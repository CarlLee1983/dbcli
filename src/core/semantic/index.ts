import { join } from 'node:path'

export {
  semanticReferenceRegistry,
  isCanonicalSemanticReference,
  validateQueryDraft,
  queryDraftReportMetadata,
  type QueryDraft,
  type QueryDraftCandidate,
  type QueryDraftSavedQueryCandidate,
  type QueryDraftSqlCandidate,
  type QueryDraftValidationInput,
  type QueryDraftValidationReport,
  type QueryDraftReportMetadata,
  type QueryDraftViolation,
  type QueryDraftViolationCode,
} from './query-draft'

export interface SemanticSchemaTable {
  columns: Array<{ name: string }>
}

export interface SemanticField {
  column: string
  description?: string
  aliases: string[]
}

export interface SemanticModel {
  name: string
  table: string
  description?: string
  aliases: string[]
  fields: SemanticField[]
}

export interface SemanticMetric {
  name: string
  description?: string
  query: string
}

export interface SemanticRelationshipEndpoint {
  model: string
  field: string
}

export type SemanticRelationshipCardinality =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many'

export interface SemanticRelationship {
  name: string
  from: SemanticRelationshipEndpoint
  to: SemanticRelationshipEndpoint
  cardinality: SemanticRelationshipCardinality
  description?: string
}

export interface SemanticContext {
  version: 1 | 2
  models: SemanticModel[]
  relationships: SemanticRelationship[]
  metrics: SemanticMetric[]
}

export interface SemanticValidationIssue {
  path: string
  message: string
}

export class SemanticValidationError extends Error {
  constructor(
    readonly filePath: string,
    readonly issues: SemanticValidationIssue[]
  ) {
    super(
      `Invalid semantic context at ${filePath}: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`
    )
    this.name = 'SemanticValidationError'
  }
}

export interface LoadSemanticContextInput {
  workspaceRoot: string
  filePath?: string
  schema: Record<string, SemanticSchemaTable>
  snippets: Array<{ key: string }>
  missingFile?: 'allow' | 'error'
}

export interface InspectSemanticDriftInput extends LoadSemanticContextInput {
  /** False only when no cache is available to compare. */
  schemaAvailable?: boolean
}

export interface SemanticDriftReport {
  status: 'valid' | 'stale' | 'invalid' | 'unavailable'
  issues: SemanticValidationIssue[]
}

export type SemanticSearchKind = 'model' | 'field' | 'relationship' | 'metric'

export interface SemanticSearchOptions {
  kind?: SemanticSearchKind
  limit?: number
  /** Blacklist names to exclude from searchable or returned free text. */
  blockedTerms?: string[]
}

export interface SemanticSearchResult {
  kind: SemanticSearchKind
  reference: string
  matchedTerms: string[]
  description?: string
  aliases: string[]
  models?: string[]
}

export class SemanticSearchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SemanticSearchError'
  }
}

const DEFAULT_FILE = 'dbcli.semantic.json'
const MAX_FILE_BYTES = 256 * 1024
const MAX_MODELS = 100
const MAX_FIELDS_PER_MODEL = 100
const MAX_METRICS = 100
const MAX_RELATIONSHIPS = 100
const MAX_ALIASES = 20
const MAX_TEXT_LENGTH = 1_000
const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 100
const IDENTIFIER = /^[a-z][a-z0-9-]*$/

/**
 * The issues that mean "the referenced entity is unavailable", as opposed to
 * "the artifact is malformed". Consumers classify on these exact literals
 * rather than searching the message for a word.
 */
const UNAVAILABLE_TABLE = 'must reference a visible cached table'
const UNAVAILABLE_SAVED_QUERY = 'must reference an available saved query'
const UNDECLARED_MODEL = 'must reference a declared model'
const UNDECLARED_FIELD = 'must reference a declared field on the model'
const REFERENCE_MESSAGES: ReadonlySet<string> = new Set([
  UNAVAILABLE_TABLE,
  UNAVAILABLE_SAVED_QUERY,
  UNDECLARED_MODEL,
  UNDECLARED_FIELD,
])

/** True when a failure is about the referenced entity, not the artifact shape. */
export function hasSemanticReferenceIssue(issues: readonly SemanticValidationIssue[]): boolean {
  return issues.some(({ message }) => REFERENCE_MESSAGES.has(message))
}
const CARDINALITIES = new Set<SemanticRelationshipCardinality>([
  'one-to-one',
  'one-to-many',
  'many-to-one',
  'many-to-many',
])

export function defaultSemanticFile(workspaceRoot: string): string {
  return join(workspaceRoot, DEFAULT_FILE)
}

/**
 * Loads declarative semantic context from a local file. Callers supply only
 * already filtered schema and saved-query names; this module never reads SQL
 * bodies, database rows, credentials, or opens a connection.
 */
export async function loadSemanticContext(
  input: LoadSemanticContextInput
): Promise<SemanticContext | null> {
  const loaded = await readSemanticFile(input)
  if (!loaded) return null
  const { filePath, raw } = loaded
  const { context, issues } = parseContext(raw)
  validateReferences(
    context,
    input.schema,
    new Set(input.snippets.map((snippet) => snippet.key)),
    issues
  )
  if (issues.length > 0) throw new SemanticValidationError(filePath, issues)
  return normalizeContext(context)
}

/**
 * Separates a malformed semantic document from one whose formerly valid local
 * references no longer appear in the cached schema or saved-query index.
 */
export async function inspectSemanticDrift(
  input: InspectSemanticDriftInput
): Promise<SemanticDriftReport> {
  let loaded: { filePath: string; raw: unknown } | null
  try {
    loaded = await readSemanticFile({ ...input, missingFile: 'error' })
  } catch (error) {
    if (error instanceof SemanticValidationError) {
      return { status: 'invalid', issues: error.issues }
    }
    throw error
  }
  if (!loaded) return { status: 'invalid', issues: [{ path: '$', message: 'file not found' }] }

  const { context, issues } = parseContext(loaded.raw)
  if (issues.length > 0) return { status: 'invalid', issues }
  if (input.schemaAvailable === false) {
    return {
      status: 'unavailable',
      issues: [{ path: '$', message: 'cached schema is unavailable' }],
    }
  }

  validateReferences(
    context,
    input.schema,
    new Set(input.snippets.map((snippet) => snippet.key)),
    issues
  )
  return issues.length > 0 ? { status: 'stale', issues } : { status: 'valid', issues: [] }
}

/** Produces v2 JSON data only; callers decide whether any file write is allowed. */
export async function migrateSemanticContext(
  input: LoadSemanticContextInput
): Promise<SemanticContext> {
  const context = await loadSemanticContext(input)
  const filePath = input.filePath ?? defaultSemanticFile(input.workspaceRoot)
  if (!context)
    throw new SemanticValidationError(filePath, [{ path: '$', message: 'file not found' }])
  if (context.version !== 1) {
    throw new SemanticValidationError(filePath, [
      { path: '$.version', message: 'must equal 1 to migrate to version 2' },
    ])
  }
  return { ...context, version: 2, relationships: [] }
}

/**
 * Searches only already validated semantic entities. Results never include a
 * saved-query body, schema cache, connection data, or blacklist configuration.
 */
export function searchSemanticContext(
  context: SemanticContext,
  terms: string[],
  options: SemanticSearchOptions = {}
): SemanticSearchResult[] {
  const normalizedTerms = normalizeSearchTerms(terms)
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new SemanticSearchError(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`)
  }
  if (options.kind && !isSearchKind(options.kind)) {
    throw new SemanticSearchError('kind must be model, field, relationship, or metric')
  }

  const blockedTerms = normalizeBlockedTerms(options.blockedTerms ?? [])
  if (
    normalizedTerms.some((term) =>
      blockedTerms.some((blocked) => isBlockedIdentifier(term, blocked))
    )
  ) {
    return []
  }
  const candidates = searchCandidates(context, blockedTerms)
  return candidates
    .filter((candidate) => !options.kind || candidate.result.kind === options.kind)
    .map((candidate) => ({ ...candidate, match: matchSearchCandidate(candidate, normalizedTerms) }))
    .filter(
      (candidate): candidate is SearchCandidate & { match: SearchMatch } => candidate.match !== null
    )
    .sort(
      (a, b) =>
        a.match.rank - b.match.rank ||
        compareKind(a.result.kind, b.result.kind) ||
        compareCodeUnits(a.result.reference, b.result.reference)
    )
    .slice(0, limit)
    .map(({ result, match }) => ({ ...result, matchedTerms: match.terms }))
}

/** Shared blacklist matching for semantic-facing artifacts and search output. */
export function containsBlockedSemanticIdentifier(
  value: string,
  blockedTerms: readonly string[]
): boolean {
  return blockedTerms.some((term) => isBlockedIdentifier(value, term.trim()))
}

interface SearchCandidate {
  result: Omit<SemanticSearchResult, 'matchedTerms'>
  canonical: string
  aliases: string[]
  description?: string
}

interface SearchMatch {
  rank: number
  terms: string[]
}

function searchCandidates(context: SemanticContext, blockedTerms: string[]): SearchCandidate[] {
  const candidates: SearchCandidate[] = []
  for (const model of context.models) {
    const description = safeSearchText(model.description, blockedTerms)
    const aliases = safeAliases(model.aliases, blockedTerms)
    candidates.push({
      result: withSearchDetails('model', model.name, description, aliases),
      canonical: model.name,
      aliases,
      description,
    })
    for (const field of model.fields) {
      const description = safeSearchText(field.description, blockedTerms)
      const aliases = safeAliases(field.aliases, blockedTerms)
      candidates.push({
        result: {
          ...withSearchDetails('field', `${model.name}.${field.column}`, description, aliases),
          models: [model.name],
        },
        canonical: field.column,
        aliases,
        description,
      })
    }
  }
  for (const relationship of context.relationships) {
    const models = [relationship.from.model, relationship.to.model]
    candidates.push({
      result: {
        ...withSearchDetails(
          'relationship',
          relationship.name,
          safeSearchText(relationship.description, blockedTerms),
          []
        ),
        models,
      },
      canonical: relationship.name,
      aliases: [],
      description: safeSearchText(relationship.description, blockedTerms),
    })
  }
  for (const metric of context.metrics) {
    candidates.push({
      result: withSearchDetails(
        'metric',
        metric.name,
        safeSearchText(metric.description, blockedTerms),
        []
      ),
      canonical: metric.name,
      aliases: [],
      description: safeSearchText(metric.description, blockedTerms),
    })
  }
  return candidates.filter(
    (candidate) => !candidateContainsBlockedIdentifier(candidate, blockedTerms)
  )
}

function withSearchDetails(
  kind: SemanticSearchKind,
  reference: string,
  description: string | undefined,
  aliases: string[]
): Omit<SemanticSearchResult, 'matchedTerms'> {
  return { kind, reference, ...(description ? { description } : {}), aliases }
}

function matchSearchCandidate(candidate: SearchCandidate, terms: string[]): SearchMatch | null {
  const canonical = candidate.canonical.toLowerCase()
  const aliases = candidate.aliases.map((alias) => alias.toLowerCase())
  const aliasTokens = aliases.flatMap((alias) => tokenize(alias))
  const descriptionTokens = tokenize(candidate.description ?? '')
  const matchedTerms: string[] = []
  const phrase = terms.join(' ')
  let rank = canonical === phrase ? 0 : aliases.includes(phrase) ? 1 : 3

  for (const term of terms) {
    const exactCanonical = canonical === term
    const exactAlias = aliases.includes(phrase)
    const prefix = [canonical, ...aliases, ...aliasTokens].some((value) => value.startsWith(term))
    const descriptionToken = descriptionTokens.includes(term)
    if (!exactCanonical && !exactAlias && !prefix && !descriptionToken) return null
    if (exactCanonical) rank = Math.min(rank, 0)
    else if (exactAlias) rank = Math.min(rank, 1)
    else if (prefix) rank = Math.min(rank, 2)
    matchedTerms.push(term)
  }
  return { rank, terms: matchedTerms }
}

function normalizeSearchTerms(terms: string[]): string[] {
  const normalized = terms.flatMap((term) => term.trim().toLowerCase().split(/\s+/)).filter(Boolean)
  if (normalized.length === 0)
    throw new SemanticSearchError('at least one non-empty search term is required')
  return [...new Set(normalized)]
}

function normalizeBlockedTerms(terms: string[]): string[] {
  return [...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean))]
}

function safeSearchText(value: string | undefined, blockedTerms: string[]): string | undefined {
  if (!value || blockedTerms.some((term) => isBlockedIdentifier(value, term))) return undefined
  return value
}

function safeAliases(aliases: string[], blockedTerms: string[]): string[] {
  return aliases.filter((alias) => safeSearchText(alias, blockedTerms) !== undefined)
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function candidateContainsBlockedIdentifier(
  candidate: SearchCandidate,
  blockedTerms: string[]
): boolean {
  const exposedValues = [candidate.result.reference, ...(candidate.result.models ?? [])]
  return exposedValues.some((value) => containsBlockedSemanticIdentifier(value, blockedTerms))
}

function isBlockedIdentifier(value: string, blocked: string): boolean {
  const escaped = blocked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(value)
}

function isSearchKind(value: string): value is SemanticSearchKind {
  return value === 'model' || value === 'field' || value === 'relationship' || value === 'metric'
}

function compareKind(a: SemanticSearchKind, b: SemanticSearchKind): number {
  return (
    ['model', 'field', 'relationship', 'metric'].indexOf(a) -
    ['model', 'field', 'relationship', 'metric'].indexOf(b)
  )
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function readSemanticFile(
  input: Pick<LoadSemanticContextInput, 'workspaceRoot' | 'filePath' | 'missingFile'>
): Promise<{ filePath: string; raw: unknown } | null> {
  const filePath = input.filePath ?? defaultSemanticFile(input.workspaceRoot)
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    if (input.missingFile === 'allow') return null
    throw new SemanticValidationError(filePath, [{ path: '$', message: 'file not found' }])
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new SemanticValidationError(filePath, [
      { path: '$', message: `file exceeds ${MAX_FILE_BYTES} bytes` },
    ])
  }
  try {
    return { filePath, raw: JSON.parse(await file.text()) }
  } catch {
    throw new SemanticValidationError(filePath, [{ path: '$', message: 'invalid JSON' }])
  }
}

function parseContext(raw: unknown): {
  context: SemanticContext
  issues: SemanticValidationIssue[]
} {
  const issues: SemanticValidationIssue[] = []
  const root = record(raw, '$', issues)
  const rawVersion = root.version
  const version: 1 | 2 = rawVersion === 2 ? 2 : 1
  if (rawVersion !== 1 && rawVersion !== 2) issue(issues, '$.version', 'must equal 1 or 2')
  rejectUnknownKeys(
    root,
    version === 2
      ? ['version', 'models', 'relationships', 'metrics']
      : ['version', 'models', 'metrics'],
    '$',
    issues
  )

  const rawModels = array(root.models, '$.models', issues)
  if (rawModels.length > MAX_MODELS)
    issue(issues, '$.models', `must contain at most ${MAX_MODELS} items`)
  const modelNames = new Set<string>()
  const models = rawModels.map((value, index) =>
    parseModel(value, `$.models[${index}]`, modelNames, issues)
  )

  const rawRelationships =
    version === 2 ? array(root.relationships ?? [], '$.relationships', issues) : []
  if (rawRelationships.length > MAX_RELATIONSHIPS) {
    issue(issues, '$.relationships', `must contain at most ${MAX_RELATIONSHIPS} items`)
  }
  const relationships = rawRelationships.map((value, index) =>
    parseRelationship(value, `$.relationships[${index}]`, models, issues)
  )
  validateRelationshipUniqueness(relationships, issues)

  const rawMetrics = array(root.metrics, '$.metrics', issues)
  if (rawMetrics.length > MAX_METRICS)
    issue(issues, '$.metrics', `must contain at most ${MAX_METRICS} items`)
  const metricNames = new Set<string>()
  const metrics = rawMetrics.map((value, index) =>
    parseMetric(value, `$.metrics[${index}]`, metricNames, issues)
  )

  return {
    context: {
      version,
      models,
      relationships,
      metrics,
    },
    issues,
  }
}

function validateReferences(
  context: SemanticContext,
  schema: Record<string, SemanticSchemaTable>,
  snippetKeys: Set<string>,
  issues: SemanticValidationIssue[]
): void {
  for (const [modelIndex, model] of context.models.entries()) {
    const path = `$.models[${modelIndex}]`
    const table = schema[model.table]
    if (!table) issue(issues, `${path}.table`, UNAVAILABLE_TABLE)
    for (const [fieldIndex, field] of model.fields.entries()) {
      if (table && !table.columns.some((candidate) => candidate.name === field.column)) {
        issue(
          issues,
          `${path}.fields[${fieldIndex}].column`,
          'must reference a visible column on the model table'
        )
      }
    }
  }
  for (const [metricIndex, metric] of context.metrics.entries()) {
    if (!snippetKeys.has(metric.query)) {
      issue(issues, `$.metrics[${metricIndex}].query`, UNAVAILABLE_SAVED_QUERY)
    }
  }
}

function parseModel(
  raw: unknown,
  path: string,
  names: Set<string>,
  issues: SemanticValidationIssue[]
): SemanticModel {
  const value = record(raw, path, issues)
  rejectUnknownKeys(value, ['name', 'table', 'description', 'aliases', 'fields'], path, issues)
  const name = namedString(value.name, `${path}.name`, issues)
  uniqueName(name, names, `${path}.name`, issues)
  const table = requiredText(value.table, `${path}.table`, issues)
  const description = optionalText(value.description, `${path}.description`, issues)
  const aliases = aliasesOf(value.aliases, `${path}.aliases`, issues)
  const rawFields = array(value.fields, `${path}.fields`, issues)
  if (rawFields.length > MAX_FIELDS_PER_MODEL)
    issue(issues, `${path}.fields`, `must contain at most ${MAX_FIELDS_PER_MODEL} items`)
  const fieldColumns = new Set<string>()
  const fields = rawFields.map((field, index) => {
    const parsed = parseField(field, `${path}.fields[${index}]`, issues)
    uniqueName(parsed.column, fieldColumns, `${path}.fields[${index}].column`, issues)
    return parsed
  })
  return { name, table, ...(description ? { description } : {}), aliases, fields }
}

function parseField(raw: unknown, path: string, issues: SemanticValidationIssue[]): SemanticField {
  const value = record(raw, path, issues)
  rejectUnknownKeys(value, ['column', 'description', 'aliases'], path, issues)
  const column = requiredText(value.column, `${path}.column`, issues)
  const description = optionalText(value.description, `${path}.description`, issues)
  const aliases = aliasesOf(value.aliases, `${path}.aliases`, issues)
  return { column, ...(description ? { description } : {}), aliases }
}

function parseRelationship(
  raw: unknown,
  path: string,
  models: SemanticModel[],
  issues: SemanticValidationIssue[]
): SemanticRelationship {
  const value = record(raw, path, issues)
  rejectUnknownKeys(value, ['name', 'from', 'to', 'cardinality', 'description'], path, issues)
  const name = namedString(value.name, `${path}.name`, issues)
  const from = parseEndpoint(value.from, `${path}.from`, models, issues)
  const to = parseEndpoint(value.to, `${path}.to`, models, issues)
  const cardinality = requiredText(value.cardinality, `${path}.cardinality`, issues)
  if (!CARDINALITIES.has(cardinality as SemanticRelationshipCardinality)) {
    issue(
      issues,
      `${path}.cardinality`,
      'must be one of one-to-one, one-to-many, many-to-one, many-to-many'
    )
  }
  const description = relationshipDescription(value.description, `${path}.description`, issues)
  return {
    name,
    from,
    to,
    cardinality: CARDINALITIES.has(cardinality as SemanticRelationshipCardinality)
      ? (cardinality as SemanticRelationshipCardinality)
      : 'one-to-one',
    ...(description ? { description } : {}),
  }
}

function parseEndpoint(
  raw: unknown,
  path: string,
  models: SemanticModel[],
  issues: SemanticValidationIssue[]
): SemanticRelationshipEndpoint {
  const value = record(raw, path, issues)
  rejectUnknownKeys(value, ['model', 'field'], path, issues)
  const model = namedString(value.model, `${path}.model`, issues)
  const field = requiredText(value.field, `${path}.field`, issues)
  const target = models.find((candidate) => candidate.name === model)
  if (!target) issue(issues, `${path}.model`, UNDECLARED_MODEL)
  else if (!target.fields.some((candidate) => candidate.column === field)) {
    issue(issues, `${path}.field`, UNDECLARED_FIELD)
  }
  return { model, field }
}

function validateRelationshipUniqueness(
  relationships: SemanticRelationship[],
  issues: SemanticValidationIssue[]
): void {
  const names = new Set<string>()
  const endpoints = new Map<string, number>()
  for (const [index, relationship] of relationships.entries()) {
    const path = `$.relationships[${index}]`
    uniqueName(relationship.name, names, `${path}.name`, issues)
    const endpoint = `${relationship.from.model}\u0000${relationship.from.field}\u0000${relationship.to.model}\u0000${relationship.to.field}`
    if (endpoints.has(endpoint)) issue(issues, path, 'must not repeat relationship endpoints')
    const reverse = `${relationship.to.model}\u0000${relationship.to.field}\u0000${relationship.from.model}\u0000${relationship.from.field}`
    const reverseIndex = endpoints.get(reverse)
    const reverseRelationship = reverseIndex === undefined ? undefined : relationships[reverseIndex]
    if (
      reverseRelationship &&
      (!relationship.description ||
        !reverseRelationship.description ||
        relationship.description === reverseRelationship.description)
    ) {
      issue(issues, path, 'reverse relationships must have distinct descriptions')
    }
    endpoints.set(endpoint, index)
  }
}

function parseMetric(
  raw: unknown,
  path: string,
  names: Set<string>,
  issues: SemanticValidationIssue[]
): SemanticMetric {
  const value = record(raw, path, issues)
  rejectUnknownKeys(value, ['name', 'description', 'query'], path, issues)
  const name = namedString(value.name, `${path}.name`, issues)
  uniqueName(name, names, `${path}.name`, issues)
  const description = optionalText(value.description, `${path}.description`, issues)
  const query = requiredText(value.query, `${path}.query`, issues)
  return { name, ...(description ? { description } : {}), query }
}

function record(
  raw: unknown,
  path: string,
  issues: SemanticValidationIssue[]
): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
    return raw as Record<string, unknown>
  issue(issues, path, 'must be an object')
  return {}
}

function array(raw: unknown, path: string, issues: SemanticValidationIssue[]): unknown[] {
  if (Array.isArray(raw)) return raw
  issue(issues, path, 'must be an array')
  return []
}

function namedString(raw: unknown, path: string, issues: SemanticValidationIssue[]): string {
  const value = requiredText(raw, path, issues)
  if (!IDENTIFIER.test(value))
    issue(issues, path, 'must use lowercase letters, digits, and hyphens')
  return value
}

function requiredText(raw: unknown, path: string, issues: SemanticValidationIssue[]): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    issue(issues, path, 'must be a non-empty string')
    return ''
  }
  const value = raw.trim()
  if (value.length > MAX_TEXT_LENGTH)
    issue(issues, path, `must be at most ${MAX_TEXT_LENGTH} characters`)
  return value
}

function optionalText(
  raw: unknown,
  path: string,
  issues: SemanticValidationIssue[]
): string | undefined {
  return raw === undefined ? undefined : requiredText(raw, path, issues)
}

function relationshipDescription(
  raw: unknown,
  path: string,
  issues: SemanticValidationIssue[]
): string | undefined {
  const description = optionalText(raw, path, issues)
  if (
    description &&
    (/[a-z][a-z0-9+.-]*:\/\//i.test(description) ||
      /\b(?:select|insert|update|delete|merge|alter|drop|create|truncate|grant|revoke)\b/i.test(
        description
      ) ||
      /\b[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\s*=\s*[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*/i.test(
        description
      ))
  ) {
    issue(issues, path, 'must not contain SQL, a join condition, or connection data')
  }
  return description
}

function aliasesOf(raw: unknown, path: string, issues: SemanticValidationIssue[]): string[] {
  if (raw === undefined) return []
  const values = array(raw, path, issues)
  if (values.length > MAX_ALIASES) issue(issues, path, `must contain at most ${MAX_ALIASES} items`)
  const aliases = values.map((value, index) => requiredText(value, `${path}[${index}]`, issues))
  const seen = new Set<string>()
  for (const [index, alias] of aliases.entries()) {
    if (seen.has(alias)) issue(issues, `${path}[${index}]`, 'must not repeat an alias')
    seen.add(alias)
  }
  return aliases
}

function uniqueName(
  name: string,
  names: Set<string>,
  path: string,
  issues: SemanticValidationIssue[]
): void {
  if (names.has(name)) issue(issues, path, 'must be unique')
  names.add(name)
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: SemanticValidationIssue[]
): void {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) issue(issues, path, 'contains an unknown property')
  }
}

function normalizeContext(context: SemanticContext): SemanticContext {
  return {
    ...context,
    models: [...context.models].sort((a, b) => a.name.localeCompare(b.name)),
    relationships: [...context.relationships].sort((a, b) => a.name.localeCompare(b.name)),
    metrics: [...context.metrics].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

function issue(issues: SemanticValidationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}
