import type { TableSchema } from '@/adapters/types'
import { SchemaLayeredLoader } from '@/core/schema-loader'
import type { SchemaContext } from '@/core/lint/types'

export function buildSchemaContext(
  schema: Record<string, TableSchema> | undefined
): SchemaContext {
  const tables = new Map<string, TableSchema>()
  for (const [name, table] of Object.entries(schema ?? {})) {
    tables.set(name.toLowerCase(), table)
  }

  return {
    available: tables.size > 0,
    getTable(name) {
      return tables.get(name.toLowerCase())
    },
    resolveColumn(candidateTables, column) {
      for (const candidateTable of candidateTables) {
        const table = tables.get(candidateTable.toLowerCase())
        const resolvedColumn = table?.columns.find(
          (candidateColumn) => candidateColumn.name.toLowerCase() === column.toLowerCase()
        )
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
