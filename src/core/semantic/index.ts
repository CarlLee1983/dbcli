import { join } from 'node:path'

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

export interface SemanticContext {
  version: 1
  models: SemanticModel[]
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

const DEFAULT_FILE = 'dbcli.semantic.json'
const MAX_FILE_BYTES = 256 * 1024
const MAX_MODELS = 100
const MAX_FIELDS_PER_MODEL = 100
const MAX_METRICS = 100
const MAX_ALIASES = 20
const MAX_TEXT_LENGTH = 1_000
const IDENTIFIER = /^[a-z][a-z0-9-]*$/

export function defaultSemanticFile(workspaceRoot: string): string {
  return join(workspaceRoot, DEFAULT_FILE)
}

/**
 * Loads the small, declarative semantic context that an agent may receive.
 * This module never opens a database or reads saved-query bodies: callers hand
 * it only the already filtered schema and saved-query names.
 */
export async function loadSemanticContext(
  input: LoadSemanticContextInput
): Promise<SemanticContext | null> {
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

  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON'
    throw new SemanticValidationError(filePath, [{ path: '$', message }])
  }

  const issues: SemanticValidationIssue[] = []
  const context = parseContext(
    raw,
    input.schema,
    new Set(input.snippets.map((snippet) => snippet.key)),
    issues
  )
  if (issues.length > 0) throw new SemanticValidationError(filePath, issues)
  return context
}

function parseContext(
  raw: unknown,
  schema: Record<string, SemanticSchemaTable>,
  snippetKeys: Set<string>,
  issues: SemanticValidationIssue[]
): SemanticContext {
  const root = record(raw, '$', issues)
  rejectUnknownKeys(root, ['version', 'models', 'metrics'], '$', issues)

  const version = root.version
  if (version !== 1) issue(issues, '$.version', 'must equal 1')

  const rawModels = array(root.models, '$.models', issues)
  if (rawModels.length > MAX_MODELS)
    issue(issues, '$.models', `must contain at most ${MAX_MODELS} items`)
  const modelNames = new Set<string>()
  const models = rawModels.map((value, index) =>
    parseModel(value, `$.models[${index}]`, schema, modelNames, issues)
  )

  const rawMetrics = array(root.metrics, '$.metrics', issues)
  if (rawMetrics.length > MAX_METRICS)
    issue(issues, '$.metrics', `must contain at most ${MAX_METRICS} items`)
  const metricNames = new Set<string>()
  const metrics = rawMetrics.map((value, index) =>
    parseMetric(value, `$.metrics[${index}]`, snippetKeys, metricNames, issues)
  )

  return {
    version: 1,
    models: models.sort((a, b) => a.name.localeCompare(b.name)),
    metrics: metrics.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

function parseModel(
  raw: unknown,
  path: string,
  schema: Record<string, SemanticSchemaTable>,
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
  const tableSchema = schema[table]
  if (!tableSchema) issue(issues, `${path}.table`, 'must reference a visible cached table')

  const rawFields = array(value.fields, `${path}.fields`, issues)
  if (rawFields.length > MAX_FIELDS_PER_MODEL) {
    issue(issues, `${path}.fields`, `must contain at most ${MAX_FIELDS_PER_MODEL} items`)
  }
  const fieldColumns = new Set<string>()
  const fields = rawFields.map((field, index) => {
    const parsed = parseField(field, `${path}.fields[${index}]`, tableSchema, issues)
    uniqueName(parsed.column, fieldColumns, `${path}.fields[${index}].column`, issues)
    return parsed
  })

  return { name, table, ...(description ? { description } : {}), aliases, fields }
}

function parseField(
  raw: unknown,
  path: string,
  table: SemanticSchemaTable | undefined,
  issues: SemanticValidationIssue[]
): SemanticField {
  const value = record(raw, path, issues)
  rejectUnknownKeys(value, ['column', 'description', 'aliases'], path, issues)
  const column = requiredText(value.column, `${path}.column`, issues)
  const description = optionalText(value.description, `${path}.description`, issues)
  const aliases = aliasesOf(value.aliases, `${path}.aliases`, issues)
  if (table && !table.columns.some((candidate) => candidate.name === column)) {
    issue(issues, `${path}.column`, 'must reference a visible column on the model table')
  }
  return { column, ...(description ? { description } : {}), aliases }
}

function parseMetric(
  raw: unknown,
  path: string,
  snippetKeys: Set<string>,
  names: Set<string>,
  issues: SemanticValidationIssue[]
): SemanticMetric {
  const value = record(raw, path, issues)
  rejectUnknownKeys(value, ['name', 'description', 'query'], path, issues)
  const name = namedString(value.name, `${path}.name`, issues)
  uniqueName(name, names, `${path}.name`, issues)
  const description = optionalText(value.description, `${path}.description`, issues)
  const query = requiredText(value.query, `${path}.query`, issues)
  if (!snippetKeys.has(query))
    issue(issues, `${path}.query`, 'must reference an available saved query')
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
  if (raw === undefined) return undefined
  return requiredText(raw, path, issues)
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
    if (!allowedKeys.has(key)) issue(issues, `${path}.${key}`, 'is not allowed')
  }
}

function issue(issues: SemanticValidationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}
