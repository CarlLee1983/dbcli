/**
 * JSON formatter for structured output
 * Enables AI agents to parse schema data programmatically
 */

import type { ColumnSchema, TableSchema } from '../adapters/types'

export interface OutputFormatter<T> {
  format(data: T, options?: { compact?: boolean }): string
}

/**
 * Formats schema data as JSON for programmatic parsing
 * Used by AI agents and tools that need structured output
 */
export class JSONFormatter implements OutputFormatter<ColumnSchema[] | TableSchema[]> {
  format(
    data: ColumnSchema[] | TableSchema[],
    options?: { compact?: boolean }
  ): string {
    const spacing = options?.compact ? undefined : 2
    return JSON.stringify(data, null, spacing)
  }
}

/**
 * Formats a single table schema as JSON
 * Includes full metadata: columns, constraints, relationships
 */
export class TableSchemaJSONFormatter implements OutputFormatter<TableSchema> {
  format(table: TableSchema, options?: { compact?: boolean }): string {
    const spacing = options?.compact ? undefined : 2
    const output = {
      name: table.name,
      columns: table.columns,
      primaryKey: table.primaryKey || [],
      foreignKeys: table.foreignKeys || [],
      metadata: {
        rowCount: table.rowCount,
        engine: table.engine
      }
    }
    return JSON.stringify(output, null, spacing)
  }
}
