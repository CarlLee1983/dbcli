// src/core/repl/types.ts

export type InputType = 'sql' | 'command' | 'meta' | 'empty'

export interface ClassifiedInput {
  readonly type: InputType
  readonly raw: string
  readonly normalized: string
}

export type OutputFormat = 'table' | 'json' | 'csv'

export interface ReplState {
  readonly format: OutputFormat
  readonly timing: boolean
  readonly connected: boolean
  /** When true, Redis size-guard rewrites/truncations are bypassed (unsafe). */
  readonly noLimit: boolean
}

export interface ReplContext {
  readonly configPath: string
  readonly permission: import('../../types').Permission
  readonly system: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'redis' | 'elasticsearch'
  readonly tableNames: readonly string[]
  readonly columnsByTable: Readonly<Record<string, readonly string[]>>
  /**
   * REPL-visible top-level command names (denylist already applied), derived
   * once from the live Commander tree and injected here so completion/dispatch
   * never depend on mutable module-level state.
   */
  readonly commandNames: readonly string[]
}

/**
 * The write gate, asked before a typed statement reaches the adapter.
 *
 * A callback rather than a call into `@/commands/write-gate-prompt` because the
 * gate has to ask a person, and ADR 0009 keeps every stream write out of
 * `src/core` — the same shape `DataExecutor` and `DDLExecutor` already use for
 * their confirmations. Returns true when the statement may run; a refusal or a
 * mistyped confirmation comes back as false, never as a thrown error, because
 * the shell must survive it and return to the prompt.
 */
export type ReplWriteGate = (sql: string) => Promise<boolean>

/**
 * The audit sink, asked to record a statement before and after it runs.
 *
 * A callback for the same reason `ReplWriteGate` is one: ADR 0009 keeps every
 * stream and file write out of `src/core`, so the engine states what happened
 * and `src/commands/shell.ts` decides where it lands.
 *
 * `attempt` is written before the statement reaches the adapter and `outcome`
 * after it returns or throws — the pair `EsShellAuditSink` already writes, for
 * the reason recorded there: a row written only on the way back cannot
 * describe a statement that never came back. ADR-0016.
 */
export type ReplAuditSink = (record: {
  phase: 'attempt' | 'outcome'
  success: boolean
  statement: string
}) => Promise<import('../audit/logger').AuditWriteResult>

export interface MetaCommandResult {
  readonly action: 'continue' | 'quit' | 'clear'
  readonly output?: string
  readonly stateUpdate?: Partial<Pick<ReplState, 'format' | 'timing' | 'noLimit'>>
}

export const SQL_KEYWORDS_FOR_DETECTION: readonly string[] = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'SHOW',
  'DESCRIBE',
  'EXPLAIN',
  'WITH',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'GRANT',
  'REVOKE',
] as const

export const SQL_KEYWORDS_FOR_COMPLETION: readonly string[] = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'CROSS',
  'ON',
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'IS',
  'NULL',
  'AS',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'TABLE',
  'INDEX',
  'DISTINCT',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'UNION',
  'ALL',
  'ASC',
  'DESC',
  'PRIMARY',
  'KEY',
  'FOREIGN',
  'REFERENCES',
  'CONSTRAINT',
  'UNIQUE',
  'NOT NULL',
  'DEFAULT',
  'CASCADE',
  'RESTRICT',
  'CHECK',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'GRANT',
  'REVOKE',
] as const

export const META_COMMANDS: readonly string[] = [
  '.help',
  '.quit',
  '.exit',
  '.clear',
  '.format',
  '.history',
  '.timing',
  '.no-limit',
] as const
