import { typeFamily } from '@/core/orm-drift/normalized-schema'
import type {
  NormalizedColumn,
  NormalizedIndex,
  NormalizedSchema,
  NormalizedTable,
  UnparsedEntry,
} from '@/core/orm-drift/normalized-schema'
import { proposalsFor } from '@/core/orm-drift/proposals'

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
  return new RegExp(`^${escaped}$`, 'i')
}

function tableMap(schema: NormalizedSchema): Map<string, NormalizedTable> {
  return new Map(Object.values(schema.tables).map((table) => [table.name.toLowerCase(), table]))
}

function entryWithProposals(
  entry: Omit<DriftEntry, 'proposedCommands'>,
  column?: NormalizedColumn
): DriftEntry {
  return { ...entry, proposedCommands: proposalsFor(entry, column) }
}

export function compareNormalized(
  orm: NormalizedSchema,
  db: NormalizedSchema,
  opts: { ignore: string[] }
): DriftReport {
  const ormTables = tableMap(orm)
  const dbTables = tableMap(db)
  const tableKeys = new Set([...ormTables.keys(), ...dbTables.keys()])
  const ignorePatterns = [...DEFAULT_IGNORE, ...opts.ignore].map(globToRegex)
  const entries: DriftEntry[] = []

  for (const tableKey of tableKeys) {
    const ormTable = ormTables.get(tableKey)
    const dbTable = dbTables.get(tableKey)
    const table = (ormTable ?? dbTable)?.name
    if (!table) continue

    if (ignorePatterns.some((pattern) => pattern.test(table))) {
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

    if (ormTable && dbTable) compareTable(ormTable, dbTable, orm.source, entries)
  }

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
  ormSource: string,
  entries: DriftEntry[]
): void {
  const table = ormTable.name
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
          ormColumn
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

  compareIndexes(ormTable.indexes, dbTable.indexes, table, ormSource, entries)
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
  table: string,
  ormSource: string,
  entries: DriftEntry[]
): void {
  const indexKey = (index: NormalizedIndex) =>
    `${index.columns.map((column) => column.toLowerCase()).join(',')}|${index.unique}`
  const dbKeys = new Set(dbIndexes.map(indexKey))
  const ormKeys = new Set(ormIndexes.map(indexKey))

  for (const index of ormIndexes) {
    if (dbKeys.has(indexKey(index))) continue
    entries.push(
      entryWithProposals({
        category: 'missing_in_db',
        severity: 'error',
        table,
        object: `index(${index.columns.join(',')})`,
        detail: `${index.unique ? 'unique ' : ''}index on (${index.columns.join(', ')}) is defined in ${ormSource} but absent in the database`,
      })
    )
  }

  for (const index of dbIndexes) {
    if (ormKeys.has(indexKey(index))) continue
    entries.push(
      entryWithProposals({
        category: 'missing_in_orm',
        severity: 'warn',
        table,
        object: `index(${index.columns.join(',')})`,
        detail: `${index.unique ? 'unique ' : ''}index on (${index.columns.join(', ')}) exists in the database but is not defined in ${ormSource}`,
      })
    )
  }
}
