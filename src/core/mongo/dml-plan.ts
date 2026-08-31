import { parseWhereClause } from '@/utils/where-parser'
import type { DmlPlanIntent } from '@/core/dml-plan'
import { compilePatterns, matchAny } from '@/core/mongo/path-matcher'

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

type OperatorTier = 'SAFE' | 'RENAME' | 'ARITHMETIC' | 'ARRAY' | 'BITWISE' | 'BLOCK'

const MONGO_OPERATOR_TIER: Record<string, OperatorTier> = {
  $set: 'SAFE',
  $unset: 'SAFE',
  $rename: 'RENAME',
  $inc: 'ARITHMETIC',
  $mul: 'ARITHMETIC',
  $min: 'ARITHMETIC',
  $max: 'ARITHMETIC',
  $currentDate: 'ARITHMETIC',
  $push: 'ARRAY',
  $pull: 'ARRAY',
  $pullAll: 'ARRAY',
  $pop: 'ARRAY',
  $addToSet: 'ARRAY',
  $bit: 'BITWISE',
  $where: 'BLOCK',
}

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

interface MongoOperatorClassification {
  fields: string[]
  tierFactors: QueryRiskFactor[]
  hasBlock: boolean
}

function classifyMongoUpdate(setDoc: Record<string, unknown>): MongoOperatorClassification {
  const fields = new Set<string>()
  const tierFactors: QueryRiskFactor[] = []
  let hasBlock = false
  const hasAnyOperator = Object.keys(setDoc).some((k) => k.startsWith('$'))

  if (!hasAnyOperator) {
    for (const k of Object.keys(setDoc)) fields.add(k)
    return { fields: Array.from(fields), tierFactors, hasBlock }
  }

  const seenTiers = new Map<OperatorTier, string[]>()

  for (const [op, payload] of Object.entries(setDoc)) {
    if (!op.startsWith('$')) {
      fields.add(op)
      continue
    }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      for (const k of Object.keys(payload as Record<string, unknown>)) fields.add(k)
    }
    const tier = MONGO_OPERATOR_TIER[op]
    if (tier === undefined) {
      hasBlock = true
      tierFactors.push({
        code: 'mongo_unknown_operator',
        severity: 'block',
        message: `Update uses unknown operator '${op}'. Reject by default; add to tier table if intentional.`,
      })
      continue
    }
    if (tier === 'BLOCK') {
      hasBlock = true
      tierFactors.push({
        code: 'mongo_unknown_operator',
        severity: 'block',
        message: `Update uses '${op}' which executes server-side code. Operation rejected.`,
      })
      continue
    }
    if (tier === 'SAFE') continue
    const bucket = seenTiers.get(tier) ?? []
    bucket.push(op)
    seenTiers.set(tier, bucket)
  }

  for (const [tier, ops] of seenTiers) {
    if (tier === 'RENAME') {
      tierFactors.push({
        code: 'mongo_rename_operator',
        severity: 'warn',
        message: `Update uses ${ops.join(', ')}; a renamed field keeps its value under a name the read mask does not know.`,
      })
    } else if (tier === 'ARITHMETIC') {
      tierFactors.push({
        code: 'mongo_arithmetic_operator',
        severity: 'warn',
        message: `Update uses ${ops.join(', ')}; numeric mutation may compound silently.`,
      })
    } else if (tier === 'ARRAY') {
      tierFactors.push({
        code: 'mongo_array_operator',
        severity: 'warn',
        message: `Update uses ${ops.join(', ')}; array mutation can grow unboundedly without a size guard.`,
      })
    } else if (tier === 'BITWISE') {
      tierFactors.push({
        code: 'mongo_bitwise_operator',
        severity: 'warn',
        message: `Update uses ${ops.join(', ')}; bitwise updates skip type promotion checks.`,
      })
    }
  }

  return { fields: Array.from(fields), tierFactors, hasBlock }
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
  let raw: string[] = []
  for (const [t, cols] of Object.entries(columns)) {
    if (t.toLowerCase() === lower) {
      raw = cols
      break
    }
  }
  if (raw.length === 0) return
  const { patterns } = compilePatterns(raw)
  if (patterns.length === 0) return
  for (const field of fields) {
    if (matchAny(field, patterns)) {
      pushFactor(
        factors,
        'blacklisted_column',
        'block',
        `MongoDB write would touch blacklisted path ${target}.${field}.`
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

export function flattenInsertPaths(data: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(data)) {
    const path = prefix === '' ? k : `${prefix}.${k}`
    out.push(path)
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const ctor = (v as object).constructor?.name
      if (ctor === 'Object') {
        out.push(...flattenInsertPaths(v as Record<string, unknown>, path))
      }
    }
  }
  return out
}

export const analyzeMongoDmlRisk: NonSqlAnalyzer = (intent, context) => {
  const factors: QueryRiskFactor[] = []
  applyPermission(intent.operation, context, factors)
  applyTableBlacklist(intent.target, context, factors)

  if (intent.operation === 'insert') {
    applyColumnBlacklist(intent.target, flattenInsertPaths(intent.data), context, factors)
  } else if (intent.operation === 'update') {
    const cls = classifyMongoUpdate(intent.set)
    for (const f of cls.tierFactors) pushFactor(factors, f.code, f.severity, f.message)
    applyColumnBlacklist(intent.target, cls.fields, context, factors)
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
