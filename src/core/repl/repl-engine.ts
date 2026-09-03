// src/core/repl/repl-engine.ts
import { ConnectionError, type DatabaseAdapter } from '../../adapters/types'
import type { ReplAuditSink, ReplContext, ReplState, ReplWriteGate } from './types'
import type { DbcliConfig } from '../../types'
import { isTransportFailure } from '@/utils/connection-error-message'
import { classifyInput, COMMAND_PREFIX } from './input-classifier'
import { MultilineBuffer } from './multiline-buffer'
import { handleMetaCommand } from './meta-commands'
import { parseCommandLine, isKnownCommand } from './command-dispatcher'
import { HistoryManager } from './history-manager'
import { checkPermission, permissionAtLeast, SQL_DIALECTS } from '../permission-guard'
import { classifyRedisCommand } from '../permission/redis'
import { QueryResultFormatter } from '../../formatters/query-result-formatter'
import type { QueryResult } from '../../types/query'
import { t_vars, t } from '../../i18n/message-loader'
import pc from 'picocolors'
import { extractTableReferences } from '../../utils/sql-tables'
import { BlacklistManager } from '../blacklist-manager'
import { BlacklistValidator } from '../blacklist-validator'
import { BlacklistError } from '../../types/blacklist'

/**
 * Words that follow a write keyword in SQL but never in a dbcli invocation,
 * where the second word is the table or the first option.
 */
const STATEMENT_CONTINUATION = new Set([
  'FROM',
  'INTO',
  'SET',
  'TABLE',
  'INDEX',
  'VIEW',
  'DATABASE',
])

export interface ProcessResult {
  readonly action: 'continue' | 'quit' | 'clear' | 'multiline'
  readonly output?: string
}

export class ReplEngine {
  private state: ReplState
  private readonly buffer: MultilineBuffer
  private readonly history: HistoryManager
  private readonly formatter: QueryResultFormatter
  private readonly config: DbcliConfig | null

  constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly context: ReplContext,
    historyPath: string,
    config: DbcliConfig | null = null,
    /**
     * Supplied by `src/commands/shell.ts` for SQL engines only. Absent means no
     * gate — Redis and MongoDB statements have a different shape and their own
     * permission guards (#78).
     */
    private readonly writeGate: ReplWriteGate | null = null,
    /**
     * Absent means no audit, which is what every caller but the SQL shell
     * passes today. ADR-0016.
     */
    private readonly auditSink: ReplAuditSink | null = null
  ) {
    this.state = { format: 'table', timing: false, connected: true, noLimit: false }
    this.buffer = new MultilineBuffer()
    this.history = new HistoryManager(historyPath)
    this.formatter = new QueryResultFormatter()
    this.config = config
  }

  getState(): Readonly<ReplState> {
    return this.state
  }

  isMultiline(): boolean {
    return this.buffer.isActive()
  }

  /**
   * Throw away a half-typed statement.
   *
   * Ctrl-C printed "Multiline input cancelled" and left the buffer holding what
   * had been typed, so the next statement was appended to the abandoned one and
   * came back as a syntax error naming a keyword the operator had not just
   * typed. `MultilineBuffer.reset` existed all along with nobody calling it.
   */
  cancelMultiline(): void {
    this.buffer.reset()
  }

  getHistory(): readonly string[] {
    return this.history.getAll()
  }

  async saveHistory(): Promise<void> {
    await this.history.save()
  }

  async processInput(line: string): Promise<ProcessResult> {
    // If in multiline mode, feed to buffer
    if (this.buffer.isActive()) {
      // Except for the shell's own commands, which stay reachable. Everything
      // typed after a statement opened multiline mode used to go into the
      // buffer, `.quit` included, so a line misread as SQL left a shell that
      // looked dead and could only be ended from outside (#88). Only the names
      // the shell implements are lifted out — `.5` is part of a decimal
      // literal, not a command — and neither is a line inside an unterminated
      // string literal, where lifting it out would corrupt the statement.
      const classified = classifyInput(line)
      if (classified.type === 'meta' && !this.buffer.isInsideLiteral()) {
        const result = this.handleMeta(classified.normalized)
        if (result.action === 'quit' || result.action === 'clear') this.buffer.reset()
        return result
      }

      const bufResult = this.buffer.append(line)
      if (bufResult.complete) {
        this.history.add(bufResult.sql!)
        return this.executeSql(bufResult.sql!)
      }
      return { action: 'multiline' }
    }

    const classified = classifyInput(line)

    switch (classified.type) {
      case 'empty':
        return { action: 'continue' }

      case 'meta':
        return this.handleMeta(classified.normalized)

      case 'sql':
        return this.handleSql(classified.normalized)

      case 'command':
        return this.handleCommand(classified.normalized)
    }
  }

  private handleMeta(input: string): ProcessResult {
    this.history.add(input)
    const result = handleMetaCommand(input, this.state, [...this.history.getAll()])

    if (result.stateUpdate) {
      this.state = { ...this.state, ...result.stateUpdate }
    }

    return {
      action: result.action,
      output: result.output,
    }
  }

  private handleSql(input: string): Promise<ProcessResult> | ProcessResult {
    const bufResult = this.buffer.append(input)

    if (bufResult.complete) {
      this.history.add(bufResult.sql!)
      return this.executeSql(bufResult.sql!)
    }

    const hint = this.subcommandHint(input)
    return hint ? { action: 'multiline', output: hint } : { action: 'multiline' }
  }

  /**
   * Say how to reach the subcommand, for a line that was almost certainly meant
   * as one.
   *
   * `delete users --where status=active` is SQL by decision and correct as such:
   * it is a statement waiting for its semicolon. It is also completely opaque to
   * whoever meant `dbcli delete`, who sees the prompt change and nothing else.
   * This changes nothing about what the line is — it only names the prefix.
   *
   * Three conditions, because two were not enough: the first word is a
   * subcommand, the line carries a double-dash option, and the second word is
   * not a keyword that continues the statement. `--` also opens a SQL comment,
   * so `DELETE FROM t --keep this` met the first two and printed a hint for
   * ordinary SQL (#88).
   */
  private subcommandHint(input: string): string | undefined {
    const words = input.trim().split(/\s+/)
    const firstWord = (words[0] ?? '').toLowerCase()
    if (!this.context.commandNames.includes(firstWord)) return undefined
    if (!/\s--[a-z]/.test(input)) return undefined
    if (STATEMENT_CONTINUATION.has((words[1] ?? '').toUpperCase())) return undefined

    return pc.dim(
      t_vars('shell.subcommand_prefix_hint', { command: `${COMMAND_PREFIX}${firstWord}` })
    )
  }

  private async handleCommand(input: string): Promise<ProcessResult> {
    // The prefix reaches this layer and is removed here rather than in the
    // classifier, so history keeps the line as it was typed and recall replays
    // something that still works.
    const invocation = input.startsWith(COMMAND_PREFIX) ? input.slice(COMMAND_PREFIX.length) : input
    const parsed = parseCommandLine(invocation)

    if (!isKnownCommand(parsed.command, this.context.commandNames)) {
      // Non-SQL engines (Redis) accept raw single-line commands that are not dbcli
      // subcommands; execute them directly instead of rejecting. SQL engines keep
      // the unknown-command behavior.
      if (this.context.system === 'redis') {
        // History keeps the line as typed; execution gets it without the prefix,
        // or the backslash reaches the permission classifier as part of the
        // command name and every tier denies it.
        this.history.add(input)
        return this.executeSql(invocation)
      }
      return {
        action: 'continue',
        output: t_vars('shell.unknown_command', { command: parsed.command }),
      }
    }

    this.history.add(input)

    try {
      // Resolve the dbcli CLI entry point path
      const cliPath = new URL('../../cli.ts', import.meta.url).pathname

      // `--config` goes ahead of the command, where the program-level option
      // lives. Behind it, Commander hands it to the subcommand, and the ones
      // that do not declare their own — `query`, `insert`, `update`, `delete`,
      // every write path — died with "unknown option '--config'" before doing
      // anything. Commands that do declare it still read this: an explicitly
      // set ancestor option outranks their own default (`resolveConfigPath`).
      const argv = ['--config', this.context.configPath, parsed.command, ...parsed.args]

      // Spawn a subprocess to run the dbcli command
      const proc = Bun.spawn(['bun', 'run', cliPath, ...argv], {
        stdout: 'pipe',
        stderr: 'pipe',
        // The child gets no stdin (Bun's default is `ignore`), so anything that
        // needs an answer — the tier-two write gate above all — sees an
        // unattended caller and refuses. That refusal is correct, but its
        // ordinary wording ("nobody is here", "run it from an interactive
        // terminal") is the opposite of what the operator sees: they are at a
        // terminal, in this shell. The marker lets the refusal say something
        // they can act on instead (#84).
        env: { ...process.env, DBCLI_SHELL_SUBCOMMAND: '1' },
      })

      const [stdoutBuf, stderrBuf] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])

      const stdout = stdoutBuf
      const stderr = stderrBuf

      // Issue 2 fix: check exit code and surface stderr as error output when non-zero
      const exitCode = await proc.exited

      if (exitCode !== 0 && stderr.trim()) {
        return { action: 'continue', output: pc.red(stderr.trimEnd()) }
      }

      if (stderr.trim()) {
        console.error(stderr.trimEnd())
      }

      return { action: 'continue', output: stdout.trimEnd() || undefined }
    } catch (error) {
      return {
        action: 'continue',
        output: pc.red(t_vars('shell.error_command_failed', { message: (error as Error).message })),
      }
    }
  }

  private async executeSql(sql: string): Promise<ProcessResult> {
    // Permission check — Redis uses its own command classifier, since the SQL
    // classifier marks every Redis verb as UNKNOWN and would deny all of them.
    if (this.context.system === 'redis') {
      const denied = this.checkRedisPermission(sql)
      if (denied) return denied
    } else {
      const permResult = checkPermission(
        sql,
        this.context.permission,
        SQL_DIALECTS.find((dialect) => dialect === this.context.system)
      )
      if (!permResult.allowed) {
        // Refused, so it was never attempted: the pair collapses to the half
        // that happened. ADR-0016.
        await this.auditSink?.({ phase: 'outcome', success: false, statement: sql })
        return {
          action: 'continue',
          output: pc.red(
            t_vars('shell.error_permission', {
              // checkPermission already derives the lowest level that grants
              // this statement, from the same table the decision uses. Guessing
              // here instead told a read-write user that DELETE "Required:
              // read-write" — a refusal whose stated requirement was already met.
              required: permResult.requiredPermission ?? 'admin',
              current: this.context.permission,
            })
          ),
        }
      }
    }

    // Blacklist check. The shell talks to the adapter directly rather than
    // through QueryExecutor, so this is the only table check on this path, and
    // it has to see every referenced table — a JOIN, a comma, or a UNION branch
    // reaches a table the leading FROM never names (issue #23).
    const referencedTables = extractTableReferences(sql, {
      dialect: SQL_DIALECTS.find((dialect) => dialect === this.context.system),
    })
    const blacklistValidator = this.config?.blacklist
      ? new BlacklistValidator(new BlacklistManager(this.config))
      : undefined
    if (blacklistValidator && referencedTables.length > 0) {
      try {
        blacklistValidator.checkTablesBlacklist('SELECT', referencedTables)
      } catch (error) {
        if (!(error instanceof BlacklistError)) throw error
        await this.auditSink?.({ phase: 'outcome', success: false, statement: sql })
        return {
          action: 'continue',
          output: pc.red(t_vars('shell.error_blacklisted', { table: error.message })),
        }
      }
    }

    // The write gate, last of the three checks and the only one that asks a
    // person. It sits outside `runStatement` so a reconnect retry does not ask
    // again for a statement that was already confirmed.
    // No output on refusal: the gate has already told the operator on stderr
    // why nothing ran, and it is the only half that can tell a decline from a
    // refusal. A second line from here would repeat it on stdout, which is the
    // channel ADR 0009 keeps clear for results.
    if (this.writeGate && !(await this.writeGate(sql))) {
      await this.auditSink?.({ phase: 'outcome', success: false, statement: sql })
      return { action: 'continue' }
    }

    return this.runStatement(sql, blacklistValidator, referencedTables)
  }

  /**
   * Send a statement that has already passed permission, blacklist and the
   * write gate, format what comes back, and reconnect once if the socket died.
   */
  private async runStatement(
    sql: string,
    blacklistValidator: BlacklistValidator | undefined,
    referencedTables: string[]
  ): Promise<ProcessResult> {
    const startTime = Date.now()

    // Before the adapter, not after: a statement killed mid-flight still
    // changed the data, and the outcome row is the one that will be missing.
    await this.auditSink?.({ phase: 'attempt', success: true, statement: sql })

    try {
      const result = await this.adapter.execute<Record<string, unknown>>(sql, undefined, {
        noLimit: this.state.noLimit,
        sqlMode:
          this.context.permission === 'query-only' &&
          ['postgresql', 'mysql', 'mariadb'].includes(this.context.system)
            ? 'native-read-only'
            : 'normal',
      })
      const elapsed = Date.now() - startTime
      const fetched = result.rows

      const fetchedColumns = fetched.length > 0 && fetched[0] ? Object.keys(fetched[0]) : []
      // The shell used to format adapter rows directly, so `blacklist.columns`
      // was never applied here — `SELECT * FROM users` returned every protected
      // column that `dbcli query` hides.
      const filtered = blacklistValidator
        ? blacklistValidator.filterColumnsForTables(referencedTables, fetched, fetchedColumns)
        : { filteredRows: fetched, omittedColumns: [] as string[] }
      const rows = filtered.filteredRows
      const columnNames = fetchedColumns.filter((col) => !filtered.omittedColumns.includes(col))
      const queryResult: QueryResult<Record<string, unknown>> = {
        rows,
        rowCount: rows.length,
        columnNames,
        executionTimeMs: elapsed,
      }

      const formatted = this.formatter.format(queryResult, {
        format: this.state.format,
      })

      // Simple tab-separated output for table/csv formats
      let output = formatted
      if (this.state.timing) {
        output += '\n' + pc.dim(t_vars('shell.timing_display', { ms: String(elapsed) }))
      }

      this.state = { ...this.state, connected: true }
      await this.auditSink?.({ phase: 'outcome', success: true, statement: sql })
      return { action: 'continue', output }
    } catch (error) {
      // Attempt auto-reconnect once on connection errors
      if (this.isConnectionError(error) && this.state.connected) {
        this.state = { ...this.state, connected: false }
        try {
          console.error(pc.yellow(t('shell.error_reconnecting')))
          await this.adapter.connect()
          this.state = { ...this.state, connected: true }
          console.error(pc.green(t('shell.error_reconnect_success')))
          if (error instanceof ConnectionError && !error.retrySafe) {
            await this.auditSink?.({ phase: 'outcome', success: false, statement: sql })
            return {
              action: 'continue',
              output: pc.red(t_vars('shell.error_sql_failed', { message: error.message })),
            }
          }
          // Retry the query once. Back into `runStatement`, not `executeSql`:
          // the statement already passed the gate, and asking again after a
          // reconnect would make one typed statement two questions.
          return this.runStatement(sql, blacklistValidator, referencedTables)
        } catch (reconnectError) {
          // This branch returns without reaching the generic failure exit
          // below, so without its own row the attempt written above would
          // never be closed.
          await this.auditSink?.({ phase: 'outcome', success: false, statement: sql })
          return {
            action: 'continue',
            output: pc.red(
              t_vars('shell.error_reconnect_failed', { message: (reconnectError as Error).message })
            ),
          }
        }
      }

      await this.auditSink?.({ phase: 'outcome', success: false, statement: sql })
      return {
        action: 'continue',
        output: pc.red(t_vars('shell.error_sql_failed', { message: (error as Error).message })),
      }
    }
  }

  /**
   * Permission gate for Redis commands. Returns a denial ProcessResult when the
   * command is not whitelisted or exceeds the current permission tier, or null
   * when execution is allowed.
   */
  private checkRedisPermission(command: string): ProcessResult | null {
    const cls = classifyRedisCommand(command)
    if (
      cls.requiredPermission === 'unknown' ||
      !permissionAtLeast(this.context.permission, cls.requiredPermission)
    ) {
      return {
        action: 'continue',
        output: pc.red(
          t_vars('shell.error_permission', {
            required: cls.requiredPermission === 'unknown' ? 'admin' : cls.requiredPermission,
            current: this.context.permission,
          })
        ),
      }
    }
    return null
  }

  private isConnectionError(error: unknown): boolean {
    // 用 adapter 分類過的窮舉表，而不是第三份自己維護的 code 清單加訊息子字串——
    // 後者會隨著錯誤措辭被改寫而靜默失效，也認不得 CONNECTION_LOST 這類新分類。
    return isTransportFailure(error)
  }
}
