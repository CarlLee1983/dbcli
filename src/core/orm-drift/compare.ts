import { typeFamily } from '@/core/orm-drift/normalized-schema'
import type {
  NormalizedColumn,
  NormalizedForeignKey,
  NormalizedIndex,
  NormalizedSchema,
  NormalizedTable,
  NormalizedTableIdentity,
  UnparsedEntry,
} from '@/core/orm-drift/normalized-schema'
import { proposalsFor, type ProposalSubject } from '@/core/orm-drift/proposals'
import { qualifiedTableName, tableIdentityKey } from '@/core/orm-drift/table-identity'

export type DriftCategory = 'missing_in_db' | 'missing_in_orm' | 'mismatch' | 'unmanaged'
export type DriftSeverity = 'info' | 'warn' | 'error'

export interface DriftEntry {
  category: DriftCategory
  severity: DriftSeverity
  table: string
  object: string
  detail: string
  proposedCommands: string[]
}

export interface DriftReport {
  ormSource: string
  entries: DriftEntry[]
  unparsed: UnparsedEntry[]
  summary: { errors: number; warns: number; infos: number; unmanaged: number }
}

const DEFAULT_IGNORE = ['_prisma_migrations']

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function tableMap(schema: NormalizedSchema, defaultSchema?: string): Map<string, NormalizedTable> {
  const tables = new Map<string, NormalizedTable>()
  for (const table of schema.tables) {
    const identity: NormalizedTableIdentity =
      table.identity.schema === undefined && defaultSchema !== undefined
        ? { ...table.identity, schema: defaultSchema }
        : table.identity
    const key = tableIdentityKey(identity)
    if (tables.has(key)) {
      throw new Error(
        `duplicate resolved table identity '${qualifiedTableName(identity)}' in ${schema.source} schema`
      )
    }
    tables.set(key, { ...table, identity })
  }
  return tables
}

function entryWithProposals(
  entry: Omit<DriftEntry, 'proposedCommands'>,
  subject?: ProposalSubject
): DriftEntry {
  return { ...entry, proposedCommands: proposalsFor(entry, subject) }
}

function codePointOrder(left: string, right: string): number {
  const leftCodePoints = [...left]
  const rightCodePoints = [...right]
  const length = Math.min(leftCodePoints.length, rightCodePoints.length)

  for (let index = 0; index < length; index += 1) {
    const difference =
      leftCodePoints[index]!.codePointAt(0)! - rightCodePoints[index]!.codePointAt(0)!
    if (difference !== 0) return difference
  }

  return leftCodePoints.length - rightCodePoints.length
}

const entryOrder = (left: DriftEntry, right: DriftEntry): number =>
  codePointOrder(left.table, right.table) ||
  codePointOrder(left.object, right.object) ||
  codePointOrder(left.category, right.category) ||
  codePointOrder(left.detail, right.detail)

export function compareNormalized(
  orm: NormalizedSchema,
  db: NormalizedSchema,
  opts: { ignore: string[]; extraDefaultIgnore?: string[]; targetLabel?: string }
): DriftReport {
  const ormTables = tableMap(orm, db.defaultSchema)
  const dbTables = tableMap(db, db.defaultSchema)
  const tableKeys = new Set([...ormTables.keys(), ...dbTables.keys()])
  const extraDefaultIgnore = opts.extraDefaultIgnore ?? []
  const defaultIgnore = [...DEFAULT_IGNORE, ...extraDefaultIgnore]
  const ignorePatterns = opts.ignore.map(globToRegex)
  const targetLabel = opts.targetLabel ?? 'database'
  const entries: DriftEntry[] = []

  for (const tableKey of tableKeys) {
    const ormTable = ormTables.get(tableKey)
    const dbTable = dbTables.get(tableKey)
    const normalizedTable = ormTable ?? dbTable
    if (!normalizedTable) continue
    const table = qualifiedTableName(normalizedTable.identity)
    const isDefaultIgnored = defaultIgnore.includes(normalizedTable.identity.table)

    if (isDefaultIgnored || ignorePatterns.some((pattern) => pattern.test(table))) {
      entries.push(
        entryWithProposals({
          category: 'unmanaged',
          severity: 'info',
          table,
          object: 'table',
          detail: 'matched ignore pattern; excluded from drift scoring',
        })
      )
      continue
    }

    if (ormTable && !dbTable) {
      entries.push(
        entryWithProposals({
          category: 'missing_in_db',
          severity: 'error',
          table,
          object: 'table',
          detail: `table '${table}' is defined in ${orm.source} but absent in the ${targetLabel}`,
        })
      )
      continue
    }

    if (!ormTable && dbTable) {
      entries.push(
        entryWithProposals({
          category: 'missing_in_orm',
          severity: 'warn',
          table,
          object: 'table',
          detail: `table '${table}' exists in the ${targetLabel} but is not defined in ${orm.source}`,
        })
      )
      continue
    }

    if (ormTable && dbTable)
      compareTable(ormTable, dbTable, table, orm.source, targetLabel, entries)
  }

  entries.sort(entryOrder)

  const summary = {
    errors: entries.filter((entry) => entry.category !== 'unmanaged' && entry.severity === 'error')
      .length,
    warns: entries.filter((entry) => entry.category !== 'unmanaged' && entry.severity === 'warn')
      .length,
    infos: entries.filter((entry) => entry.category !== 'unmanaged' && entry.severity === 'info')
      .length,
    unmanaged: entries.filter((entry) => entry.category === 'unmanaged').length,
  }

  return {
    ormSource: orm.source,
    entries,
    unparsed: [...orm.unparsed, ...db.unparsed],
    summary,
  }
}

function compareTable(
  ormTable: NormalizedTable,
  dbTable: NormalizedTable,
  table: string,
  ormSource: string,
  targetLabel: string,
  entries: DriftEntry[]
): void {
  const ormColumns = new Map(ormTable.columns.map((column) => [column.name.toLowerCase(), column]))
  const dbColumns = new Map(dbTable.columns.map((column) => [column.name.toLowerCase(), column]))

  for (const [columnKey, ormColumn] of ormColumns) {
    const dbColumn = dbColumns.get(columnKey)
    if (!dbColumn) {
      entries.push(
        entryWithProposals(
          {
            category: 'missing_in_db',
            severity: 'error',
            table,
            object: ormColumn.name,
            detail: `column '${ormColumn.name}' (${ormColumn.type}) is defined in ${ormSource} but absent in the ${targetLabel}`,
          },
          { kind: 'column', table: ormTable.identity, column: ormColumn }
        )
      )
      continue
    }

    const mismatch = columnMismatch(ormColumn, dbColumn)
    if (mismatch) {
      entries.push(
        entryWithProposals({
          category: 'mismatch',
          severity: mismatch.severity,
          table,
          object: ormColumn.name,
          detail: `column '${ormColumn.name}': ${mismatch.reasons.join('; ')}`,
        })
      )
    }
  }

  for (const [columnKey, dbColumn] of dbColumns) {
    if (ormColumns.has(columnKey)) continue
    entries.push(
      entryWithProposals({
        category: 'missing_in_orm',
        severity: 'warn',
        table,
        object: dbColumn.name,
        detail: `column '${dbColumn.name}' (${dbColumn.type}) exists in the ${targetLabel} but is not defined in ${ormSource}`,
      })
    )
  }

  compareIndexes(
    ormTable.indexes,
    dbTable.indexes,
    ormTable.identity,
    table,
    ormSource,
    targetLabel,
    entries
  )
  compareForeignKeys(
    ormTable.foreignKeys,
    dbTable.foreignKeys,
    table,
    ormSource,
    targetLabel,
    entries
  )
}

function compareForeignKeys(
  ormForeignKeys: NormalizedForeignKey[],
  dbForeignKeys: NormalizedForeignKey[],
  table: string,
  ormSource: string,
  targetLabel: string,
  entries: DriftEntry[]
): void {
  const ormByKey = new Map(
    ormForeignKeys.map((foreignKey) => [foreignKeyKey(foreignKey), foreignKey])
  )
  const dbByKey = new Map(
    dbForeignKeys.map((foreignKey) => [foreignKeyKey(foreignKey), foreignKey])
  )

  for (const [key, foreignKey] of ormByKey) {
    if (dbByKey.has(key)) continue
    entries.push(
      entryWithProposals({
        category: 'missing_in_db',
        severity: 'error',
        table,
        object: `foreign key (${foreignKey.columns.join(', ')})`,
        detail: `foreign key (${foreignKey.columns.join(', ')}) → ${qualifiedTableName(foreignKey.refTable)}(${foreignKey.refColumns.join(', ')}) is defined in ${ormSource} but absent in the ${targetLabel}`,
      })
    )
  }
  for (const [key, foreignKey] of dbByKey) {
    if (ormByKey.has(key)) continue
    entries.push(
      entryWithProposals({
        category: 'missing_in_orm',
        severity: 'warn',
        table,
        object: `foreign key (${foreignKey.columns.join(', ')})`,
        detail: `foreign key (${foreignKey.columns.join(', ')}) → ${qualifiedTableName(foreignKey.refTable)}(${foreignKey.refColumns.join(', ')}) exists in the ${targetLabel} but is not defined in ${ormSource}`,
      })
    )
  }
}

function foreignKeyKey(foreignKey: NormalizedForeignKey): string {
  return [
    foreignKey.columns.join('\u0000'),
    tableIdentityKey(foreignKey.refTable),
    foreignKey.refColumns.join('\u0000'),
  ].join('\u0001')
}

function columnMismatch(
  ormColumn: NormalizedColumn,
  dbColumn: NormalizedColumn
): { severity: Extract<DriftSeverity, 'info' | 'error'>; reasons: string[] } | undefined {
  const reasons: string[] = []
  let severity: Extract<DriftSeverity, 'info' | 'error'> = 'info'
  const ormFamily = typeFamily(ormColumn.type)
  const dbFamily = typeFamily(dbColumn.type)

  if (ormFamily !== dbFamily) {
    severity = 'error'
    reasons.push(`type family differs (${ormColumn.type} vs ${dbColumn.type})`)
  } else if (ormColumn.type !== dbColumn.type) {
    reasons.push(`type spelling differs (${ormColumn.type} vs ${dbColumn.type})`)
  }

  if (ormColumn.nullable !== dbColumn.nullable) {
    severity = 'error'
    reasons.push(
      `nullability differs (${ormColumn.nullable ? 'NULL' : 'NOT NULL'} vs ${dbColumn.nullable ? 'NULL' : 'NOT NULL'})`
    )
  }

  if (ormColumn.default !== dbColumn.default) {
    reasons.push(
      `default differs (${displayOptional(ormColumn.default)} vs ${displayOptional(dbColumn.default)})`
    )
  }

  if (Boolean(ormColumn.primaryKey) !== Boolean(dbColumn.primaryKey)) {
    reasons.push(
      `primary key differs (${Boolean(ormColumn.primaryKey)} vs ${Boolean(dbColumn.primaryKey)})`
    )
  }

  return reasons.length > 0 ? { severity, reasons } : undefined
}

function displayOptional(value: string | undefined): string {
  return value === undefined ? 'none' : value
}

function compareIndexes(
  ormIndexes: NormalizedIndex[],
  dbIndexes: NormalizedIndex[],
  tableIdentity: NormalizedTableIdentity,
  table: string,
  ormSource: string,
  targetLabel: string,
  entries: DriftEntry[]
): void {
  const indexKey = (index: NormalizedIndex) =>
    JSON.stringify([index.columns.map((column) => column.toLowerCase()), index.unique])
  const dbKeys = new Set(dbIndexes.map(indexKey))
  const ormKeys = new Set(ormIndexes.map(indexKey))
  const emittedOrmKeys = new Set<string>()
  const emittedDbKeys = new Set<string>()

  for (const index of ormIndexes) {
    const key = indexKey(index)
    if (dbKeys.has(key) || emittedOrmKeys.has(key)) continue
    emittedOrmKeys.add(key)
    entries.push(
      entryWithProposals(
        {
          category: 'missing_in_db',
          severity: 'error',
          table,
          object: `index(${index.columns.join(',')})`,
          detail: `${index.unique ? 'unique ' : ''}index on (${index.columns.join(', ')}) is defined in ${ormSource} but absent in the ${targetLabel}`,
        },
        { kind: 'index', table: tableIdentity, index }
      )
    )
  }

  for (const index of dbIndexes) {
    const key = indexKey(index)
    if (ormKeys.has(key) || emittedDbKeys.has(key)) continue
    emittedDbKeys.add(key)
    entries.push(
      entryWithProposals(
        {
          category: 'missing_in_orm',
          severity: 'warn',
          table,
          object: `index(${index.columns.join(',')})`,
          detail: `${index.unique ? 'unique ' : ''}index on (${index.columns.join(', ')}) exists in the ${targetLabel} but is not defined in ${ormSource}`,
        },
        { kind: 'index', table: tableIdentity, index }
      )
    )
  }
}
