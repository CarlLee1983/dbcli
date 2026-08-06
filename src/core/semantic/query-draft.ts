import { createHash } from 'node:crypto'
import { Parser } from 'node-sql-parser'
import type { SqlDatabaseSystem } from '@/adapters/types'
import { isProvenReadOnlySql } from '@/core/explain/read-only'
import type { SemanticContext, SemanticSchemaTable } from './index'

const parser = new Parser()

const DIALECT: Record<SqlDatabaseSystem, string> = {
  postgresql: 'Postgresql',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
}

const HASH = /^[a-f0-9]{64}$/
const IDENTIFIER = /^[a-z][a-z0-9-]*$/

export interface QueryDraftSqlCandidate {
  kind: 'sql'
  sql: string
}

export interface QueryDraftSavedQueryCandidate {
  kind: 'saved-query'
  name: string
}

export type QueryDraftCandidate = QueryDraftSqlCandidate | QueryDraftSavedQueryCandidate

/**
 * Untrusted, explicitly supplied query proposal. It never represents an
 * execution request: a separately invoked query or explain command remains
 * responsible for all database access gates.
 */
export interface QueryDraft {
  version: 1
  questionHash: string
  candidate: QueryDraftCandidate
  semanticReferences: string[]
  parameterRequests?: string[]
  rationale?: string
  risks?: string[]
}

export type QueryDraftViolationCode =
  | 'INVALID_DRAFT'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_QUESTION_HASH'
  | 'INVALID_CANDIDATE'
  | 'DUPLICATE_SEMANTIC_REFERENCE'
  | 'UNKNOWN_SEMANTIC_REFERENCE'
  | 'BLACKLISTED_SEMANTIC_REFERENCE'
  | 'UNKNOWN_SAVED_QUERY'
  | 'UNSAFE_SQL'
  | 'UNKNOWN_SQL_REFERENCE'
  | 'BLACKLISTED_SQL_REFERENCE'
  | 'UNGOVERNED_SQL_REFERENCE'

/** Intentionally code-only so reports cannot disclose SQL or protected names. */
export interface QueryDraftViolation {
  code: QueryDraftViolationCode
}

export interface QueryDraftValidationReport {
  status: 'valid' | 'invalid'
  draftHash: string
  questionHash?: string
  canonicalReferences: string[]
  violations: QueryDraftViolation[]
}

/**
 * All evidence is supplied by the caller. `schema` must already have blacklist
 * filtering applied; `blockedTerms` lets the caller additionally fail closed
 * when untrusted input names protected identifiers.
 */
export interface QueryDraftValidationInput {
  draft: unknown
  context: SemanticContext
  schema: Record<string, SemanticSchemaTable>
  savedQueryNames: readonly string[]
  system: SqlDatabaseSystem
  blockedTerms?: readonly string[]
}

/**
 * Offline validation boundary for untrusted query drafts. This module has no
 * filesystem, configuration, network, database, CLI, or persistence access.
 */
export function validateQueryDraft(input: QueryDraftValidationInput): QueryDraftValidationReport {
  const violations = new Set<QueryDraftViolationCode>()
  const draftHash = sha256(stableJson(canonicalDraftPayload(input.draft)))
  const draft = parseDraft(input.draft, violations)
  const blockedTerms = normalizeBlockedTerms(input.blockedTerms ?? [])
  const safeReferences = draft
    ? validateSemanticReferences(draft.semanticReferences, input, blockedTerms, violations)
    : []

  if (draft?.candidate.kind === 'saved-query') {
    const savedQueryName = draft.candidate.name
    if (!input.savedQueryNames.includes(savedQueryName)) {
      violations.add('UNKNOWN_SAVED_QUERY')
    }
  } else if (draft?.candidate.kind === 'sql') {
    validateSqlCandidate(draft.candidate.sql, input, safeReferences, blockedTerms, violations)
  }

  const report: QueryDraftValidationReport = {
    status: violations.size === 0 ? 'valid' : 'invalid',
    draftHash,
    ...(draft && HASH.test(draft.questionHash) ? { questionHash: draft.questionHash } : {}),
    canonicalReferences: safeReferences,
    violations: [...violations].sort().map((code) => ({ code })),
  }
  return report
}

function parseDraft(
  raw: unknown,
  violations: Set<QueryDraftViolationCode>
): QueryDraft | undefined {
  if (!isRecord(raw)) {
    violations.add('INVALID_DRAFT')
    return undefined
  }
  const allowed = new Set([
    'version',
    'questionHash',
    'candidate',
    'semanticReferences',
    'parameterRequests',
    'rationale',
    'risks',
  ])
  if (Object.keys(raw).some((key) => !allowed.has(key))) violations.add('INVALID_DRAFT')
  if (raw.version !== 1) violations.add('UNSUPPORTED_VERSION')
  if (typeof raw.questionHash !== 'string' || !HASH.test(raw.questionHash)) {
    violations.add('INVALID_QUESTION_HASH')
  }
  const candidate = parseCandidate(raw.candidate, violations)
  const semanticReferences = stringArray(raw.semanticReferences, violations)
  validateOptionalText(raw.parameterRequests, violations)
  validateOptionalText(raw.risks, violations)
  if (raw.rationale !== undefined && typeof raw.rationale !== 'string') violations.add('INVALID_DRAFT')
  if (!candidate || !semanticReferences || typeof raw.questionHash !== 'string' || raw.version !== 1) {
    return undefined
  }
  return {
    version: 1,
    questionHash: raw.questionHash,
    candidate,
    semanticReferences,
  }
}

function parseCandidate(
  raw: unknown,
  violations: Set<QueryDraftViolationCode>
): QueryDraftCandidate | undefined {
  if (!isRecord(raw) || (raw.kind !== 'sql' && raw.kind !== 'saved-query')) {
    violations.add('INVALID_CANDIDATE')
    return undefined
  }
  const allowed = raw.kind === 'sql' ? new Set(['kind', 'sql']) : new Set(['kind', 'name'])
  if (Object.keys(raw).some((key) => !allowed.has(key))) violations.add('INVALID_CANDIDATE')
  const value = raw.kind === 'sql' ? raw.sql : raw.name
  if (typeof value !== 'string' || value.trim().length === 0) {
    violations.add('INVALID_CANDIDATE')
    return undefined
  }
  return raw.kind === 'sql'
    ? { kind: 'sql', sql: value.trim() }
    : { kind: 'saved-query', name: value.trim() }
}

function stringArray(
  raw: unknown,
  violations: Set<QueryDraftViolationCode>
): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((item) => typeof item !== 'string')) {
    violations.add('INVALID_DRAFT')
    return undefined
  }
  return raw.map((item) => item.trim())
}

function validateOptionalText(raw: unknown, violations: Set<QueryDraftViolationCode>): void {
  if (raw !== undefined && (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string'))) {
    violations.add('INVALID_DRAFT')
  }
}

function validateSemanticReferences(
  references: string[],
  input: QueryDraftValidationInput,
  blockedTerms: string[],
  violations: Set<QueryDraftViolationCode>
): string[] {
  const registry = semanticReferenceRegistry(input.context, input.schema, input.savedQueryNames)
  const safe = new Set<string>()
  for (const reference of references) {
    if (!isCanonicalSemanticReference(reference)) {
      violations.add('UNKNOWN_SEMANTIC_REFERENCE')
      continue
    }
    if (safe.has(reference)) {
      violations.add('DUPLICATE_SEMANTIC_REFERENCE')
      continue
    }
    if (containsBlockedIdentifier(reference, blockedTerms)) {
      violations.add('BLACKLISTED_SEMANTIC_REFERENCE')
      continue
    }
    if (!registry.has(reference)) {
      violations.add('UNKNOWN_SEMANTIC_REFERENCE')
      continue
    }
    safe.add(reference)
  }
  return [...safe].sort()
}

function semanticReferenceRegistry(
  context: SemanticContext,
  schema: Record<string, SemanticSchemaTable>,
  savedQueryNames: readonly string[]
): Set<string> {
  const references = new Set<string>()
  const saved = new Set(savedQueryNames)
  for (const model of context.models) {
    const table = schema[model.table]
    if (!table) continue
    references.add(`model:${model.name}`)
    for (const field of model.fields) {
      if (table.columns.some((column) => column.name === field.column)) {
        references.add(`field:${model.name}.${field.column}`)
      }
    }
  }
  for (const relationship of context.relationships) {
    const from = `field:${relationship.from.model}.${relationship.from.field}`
    const to = `field:${relationship.to.model}.${relationship.to.field}`
    if (references.has(from) && references.has(to)) references.add(`relationship:${relationship.name}`)
  }
  for (const metric of context.metrics) {
    if (saved.has(metric.query)) references.add(`metric:${metric.name}`)
  }
  return references
}

function validateSqlCandidate(
  sql: string,
  input: QueryDraftValidationInput,
  references: string[],
  blockedTerms: string[],
  violations: Set<QueryDraftViolationCode>
): void {
  if (!isProvenReadOnlySql(sql, input.system)) {
    violations.add('UNSAFE_SQL')
    return
  }
  const ast = parseSql(sql, input.system)
  if (!ast) {
    violations.add('UNSAFE_SQL')
    return
  }
  const tables = sqlTables(ast)
  if (tables.length === 0) {
    violations.add('UNKNOWN_SQL_REFERENCE')
    return
  }
  const modelTables = referencedModelTables(input.context, references)
  const aliases = validateSqlTables(tables, input, modelTables, blockedTerms, violations)
  validateSqlColumns(ast, input, references, modelTables, aliases, blockedTerms, violations)
}

function referencedModelTables(context: SemanticContext, references: string[]): Map<string, string> {
  return new Map(
    context.models
      .filter(
        (model) =>
          references.includes(`model:${model.name}`) ||
          references.some((reference) => reference.startsWith(`field:${model.name}.`))
      )
      .map((model) => [model.table, model.name])
  )
}

function validateSqlTables(
  tables: Array<{ name: string; alias?: string; namespace?: string }>,
  input: QueryDraftValidationInput,
  modelTables: Map<string, string>,
  blockedTerms: string[],
  violations: Set<QueryDraftViolationCode>
): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const table of tables) {
    if (table.namespace) {
      violations.add(
        containsBlockedIdentifier(table.namespace, blockedTerms)
          ? 'BLACKLISTED_SQL_REFERENCE'
          : 'UNKNOWN_SQL_REFERENCE'
      )
      continue
    }
    if (containsBlockedIdentifier(table.name, blockedTerms)) {
      violations.add('BLACKLISTED_SQL_REFERENCE')
      continue
    }
    if (!input.schema[table.name]) {
      violations.add('UNKNOWN_SQL_REFERENCE')
      continue
    }
    if (!modelTables.has(table.name)) violations.add('UNGOVERNED_SQL_REFERENCE')
    aliases.set(table.alias ?? table.name, table.name)
  }
  return aliases
}

function validateSqlColumns(
  ast: unknown,
  input: QueryDraftValidationInput,
  references: string[],
  modelTables: Map<string, string>,
  aliases: Map<string, string>,
  blockedTerms: string[],
  violations: Set<QueryDraftViolationCode>
): void {
  for (const column of sqlColumns(ast)) {
    if (column.name === '*') {
      violations.add('UNGOVERNED_SQL_REFERENCE')
      continue
    }
    if (containsBlockedIdentifier(column.name, blockedTerms)) {
      violations.add('BLACKLISTED_SQL_REFERENCE')
      continue
    }
    const tableNames = (column.table ? [aliases.get(column.table)] : [...new Set(aliases.values())]).filter(
      (table): table is string => typeof table === 'string'
    )
    const matches = tableNames.filter((table) =>
      input.schema[table]?.columns.some((candidate) => candidate.name === column.name)
    )
    if (matches.length === 0) {
      violations.add('UNKNOWN_SQL_REFERENCE')
      continue
    }
    if (
      !matches.some((table) => {
        const model = modelTables.get(table)
        return model !== undefined && references.includes(`field:${model}.${column.name}`)
      })
    ) {
      violations.add('UNGOVERNED_SQL_REFERENCE')
    }
  }
}

function parseSql(sql: string, system: SqlDatabaseSystem): unknown | undefined {
  try {
    const parsed = parser.astify(sql, { database: DIALECT[system] })
    return Array.isArray(parsed) ? (parsed.length === 1 ? parsed[0] : undefined) : parsed
  } catch {
    return undefined
  }
}

function sqlTables(ast: unknown): Array<{ name: string; alias?: string; namespace?: string }> {
  const tables: Array<{ name: string; alias?: string; namespace?: string }> = []
  visit(ast, (node) => {
    if (typeof node.table === 'string' && typeof node.type !== 'string') {
      tables.push({
        name: node.table,
        ...(typeof node.as === 'string' ? { alias: node.as } : {}),
        ...(typeof node.db === 'string' ? { namespace: node.db } : {}),
      })
    }
  })
  return tables
}

function sqlColumns(ast: unknown): Array<{ name: string; table?: string }> {
  const columns: Array<{ name: string; table?: string }> = []
  visit(ast, (node) => {
    if (node.type !== 'column_ref') return
    const name = columnName(node.column)
    if (name) columns.push({ name, ...(typeof node.table === 'string' ? { table: node.table } : {}) })
  })
  return columns
}

function columnName(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  if (!isRecord(raw) || !isRecord(raw.expr) || typeof raw.expr.value !== 'string') return undefined
  return raw.expr.value
}

function visit(value: unknown, action: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, action))
    return
  }
  if (!isRecord(value)) return
  action(value)
  Object.values(value).forEach((child) => visit(child, action))
}

function normalizeBlockedTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean))]
}

function containsBlockedIdentifier(value: string, blockedTerms: string[]): boolean {
  return blockedTerms.some((blocked) => {
    const escaped = blocked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(value)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value !== 'object') return JSON.stringify(String(value))
  if (seen.has(value)) return '"[Circular]"'
  seen.add(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, seen)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key], seen)}`)
    .join(',')}}`
}

function canonicalDraftPayload(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.semanticReferences)) return value
  return {
    ...value,
    semanticReferences: [...value.semanticReferences].sort((a, b) => {
      const left = typeof a === 'string' ? a : stableJson(a)
      const right = typeof b === 'string' ? b : stableJson(b)
      return left < right ? -1 : left > right ? 1 : 0
    }),
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isCanonicalSemanticReference(value: string): boolean {
  const [kind, target, extra] = value.split(':')
  if (extra !== undefined || !target) return false
  if (kind === 'model' || kind === 'metric' || kind === 'relationship') return IDENTIFIER.test(target)
  if (kind !== 'field') return false
  const [model = '', field = '', fieldExtra] = target.split('.')
  return fieldExtra === undefined && IDENTIFIER.test(model) && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(field)
}
