import type { TableSchema } from '@/adapters/types'
import { checkPermission, classifyStatement } from '@/core/permission-guard'
import { getSizeCategory } from '@/core/size-category'
import type { BlacklistConfig } from '@/types/blacklist'
import type {
  AnalyzeQueryRiskInput,
  QueryRiskFactor,
  QueryRiskFactorCode,
  QueryRiskOperation,
  QueryRiskResult,
  QueryRiskSeverity,
  SchemaLookup,
} from '@/types/query-risk'
import { mapStatementTypeToRiskOperation } from '@/types/query-risk'

type SqlFacts = {
  normalizedSql: string
  analysisSql: string
  operation: QueryRiskOperation
  targetTables: string[]
  referencedColumns: string[]
  hasWhere: boolean
  hasLimit: boolean
  hasSelectStar: boolean
  appearsReadLike: boolean
  appearsWriteOrDdlLike: boolean
}

/**
 * Strips SQL comments and single-quoted string literals while preserving
 * double-quoted identifiers (PostgreSQL/ANSI quoted names like "users").
 * Using this instead of stripCommentsAndStrings keeps quoted table/column
 * names visible to the table extractor.
 */
function stripCommentsAndSingleQuotedStrings(sql: string): string {
  let result = ''
  let i = 0

  while (i < sql.length) {
    const char = sql[i]

    if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      if (i < sql.length) {
        result += '\n'
        i++
      }
      continue
    }

    if (char === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2
          break
        }
        i++
      }
      result += ' '
      continue
    }

    if (char === "'") {
      i++
      while (i < sql.length && sql[i] !== "'") {
        if (sql[i] === '\\') i++
        i++
      }
      if (i < sql.length) i++
      result += ' '
      continue
    }

    result += char
    i++
  }

  return result
}

const READ_LIKE_WORDS = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'WITH']
const WRITE_OR_DDL_LIKE_WORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'UPSERT',
  'DROP',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'RENAME',
  'GRANT',
  'REVOKE',
]

export function analyzeQueryRisk(input: AnalyzeQueryRiskInput): QueryRiskResult {
  const facts = collectSqlFacts(input.sql)
  const factors: QueryRiskFactor[] = []

  applyPermissionRules(input.sql, input.permission, factors)
  applyWriteWhereRules(facts, factors)
  applyDdlAndUnknownRules(facts, factors)
  applySelectPatternRules(facts, factors)
  applyBlacklistRules(facts, input.blacklist, factors)
  const schemaGap = applySchemaRules(facts, input.schemaLookup, factors)

  const recommendations = buildRecommendations(factors, facts)
  const suggestedCommands = buildSuggestedCommands(facts, schemaGap)

  return {
    decision: decide(factors),
    operation: facts.operation,
    targetTables: facts.targetTables,
    riskFactors: factors,
    recommendations,
    suggestedCommands,
  }
}

function collectSqlFacts(sql: string): SqlFacts {
  const normalizedSql = normalizeSql(sql)
  const analysisSql = normalizeSql(stripCommentsAndSingleQuotedStrings(sql))
  const classification = classifyStatement(sql)
  const operation = mapStatementTypeToRiskOperation(classification.type)

  return {
    normalizedSql,
    analysisSql,
    operation,
    targetTables: extractTargetTables(analysisSql, operation),
    referencedColumns: extractReferencedColumns(analysisSql, operation),
    hasWhere: /\bWHERE\b/i.test(analysisSql),
    hasLimit: /\bLIMIT\b/i.test(analysisSql),
    hasSelectStar: /^\s*SELECT\s+(?:DISTINCT\s+)?\*/i.test(analysisSql),
    appearsReadLike: READ_LIKE_WORDS.some((word) =>
      new RegExp(`\\b${word}\\b`, 'i').test(analysisSql)
    ),
    appearsWriteOrDdlLike: WRITE_OR_DDL_LIKE_WORDS.some((word) =>
      new RegExp(`\\b${word}\\b`, 'i').test(analysisSql)
    ),
  }
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ')
}

function extractTargetTables(sql: string, operation: QueryRiskOperation): string[] {
  const cteAliases = extractCteAliases(sql)
  const tables = new Set<string>()

  const add = (value: string | undefined) => {
    const cleaned = cleanIdentifier(value)
    if (!cleaned) return
    if (cteAliases.has(cleaned.toLowerCase())) return
    tables.add(cleaned)
  }

  if (operation === 'UPDATE') {
    add(sql.match(/\bUPDATE\s+([`"[]?[\w.]+[`"\]]?)/i)?.[1])
  }

  if (operation === 'DELETE') {
    add(sql.match(/\bDELETE\s+FROM\s+([`"[]?[\w.]+[`"\]]?)/i)?.[1])
  }

  if (operation === 'INSERT') {
    add(sql.match(/\bINSERT\s+INTO\s+([`"[]?[\w.]+[`"\]]?)/i)?.[1])
  }

  const fromJoinPattern = /\b(?:FROM|JOIN)\s+([`"[]?[\w.]+[`"\]]?)/gi
  for (const match of sql.matchAll(fromJoinPattern)) {
    add(match[1])
  }

  return Array.from(tables)
}

/**
 * Returns the set of CTE alias names (lowercased) introduced by a leading
 * WITH clause. Detects `<name> AS (` patterns occurring after the first
 * WITH keyword. CTE aliases must be excluded from target tables to avoid
 * suggesting schema lookups for query-local names.
 */
function extractCteAliases(sql: string): Set<string> {
  const aliases = new Set<string>()
  const withMatch = sql.match(/\bWITH\b/i)
  if (!withMatch || withMatch.index === undefined) return aliases

  const tail = sql.slice(withMatch.index + withMatch[0].length)
  const aliasPattern = /([`"[]?[\w]+[`"\]]?)\s+AS\s*\(/gi
  for (const match of tail.matchAll(aliasPattern)) {
    const cleaned = cleanIdentifier(match[1])
    if (cleaned) aliases.add(cleaned.toLowerCase())
  }
  return aliases
}

function cleanIdentifier(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/^[`"[]|[`"\]]$/g, '')
  const withoutSchema = trimmed.includes('.') ? trimmed.split('.').slice(-1)[0] : trimmed
  if (!withoutSchema) return null
  if (/^(SELECT|WHERE|JOIN|ON|SET|VALUES)$/i.test(withoutSchema)) return null
  return withoutSchema
}

function extractReferencedColumns(sql: string, operation: QueryRiskOperation): string[] {
  const columns = new Set<string>()
  const add = (value: string | undefined) => {
    const cleaned = cleanIdentifier(value)
    if (cleaned && cleaned !== '*') columns.add(cleaned)
  }

  if (operation === 'SELECT') {
    const selectList = sql.match(/^\s*SELECT\s+(?:DISTINCT\s+)?(.+?)\s+FROM\s+/i)?.[1]
    if (selectList && selectList.trim() !== '*') {
      for (const part of selectList.split(',')) {
        const expression = part.trim().replace(/\s+AS\s+[`"[]?[\w]+[`"\]]?$/i, '')
        const simpleColumn = expression.match(
          /^(?:[`"[]?[\w]+[`"\]]?\.)?([`"[]?[\w]+[`"\]]?)$/
        )?.[1]
        add(simpleColumn)
      }
    }
  }

  if (operation === 'UPDATE') {
    const setList = sql.match(/\bSET\s+(.+?)(?:\s+WHERE\s+|$)/i)?.[1]
    if (setList) {
      for (const part of setList.split(',')) {
        add(part.match(/^\s*([`"[]?[\w]+[`"\]]?)\s*=/)?.[1])
      }
    }
  }

  if (operation === 'INSERT') {
    const insertColumns = sql.match(/\bINSERT\s+INTO\s+[`"[]?[\w.]+[`"\]]?\s*\(([^)]+)\)/i)?.[1]
    if (insertColumns) {
      for (const part of insertColumns.split(',')) add(part.trim())
    }
  }

  return Array.from(columns)
}

function applyPermissionRules(
  sql: string,
  permission: AnalyzeQueryRiskInput['permission'],
  factors: QueryRiskFactor[]
): void {
  const permissionResult = checkPermission(sql, permission)
  if (!permissionResult.allowed) {
    pushFactor(factors, 'permission_denied', 'block', permissionResult.reason)
  }
}

function applyWriteWhereRules(facts: SqlFacts, factors: QueryRiskFactor[]): void {
  if ((facts.operation === 'UPDATE' || facts.operation === 'DELETE') && !facts.hasWhere) {
    pushFactor(
      factors,
      'write_missing_where',
      'block',
      `${facts.operation} statement has no WHERE clause.`
    )
  }
}

function applyDdlAndUnknownRules(facts: SqlFacts, factors: QueryRiskFactor[]): void {
  if (/\b(DROP|TRUNCATE)\b/i.test(facts.analysisSql)) {
    pushFactor(factors, 'destructive_ddl', 'block', 'Statement appears to contain destructive DDL.')
    return
  }

  if (/\bALTER\b/i.test(facts.analysisSql)) {
    pushFactor(
      factors,
      'destructive_ddl',
      'block',
      'ALTER statements are unsupported by plan and may be destructive.'
    )
    return
  }

  if (facts.operation === 'DDL') {
    pushFactor(factors, 'unsupported_ddl', 'block', 'DDL statements are unsupported by plan.')
    return
  }

  if (facts.operation === 'UNKNOWN' && facts.appearsWriteOrDdlLike) {
    pushFactor(
      factors,
      'unknown_write_or_ddl',
      'block',
      'SQL type is unclear and appears write-like or DDL-like.'
    )
    return
  }

  if (facts.operation === 'UNKNOWN' && facts.appearsReadLike) {
    pushFactor(factors, 'unknown_read', 'warn', 'SQL type is unclear but appears read-like.')
  }
}

function applySelectPatternRules(facts: SqlFacts, factors: QueryRiskFactor[]): void {
  if (facts.operation === 'SELECT' && facts.hasSelectStar) {
    pushFactor(factors, 'select_star', 'warn', 'SELECT * may expose unnecessary columns.')
  }
}

function applyBlacklistRules(
  facts: SqlFacts,
  blacklist: BlacklistConfig,
  factors: QueryRiskFactor[]
): void {
  const blacklistedTables = new Set((blacklist.tables ?? []).map((table) => table.toLowerCase()))

  for (const table of facts.targetTables) {
    if (blacklistedTables.has(table.toLowerCase())) {
      pushFactor(factors, 'table_blacklisted', 'block', `Target table ${table} is blacklisted.`)
    }
  }

  for (const table of facts.targetTables) {
    const blacklistedColumns = findBlacklistedColumnsForTable(blacklist, table)
    for (const column of facts.referencedColumns) {
      if (blacklistedColumns.has(column)) {
        pushFactor(
          factors,
          'blacklisted_column',
          'warn',
          `Query references blacklisted column ${table}.${column}.`
        )
      }
    }
  }
}

function findBlacklistedColumnsForTable(blacklist: BlacklistConfig, table: string): Set<string> {
  const columns = blacklist.columns ?? {}
  for (const [tableName, columnNames] of Object.entries(columns)) {
    if (tableName.toLowerCase() === table.toLowerCase()) {
      return new Set(columnNames)
    }
  }
  return new Set()
}

interface SchemaGap {
  cacheMissing: boolean
  unknownTables: string[]
}

function applySchemaRules(
  facts: SqlFacts,
  schemaLookup: SchemaLookup,
  factors: QueryRiskFactor[]
): SchemaGap {
  const gap: SchemaGap = { cacheMissing: false, unknownTables: [] }

  if (facts.targetTables.length === 0) return gap

  if (!schemaLookup.cacheAvailable) {
    pushFactor(
      factors,
      'schema_cache_missing',
      'warn',
      'Schema cache is missing for the selected connection.'
    )
    gap.cacheMissing = true
    return gap
  }

  const knownTables = new Set(Object.keys(schemaLookup.tables).map((table) => table.toLowerCase()))
  let knownCount = 0

  for (const table of facts.targetTables) {
    const schema = getSchemaForTable(schemaLookup.tables, table)
    if (!schema || !knownTables.has(table.toLowerCase())) {
      pushFactor(
        factors,
        'schema_table_unknown',
        'warn',
        `Target table ${table} is missing from schema cache.`
      )
      gap.unknownTables.push(table)
      continue
    }

    knownCount += 1
    const category = getSizeCategory(schema.estimatedRowCount ?? schema.rowCount ?? 0)
    if (
      facts.operation === 'SELECT' &&
      (category === 'large' || category === 'huge') &&
      !facts.hasWhere &&
      !facts.hasLimit
    ) {
      pushFactor(
        factors,
        'large_table_unfiltered',
        'warn',
        `Target table ${table} is ${category} and the query has no WHERE or LIMIT clause.`
      )
    }
  }

  if (facts.targetTables.length > 1 && knownCount > 0 && knownCount < facts.targetTables.length) {
    pushFactor(
      factors,
      'partial_schema_coverage',
      'warn',
      'Multi-table query has partial schema-cache coverage.'
    )
  }

  return gap
}

function getSchemaForTable(
  tables: Record<string, TableSchema>,
  table: string
): TableSchema | undefined {
  return Object.entries(tables).find(([name]) => name.toLowerCase() === table.toLowerCase())?.[1]
}

function pushFactor(
  factors: QueryRiskFactor[],
  code: QueryRiskFactorCode,
  severity: QueryRiskSeverity,
  message: string
): void {
  if (factors.some((factor) => factor.code === code && factor.message === message)) return
  factors.push({ code, severity, message })
}

function decide(factors: QueryRiskFactor[]): QueryRiskResult['decision'] {
  if (factors.some((factor) => factor.severity === 'block')) return 'BLOCK'
  if (factors.some((factor) => factor.severity === 'warn')) return 'WARN'
  return 'ALLOW'
}

function buildRecommendations(factors: QueryRiskFactor[], facts: SqlFacts): string[] {
  const recommendations = new Set<string>()
  const codes = new Set(factors.map((factor) => factor.code))

  if (codes.has('write_missing_where')) {
    recommendations.add('Add a WHERE clause.')
    recommendations.add('Run a SELECT count(*) with the same condition before executing.')
    recommendations.add('Use --dry-run on the actual write command.')
  }

  if (codes.has('permission_denied')) {
    recommendations.add(
      'Switch to a connection with sufficient permission only if the operation is intended.'
    )
  }

  if (codes.has('table_blacklisted') || codes.has('blacklisted_column')) {
    recommendations.add('Review blacklist rules before accessing sensitive data.')
  }

  if (
    codes.has('destructive_ddl') ||
    codes.has('unsupported_ddl') ||
    codes.has('unknown_write_or_ddl')
  ) {
    recommendations.add('Do not execute this statement through dbcli without manual review.')
  }

  if (codes.has('select_star')) {
    recommendations.add('Select only the columns required for the task.')
  }

  if (codes.has('large_table_unfiltered')) {
    recommendations.add('Add a WHERE clause or LIMIT before querying a large table.')
  }

  if (
    codes.has('schema_cache_missing') ||
    codes.has('schema_table_unknown') ||
    codes.has('partial_schema_coverage')
  ) {
    recommendations.add('Refresh schema cache for the target table before executing.')
  }

  if (
    facts.operation === 'UPDATE' ||
    facts.operation === 'DELETE' ||
    facts.operation === 'INSERT'
  ) {
    recommendations.add('Use --dry-run on the actual write command.')
  }

  return Array.from(recommendations)
}

function buildSuggestedCommands(facts: SqlFacts, gap: SchemaGap): string[] {
  const commands = new Set<string>()
  const targets = gap.cacheMissing ? facts.targetTables : gap.unknownTables

  for (const table of targets) {
    commands.add(`dbcli schema ${table} --format json`)
  }

  return Array.from(commands)
}
