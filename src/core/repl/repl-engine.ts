// src/core/repl/repl-engine.ts
import type { DatabaseAdapter } from '../../adapters/types'
import type { ReplContext, ReplState } from './types'
import type { DbcliConfig } from '../../types'
import { classifyInput } from './input-classifier'
import { MultilineBuffer } from './multiline-buffer'
import { handleMetaCommand } from './meta-commands'
import { parseCommandLine, isKnownCommand } from './command-dispatcher'
import { HistoryManager } from './history-manager'
import { checkPermission } from '../permission-guard'
import { QueryResultFormatter } from '../../formatters/query-result-formatter'
import type { QueryResult } from '../../types/query'
import { t_vars, t } from '../../i18n/message-loader'
import pc from 'picocolors'

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
  ) {
    this.state = { format: 'table', timing: false, connected: true }
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

  private handleSql(input: string): ProcessResult {
    const bufResult = this.buffer.append(input)

    if (bufResult.complete) {
      this.history.add(bufResult.sql!)
      return this.executeSql(bufResult.sql!)
    }

    return { action: 'multiline' }
  }

  private async handleCommand(input: string): Promise<ProcessResult> {
    const parsed = parseCommandLine(input)

    if (!isKnownCommand(parsed.command)) {
      return {
        action: 'continue',
        output: t_vars('shell.unknown_command', { command: parsed.command }),
      }
    }

    this.history.add(input)

    try {
      // Resolve the dbcli CLI entry point path
      const cliPath = new URL('../../cli.ts', import.meta.url).pathname

      // Build argv: [command, ...args]
      const argv = [parsed.command, ...parsed.args]

      // Spawn a subprocess to run the dbcli command
      const proc = Bun.spawn(
        ['bun', 'run', cliPath, ...argv],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env },
        }
      )

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
    } catch (error: any) {
      return {
        action: 'continue',
        output: pc.red(t_vars('shell.error_command_failed', { message: error.message })),
      }
    }
  }

  private async executeSql(sql: string): Promise<ProcessResult> {
    // Permission check
    const permResult = checkPermission(sql, this.context.permission)
    if (!permResult.allowed) {
      return {
        action: 'continue',
        output: pc.red(t_vars('shell.error_permission', {
          required: permResult.classification.type === 'UNKNOWN' ? 'admin' : 'read-write',
          current: this.context.permission,
        })),
      }
    }

    // Blacklist check — Issue 1 fix: also check INSERT INTO and UPDATE tablename
    if (this.config?.blacklist) {
      const tableName = this.extractTableName(sql)
      if (tableName) {
        const blacklistedTables: string[] = this.config.blacklist.tables ?? []
        const isBlacklisted = blacklistedTables.some(
          t => t.toLowerCase() === tableName.toLowerCase()
        )
        if (isBlacklisted) {
          return {
            action: 'continue',
            output: pc.red(t_vars('shell.error_blacklisted', { table: tableName })),
          }
        }
      }
    }

    const startTime = Date.now()

    try {
      const rows = await this.adapter.execute<Record<string, unknown>>(sql)
      const elapsed = Date.now() - startTime

      const columnNames = rows.length > 0 ? Object.keys(rows[0]) : []
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
    } catch (error: any) {
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
        } catch (reconnectError: any) {
          return {
            action: 'continue',
            output: pc.red(t_vars('shell.error_reconnect_failed', { message: reconnectError.message })),
          }
        }
      }

      return {
        action: 'continue',
        output: pc.red(t_vars('shell.error_sql_failed', { message: error.message })),
      }
    }
  }

  // Issue 1 fix: Match FROM tablename, INTO tablename (INSERT INTO), UPDATE tablename
  private extractTableName(sql: string): string | undefined {
    const match = sql.match(/\b(?:FROM|INTO|UPDATE)\s+["'`]?(\w+)["'`]?/i)
    return match?.[1]
  }

  private isConnectionError(error: any): boolean {
    const msg = (error.message ?? '').toLowerCase()
    return (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      msg.includes('connection') ||
      msg.includes('terminated') ||
      msg.includes('socket')
    )
  }
}
