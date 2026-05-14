import type { DmlPlanIntent } from '@/core/dml-plan'

export type RedisBuildInput =
  | { operation: 'insert'; target: string; data: Record<string, unknown> }
  | { operation: 'update'; target: string; set: Record<string, unknown>; rawWhere: string }
  | { operation: 'delete'; target: string; rawWhere: string }

function normalizeKey(target: string): string {
  const trimmed = (target ?? '').trim()
  if (trimmed === '') {
    throw new Error('Redis key is required as the positional <target>')
  }
  return trimmed
}

export function buildRedisDmlPlan(input: RedisBuildInput): DmlPlanIntent {
  const target = normalizeKey(input.target)

  if (input.operation === 'insert') {
    return { operation: 'insert', target, data: input.data }
  }

  if (input.operation === 'update') {
    return {
      operation: 'update',
      target,
      set: input.set,
      where: null,
      rawWhere: input.rawWhere,
    }
  }

  return { operation: 'delete', target, where: null, rawWhere: input.rawWhere }
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

function classifyKey(target: string): 'single' | 'pattern' | 'all' {
  if (target === '*') return 'all'
  if (target.includes('*') || target.includes('?') || /\[.+\]/.test(target)) return 'pattern'
  return 'single'
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
    pushFactor(factors, 'table_blacklisted', 'block', `Redis key ${target} is blacklisted.`)
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
        `Redis write would touch blacklisted field ${target}.${field}.`
      )
    }
  }
}

function redisSchemaKeyMatches(schemaKey: string, target: string): boolean {
  const lowerKey = schemaKey.toLowerCase()
  const lowerTarget = target.toLowerCase()
  if (lowerKey === lowerTarget) return true
  if (!lowerKey.includes('*') && !lowerKey.includes('?')) return false
  const pattern = lowerKey
    .split('')
    .map((ch) => {
      if (ch === '*') return '.*'
      if (ch === '?') return '.'
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${pattern}$`).test(lowerTarget)
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
      'Schema/key metadata is missing for the selected Redis connection.'
    )
    return
  }
  const known = tables.some((t) => redisSchemaKeyMatches(t, target))
  if (!known) {
    pushFactor(
      factors,
      'schema_table_unknown',
      'warn',
      `Redis key namespace ${target} is missing from cached metadata.`
    )
  }
}

function buildRecommendations(factors: QueryRiskFactor[]): string[] {
  const out = new Set<string>()
  const codes = new Set(factors.map((f) => f.code))
  if (codes.has('nonsql_key_pattern_broad')) {
    out.add('Specify a concrete single key instead of a wildcard pattern.')
  }
  if (codes.has('nonsql_overwrite_unknown')) {
    out.add('Provide --set field information so the planner can verify the write target.')
  }
  if (codes.has('permission_denied')) {
    out.add('Switch to a connection with sufficient permission only if the operation is intended.')
  }
  if (codes.has('table_blacklisted') || codes.has('blacklisted_column')) {
    out.add('Review blacklist rules before accessing sensitive data.')
  }
  if (codes.has('schema_cache_missing') || codes.has('schema_table_unknown')) {
    out.add('Refresh schema cache for the target Redis namespace before executing.')
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

export const analyzeRedisDmlRisk: NonSqlAnalyzer = (intent, context) => {
  const factors: QueryRiskFactor[] = []
  applyPermission(intent.operation, context, factors)
  applyTableBlacklist(intent.target, context, factors)

  const keyClass = classifyKey(intent.target)
  if (keyClass === 'all') {
    pushFactor(
      factors,
      'nonsql_key_pattern_broad',
      'block',
      'Redis key "*" matches every key and is unsafe for planner-level writes.'
    )
  } else if (keyClass === 'pattern') {
    pushFactor(
      factors,
      'nonsql_key_pattern_broad',
      'warn',
      `Redis target ${intent.target} contains wildcard characters and may match multiple keys.`
    )
  }

  if (intent.operation === 'insert') {
    applyColumnBlacklist(intent.target, Object.keys(intent.data), context, factors)
  } else if (intent.operation === 'update') {
    const fields = Object.keys(intent.set)
    if (fields.length === 0) {
      pushFactor(
        factors,
        'nonsql_overwrite_unknown',
        'warn',
        'Redis update has no field information and overwrite impact cannot be verified.'
      )
    }
    applyColumnBlacklist(intent.target, fields, context, factors)
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
