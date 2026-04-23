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
}

export interface ReplContext {
  readonly configPath: string
  readonly permission: import('../../types').Permission
  readonly system: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb'
  readonly tableNames: readonly string[]
  readonly columnsByTable: Readonly<Record<string, readonly string[]>>
}

export interface MetaCommandResult {
  readonly action: 'continue' | 'quit' | 'clear'
  readonly output?: string
  readonly stateUpdate?: Partial<Pick<ReplState, 'format' | 'timing'>>
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

export const DBCLI_COMMANDS: readonly string[] = [
  'list',
  'schema',
  'query',
  'insert',
  'update',
  'delete',
  'export',
  'blacklist',
  'check',
  'diff',
  'status',
  'doctor',
  'skill',
  'init',
  'completion',
  'upgrade',
  'migrate',
] as const

export const META_COMMANDS: readonly string[] = [
  '.help',
  '.quit',
  '.exit',
  '.clear',
  '.format',
  '.history',
  '.timing',
] as const
