/**
 * DDL → NormalizedSchema via node-sql-parser. CREATE TABLE and
 * CREATE [UNIQUE] INDEX are consumed; unsupported or malformed statements
 * are retained as blocked entries instead of being guessed.
 */
import { Parser } from 'node-sql-parser'
import type { SqlDatabaseSystem } from '@/adapters/types'
import type {
  NormalizedSchema,
  NormalizedTable,
  UnparsedEntry,
} from '@/core/orm-drift/normalized-schema'

const DIALECT: Record<SqlDatabaseSystem, string> = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'Postgresql',
}

const parser = new Parser()
type Ast = Record<string, unknown>
type Result<T> = { ok: true; value: T } | { ok: false; reason: string }

export function parseDdl(sql: string, system: SqlDatabaseSystem): NormalizedSchema {
  const tables: Record<string, NormalizedTable> = {}
  const unparsed: UnparsedEntry[] = []

  for (const statement of splitSqlStatements(sql)) {
    let ast: unknown
    try {
      ast = parser.astify(statement, { database: DIALECT[system] })
    } catch (error) {
      unparsed.push({
        location: statement.slice(0, 60),
        reason: `blocked: parse failed — ${firstErrorLine(error)}`,
      })
      continue
    }

    for (const node of Array.isArray(ast) ? ast : [ast]) {
      if (!isAst(node)) {
        unparsed.push({
          location: statement.slice(0, 60),
          reason: 'blocked: parser produced a malformed statement',
        })
        continue
      }
      consumeStatement(node, tables, unparsed)
    }
  }

  return { source: 'ddl', tables, unparsed }
}

function consumeStatement(
  node: Ast,
  tables: Record<string, NormalizedTable>,
  unparsed: UnparsedEntry[]
): void {
  if (node.type === 'create' && node.keyword === 'table') {
    consumeCreateTable(node, tables, unparsed)
    return
  }
  if (node.type === 'create' && node.keyword === 'index') {
    consumeCreateIndex(node, tables, unparsed)
    return
  }

  const description = [stringValue(node.type), stringValue(node.keyword)]
    .filter((part): part is string => part !== null)
    .join(' ')
  unparsed.push({
    location: description || 'unknown',
    reason: `blocked: unsupported DDL statement '${description || 'unknown'}'`,
  })
}

function consumeCreateTable(
  node: Ast,
  tables: Record<string, NormalizedTable>,
  unparsed: UnparsedEntry[]
): void {
  const tableName = tableNameOf(node)
  if (!tableName) {
    unparsed.push({
      location: 'create table',
      reason: 'blocked: malformed CREATE TABLE missing table name',
    })
    return
  }

  if (!Array.isArray(node.create_definitions)) {
    unparsed.push({
      location: tableName,
      reason: 'blocked: unsupported CREATE TABLE without column definitions',
    })
    return
  }

  const table: NormalizedTable = {
    name: tableName,
    columns: [],
    indexes: [],
    foreignKeys: [],
  }

  const definitions: Ast[] = []
  for (const value of node.create_definitions) {
    if (!isAst(value)) {
      pushUnsupportedDefinition(tableName, 'malformed', unparsed)
      continue
    }
    definitions.push(value)
  }

  for (const definition of definitions) {
    if (definition.resource === 'column') {
      consumeColumn(definition, table, unparsed)
    }
  }

  for (const definition of definitions) {
    if (definition.resource === 'column') continue
    if (
      definition.resource === 'constraint' &&
      normalizedString(definition.constraint_type) === 'primary key'
    ) {
      consumeTablePrimaryKey(definition, table, unparsed)
      continue
    }

    pushUnsupportedDefinition(
      tableName,
      stringValue(definition.constraint_type) ?? stringValue(definition.resource) ?? 'malformed',
      unparsed
    )
  }

  tables[tableName.toLowerCase()] = table
}

function consumeColumn(definition: Ast, table: NormalizedTable, unparsed: UnparsedEntry[]): void {
  const columnName = identifierOf(definition.column)
  const dataType = isAst(definition.definition) ? definition.definition : null

  if (!columnName || !dataType) {
    pushUnsupportedDefinition(
      table.name,
      `malformed column${columnName ? ` '${columnName}'` : ''}`,
      unparsed
    )
    return
  }

  const unsupportedField = firstMeaningfulUnsupportedField(definition, [
    'column',
    'definition',
    'resource',
    'primary_key',
    'nullable',
    'reference_definition',
    'default_val',
    'unique',
    'generated',
  ])
  if (unsupportedField) {
    pushUnsupportedDefinition(
      table.name,
      `column '${columnName}' uses unsupported ${unsupportedField}`,
      unparsed
    )
    return
  }

  if (definition.generated !== undefined && definition.generated !== null) {
    pushUnsupportedDefinition(table.name, `generated column '${columnName}'`, unparsed)
    return
  }

  if (
    isAst(definition.column) &&
    definition.column.collate !== undefined &&
    definition.column.collate !== null
  ) {
    pushUnsupportedDefinition(table.name, `collated column '${columnName}'`, unparsed)
    return
  }

  const typeResult = reconstructType(dataType)
  if (!typeResult.ok) {
    pushUnsupportedDefinition(
      table.name,
      `${typeResult.reason} on column '${columnName}'`,
      unparsed
    )
    return
  }

  const nullable = nullableOf(definition.nullable)
  if (nullable === null) {
    pushUnsupportedDefinition(
      table.name,
      `malformed nullability on column '${columnName}'`,
      unparsed
    )
    return
  }

  const defaultResult = defaultOf(definition.default_val)
  if (!defaultResult.ok) {
    pushUnsupportedDefinition(table.name, `unsupported default on column '${columnName}'`, unparsed)
    return
  }

  const unique =
    definition.unique === undefined || definition.unique === null
      ? false
      : normalizedString(definition.unique) === 'unique'
  if (
    definition.unique !== undefined &&
    definition.unique !== null &&
    normalizedString(definition.unique) !== 'unique'
  ) {
    pushUnsupportedDefinition(table.name, `malformed unique column '${columnName}'`, unparsed)
    return
  }

  const foreignKeyResult = inlineForeignKeyOf(definition.reference_definition, columnName)
  if (!foreignKeyResult.ok) {
    pushUnsupportedDefinition(table.name, foreignKeyResult.reason, unparsed)
    return
  }

  const primaryKey = normalizedString(definition.primary_key) === 'primary key'

  table.columns.push({
    name: columnName,
    type: typeResult.value,
    rawType: typeResult.value,
    nullable: primaryKey ? false : nullable,
    ...(defaultResult.value === undefined ? {} : { default: defaultResult.value }),
    ...(primaryKey ? { primaryKey: true } : {}),
  })

  if (unique) table.indexes.push({ columns: [columnName], unique: true })
  if (foreignKeyResult.value) table.foreignKeys.push(foreignKeyResult.value)
}

function consumeTablePrimaryKey(
  definition: Ast,
  table: NormalizedTable,
  unparsed: UnparsedEntry[]
): void {
  const columns = identifierList(definition.definition)
  if (columns.length === 0) {
    pushUnsupportedDefinition(table.name, 'malformed primary key', unparsed)
    return
  }

  const found = new Set<string>()
  for (const column of table.columns) {
    if (columns.includes(column.name)) {
      column.primaryKey = true
      column.nullable = false
      found.add(column.name)
    }
  }

  if (found.size !== columns.length) {
    pushUnsupportedDefinition(table.name, 'primary key references an unknown column', unparsed)
  }
}

function inlineForeignKeyOf(
  value: unknown,
  columnName: string
): Result<NormalizedTable['foreignKeys'][number] | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (!isAst(value)) {
    return { ok: false, reason: `malformed foreign key on '${columnName}'` }
  }
  const unsupportedField = firstMeaningfulUnsupportedField(value, [
    'definition',
    'table',
    'keyword',
    'match',
    'on_action',
  ])
  if (unsupportedField) {
    return {
      ok: false,
      reason: `unsupported foreign key ${unsupportedField} on '${columnName}'`,
    }
  }
  if (
    (value.match !== undefined && value.match !== null) ||
    (Array.isArray(value.on_action) && value.on_action.length > 0)
  ) {
    return { ok: false, reason: `unsupported foreign key action on '${columnName}'` }
  }

  const refTable = tableNameOf(value)
  const refColumns = identifierList(value.definition)
  if (!refTable || refColumns.length === 0) {
    return { ok: false, reason: `malformed foreign key on '${columnName}'` }
  }

  return { ok: true, value: { columns: [columnName], refTable, refColumns } }
}

function consumeCreateIndex(
  node: Ast,
  tables: Record<string, NormalizedTable>,
  unparsed: UnparsedEntry[]
): void {
  const tableName = tableNameOf(node)
  const indexName = stringValue(node.index)
  const target = tableName ? tables[tableName.toLowerCase()] : undefined
  if (!target) {
    unparsed.push({
      location: indexName ?? 'index',
      reason: `blocked: CREATE INDEX targets unknown table '${tableName ?? '?'}'`,
    })
    return
  }

  const unsupportedIndexField = firstMeaningfulUnsupportedField(node, [
    'type',
    'index_type',
    'keyword',
    'index',
    'table',
    'index_columns',
    'temporary',
    'concurrently',
    'if_not_exists',
    'on_kw',
    'with_before_where',
  ])
  if (unsupportedIndexField) {
    pushUnsupportedIndex(indexName, `unsupported CREATE INDEX ${unsupportedIndexField}`, unparsed)
    return
  }

  const indexType = normalizedString(node.index_type)
  if (indexType !== null && indexType !== 'unique') {
    pushUnsupportedIndex(indexName, `unsupported CREATE INDEX type '${indexType}'`, unparsed)
    return
  }

  const columns = indexColumnList(node.index_columns)
  if (!columns.ok) {
    pushUnsupportedIndex(indexName, columns.reason, unparsed)
    return
  }
  if (columns.value.length === 0) {
    unparsed.push({
      location: indexName ?? `${tableName} index`,
      reason: 'blocked: malformed CREATE INDEX without columns',
    })
    return
  }

  target.indexes.push({
    ...(indexName ? { name: indexName } : {}),
    columns: columns.value,
    unique: indexType === 'unique',
  })
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let hasCode = false
  let quote: "'" | '"' | '`' | null = null
  let dollarTag: string | null = null
  let lineComment = false
  let blockComment = false

  const finish = (): void => {
    if (hasCode) statements.push(current.trim())
    current = ''
    hasCode = false
  }

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!
    const next = sql[index + 1]
    current += char

    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        current += next
        index += 1
        blockComment = false
      }
      continue
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag.slice(1)
        index += dollarTag.length - 1
        dollarTag = null
      }
      continue
    }
    if (quote) {
      if (char === '\\' && next !== undefined) {
        current += next
        index += 1
      } else if (char === quote && next === quote) {
        current += next
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '-' && next === '-') {
      current += next
      index += 1
      lineComment = true
      continue
    }
    if (char === '#') {
      lineComment = true
      continue
    }
    if (char === '/' && next === '*') {
      current += next
      index += 1
      blockComment = true
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      hasCode = true
      continue
    }
    if (char === '$') {
      const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (match) {
        const tag = match[0]
        current += tag.slice(1)
        index += tag.length - 1
        dollarTag = tag
        hasCode = true
        continue
      }
    }
    if (char === ';') {
      current = current.slice(0, -1)
      finish()
      continue
    }
    if (!/\s/.test(char)) hasCode = true
  }

  finish()
  return statements
}

function identifierList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const identifiers: string[] = []
  for (const item of value) {
    const identifier = identifierOf(item)
    if (identifier) identifiers.push(identifier)
  }
  return identifiers
}

function identifierOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!isAst(value)) return null

  for (const key of ['column', 'expr', 'value'] as const) {
    const identifier = identifierOf(value[key])
    if (identifier) return identifier
  }
  return null
}

function tableNameOf(node: Ast): string | null {
  const value = Array.isArray(node.table) ? node.table[0] : node.table
  if (typeof value === 'string') return value
  if (!isAst(value)) return null
  return stringValue(value.table)
}

function reconstructType(dataType: Ast): Result<string> {
  const baseType = normalizedString(dataType.dataType)
  if (!baseType) return { ok: false, reason: 'malformed type' }

  const unsupportedField = firstMeaningfulUnsupportedField(dataType, [
    'dataType',
    'length',
    'scale',
    'parentheses',
    'suffix',
  ])
  if (unsupportedField) {
    return { ok: false, reason: `unsupported type ${unsupportedField}` }
  }

  let type = baseType
  if (dataType.length !== undefined && dataType.length !== null) {
    const length = typeLength(dataType.length)
    if (!length) return { ok: false, reason: 'malformed type length' }

    let dimensions = length
    if (dataType.scale !== undefined && dataType.scale !== null) {
      const scale = scalarValue(dataType.scale)
      if (scale === null) return { ok: false, reason: 'malformed type scale' }
      dimensions += `,${scale}`
    }
    type += `(${dimensions})`
  } else if (dataType.scale !== undefined && dataType.scale !== null) {
    return { ok: false, reason: 'type scale without precision' }
  }

  if (dataType.suffix !== undefined && dataType.suffix !== null) {
    if (
      !Array.isArray(dataType.suffix) ||
      !dataType.suffix.every((part) => typeof part === 'string')
    ) {
      return { ok: false, reason: 'malformed type suffix' }
    }
    if (dataType.suffix.length > 0) {
      type += ` ${dataType.suffix.join(' ').toLowerCase()}`
    }
  }

  return { ok: true, value: type }
}

function defaultOf(value: unknown): Result<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (!isAst(value) || value.type !== 'default' || !isAst(value.value)) {
    return { ok: false, reason: 'malformed default' }
  }

  const expression = value.value
  if (expression.type === 'number') {
    const number = scalarValue(expression.value)
    return number === null
      ? { ok: false, reason: 'malformed numeric default' }
      : { ok: true, value: number }
  }
  if (expression.type === 'single_quote_string' && typeof expression.value === 'string') {
    return { ok: true, value: `'${expression.value.replaceAll("'", "''")}'` }
  }
  if (expression.type === 'bool' && typeof expression.value === 'boolean') {
    return { ok: true, value: String(expression.value) }
  }
  if (expression.type === 'null') return { ok: true, value: 'null' }

  return { ok: false, reason: `unsupported default expression '${expression.type ?? 'unknown'}'` }
}

function nullableOf(value: unknown): boolean | null {
  if (value === undefined || value === null) return true
  if (!isAst(value)) return null
  const type = normalizedString(value.type)
  if (type === 'not null') return false
  if (type === 'null') return true
  return null
}

function indexColumnList(value: unknown): Result<string[]> {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'blocked: malformed CREATE INDEX columns' }
  }

  const columns: string[] = []
  for (const column of value) {
    if (!isAst(column) || column.type !== 'column_ref') {
      return { ok: false, reason: 'blocked: unsupported CREATE INDEX expression' }
    }
    const unsupportedField = firstMeaningfulUnsupportedField(column, ['type', 'table', 'column'])
    if (unsupportedField) {
      return {
        ok: false,
        reason: `blocked: unsupported CREATE INDEX column ${unsupportedField}`,
      }
    }
    const identifier = identifierOf(column)
    if (!identifier) return { ok: false, reason: 'blocked: malformed CREATE INDEX column' }
    columns.push(identifier)
  }

  return { ok: true, value: columns }
}

function typeLength(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) {
    const parts = value.map((part) => scalarValue(part))
    return parts.every((part) => part !== null) ? (parts as string[]).join(',') : null
  }
  return scalarValue(value)
}

function scalarValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!isAst(value)) return null
  return scalarValue(value.value)
}

function firstMeaningfulUnsupportedField(value: Ast, allowed: string[]): string | null {
  const allowedFields = new Set(allowed)
  for (const [key, fieldValue] of Object.entries(value)) {
    if (allowedFields.has(key)) continue
    if (fieldValue === undefined || fieldValue === null) continue
    if (Array.isArray(fieldValue) && fieldValue.length === 0) continue
    return key
  }
  return null
}

function pushUnsupportedDefinition(
  tableName: string,
  definition: string,
  unparsed: UnparsedEntry[]
): void {
  unparsed.push({
    location: `${tableName} (${definition})`,
    reason: `blocked: unsupported table definition '${definition}'`,
  })
}

function pushUnsupportedIndex(
  indexName: string | null,
  reason: string,
  unparsed: UnparsedEntry[]
): void {
  unparsed.push({
    location: indexName ?? 'index',
    reason: reason.startsWith('blocked:') ? reason : `blocked: ${reason}`,
  })
}

function firstErrorLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'unknown error'
}

function normalizedString(value: unknown): string | null {
  const string = stringValue(value)
  return string === null ? null : string.toLowerCase()
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isAst(value: unknown): value is Ast {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
