import { typeFamily } from '@/core/orm-drift/normalized-schema'
import type {
  NormalizedColumn,
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
  return new Map(
    schema.tables.map((table) => {
      const identity: NormalizedTableIdentity =
        table.identity.schema === undefined && defaultSchema !== undefined
          ? { ...table.identity, schema: defaultSchema }
          : table.identity
      return [tableIdentityKey(identity), { ...table, identity }]
    })
  )
}

function entryWithProposals(
  entry: Omit<DriftEntry, 'proposedCommands'>,
  subject?: ProposalSubject
): DriftEntry {
  return { ...entry, proposedCommands: proposalsFor(entry, subject) }
}

const entryOrder = (left: DriftEntry, right: DriftEntry): number =>
  left.table.localeCompare(right.table) ||
  left.object.localeCompare(right.object) ||
  left.category.localeCompare(right.category) ||
  left.detail.localeCompare(right.detail)

export function compareNormalized(
  orm: NormalizedSchema,
  db: NormalizedSchema,
  opts: { ignore: string[] }
): DriftReport {
  const ormTables = tableMap(orm, db.defaultSchema)
  const dbTables = tableMap(db)
  const tableKeys = new Set([...ormTables.keys(), ...dbTables.keys()])
  const ignorePatterns = opts.ignore.map(globToRegex)
  const entries: DriftEntry[] = []

  for (const tableKey of tableKeys) {
    const ormTable = ormTables.get(tableKey)
    const dbTable = dbTables.get(tableKey)
    const normalizedTable = ormTable ?? dbTable
    if (!normalizedTable) continue
    const table = qualifiedTableName(normalizedTable.identity)

    if (
      DEFAULT_IGNORE.includes(normalizedTable.identity.table) ||
      ignorePatterns.some((pattern) => pattern.test(table))
    ) {
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
          detail: `table '${table}' is defined in ${orm.source} but absent in the database`,
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
          detail: `table '${table}' exists in the database but is not defined in ${orm.source}`,
        })
      )
      continue
    }

    if (ormTable && dbTable) compareTable(ormTable, dbTable, table, orm.source, entries)
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
            detail: `column '${ormColumn.name}' (${ormColumn.type}) is defined in ${ormSource} but absent in the database`,
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
        detail: `column '${dbColumn.name}' (${dbColumn.type}) exists in the database but is not defined in ${ormSource}`,
      })
    )
  }

  compareIndexes(ormTable.indexes, dbTable.indexes, ormTable.identity, table, ormSource, entries)
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
          detail: `${index.unique ? 'unique ' : ''}index on (${index.columns.join(', ')}) is defined in ${ormSource} but absent in the database`,
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
          detail: `${index.unique ? 'unique ' : ''}index on (${index.columns.join(', ')}) exists in the database but is not defined in ${ormSource}`,
        },
        { kind: 'index', table: tableIdentity, index }
      )
    )
  }
}
