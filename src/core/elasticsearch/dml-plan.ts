import { parseWhereClause } from '@/utils/where-parser'
import type { DmlPlanIntent } from '@/core/dml-plan'

export type ElasticsearchBuildInput =
  | { operation: 'insert'; target: string; data: Record<string, unknown> }
  | {
      operation: 'update'
      target: string
      set: Record<string, unknown>
      rawWhere: string
    }
  | { operation: 'delete'; target: string; rawWhere: string }

function normalizeIndex(target: string): string {
  const trimmed = (target ?? '').trim()
  if (trimmed === '') {
    throw new Error('Elasticsearch index name is required')
  }
  return trimmed
}

function parseEsFilter(rawWhere: string): Record<string, unknown> | null {
  const trimmed = (rawWhere ?? '').trim()
  if (trimmed === '') return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    throw new Error('Elasticsearch --where must be a JSON object or simple key=value expression')
  } catch {
    try {
      return parseWhereClause(trimmed)
    } catch {
      throw new Error('Elasticsearch --where must be a JSON object or simple key=value expression')
    }
  }
}

export function buildElasticsearchDmlPlan(input: ElasticsearchBuildInput): DmlPlanIntent {
  const target = normalizeIndex(input.target)

  if (input.operation === 'insert') {
    return { operation: 'insert', target, data: input.data }
  }

  if (input.operation === 'update') {
    return {
      operation: 'update',
      target,
      set: input.set,
      where: parseEsFilter(input.rawWhere),
      rawWhere: input.rawWhere,
    }
  }

  return {
    operation: 'delete',
    target,
    where: parseEsFilter(input.rawWhere),
    rawWhere: input.rawWhere,
  }
}

import { checkPermission } from '@/core/permission-guard'
import type {
  QueryRiskFactor,
  QueryRiskFactorCode,
  QueryRiskOperation,
  QueryRiskResult,
  QueryRiskSeverity,
} from '@/types/query-risk'
import type { NonSqlAnalyzer, NonSqlAnalyzerContext } from '@/core/dml-plan'

function permissionSql(operation: 'insert' | 'update' | 'delete'): string {
  if (operation === 'insert') return 'INSERT INTO dummy'
  if (operation === 'update') return 'UPDATE dummy'
  return 'DELETE FROM dummy'
}

function broadOperation(operation: 'insert' | 'update' | 'delete'): QueryRiskOperation {
  if (operation === 'insert') return 'INSERT'
  if (operation === 'update') return 'UPDATE'
  return 'DELETE'
}

function pushFactor(
  factors: QueryRiskFactor[],
  code: QueryRiskFactorCode,
  severity: QueryRiskSeverity,
  message: string
): void {
  if (factors.some((f) => f.code === code && f.message === message)) return
  factors.push({ code, severity, message })
}

function decide(factors: QueryRiskFactor[]): QueryRiskResult['decision'] {
  if (factors.some((f) => f.severity === 'block')) return 'BLOCK'
  if (factors.some((f) => f.severity === 'warn')) return 'WARN'
  return 'ALLOW'
}

function hasIdEquality(where: Record<string, unknown> | null): boolean {
  if (!where) return false
  if (!('_id' in where)) return false
  const value = where._id
  if (value === null || value === undefined) return false
  if (typeof value === 'object') return false
  return true
}

function applyPermission(
  operation: 'insert' | 'update' | 'delete',
  context: NonSqlAnalyzerContext,
  factors: QueryRiskFactor[]
): void {
  const result = checkPermission(permissionSql(operation), context.permission)
  if (!result.allowed) {
    pushFactor(factors, 'permission_denied', 'block', result.reason)
  }
}

function applyTableBlacklist(
  target: string,
  context: NonSqlAnalyzerContext,
  factors: QueryRiskFactor[]
): void {
  const blacklisted = (context.blacklist.tables ?? []).map((t) => t.toLowerCase())
  if (blacklisted.includes(target.toLowerCase())) {
    pushFactor(
      factors,
      'table_blacklisted',
      'block',
      `Elasticsearch index ${target} is blacklisted.`
    )
  }
}

function applyColumnBlacklist(
  target: string,
  fields: string[],
  context: NonSqlAnalyzerContext,
  factors: QueryRiskFactor[]
): void {
  const columns = context.blacklist.columns ?? {}
  const lower = target.toLowerCase()
  let blacklistedFields: string[] = []
  for (const [t, cols] of Object.entries(columns)) {
    if (t.toLowerCase() === lower) {
      blacklistedFields = cols
      break
    }
  }
  if (blacklistedFields.length === 0) return
  for (const field of fields) {
    if (blacklistedFields.includes(field)) {
      pushFactor(
        factors,
        'blacklisted_column',
        'block',
        `Elasticsearch write would touch blacklisted field ${target}.${field}.`
      )
    }
  }
}

function applySchemaCoverage(
  target: string,
  context: NonSqlAnalyzerContext,
  factors: QueryRiskFactor[]
): void {
  const tables = Object.keys(context.schema)
  if (tables.length === 0) {
    pushFactor(
      factors,
      'schema_cache_missing',
      'warn',
      'Schema cache is missing for the selected Elasticsearch connection.'
    )
    return
  }
  const known = tables.some((t) => t.toLowerCase() === target.toLowerCase())
  if (!known) {
    pushFactor(
      factors,
      'schema_table_unknown',
      'warn',
      `Target index ${target} is missing from schema cache.`
    )
  }
}

function buildRecommendations(factors: QueryRiskFactor[]): string[] {
  const out = new Set<string>()
  const codes = new Set(factors.map((f) => f.code))
  if (codes.has('nonsql_missing_id')) {
    out.add('Add an _id equality filter (or include _id in the document) before executing.')
  }
  if (codes.has('nonsql_unsupported_bulk')) {
    out.add('Use a document-level write instead of a bulk or by-query operation.')
  }
  if (codes.has('permission_denied')) {
    out.add('Switch to a connection with sufficient permission only if the operation is intended.')
  }
  if (codes.has('table_blacklisted') || codes.has('blacklisted_column')) {
    out.add('Review blacklist rules before accessing sensitive data.')
  }
  if (codes.has('schema_cache_missing') || codes.has('schema_table_unknown')) {
    out.add('Refresh schema cache for the target index before executing.')
  }
  out.add('Use --dry-run on the actual write command.')
  return Array.from(out)
}

function buildSuggestedCommands(target: string, factors: QueryRiskFactor[]): string[] {
  const codes = new Set(factors.map((f) => f.code))
  if (codes.has('schema_cache_missing') || codes.has('schema_table_unknown')) {
    return [`dbcli schema ${target} --format json`]
  }
  return []
}

export const analyzeElasticsearchDmlRisk: NonSqlAnalyzer = (intent, context) => {
  const factors: QueryRiskFactor[] = []
  applyPermission(intent.operation, context, factors)
  applyTableBlacklist(intent.target, context, factors)

  if (intent.operation === 'insert') {
    const fields = Object.keys(intent.data)
    applyColumnBlacklist(intent.target, fields, context, factors)
    if (intent.data._id === undefined || intent.data._id === null || intent.data._id === '') {
      pushFactor(
        factors,
        'nonsql_missing_id',
        'warn',
        'Elasticsearch insert has no _id; auto-id generation will make later correlation harder.'
      )
    }
  } else if (intent.operation === 'update') {
    applyColumnBlacklist(intent.target, Object.keys(intent.set), context, factors)
    if (!hasIdEquality(intent.where)) {
      pushFactor(
        factors,
        'nonsql_missing_id',
        'block',
        'Elasticsearch update requires _id in --where for planner-safe document-level update.'
      )
    }
  } else {
    if (!hasIdEquality(intent.where)) {
      pushFactor(
        factors,
        'nonsql_missing_id',
        'block',
        'Elasticsearch delete requires _id in --where for planner-safe document-level deletion.'
      )
    }
  }

  applySchemaCoverage(intent.target, context, factors)

  return {
    decision: decide(factors),
    operation: broadOperation(intent.operation),
    targetTables: [intent.target],
    riskFactors: factors,
    recommendations: buildRecommendations(factors),
    suggestedCommands: buildSuggestedCommands(intent.target, factors),
  }
}
