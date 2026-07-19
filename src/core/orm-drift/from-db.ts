import type { TableSchema } from '@/adapters/types'
import type { NormalizedSchema, NormalizedTable } from './normalized-schema'

export function normalizeDbSchema(schema: Record<string, TableSchema>): NormalizedSchema {
  const tables: Record<string, NormalizedTable> = {}
  for (const table of Object.values(schema)) {
    tables[table.name.toLowerCase()] = {
      name: table.name,
      columns: table.columns.map((c) => ({
        name: c.name,
        type: c.type.toLowerCase(),
        rawType: c.type,
        nullable: c.nullable,
        ...(c.default !== undefined && c.default !== 'NULL' && { default: c.default }),
        ...(c.primaryKey && { primaryKey: true }),
      })),
      indexes: (table.indexes ?? []).map((i) => ({
        name: i.name,
        columns: i.columns,
        unique: Boolean(i.unique),
      })),
      foreignKeys: (table.foreignKeys ?? []).map((fk) => ({
        columns: fk.columns,
        refTable: fk.refTable,
        refColumns: fk.refColumns,
      })),
    }
  }
  return { source: 'db', tables, unparsed: [] }
}
