/**
 * drizzle-kit PostgreSQL snapshot JSON → NormalizedSchema. This consumes the
 * generated drizzle/meta/*_snapshot.json artifact, never the TypeScript schema.
 */
import type {
  NormalizedSchema,
  NormalizedTable,
  UnparsedEntry,
} from '@/core/orm-drift/normalized-schema'
import { tableIdentityKey } from '@/core/orm-drift/table-identity'

type JsonObject = Record<string, unknown>

const TOP_LEVEL_FIELDS = new Set([
  'id',
  'prevId',
  'version',
  'dialect',
  'tables',
  'enums',
  'schemas',
  'views',
  'sequences',
  'roles',
  'policies',
  '_meta',
])

const TABLE_FIELDS = new Set([
  'name',
  'schema',
  'columns',
  'indexes',
  'foreignKeys',
  'compositePrimaryKeys',
  'uniqueConstraints',
  'policies',
  'checkConstraints',
  'isRLSEnabled',
])

const COLUMN_FIELDS = new Set([
  'name',
  'type',
  'typeSchema',
  'primaryKey',
  'notNull',
  'default',
  'isUnique',
  'uniqueName',
  'nullsNotDistinct',
  'generated',
  'identity',
])

const INDEX_FIELDS = new Set([
  'name',
  'columns',
  'isUnique',
  'method',
  'where',
  'with',
  'concurrently',
])

const INDEX_COLUMN_FIELDS = new Set(['expression', 'isExpression', 'asc', 'nulls', 'opclass'])

const FOREIGN_KEY_FIELDS = new Set([
  'name',
  'tableFrom',
  'columnsFrom',
  'tableTo',
  'schemaTo',
  'columnsTo',
  'onUpdate',
  'onDelete',
])

const UNSUPPORTED_TOP_LEVEL_COLLECTIONS = [
  'enums',
  'schemas',
  'views',
  'sequences',
  'roles',
  'policies',
] as const

const UNSUPPORTED_TABLE_COLLECTIONS = [
  'compositePrimaryKeys',
  'uniqueConstraints',
  'policies',
  'checkConstraints',
] as const

export function isDrizzleSnapshot(json: unknown): boolean {
  return (
    isObject(json) && json.version === '7' && json.dialect === 'postgresql' && isObject(json.tables)
  )
}

export function parseDrizzleSnapshot(json: unknown): NormalizedSchema {
  const unparsed: UnparsedEntry[] = []
  const tables: NormalizedTable[] = []
  const tableKeys = new Set<string>()

  if (!isObject(json)) {
    addBlocked(unparsed, 'snapshot', 'drizzle snapshot must be a JSON object')
    return { source: 'drizzle', tables, unparsed }
  }

  surfaceUnknownFields(json, TOP_LEVEL_FIELDS, '', unparsed)
  surfaceUnsupportedCollections(json, UNSUPPORTED_TOP_LEVEL_COLLECTIONS, '', unparsed)

  if (!isObject(json.tables)) {
    addBlocked(unparsed, 'tables', 'drizzle snapshot tables must be an object')
    return { source: 'drizzle', tables, unparsed }
  }

  for (const [snapshotKey, rawTable] of Object.entries(json.tables)) {
    const location = snapshotKey
    if (!isObject(rawTable)) {
      addBlocked(unparsed, location, 'drizzle table entry must be an object')
      continue
    }

    surfaceUnknownFields(rawTable, TABLE_FIELDS, location, unparsed)
    surfaceUnsupportedCollections(rawTable, UNSUPPORTED_TABLE_COLLECTIONS, location, unparsed)
    if (rawTable.isRLSEnabled === true) {
      addBlocked(unparsed, `${location}.isRLSEnabled`, 'row-level security is not compared')
    }

    const fallbackName = snapshotKey.split('.').pop()
    const name = stringValue(rawTable.name) ?? fallbackName
    if (!name) {
      addBlocked(unparsed, location, 'table name is missing')
      continue
    }
    const schema = stringValue(rawTable.schema)
    const table: NormalizedTable = {
      identity: { ...(schema ? { schema } : {}), table: name },
      columns: [],
      indexes: [],
      foreignKeys: [],
    }

    parseColumns(rawTable.columns, location, table, unparsed)
    parseIndexes(rawTable.indexes, location, table, unparsed)
    parseForeignKeys(rawTable.foreignKeys, location, table, unparsed)

    const identityKey = tableIdentityKey(table.identity)
    if (tableKeys.has(identityKey)) {
      addBlocked(unparsed, location, `duplicate normalized table identity '${name}'`)
      continue
    }
    tableKeys.add(identityKey)
    tables.push(table)
  }

  return { source: 'drizzle', tables, unparsed }
}

function parseColumns(
  rawColumns: unknown,
  tableLocation: string,
  table: NormalizedTable,
  unparsed: UnparsedEntry[]
): void {
  if (rawColumns === undefined) return
  if (!isObject(rawColumns)) {
    addBlocked(unparsed, `${tableLocation}.columns`, 'columns must be an object')
    return
  }

  for (const [columnKey, rawColumn] of Object.entries(rawColumns)) {
    const location = `${tableLocation}.columns.${columnKey}`
    if (!isObject(rawColumn)) {
      addBlocked(unparsed, location, 'column entry must be an object')
      continue
    }

    surfaceUnknownFields(rawColumn, COLUMN_FIELDS, location, unparsed)
    surfaceUnsupportedColumnFields(rawColumn, location, unparsed)

    const name = stringValue(rawColumn.name) ?? columnKey
    const rawType = stringValue(rawColumn.type)
    if (!rawType) {
      addBlocked(unparsed, location, 'column type is missing')
      continue
    }
    table.columns.push({
      name,
      type: rawType.toLowerCase(),
      rawType,
      nullable: rawColumn.notNull !== true && rawColumn.primaryKey !== true,
      ...(rawColumn.primaryKey === true ? { primaryKey: true } : {}),
      ...(rawColumn.default !== undefined ? { default: String(rawColumn.default) } : {}),
    })
  }
}

function parseIndexes(
  rawIndexes: unknown,
  tableLocation: string,
  table: NormalizedTable,
  unparsed: UnparsedEntry[]
): void {
  if (rawIndexes === undefined) return
  if (!isObject(rawIndexes)) {
    addBlocked(unparsed, `${tableLocation}.indexes`, 'indexes must be an object')
    return
  }

  for (const [indexKey, rawIndex] of Object.entries(rawIndexes)) {
    const location = `${tableLocation}.indexes.${indexKey}`
    if (!isObject(rawIndex)) {
      addBlocked(unparsed, location, 'index entry must be an object')
      continue
    }

    surfaceUnknownFields(rawIndex, INDEX_FIELDS, location, unparsed)
    surfaceUnsupportedIndexOptions(rawIndex, location, unparsed)

    if (!Array.isArray(rawIndex.columns)) {
      addBlocked(unparsed, location, 'index columns must use the v7 structured array')
      continue
    }

    const columns: string[] = []
    let blocked = false
    for (const [columnIndex, rawColumn] of rawIndex.columns.entries()) {
      const columnLocation = `${location}.columns.${columnIndex}`
      if (!isObject(rawColumn)) {
        addBlocked(unparsed, location, 'index columns must use v7 structured references')
        blocked = true
        break
      }
      surfaceUnknownFields(rawColumn, INDEX_COLUMN_FIELDS, columnLocation, unparsed)
      if (rawColumn.isExpression !== false || typeof rawColumn.expression !== 'string') {
        addBlocked(unparsed, location, 'expression or malformed indexes are not compared')
        blocked = true
        break
      }
      surfaceUnsupportedIndexColumnOptions(rawColumn, columnLocation, unparsed)
      columns.push(rawColumn.expression)
    }
    if (blocked) continue

    table.indexes.push({
      name: stringValue(rawIndex.name) ?? indexKey,
      columns,
      unique: rawIndex.isUnique === true,
    })
  }
}

function parseForeignKeys(
  rawForeignKeys: unknown,
  tableLocation: string,
  table: NormalizedTable,
  unparsed: UnparsedEntry[]
): void {
  if (rawForeignKeys === undefined) return
  if (!isObject(rawForeignKeys)) {
    addBlocked(unparsed, `${tableLocation}.foreignKeys`, 'foreign keys must be an object')
    return
  }

  for (const [foreignKeyName, rawForeignKey] of Object.entries(rawForeignKeys)) {
    const location = `${tableLocation}.foreignKeys.${foreignKeyName}`
    if (!isObject(rawForeignKey)) {
      addBlocked(unparsed, location, 'foreign key entry must be an object')
      continue
    }

    surfaceUnknownFields(rawForeignKey, FOREIGN_KEY_FIELDS, location, unparsed)
    if (rawForeignKey.onUpdate !== undefined || rawForeignKey.onDelete !== undefined) {
      addBlocked(unparsed, location, 'foreign-key actions are not compared')
    }

    const columns = stringArray(rawForeignKey.columnsFrom)
    const refColumns = stringArray(rawForeignKey.columnsTo)
    const refTable = stringValue(rawForeignKey.tableTo)
    if (!columns || !refColumns || !refTable || columns.length !== refColumns.length) {
      addBlocked(unparsed, location, 'foreign key shape is malformed')
      continue
    }
    const refSchema = stringValue(rawForeignKey.schemaTo)
    table.foreignKeys.push({
      columns,
      refTable: { ...(refSchema ? { schema: refSchema } : {}), table: refTable },
      refColumns,
    })
  }
}

function surfaceUnsupportedColumnFields(
  column: JsonObject,
  location: string,
  unparsed: UnparsedEntry[]
): void {
  for (const field of ['typeSchema', 'generated', 'identity'] as const) {
    if (column[field] !== undefined) {
      addBlocked(unparsed, `${location}.${field}`, `column ${field} metadata is not compared`)
    }
  }
  if (
    column.isUnique === true ||
    column.uniqueName !== undefined ||
    column.nullsNotDistinct === true
  ) {
    addBlocked(unparsed, location, 'column-level unique constraints are not compared')
  }
}

function surfaceUnsupportedIndexOptions(
  index: JsonObject,
  location: string,
  unparsed: UnparsedEntry[]
): void {
  if (index.method !== undefined && index.method !== 'btree') {
    addBlocked(unparsed, `${location}.method`, 'non-btree index methods are not compared')
  }
  if (index.where !== undefined) {
    addBlocked(unparsed, `${location}.where`, 'partial-index predicates are not compared')
  }
  if (index.with !== undefined) {
    addBlocked(unparsed, `${location}.with`, 'index storage parameters are not compared')
  }
  if (index.concurrently === true) {
    addBlocked(unparsed, `${location}.concurrently`, 'concurrent index creation is not compared')
  }
}

function surfaceUnsupportedIndexColumnOptions(
  column: JsonObject,
  location: string,
  unparsed: UnparsedEntry[]
): void {
  if (column.asc === false) {
    addBlocked(unparsed, `${location}.asc`, 'descending index order is not compared')
  }
  if (column.nulls !== undefined && column.nulls !== 'last') {
    addBlocked(unparsed, `${location}.nulls`, 'non-default index null ordering is not compared')
  }
  if (column.opclass !== undefined) {
    addBlocked(unparsed, `${location}.opclass`, 'index operator classes are not compared')
  }
}

function surfaceUnsupportedCollections(
  object: JsonObject,
  fields: readonly string[],
  parentLocation: string,
  unparsed: UnparsedEntry[]
): void {
  for (const field of fields) {
    const value = object[field]
    const fieldLocation = joinLocation(parentLocation, field)
    if (isObject(value)) {
      for (const key of Object.keys(value)) {
        addBlocked(unparsed, `${fieldLocation}.${key}`, `drizzle ${field} entries are not compared`)
      }
    } else if (value !== undefined) {
      addBlocked(unparsed, fieldLocation, `drizzle ${field} must be an object`)
    }
  }
}

function surfaceUnknownFields(
  object: JsonObject,
  knownFields: ReadonlySet<string>,
  parentLocation: string,
  unparsed: UnparsedEntry[]
): void {
  for (const field of Object.keys(object)) {
    if (!knownFields.has(field)) {
      addBlocked(
        unparsed,
        joinLocation(parentLocation, field),
        `unknown drizzle schema field '${field}'`
      )
    }
  }
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function joinLocation(parent: string, child: string): string {
  return parent ? `${parent}.${child}` : child
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function addBlocked(unparsed: UnparsedEntry[], location: string, detail: string): void {
  unparsed.push({
    location,
    reason: detail.startsWith('blocked:') ? detail : `blocked: ${detail}`,
  })
}
