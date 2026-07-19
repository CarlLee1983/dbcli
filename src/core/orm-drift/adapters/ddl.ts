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

  for (const value of node.create_definitions) {
    if (!isAst(value)) {
      pushUnsupportedDefinition(tableName, 'malformed', unparsed)
      continue
    }

    const definition = value
    if (definition.resource === 'column') {
      consumeColumn(definition, table, unparsed)
      continue
    }

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
  const baseType = normalizedString(dataType?.dataType)

  if (!columnName || !baseType) {
    pushUnsupportedDefinition(
      table.name,
      `malformed column${columnName ? ` '${columnName}'` : ''}`,
      unparsed
    )
    return
  }

  const length = typeLength(dataType?.length)
  const type = length === null ? baseType : `${baseType}(${length})`
  const primaryKey = normalizedString(definition.primary_key) === 'primary key'
  const notNull =
    isAst(definition.nullable) && normalizedString(definition.nullable.type) === 'not null'

  table.columns.push({
    name: columnName,
    type,
    rawType: type,
    nullable: !primaryKey && !notNull,
    ...(primaryKey ? { primaryKey: true } : {}),
  })

  if (definition.reference_definition !== undefined) {
    consumeInlineForeignKey(definition.reference_definition, columnName, table, unparsed)
  }
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

function consumeInlineForeignKey(
  value: unknown,
  columnName: string,
  table: NormalizedTable,
  unparsed: UnparsedEntry[]
): void {
  if (!isAst(value)) {
    pushUnsupportedDefinition(table.name, `malformed foreign key on '${columnName}'`, unparsed)
    return
  }

  const refTable = tableNameOf(value)
  const refColumns = identifierList(value.definition)
  if (!refTable || refColumns.length === 0) {
    pushUnsupportedDefinition(table.name, `malformed foreign key on '${columnName}'`, unparsed)
    return
  }

  table.foreignKeys.push({ columns: [columnName], refTable, refColumns })
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

  const columns = identifierList(node.index_columns)
  if (columns.length === 0) {
    unparsed.push({
      location: indexName ?? `${tableName} index`,
      reason: 'blocked: malformed CREATE INDEX without columns',
    })
    return
  }

  target.indexes.push({
    ...(indexName ? { name: indexName } : {}),
    columns,
    unique: normalizedString(node.index_type) === 'unique',
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
