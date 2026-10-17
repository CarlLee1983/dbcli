import type { TableSchema } from '@/adapters/types'
import type { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistError } from '@/types/blacklist'

export function schemaIdentities(name: string, namespace?: string): string[] {
  return namespace === undefined ? [name] : [name, `${namespace}.${name}`]
}

export function checkSchemaTable(
  manager: BlacklistManager,
  name: string,
  namespace?: string
): void {
  if (schemaIdentities(name, namespace).some((id) => manager.isTableBlacklisted(id))) {
    throw new BlacklistError('Schema inspection is blocked by the table blacklist.', name, 'schema')
  }
}

/** Redact the whole constraint, never fabricate a shorter key. Rebuild column
 * references from surviving FK identities so that no second representation leaks. */
export function protectSQLSchema(schema: TableSchema, manager: BlacklistManager): TableSchema {
  checkSchemaTable(manager, schema.name, schema.schema)
  const blockedColumn = (name: string, namespace: string | undefined, column: string) =>
    [...schemaIdentities(name, namespace), '*'].some((id) =>
      manager.isColumnBlacklisted(id, column)
    )
  const hidden = (column: string) => blockedColumn(schema.name, schema.schema, column)
  const columns = schema.columns.filter((column) => !hidden(column.name))
  const primaryKey = schema.primaryKey?.some(hidden) ? [] : schema.primaryKey
  const indexes = schema.indexes?.filter(
    (index) => index.columnsComplete !== false && !index.columns.some(hidden)
  )
  const foreignKeys = schema.foreignKeys?.filter(
    (fk) =>
      fk.refSchema !== undefined &&
      !fk.columns.some(hidden) &&
      !schemaIdentities(fk.refTable, fk.refSchema).some((id) => manager.isTableBlacklisted(id)) &&
      !fk.refColumns.some((column) => blockedColumn(fk.refTable, fk.refSchema, column))
  )
  const omitted =
    columns.length !== schema.columns.length ||
    primaryKey?.length !== schema.primaryKey?.length ||
    indexes?.length !== schema.indexes?.length ||
    foreignKeys?.length !== schema.foreignKeys?.length ||
    columns.some(
      (column) =>
        column.foreignKey &&
        !foreignKeys?.some((fk) => fk.columns.length === 1 && fk.columns[0] === column.name)
    )
  if (!omitted) return schema
  return {
    ...schema,
    columns: columns.map((column) => {
      const fk = foreignKeys?.find(
        (fk) =>
          fk.columns.length === 1 && fk.columns[0] === column.name && fk.refColumns.length === 1
      )
      return {
        ...column,
        primaryKey: primaryKey?.includes(column.name) ?? false,
        foreignKey: fk ? { table: fk.refTable, column: fk.refColumns[0]! } : undefined,
      }
    }),
    primaryKey,
    indexes,
    foreignKeys,
    metadataOmitted: true,
  }
}
