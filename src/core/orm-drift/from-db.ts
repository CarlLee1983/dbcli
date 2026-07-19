import type { TableSchema } from '@/adapters/types'
import type { NormalizedSchema } from './normalized-schema'

export function normalizeDbSchema(
  schema: Record<string, TableSchema>,
  options: { defaultSchema?: string } = {}
): NormalizedSchema {
  return {
    source: 'db',
    ...(options.defaultSchema !== undefined && { defaultSchema: options.defaultSchema }),
    tables: Object.values(schema).map((table) => ({
      identity: {
        ...(table.schema !== undefined && { schema: table.schema }),
        table: table.name,
      },
      columns: table.columns.map((column) => ({
        name: column.name,
        type: column.type.toLowerCase(),
        rawType: column.type,
        nullable: column.nullable,
        ...(column.default !== undefined &&
          column.default !== 'NULL' && { default: column.default }),
        ...(column.primaryKey && { primaryKey: true }),
      })),
      indexes: (table.indexes ?? []).map((index) => ({
        name: index.name,
        columns: index.columns,
        unique: Boolean(index.unique),
      })),
      foreignKeys: (table.foreignKeys ?? []).map((foreignKey) => ({
        columns: foreignKey.columns,
        refTable: {
          ...(foreignKey.refSchema !== undefined && { schema: foreignKey.refSchema }),
          table: foreignKey.refTable,
        },
        refColumns: foreignKey.refColumns,
      })),
    })),
    unparsed: [],
  }
}
