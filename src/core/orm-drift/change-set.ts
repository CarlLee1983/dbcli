import type {
  NormalizedColumn,
  NormalizedForeignKey,
  NormalizedIndex,
  NormalizedSchema,
  NormalizedTable,
  NormalizedTableIdentity,
} from '@/core/orm-drift/normalized-schema'
import { qualifiedTableName, tableIdentityKey } from '@/core/orm-drift/table-identity'

const DEFAULT_IGNORE = ['_prisma_migrations']

export interface NormalizedChangeScope {
  /** Stable, caller-owned scope identifier; it prevents cross-connection collisions. */
  key: string
  system: string
  connection?: string
  environment?: string
  catalog?: string
}

export interface NormalizedChangeOrigins {
  declared: string
  baseline: string
}

export interface NormalizedChangeSetInput {
  /** The proposed design or ORM definition. */
  declared: NormalizedSchema
  /** The current cache or the definition being compared against. */
  baseline: NormalizedSchema
  scope: NormalizedChangeScope
  origins: NormalizedChangeOrigins
  ignore?: string[]
}

export type NormalizedChangeOperation = 'add' | 'remove' | 'modify'
export type NormalizedChangeObjectKind = 'table' | 'column' | 'index' | 'foreign-key'

export interface NormalizedChangeSubject {
  scopeKey: string
  system: string
  connection?: string
  environment?: string
  catalog?: string
  schema?: string
  table: string
  column?: string
  objectKey?: string
}

export interface NormalizedChange {
  /** Stable JSON-tuple identity, never a display name. */
  id: string
  operation: NormalizedChangeOperation
  objectKind: NormalizedChangeObjectKind
  subject: NormalizedChangeSubject
  source: { declared?: string; baseline?: string }
  changedFields?: string[]
  before?: NormalizedColumn
  after?: NormalizedColumn
}

export type NormalizedChangeCoverageGapKind = 'unsupported' | 'lossy' | 'ambiguous' | 'unmanaged'

export interface NormalizedChangeCoverageGap {
  kind: NormalizedChangeCoverageGapKind
  side: 'declared' | 'baseline' | 'comparison'
  location: string
  reason: string
  subject?: Pick<NormalizedChangeSubject, 'schema' | 'table' | 'column' | 'objectKey'>
}

export interface NormalizedChangeSet {
  scope: NormalizedChangeScope
  origins: NormalizedChangeOrigins
  changes: NormalizedChange[]
  coverage: {
    level: 'declared' | 'partial'
    gaps: NormalizedChangeCoverageGap[]
  }
}

export class NormalizedChangeSetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NormalizedChangeSetError'
  }
}

type Side = 'declared' | 'baseline'

interface ResolvedTable {
  table: NormalizedTable
  identity: NormalizedTableIdentity
}

/**
 * Produces migration-direction facts from the typed schemas, not from the
 * presentation-oriented drift report. `declared` is always the target state.
 */
export function normalizeProposedChanges(input: NormalizedChangeSetInput): NormalizedChangeSet {
  validateInput(input)

  const gaps: NormalizedChangeCoverageGap[] = [
    ...unparsedGaps(input.declared, 'declared'),
    ...unparsedGaps(input.baseline, 'baseline'),
  ]
  const declaredTables = tableMap(input.declared, input.baseline.defaultSchema, 'declared')
  const baselineTables = tableMap(input.baseline, input.baseline.defaultSchema, 'baseline')
  const ignored = ignoredTableKeys(input, declaredTables, baselineTables, gaps)
  const changes: NormalizedChange[] = []
  const tableKeys = [...new Set([...declaredTables.keys(), ...baselineTables.keys()])].sort(codePointOrder)

  for (const tableKey of tableKeys) {
    if (ignored.has(tableKey)) continue
    const declared = declaredTables.get(tableKey)
    const baseline = baselineTables.get(tableKey)
    if (declared && !baseline) {
      changes.push(tableChange(input, 'add', declared, 'declared'))
      continue
    }
    if (!declared && baseline) {
      changes.push(tableChange(input, 'remove', baseline, 'baseline'))
      continue
    }
    if (declared && baseline) compareTable(input, declared, baseline, changes, gaps)
  }

  changes.sort((left, right) => codePointOrder(left.id, right.id))
  gaps.sort(gapOrder)
  return {
    scope: { ...input.scope },
    origins: { ...input.origins },
    changes,
    coverage: { level: gaps.length === 0 ? 'declared' : 'partial', gaps },
  }
}

function validateInput(input: NormalizedChangeSetInput): void {
  if (!input.scope.key.trim()) throw new NormalizedChangeSetError('scope.key must not be empty')
  if (!input.scope.system.trim()) throw new NormalizedChangeSetError('scope.system must not be empty')
  if (!input.origins.declared.trim() || !input.origins.baseline.trim())
    throw new NormalizedChangeSetError('declared and baseline origins must not be empty')
}

function tableMap(
  schema: NormalizedSchema,
  defaultSchema: string | undefined,
  side: Side
): Map<string, ResolvedTable> {
  const tables = new Map<string, ResolvedTable>()
  for (const table of schema.tables) {
    const identity =
      table.identity.schema === undefined && defaultSchema !== undefined
        ? { ...table.identity, schema: defaultSchema }
        : table.identity
    const key = tableIdentityKey(identity)
    if (tables.has(key)) {
      throw new NormalizedChangeSetError(
        `duplicate resolved table identity '${qualifiedTableName(identity)}' in ${side} schema`
      )
    }
    tables.set(key, { table: { ...table, identity }, identity })
  }
  return tables
}

function ignoredTableKeys(
  input: NormalizedChangeSetInput,
  declared: Map<string, ResolvedTable>,
  baseline: Map<string, ResolvedTable>,
  gaps: NormalizedChangeCoverageGap[]
): Set<string> {
  const patterns = [...DEFAULT_IGNORE, ...(input.ignore ?? [])].map(globToRegex)
  const ignored = new Set<string>()
  for (const [side, tables] of [
    ['declared', declared],
    ['baseline', baseline],
  ] as const) {
    for (const [key, resolved] of tables) {
      const name = qualifiedTableName(resolved.identity)
      if (!patterns.some((pattern) => pattern.test(name) || pattern.test(resolved.identity.table)))
        continue
      if (ignored.has(key)) continue
      ignored.add(key)
      gaps.push({
        kind: 'unmanaged',
        side: 'comparison',
        location: input.origins[side],
        reason: `table '${name}' matched an ignore pattern`,
        subject: tableSubject(resolved.identity),
      })
    }
  }
  return ignored
}

function compareTable(
  input: NormalizedChangeSetInput,
  declared: ResolvedTable,
  baseline: ResolvedTable,
  changes: NormalizedChange[],
  gaps: NormalizedChangeCoverageGap[]
): void {
  const declaredColumns = uniqueBy(
    declared.table.columns,
    (column) => column.name.toLowerCase(),
    'column',
    declared.identity,
    'declared'
  )
  const baselineColumns = uniqueBy(
    baseline.table.columns,
    (column) => column.name.toLowerCase(),
    'column',
    baseline.identity,
    'baseline'
  )
  const columnKeys = [...new Set([...declaredColumns.keys(), ...baselineColumns.keys()])].sort(codePointOrder)
  for (const key of columnKeys) {
    const after = declaredColumns.get(key)
    const before = baselineColumns.get(key)
    if (after && !before) changes.push(columnChange(input, 'add', declared.identity, after))
    else if (!after && before) changes.push(columnChange(input, 'remove', baseline.identity, before))
    else if (after && before) {
      const changedFields = columnChangedFields(before, after)
      if (changedFields.length > 0)
        changes.push(columnChange(input, 'modify', declared.identity, after, before, changedFields))
    }
  }

  compareIndexes(input, declared, baseline, changes, gaps)
  compareForeignKeys(input, declared, baseline, changes)
}

function compareIndexes(
  input: NormalizedChangeSetInput,
  declared: ResolvedTable,
  baseline: ResolvedTable,
  changes: NormalizedChange[],
  gaps: NormalizedChangeCoverageGap[]
): void {
  const declaredIndexes = uniqueBy(
    declared.table.indexes,
    indexKey,
    'index',
    declared.identity,
    'declared'
  )
  const baselineIndexes = uniqueBy(
    baseline.table.indexes,
    indexKey,
    'index',
    baseline.identity,
    'baseline'
  )
  const keys = [...new Set([...declaredIndexes.keys(), ...baselineIndexes.keys()])].sort(codePointOrder)
  for (const key of keys) {
    const after = declaredIndexes.get(key)
    const before = baselineIndexes.get(key)
    if (after && !before) changes.push(objectChange(input, 'add', 'index', declared.identity, key, 'declared'))
    else if (!after && before)
      changes.push(objectChange(input, 'remove', 'index', baseline.identity, key, 'baseline'))
    else if (after && before && after.name !== before.name) {
      gaps.push({
        kind: 'lossy',
        side: 'comparison',
        location: input.origins.declared,
        reason: `index names are not part of the normalized index identity for '${qualifiedTableName(declared.identity)}'`,
        subject: { ...tableSubject(declared.identity), objectKey: key },
      })
    }
  }
}

function compareForeignKeys(
  input: NormalizedChangeSetInput,
  declared: ResolvedTable,
  baseline: ResolvedTable,
  changes: NormalizedChange[]
): void {
  const declaredKeys = uniqueBy(
    declared.table.foreignKeys,
    (foreignKey) => foreignKeyKey(foreignKey, input.baseline.defaultSchema),
    'foreign key',
    declared.identity,
    'declared'
  )
  const baselineKeys = uniqueBy(
    baseline.table.foreignKeys,
    (foreignKey) => foreignKeyKey(foreignKey, input.baseline.defaultSchema),
    'foreign key',
    baseline.identity,
    'baseline'
  )
  const keys = [...new Set([...declaredKeys.keys(), ...baselineKeys.keys()])].sort(codePointOrder)
  for (const key of keys) {
    if (declaredKeys.has(key) && !baselineKeys.has(key))
      changes.push(objectChange(input, 'add', 'foreign-key', declared.identity, key, 'declared'))
    else if (!declaredKeys.has(key) && baselineKeys.has(key))
      changes.push(objectChange(input, 'remove', 'foreign-key', baseline.identity, key, 'baseline'))
  }
}

function tableChange(
  input: NormalizedChangeSetInput,
  operation: Extract<NormalizedChangeOperation, 'add' | 'remove'>,
  resolved: ResolvedTable,
  side: Side
): NormalizedChange {
  return objectChange(input, operation, 'table', resolved.identity, 'table', side)
}

function columnChange(
  input: NormalizedChangeSetInput,
  operation: NormalizedChangeOperation,
  identity: NormalizedTableIdentity,
  column: NormalizedColumn,
  before?: NormalizedColumn,
  changedFields?: string[]
): NormalizedChange {
  const subject = { ...subjectFor(input.scope, identity), column: column.name }
  const id = changeId(input.scope, identity, 'column', column.name, operation)
  return {
    id,
    operation,
    objectKind: 'column',
    subject,
    source:
      operation === 'add'
        ? { declared: objectLocation(input.origins.declared, identity, `columns.${column.name}`) }
        : operation === 'remove'
          ? { baseline: objectLocation(input.origins.baseline, identity, `columns.${column.name}`) }
          : {
              declared: objectLocation(input.origins.declared, identity, `columns.${column.name}`),
              baseline: objectLocation(input.origins.baseline, identity, `columns.${column.name}`),
            },
    ...(changedFields !== undefined && { changedFields }),
    ...(before !== undefined && { before: { ...before } }),
    ...(operation !== 'remove' && { after: { ...column } }),
  }
}

function objectChange(
  input: NormalizedChangeSetInput,
  operation: Extract<NormalizedChangeOperation, 'add' | 'remove'>,
  objectKind: Exclude<NormalizedChangeObjectKind, 'column'>,
  identity: NormalizedTableIdentity,
  objectKey: string,
  side: Side
): NormalizedChange {
  const subject = { ...subjectFor(input.scope, identity), ...(objectKind !== 'table' && { objectKey }) }
  const location = objectLocation(input.origins[side], identity, objectKind === 'table' ? undefined : objectKey)
  return {
    id: changeId(input.scope, identity, objectKind, objectKey, operation),
    operation,
    objectKind,
    subject,
    source: side === 'declared' ? { declared: location } : { baseline: location },
  }
}

function uniqueBy<T>(
  entries: T[],
  keyFor: (entry: T) => string,
  kind: string,
  table: NormalizedTableIdentity,
  side: Side
): Map<string, T> {
  const result = new Map<string, T>()
  for (const entry of entries) {
    const key = keyFor(entry)
    if (result.has(key)) {
      throw new NormalizedChangeSetError(
        `duplicate ${kind} identity '${key}' in ${qualifiedTableName(table)} (${side} schema)`
      )
    }
    result.set(key, entry)
  }
  return result
}

function columnChangedFields(before: NormalizedColumn, after: NormalizedColumn): string[] {
  const fields: Array<keyof NormalizedColumn> = [
    'type',
    'rawType',
    'nullable',
    'default',
    'primaryKey',
  ]
  return fields.filter((field) => before[field] !== after[field])
}

function indexKey(index: NormalizedIndex): string {
  return JSON.stringify([index.columns.map((column) => column.toLowerCase()), index.unique])
}

function foreignKeyKey(foreignKey: NormalizedForeignKey, defaultSchema?: string): string {
  const reference =
    foreignKey.refTable.schema === undefined && defaultSchema !== undefined
      ? { ...foreignKey.refTable, schema: defaultSchema }
      : foreignKey.refTable
  return JSON.stringify([
    foreignKey.columns.map((column) => column.toLowerCase()),
    tableIdentityKey(reference),
    foreignKey.refColumns.map((column) => column.toLowerCase()),
  ])
}

function subjectFor(scope: NormalizedChangeScope, identity: NormalizedTableIdentity): NormalizedChangeSubject {
  return {
    scopeKey: scope.key,
    system: scope.system,
    ...(scope.connection !== undefined && { connection: scope.connection }),
    ...(scope.environment !== undefined && { environment: scope.environment }),
    ...(scope.catalog !== undefined && { catalog: scope.catalog }),
    ...(identity.schema !== undefined && { schema: identity.schema }),
    table: identity.table,
  }
}

function tableSubject(identity: NormalizedTableIdentity): Pick<NormalizedChangeSubject, 'schema' | 'table'> {
  return {
    ...(identity.schema !== undefined && { schema: identity.schema }),
    table: identity.table,
  }
}

function changeId(
  scope: NormalizedChangeScope,
  identity: NormalizedTableIdentity,
  objectKind: NormalizedChangeObjectKind,
  objectKey: string,
  operation: NormalizedChangeOperation
): string {
  return JSON.stringify([
    scope.key,
    scope.system,
    scope.connection ?? null,
    scope.environment ?? null,
    scope.catalog ?? null,
    identity.schema ?? null,
    identity.table,
    objectKind,
    objectKey,
    operation,
  ])
}

function objectLocation(origin: string, identity: NormalizedTableIdentity, objectKey?: string): string {
  const table = qualifiedTableName(identity)
  return objectKey === undefined ? `${origin}#${table}` : `${origin}#${table}.${objectKey}`
}

function unparsedGaps(schema: NormalizedSchema, side: Side): NormalizedChangeCoverageGap[] {
  return schema.unparsed.map((entry) => ({
    kind: 'unsupported',
    side,
    location: entry.location,
    reason: entry.reason,
  }))
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function gapOrder(left: NormalizedChangeCoverageGap, right: NormalizedChangeCoverageGap): number {
  return (
    codePointOrder(left.side, right.side) ||
    codePointOrder(left.kind, right.kind) ||
    codePointOrder(left.location, right.location) ||
    codePointOrder(left.reason, right.reason)
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
