import type { TableSchema } from '@/adapters/types'
import type { BlacklistConfig } from '@/types/blacklist'
import type { Permission } from '@/types'
import type { SqlDialect, StatementType } from '@/core/permission-guard'

export type QueryRiskDecision = 'ALLOW' | 'WARN' | 'BLOCK'
export type QueryRiskSeverity = 'warn' | 'block'

export type QueryRiskOperation =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'SHOW'
  | 'DESCRIBE'
  | 'EXPLAIN'
  | 'DDL'
  | 'UNKNOWN'

export type QueryRiskFactorCode =
  | 'write_missing_where'
  | 'permission_denied'
  | 'table_blacklisted'
  | 'destructive_ddl'
  | 'unsupported_ddl'
  | 'unknown_write_or_ddl'
  | 'unknown_read'
  | 'select_star'
  | 'large_table_unfiltered'
  | 'schema_cache_missing'
  | 'schema_table_unknown'
  | 'blacklisted_column'
  /** A blacklist entry the matcher cannot read — ADR-0019 Decision 3. */
  | 'blacklist_unreadable'
  | 'partial_schema_coverage'
  | 'nonsql_filter_empty'
  | 'nonsql_filter_broad'
  | 'nonsql_missing_id'
  | 'nonsql_unsupported_operator'
  | 'nonsql_unsupported_bulk'
  | 'nonsql_key_pattern_broad'
  | 'nonsql_dynamic_schema_unknown'
  | 'nonsql_overwrite_unknown'
  | 'mongo_rename_operator'
  | 'mongo_arithmetic_operator'
  | 'mongo_array_operator'
  | 'mongo_bitwise_operator'
  | 'mongo_unknown_operator'

export interface QueryRiskFactor {
  code: QueryRiskFactorCode
  severity: QueryRiskSeverity
  message: string
}

export interface QueryRiskResult {
  decision: QueryRiskDecision
  operation: QueryRiskOperation
  targetTables: string[]
  riskFactors: QueryRiskFactor[]
  recommendations: string[]
  suggestedCommands: string[]
}

export interface SchemaLookup {
  tables: Record<string, TableSchema>
  cacheAvailable: boolean
}

export interface AnalyzeQueryRiskInput {
  sql: string
  permission: Permission
  blacklist: BlacklistConfig
  schemaLookup: SchemaLookup
  /**
   * The connection's SQL dialect. Without it the permission check falls back to
   * judging every dialect at once, which reports a legitimate MySQL query as
   * multi-statement when a `#` comment or backtick identifier holds a semicolon.
   */
  dialect?: SqlDialect
}

export interface QueryRiskFormatOptions {
  format: 'text' | 'json'
}

export function mapStatementTypeToRiskOperation(type: StatementType): QueryRiskOperation {
  if (type === 'DROP' || type === 'TRUNCATE' || type === 'ALTER' || type === 'CREATE') {
    return 'DDL'
  }
  if (
    type === 'SELECT' ||
    type === 'INSERT' ||
    type === 'UPDATE' ||
    type === 'DELETE' ||
    type === 'SHOW' ||
    type === 'DESCRIBE' ||
    type === 'EXPLAIN'
  ) {
    return type
  }
  return 'UNKNOWN'
}
