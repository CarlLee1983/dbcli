import { parseWhereClause } from '@/utils/where-parser'
import type { DmlPlanIntent } from '@/core/dml-plan'

export type MongoBuildInput =
  | { operation: 'insert'; target: string; data: Record<string, unknown> }
  | {
      operation: 'update'
      target: string
      set: Record<string, unknown>
      rawWhere: string
    }
  | { operation: 'delete'; target: string; rawWhere: string }

function normalizeCollection(target: string): string {
  const trimmed = (target ?? '').trim()
  if (trimmed === '') {
    throw new Error('MongoDB collection name is required')
  }
  return trimmed
}

function parseMongoFilter(rawWhere: string): Record<string, unknown> {
  const trimmed = (rawWhere ?? '').trim()
  if (trimmed === '') return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    throw new Error('MongoDB --where must be a JSON object or simple key=value expression')
  } catch {
    try {
      return parseWhereClause(trimmed)
    } catch {
      throw new Error('MongoDB --where must be a JSON object or simple key=value expression')
    }
  }
}

export function buildMongoDmlPlan(input: MongoBuildInput): DmlPlanIntent {
  const target = normalizeCollection(input.target)

  if (input.operation === 'insert') {
    return { operation: 'insert', target, data: input.data }
  }

  if (input.operation === 'update') {
    const where = parseMongoFilter(input.rawWhere)
    return {
      operation: 'update',
      target,
      set: input.set,
      where,
      rawWhere: input.rawWhere,
    }
  }

  const where = parseMongoFilter(input.rawWhere)
  return { operation: 'delete', target, where, rawWhere: input.rawWhere }
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

const MONGO_UPDATE_OPERATOR_ALLOWLIST = new Set(['$set', '$unset'])
const MONGO_BROAD_FILTER_OPERATORS = new Set([
  '$regex',
  '$in',
  '$nin',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$ne',
  '$exists',
  '$or',
  '$and',
  '$nor',
  '$not',
  '$expr',
  '$text',
])

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

function extractMongoWrittenFields(setDoc: Record<string, unknown>): {
  fields: string[]
  operators: string[]
  hasUnsupportedOperator: boolean
} {
  const fields = new Set<string>()
  const operators: string[] = []
  let hasUnsupportedOperator = false
  const hasAnyOperator = Object.keys(setDoc).some((k) => k.startsWith('$'))

  if (!hasAnyOperator) {
    for (const k of Object.keys(setDoc)) fields.add(k)
    return { fields: Array.from(fields), operators: [], hasUnsupportedOperator: false }
  }

  for (const [op, payload] of Object.entries(setDoc)) {
    operators.push(op)
    if (!MONGO_UPDATE_OPERATOR_ALLOWLIST.has(op)) {
      hasUnsupportedOperator = true
      continue
    }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      for (const k of Object.keys(payload as Record<string, unknown>)) fields.add(k)
    }
  }

  return { fields: Array.from(fields), operators, hasUnsupportedOperator }
}

function hasIdEquality(where: Record<string, unknown>): boolean {
  if (!('_id' in where)) return false
  const value = where._id
  if (value === null || value === undefined) return false
  if (typeof value === 'object') return false
  return true
}

function hasNonIdEquality(where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === '_id') continue
    if (key.startsWith('$')) continue
    if (value === null) continue
    if (typeof value === 'object') continue
    return true
  }
  return false
}

function hasBroadFilter(where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (MONGO_BROAD_FILTER_OPERATORS.has(key)) return true
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const inner of Object.keys(value as Record<string, unknown>)) {
        if (MONGO_BROAD_FILTER_OPERATORS.has(inner)) return true
      }
    }
  }
  return false
}

function applyPermission(
  operation: 'insert' | 'update' | 'delete',
  context: NonSqlAnalyzerContext,
  factors: QueryRiskFactor[]
): void {
  const permResult = checkPermission(permissionSql(operation), context.permission)
  if (!permResult.allowed) {
    pushFactor(factors, 'permission_denied', 'block', permResult.reason)
  }
}

function applyTableBlacklist(
  target: string,
  context: NonSqlAnalyzerContext,
  factors: QueryRiskFactor[]
): void {
  const blacklisted = (context.blacklist.tables ?? []).map((t) => t.toLowerCase())
  if (blacklisted.includes(target.toLowerCase())) {
    pushFactor(factors, 'table_blacklisted', 'block', `Target collection ${target} is blacklisted.`)
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
        `MongoDB write would touch blacklisted field ${target}.${field}.`
      )
    }
  }
}

function applySchemaCoverage(
  target: string,
  context: NonSqlAnalyzerContext,
  factors: QueryRiskFactor[]
): void {
  const schemaTables = Object.keys(context.schema)
  if (schemaTables.length === 0) {
    pushFactor(
      factors,
      'schema_cache_missing',
      'warn',
      'Schema cache is missing for the selected connection.'
    )
    return
  }
  const known = schemaTables.some((t) => t.toLowerCase() === target.toLowerCase())
  if (!known) {
    pushFactor(
      factors,
      'schema_table_unknown',
      'warn',
      `Target collection ${target} is missing from schema cache.`
    )
  }
}

function buildRecommendations(factors: QueryRiskFactor[]): string[] {
  const out = new Set<string>()
  const codes = new Set(factors.map((f) => f.code))
  if (codes.has('nonsql_filter_empty')) {
    out.add('Add an _id equality filter before executing this MongoDB write.')
  }
  if (codes.has('nonsql_missing_id')) {
    out.add('Prefer an _id equality filter before executing this MongoDB write.')
  }
  if (codes.has('nonsql_filter_broad')) {
    out.add('Narrow the filter to an _id equality or a tightly bounded condition.')
  }
  if (codes.has('nonsql_unsupported_operator')) {
    out.add('Restrict the update document to $set / $unset for planner-safe writes.')
  }
  if (codes.has('permission_denied')) {
    out.add('Switch to a connection with sufficient permission only if the operation is intended.')
  }
  if (codes.has('table_blacklisted') || codes.has('blacklisted_column')) {
    out.add('Review blacklist rules before accessing sensitive data.')
  }
  if (codes.has('schema_cache_missing') || codes.has('schema_table_unknown')) {
    out.add('Refresh schema cache for the target collection before executing.')
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

export const analyzeMongoDmlRisk: NonSqlAnalyzer = (intent, context) => {
  const factors: QueryRiskFactor[] = []
  applyPermission(intent.operation, context, factors)
  applyTableBlacklist(intent.target, context, factors)

  if (intent.operation === 'insert') {
    applyColumnBlacklist(intent.target, Object.keys(intent.data), context, factors)
  } else if (intent.operation === 'update') {
    const { fields, hasUnsupportedOperator } = extractMongoWrittenFields(intent.set)
    if (hasUnsupportedOperator) {
      pushFactor(
        factors,
        'nonsql_unsupported_operator',
        'block',
        'MongoDB update uses an operator outside the MVP allowlist ($set, $unset).'
      )
    }
    applyColumnBlacklist(intent.target, fields, context, factors)
    const where = intent.where ?? {}
    if (Object.keys(where).length === 0) {
      pushFactor(
        factors,
        'nonsql_filter_empty',
        'block',
        'MongoDB update filter is empty and would match every document.'
      )
    } else if (!hasIdEquality(where)) {
      if (hasBroadFilter(where)) {
        pushFactor(
          factors,
          'nonsql_filter_broad',
          'warn',
          'MongoDB update filter uses a broad operator and may match multiple documents.'
        )
      } else if (hasNonIdEquality(where)) {
        pushFactor(
          factors,
          'nonsql_missing_id',
          'warn',
          'MongoDB update filter does not use _id and may match multiple documents.'
        )
      } else {
        pushFactor(
          factors,
          'nonsql_filter_broad',
          'warn',
          'MongoDB update filter is not an _id equality and may match multiple documents.'
        )
      }
    }
  } else {
    const where = intent.where ?? {}
    if (Object.keys(where).length === 0) {
      pushFactor(
        factors,
        'nonsql_filter_empty',
        'block',
        'MongoDB delete filter is empty and would match every document.'
      )
    } else if (!hasIdEquality(where)) {
      if (hasBroadFilter(where)) {
        pushFactor(
          factors,
          'nonsql_filter_broad',
          'warn',
          'MongoDB delete filter uses a broad operator and may match multiple documents.'
        )
      } else if (hasNonIdEquality(where)) {
        pushFactor(
          factors,
          'nonsql_missing_id',
          'warn',
          'MongoDB delete filter does not use _id and may match multiple documents.'
        )
      } else {
        pushFactor(
          factors,
          'nonsql_filter_broad',
          'warn',
          'MongoDB delete filter is not an _id equality and may match multiple documents.'
        )
      }
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
