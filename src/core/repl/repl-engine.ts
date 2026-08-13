// src/core/repl/repl-engine.ts
import type { DatabaseAdapter } from '../../adapters/types'
import type { ReplContext, ReplState } from './types'
import type { DbcliConfig } from '../../types'
import { isTransportFailure } from '@/utils/connection-error-message'
import { classifyInput } from './input-classifier'
import { MultilineBuffer } from './multiline-buffer'
import { handleMetaCommand } from './meta-commands'
import { parseCommandLine, isKnownCommand } from './command-dispatcher'
import { HistoryManager } from './history-manager'
import {
  checkPermission,
  classifyRedisCommand,
  permissionAtLeast,
  SQL_DIALECTS,
} from '../permission-guard'
import { QueryResultFormatter } from '../../formatters/query-result-formatter'
import type { QueryResult } from '../../types/query'
import { t_vars, t } from '../../i18n/message-loader'
import pc from 'picocolors'
import { extractTableReferences } from '../../utils/sql-tables'
import { BlacklistManager } from '../blacklist-manager'
import { BlacklistValidator } from '../blacklist-validator'
import { BlacklistError } from '../../types/blacklist'

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
    config: DbcliConfig | null = null
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

  getHistory(): readonly string[] {
    return this.history.getAll()
  }

  async saveHistory(): Promise<void> {
    await this.history.save()
  }

  async processInput(line: string): Promise<ProcessResult> {
    // If in multiline mode, feed to buffer
    if (this.buffer.isActive()) {
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

    return { action: 'multiline' }
  }

  private async handleCommand(input: string): Promise<ProcessResult> {
    const parsed = parseCommandLine(input)

    if (!isKnownCommand(parsed.command, this.context.commandNames)) {
      // Non-SQL engines (Redis) accept raw single-line commands that are not dbcli
      // subcommands; execute them directly instead of rejecting. SQL engines keep
      // the unknown-command behavior.
      if (this.context.system === 'redis') {
        this.history.add(input)
        return this.executeSql(input)
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

      // Build argv: [command, --config, current-config, ...args]
      const argv = [parsed.command, '--config', this.context.configPath, ...parsed.args]

      // Spawn a subprocess to run the dbcli command
      const proc = Bun.spawn(['bun', 'run', cliPath, ...argv], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env },
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
        return {
          action: 'continue',
          output: pc.red(
            t_vars('shell.error_permission', {
              required: permResult.classification.type === 'UNKNOWN' ? 'admin' : 'read-write',
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
        return {
          action: 'continue',
          output: pc.red(t_vars('shell.error_blacklisted', { table: error.message })),
        }
      }
    }

    const startTime = Date.now()

    try {
      const result = await this.adapter.execute<Record<string, unknown>>(sql, undefined, {
        noLimit: this.state.noLimit,
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
          // Retry the query once
          return this.executeSql(sql)
        } catch (reconnectError) {
          return {
            action: 'continue',
            output: pc.red(
              t_vars('shell.error_reconnect_failed', { message: (reconnectError as Error).message })
            ),
          }
        }
      }

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
