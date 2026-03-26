/**
 * Table formatter for CLI output
 * Converts schema data to human-readable ASCII tables
 */

import type { ColumnSchema, TableSchema } from '../adapters/types'

// Using require for cli-table3 due to CommonJS export
const Table = require('cli-table3')

export interface OutputFormatter<T> {
  format(data: T, options?: { compact?: boolean }): string
}

/**
 * Formats column schemas as ASCII table for terminal display
 * Shows column name, type, nullability, default values, and key information
 */
export class TableFormatter implements OutputFormatter<ColumnSchema[]> {
  format(columns: ColumnSchema[]): string {
    const table = new Table({
      head: ['Column', 'Type', 'Nullable', 'Default', 'Key'],
      style: { compact: false, 'padding-left': 1, 'padding-right': 1 },
      colWidths: [25, 25, 10, 25, 20]
    })

    columns.forEach(col => {
      let keyType = ''
      if (col.primaryKey) {
        keyType = 'PK'
      } else if (col.foreignKey) {
        keyType = `FK → ${col.foreignKey.table}.${col.foreignKey.column}`
      }

      table.push([
        col.name,
        col.type,
        col.nullable ? 'YES' : 'NO',
        col.default || 'NULL',
        keyType
      ])
    })

    return table.toString()
  }
}

/**
 * Formats table list for terminal display
 * Shows table name, column count, row count, and engine
 */
export class TableListFormatter implements OutputFormatter<TableSchema[]> {
  format(tables: TableSchema[]): string {
    const table = new Table({
      head: ['Table', 'Columns', 'Rows', 'Engine'],
      style: { compact: false, 'padding-left': 1, 'padding-right': 1 },
      colWidths: [30, 12, 15, 15]
    })

    tables.forEach(t => {
      table.push([
        t.name,
        (t.columnCount ?? t.columns.length).toString(),
        (t.rowCount ?? '?').toString(),
        t.engine || 'N/A'
      ])
    })

    return table.toString()
  }
}
