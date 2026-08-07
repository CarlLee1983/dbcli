import { join } from 'node:path'
import { z } from 'zod'
import { typeFamily, type NormalizedSchema } from '@/core/orm-drift/normalized-schema'
import type { DriftReport } from '@/core/orm-drift/compare'

export type DesignDialect = 'postgresql' | 'mysql' | 'mariadb'
export type DesignFindingSeverity = 'error' | 'warn' | 'info'

export interface DesignField {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  unique: boolean
  description?: string
}

export interface DesignIndex {
  name?: string
  columns: string[]
  unique: boolean
}

export interface DesignModel {
  name: string
  table: string
  description?: string
  fields: DesignField[]
  indexes: DesignIndex[]
}

export interface DesignRelationshipEndpoint {
  model: string
  field: string
}

export type DesignCardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'

export interface DesignRelationship {
  name: string
  from: DesignRelationshipEndpoint
  to: DesignRelationshipEndpoint
  cardinality: DesignCardinality
  description?: string
}

export interface DesignAccessPattern {
  model: string
  filters: string[]
  sort: string[]
  description?: string
}

export interface DesignDecision {
  name: string
  rationale: string
}

export interface DesignSpec {
  version: 1
  dialect: DesignDialect
  models: DesignModel[]
  relationships: DesignRelationship[]
  accessPatterns: DesignAccessPattern[]
  decisions: DesignDecision[]
}

export interface DesignIssue {
  path: string
  message: string
}

export interface DesignFinding extends DesignIssue {
  code: string
  severity: DesignFindingSeverity
}

export interface DesignReviewReport {
  findings: DesignFinding[]
  summary: { errors: number; warns: number; infos: number }
}

export interface DesignProposal {
  table: string
  object: string
  safety: 'dry-run' | 'migration-review'
  commands: string[]
  preflight: string[]
  rollback: string
  verification: string[]
}

export interface DesignProposalPlan {
  report: DriftReport
  proposals: DesignProposal[]
}

export class DesignValidationError extends Error {
  constructor(
    readonly filePath: string,
    readonly issues: DesignIssue[]
  ) {
    super(
      `Invalid design artifact at ${filePath}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`
    )
    this.name = 'DesignValidationError'
  }
}

const DEFAULT_FILE = 'dbcli.design.json'
const MAX_FILE_BYTES = 256 * 1024
const MAX_MODELS = 100
const MAX_FIELDS_PER_MODEL = 100
const MAX_RELATIONSHIPS = 200
const MAX_ACCESS_PATTERNS = 200
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const DESIGN_NAME = /^[a-z][a-z0-9-]*$/
const TYPE = /^[^;\r\n]{1,100}$/
const UNSAFE_TEXT =
  /(?:\b(?:select|insert|update|delete|alter|drop|grant)\b\s+|\bcreate\s+(?:table|index)\b|(?:postgres(?:ql)?|mysql):\/\/)/i

const identifier = z.string().regex(IDENTIFIER, 'must be a SQL-safe identifier')
const designName = z.string().regex(DESIGN_NAME, 'must be lowercase kebab-case')
const text = z
  .string()
  .min(1)
  .max(1_000)
  .refine((value) => !UNSAFE_TEXT.test(value), 'must not contain SQL or connection data')
const fieldSchema = z
  .object({
    name: identifier,
    type: z
      .string()
      .regex(TYPE, 'must be a bounded type declaration without SQL separators')
      .refine((value) => !UNSAFE_TEXT.test(value), 'must not contain SQL or connection data'),
    nullable: z.boolean(),
    primaryKey: z.boolean().optional().default(false),
    unique: z.boolean().optional().default(false),
    description: text.optional(),
  })
  .strict()
const indexSchema = z
  .object({
    name: identifier.optional(),
    columns: z.array(identifier).min(1).max(16),
    unique: z.boolean().optional().default(false),
  })
  .strict()
const modelSchema = z
  .object({
    name: designName,
    table: identifier,
    description: text.optional(),
    fields: z.array(fieldSchema).max(MAX_FIELDS_PER_MODEL),
    indexes: z.array(indexSchema).optional().default([]),
  })
  .strict()
const endpointSchema = z.object({ model: designName, field: identifier }).strict()
const relationshipSchema = z
  .object({
    name: designName,
    from: endpointSchema,
    to: endpointSchema,
    cardinality: z.enum(['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']),
    description: text.optional(),
  })
  .strict()
const accessPatternSchema = z
  .object({
    model: designName,
    filters: z.array(identifier).max(16).optional().default([]),
    sort: z.array(identifier).max(16).optional().default([]),
    description: text.optional(),
  })
  .strict()
const decisionSchema = z.object({ name: designName, rationale: text }).strict()
const specSchema = z
  .object({
    version: z.literal(1),
    dialect: z.enum(['postgresql', 'mysql', 'mariadb']),
    models: z.array(modelSchema).max(MAX_MODELS),
    relationships: z.array(relationshipSchema).max(MAX_RELATIONSHIPS).optional().default([]),
    accessPatterns: z.array(accessPatternSchema).max(MAX_ACCESS_PATTERNS).optional().default([]),
    decisions: z.array(decisionSchema).max(100).optional().default([]),
  })
  .strict()

export function defaultDesignFile(workspaceRoot: string): string {
  return join(workspaceRoot, DEFAULT_FILE)
}

/** Parses a local, provider-free design artifact without accessing a database. */
export function parseDesignSpec(raw: unknown, filePath = DEFAULT_FILE): DesignSpec {
  const parsed = specSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DesignValidationError(
      filePath,
      parsed.error.issues.map((issue) => ({
        path: formatZodPath(issue.path),
        message: issue.message,
      }))
    )
  }
  return normalizeSpec(parsed.data)
}

/** Reads only the explicit local artifact. It never opens a database or network connection. */
export async function loadDesignSpec(filePath: string): Promise<DesignSpec> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    throw new DesignValidationError(filePath, [{ path: '$', message: 'file not found' }])
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new DesignValidationError(filePath, [
      { path: '$', message: `must not exceed ${MAX_FILE_BYTES} bytes` },
    ])
  }
  try {
    return parseDesignSpec(JSON.parse(await file.text()), filePath)
  } catch (error) {
    if (error instanceof DesignValidationError) throw error
    throw new DesignValidationError(filePath, [{ path: '$', message: 'must be valid JSON' }])
  }
}

/**
 * Reviews physical design invariants. It is deliberately pure so CLI, tests,
 * and future agent integrations share one deterministic safety surface.
 */
export function reviewDesign(spec: DesignSpec): DesignReviewReport {
  const findings: DesignFinding[] = []
  const models = new Map<string, { model: DesignModel; index: number }>()
  const tables = new Map<string, number>()

  if (spec.models.length === 0)
    addFinding(findings, 'error', 'NO_MODELS', '$.models', 'must contain at least one model')
  for (const [modelIndex, model] of spec.models.entries()) {
    const path = `$.models[${modelIndex}]`
    if (models.has(model.name))
      addFinding(findings, 'error', 'DUPLICATE_MODEL', `${path}.name`, 'must be unique')
    else models.set(model.name, { model, index: modelIndex })
    if (tables.has(model.table))
      addFinding(findings, 'error', 'DUPLICATE_TABLE', `${path}.table`, 'must be unique')
    else tables.set(model.table, modelIndex)
    reviewModel(model, modelIndex, findings)
  }

  const relationships = new Set<string>()
  for (const [relationshipIndex, relationship] of spec.relationships.entries()) {
    const path = `$.relationships[${relationshipIndex}]`
    const key = `${relationship.from.model}\u0000${relationship.from.field}\u0000${relationship.to.model}\u0000${relationship.to.field}`
    const reverseKey = `${relationship.to.model}\u0000${relationship.to.field}\u0000${relationship.from.model}\u0000${relationship.from.field}`
    if (relationships.has(key))
      addFinding(
        findings,
        'error',
        'DUPLICATE_RELATIONSHIP',
        path,
        'must not repeat relationship endpoints'
      )
    else if (key !== reverseKey && relationships.has(reverseKey)) {
      addFinding(
        findings,
        'error',
        'REVERSE_RELATIONSHIP',
        path,
        'must use one relationship direction; the reverse endpoints are already declared'
      )
    }
    relationships.add(key)
    reviewRelationship(relationship, path, models, findings)
  }

  for (const [patternIndex, pattern] of spec.accessPatterns.entries()) {
    reviewAccessPattern(pattern, `$.accessPatterns[${patternIndex}]`, models, findings)
  }

  findings.sort(findingOrder)
  return {
    findings,
    summary: {
      errors: findings.filter((finding) => finding.severity === 'error').length,
      warns: findings.filter((finding) => finding.severity === 'warn').length,
      infos: findings.filter((finding) => finding.severity === 'info').length,
    },
  }
}

/** Compiles an already parsed artifact into the existing ORM-drift comparison shape. */
export function compileDesignSchema(spec: DesignSpec): NormalizedSchema {
  const models = new Map(spec.models.map((model) => [model.name, model]))
  return {
    source: 'design',
    ...(spec.dialect === 'postgresql' ? { defaultSchema: 'public' } : {}),
    tables: spec.models.map((model) => ({
      identity: { table: model.table },
      columns: model.fields.map((field) => ({
        name: field.name,
        type: field.type,
        nullable: field.nullable,
        primaryKey: field.primaryKey || undefined,
      })),
      indexes: [
        ...model.indexes.map((index) => ({ ...index })),
        ...model.fields
          .filter((field) => field.unique && !field.primaryKey)
          .map((field) => ({ columns: [field.name], unique: true })),
      ],
      foreignKeys: spec.relationships.flatMap((relationship) => {
        if (relationship.cardinality === 'many-to-many' || relationship.from.model !== model.name)
          return []
        const target = models.get(relationship.to.model)
        if (!target) return []
        return [
          {
            columns: [relationship.from.field],
            refTable: { table: target.table },
            refColumns: [relationship.to.field],
          },
        ]
      }),
    })),
    unparsed: [],
  }
}

/**
 * Turns drift entries into review-only implementation plans. It intentionally
 * preserves existing safe dry-run proposals and escalates every other change.
 */
export function planDesignProposals(report: DriftReport): DesignProposalPlan {
  return {
    report,
    proposals: report.entries
      .filter((entry) => entry.category !== 'unmanaged')
      .map((entry) => ({
        table: entry.table,
        object: entry.object,
        safety: entry.proposedCommands.some((command) => command.startsWith('# dry-run'))
          ? 'dry-run'
          : 'migration-review',
        commands: entry.proposedCommands,
        preflight: [
          'dbcli blacklist list',
          'Confirm the exact affected table with: dbcli schema <exact-table> --format json',
        ],
        rollback:
          'Capture the current schema and generated DDL before any approved write; define the inverse migration before execution.',
        verification: [
          'After an approved write, run: dbcli schema <exact-table> --format json',
          'Re-run this same design diff command and review the remaining drift.',
        ],
      })),
  }
}

function reviewModel(model: DesignModel, modelIndex: number, findings: DesignFinding[]): void {
  const fields = new Map<string, number>()
  const primaryKeys = model.fields.filter((field) => field.primaryKey)
  if (primaryKeys.length !== 1)
    addFinding(
      findings,
      'error',
      'PRIMARY_KEY_COUNT',
      `$.models[${modelIndex}].fields`,
      'must declare exactly one primary-key field in v1'
    )
  for (const [fieldIndex, field] of model.fields.entries()) {
    const path = `$.models[${modelIndex}].fields[${fieldIndex}]`
    if (fields.has(field.name))
      addFinding(
        findings,
        'error',
        'DUPLICATE_FIELD',
        `${path}.name`,
        'must be unique within its model'
      )
    else fields.set(field.name, fieldIndex)
    if (field.primaryKey && field.nullable)
      addFinding(
        findings,
        'error',
        'NULLABLE_PRIMARY_KEY',
        `${path}.nullable`,
        'primary-key fields must not be nullable'
      )
  }
  const indexKeys = new Set<string>()
  for (const [indexIndex, index] of model.indexes.entries()) {
    const path = `$.models[${modelIndex}].indexes[${indexIndex}]`
    const key = `${index.unique}\u0000${index.columns.join('\u0000')}`
    if (indexKeys.has(key))
      addFinding(findings, 'warn', 'DUPLICATE_INDEX', path, 'duplicates a prior index')
    indexKeys.add(key)
    for (const column of index.columns) {
      if (!fields.has(column))
        addFinding(
          findings,
          'error',
          'UNKNOWN_INDEX_FIELD',
          `${path}.columns`,
          `references unknown field '${column}'`
        )
    }
    if (
      index.columns.length === 1 &&
      primaryKeys.some((field) => field.name === index.columns[0])
    ) {
      addFinding(
        findings,
        'warn',
        'REDUNDANT_PRIMARY_KEY_INDEX',
        path,
        'primary-key fields are already indexed'
      )
    }
    if (
      !index.unique &&
      model.indexes.some(
        (candidate) =>
          candidate.columns.length > index.columns.length &&
          index.columns.every((column, columnIndex) => candidate.columns[columnIndex] === column)
      )
    ) {
      addFinding(
        findings,
        'warn',
        'PREFIX_REDUNDANT_INDEX',
        path,
        'is covered by a longer index with the same leading columns'
      )
    }
  }
}

function reviewRelationship(
  relationship: DesignRelationship,
  path: string,
  models: Map<string, { model: DesignModel; index: number }>,
  findings: DesignFinding[]
): void {
  const from = lookupField(relationship.from, `${path}.from`, models, findings)
  const to = lookupField(relationship.to, `${path}.to`, models, findings)
  if (!from || !to) return
  if (relationship.cardinality === 'many-to-many') {
    addFinding(
      findings,
      'error',
      'MANY_TO_MANY_REQUIRES_BRIDGE',
      `${path}.cardinality`,
      'requires an explicit bridge model in v1'
    )
  }
  if (typeFamily(from.field.type) !== typeFamily(to.field.type)) {
    addFinding(
      findings,
      'error',
      'RELATIONSHIP_TYPE_MISMATCH',
      path,
      `field types are incompatible (${from.field.type} vs ${to.field.type})`
    )
  }
  if (relationship.cardinality === 'one-to-one' && !isUniqueField(from.model, from.field.name)) {
    addFinding(
      findings,
      'error',
      'ONE_TO_ONE_REQUIRES_UNIQUE_FK',
      `${path}.from.field`,
      'must be primary-key, unique, or covered by a single-column unique index'
    )
  }
}

function reviewAccessPattern(
  pattern: DesignAccessPattern,
  path: string,
  models: Map<string, { model: DesignModel; index: number }>,
  findings: DesignFinding[]
): void {
  const found = models.get(pattern.model)
  if (!found) {
    addFinding(
      findings,
      'error',
      'UNKNOWN_ACCESS_MODEL',
      `${path}.model`,
      `references unknown model '${pattern.model}'`
    )
    return
  }
  const fields = new Set(found.model.fields.map((field) => field.name))
  for (const field of [...pattern.filters, ...pattern.sort]) {
    if (!fields.has(field))
      addFinding(
        findings,
        'error',
        'UNKNOWN_ACCESS_FIELD',
        path,
        `references unknown field '${field}'`
      )
  }
  const needed = [...pattern.filters, ...pattern.sort]
  if (needed.length > 0 && !hasSupportingIndex(found.model, needed)) {
    addFinding(
      findings,
      'warn',
      'ACCESS_PATTERN_INDEX',
      path,
      `consider an index beginning with (${needed.join(', ')})`
    )
  }
}

function lookupField(
  endpoint: DesignRelationshipEndpoint,
  path: string,
  models: Map<string, { model: DesignModel; index: number }>,
  findings: DesignFinding[]
): { model: DesignModel; field: DesignField } | undefined {
  const found = models.get(endpoint.model)
  if (!found) {
    addFinding(
      findings,
      'error',
      'UNKNOWN_RELATIONSHIP_MODEL',
      `${path}.model`,
      `references unknown model '${endpoint.model}'`
    )
    return undefined
  }
  const field = found.model.fields.find((candidate) => candidate.name === endpoint.field)
  if (!field) {
    addFinding(
      findings,
      'error',
      'UNKNOWN_RELATIONSHIP_FIELD',
      `${path}.field`,
      `references unknown field '${endpoint.field}'`
    )
    return undefined
  }
  return { model: found.model, field }
}

function isUniqueField(model: DesignModel, field: string): boolean {
  return (
    model.fields.some(
      (candidate) => candidate.name === field && (candidate.primaryKey || candidate.unique)
    ) ||
    model.indexes.some(
      (index) => index.unique && index.columns.length === 1 && index.columns[0] === field
    )
  )
}

function hasSupportingIndex(model: DesignModel, needed: string[]): boolean {
  const indexes = [
    ...model.indexes.map((index) => index.columns),
    ...model.fields
      .filter((field) => field.primaryKey || field.unique)
      .map((field) => [field.name]),
  ]
  return indexes.some((columns) => needed.every((column, index) => columns[index] === column))
}

function addFinding(
  findings: DesignFinding[],
  severity: DesignFindingSeverity,
  code: string,
  path: string,
  message: string
): void {
  findings.push({ severity, code, path, message })
}

function normalizeSpec(spec: z.infer<typeof specSchema>): DesignSpec {
  return {
    ...spec,
    models: [...spec.models].sort((left, right) => codePointOrder(left.name, right.name)),
    relationships: [...spec.relationships].sort((left, right) =>
      codePointOrder(left.name, right.name)
    ),
    accessPatterns: [...spec.accessPatterns].sort((left, right) => {
      const leftKey = `${left.model}\u0000${left.filters.join('\u0000')}\u0000${left.sort.join('\u0000')}`
      const rightKey = `${right.model}\u0000${right.filters.join('\u0000')}\u0000${right.sort.join('\u0000')}`
      return codePointOrder(leftKey, rightKey)
    }),
    decisions: [...spec.decisions].sort((left, right) => codePointOrder(left.name, right.name)),
  }
}

function formatZodPath(path: Array<string | number>): string {
  return path.reduce<string>(
    (result, part) => (typeof part === 'number' ? `${result}[${part}]` : `${result}.${part}`),
    '$'
  )
}

function findingOrder(left: DesignFinding, right: DesignFinding): number {
  return (
    codePointOrder(left.path, right.path) ||
    codePointOrder(left.code, right.code) ||
    codePointOrder(left.message, right.message)
  )
}

function codePointOrder(left: string, right: string): number {
  const leftPoints = [...left]
  const rightPoints = [...right]
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}
