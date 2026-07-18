import type { SqlDatabaseSystem, TableSchema, ColumnSchema } from '@/adapters/types'

export type LintSeverity = 'info' | 'warn' | 'error'
export type AstNode = Record<string, unknown>

export interface LintFinding {
  rule: string
  severity: LintSeverity
  message: string
  span: { start: number; end: number }
  rewrite?: { sql: string; confidence: 'high' | 'medium' | 'low' }
  verifyCommand?: string
  schemaVerified: boolean
}

export interface LintReport {
  sql: string
  label?: string
  dialect: SqlDatabaseSystem
  findings: LintFinding[]
  skippedRules: { rule: string; reason: string }[]
  relatedCommands: string[]
  parseError?: string
}

/** Read-only view over the local schema cache. Implemented in context.ts. */
export interface SchemaContext {
  available: boolean
  getTable(name: string): TableSchema | undefined
  /** Resolve a column across candidate tables; first match wins. */
  resolveColumn(
    tables: string[],
    column: string
  ): { table: string; column: ColumnSchema } | undefined
}

export interface LintRuleContext {
  system: SqlDatabaseSystem
  sql: string
  ast: AstNode
  schema: SchemaContext
}

export interface LintRule {
  name: string
  requiresSchema: boolean
  check(ctx: LintRuleContext): LintFinding[]
}

export function verifyWith(sql: string): string {
  return `dbcli explain --analyze "${sql.replace(/[\\$`"]/g, '\\$&')}"`
}
