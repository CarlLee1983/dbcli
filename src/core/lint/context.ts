import type { TableSchema } from '@/adapters/types'
import { SchemaLayeredLoader } from '@/core/schema-loader'
import type { SchemaContext } from '@/core/lint/types'

export function buildSchemaContext(
  schema: Record<string, TableSchema> | undefined
): SchemaContext {
  const exactTables = new Map<string, TableSchema[]>()
  const foldedTables = new Map<string, TableSchema[]>()

  const addTableAlias = (
    index: Map<string, TableSchema[]>,
    alias: string,
    table: TableSchema
  ) => {
    const matches = index.get(alias) ?? []
    if (!matches.includes(table)) matches.push(table)
    index.set(alias, matches)
  }

  for (const [name, table] of Object.entries(schema ?? {})) {
    for (const alias of new Set([name, table.name])) {
      addTableAlias(exactTables, alias, table)
      addTableAlias(foldedTables, alias.toLowerCase(), table)
    }
  }

  const resolveTable = (name: string): TableSchema | undefined => {
    const folded = foldedTables.get(name.toLowerCase())
    if (folded?.length !== 1) return undefined

    const exact = exactTables.get(name)
    return exact?.length === 1 ? exact[0] : folded[0]
  }

  const resolveTableColumn = (
    table: TableSchema,
    name: string
  ): TableSchema['columns'][number] | undefined => {
    const folded = table.columns.filter(
      (column) => column.name.toLowerCase() === name.toLowerCase()
    )
    if (folded.length !== 1) return undefined

    const exact = table.columns.filter((column) => column.name === name)
    return exact.length === 1 ? exact[0] : folded[0]
  }

  return {
    available: exactTables.size > 0,
    getTable(name) {
      return resolveTable(name)
    },
    resolveColumn(candidateTables, column) {
      for (const candidateTable of candidateTables) {
        const table = resolveTable(candidateTable)
        const resolvedColumn = table
          ? resolveTableColumn(table, column)
          : undefined
        if (table && resolvedColumn) {
          return { table: table.name, column: resolvedColumn }
        }
      }

      return undefined
    },
  }
}

export async function loadSchemaContext(
  dbcliPath: string,
  connectionName?: string
): Promise<SchemaContext> {
  const loader = new SchemaLayeredLoader(dbcliPath, { connectionName })
  const { cache, index } = await loader.initialize()
  const schema: Record<string, TableSchema> = {}

  for (const tableName of Object.keys(index?.tables ?? {})) {
    const table = await cache.getTableSchema(tableName)
    if (table) {
      schema[tableName] = table
    }
  }

  return buildSchemaContext(schema)
}
