/**
 * Column Index Builder - O(1) Column Lookup
 *
 * Builds and maintains an index for fast column lookups across all tables
 * Provides O(1) column name resolution instead of O(n*m)
 */

import type { TableSchema, ColumnSchema } from '@/adapters/types'

/**
 * Column index entry - maps column name to all tables containing it
 */
export interface ColumnIndexEntry {
  name: string
  tables: Array<{
    tableName: string
    column: ColumnSchema
  }>
}

/**
 * Column Index - maps column names to table locations
 */
export interface ColumnIndexMap {
  /** Column name → index entry */
  columns: Map<string, ColumnIndexEntry>
  /** Total number of columns indexed */
  totalColumns: number
  /** Total number of tables indexed */
  totalTables: number
  /** Timestamp of index creation */
  timestamp: string
}

/**
 * Column Index Builder - creates and updates column indexes
 *
 * Optimizes column lookups from O(n*m) to O(1)
 * where n=number of tables, m=average columns per table
 */
export class ColumnIndexBuilder {
  private index: ColumnIndexMap = {
    columns: new Map(),
    totalColumns: 0,
    totalTables: 0,
    timestamp: new Date().toISOString(),
  }

  /**
   * Build index from schema objects
   *
   * Iterates through all tables and columns, creating hash map for O(1) lookup
   *
   * @param schemas Map of table name → TableSchema
   * @returns ColumnIndexMap for fast lookups
   */
  build(schemas: Record<string, TableSchema>): ColumnIndexMap {
    this.index = {
      columns: new Map(),
      totalColumns: 0,
      totalTables: Object.keys(schemas).length,
      timestamp: new Date().toISOString(),
    }

    // Iterate through all tables
    for (const [tableName, table] of Object.entries(schemas)) {
      // Index each column
      for (const column of table.columns) {
        this.addColumnEntry(tableName, column)
      }
    }

    return this.index
  }

  /**
   * Add or update a column entry in the index
   *
   * If column already exists (in other table), append entry
   * If new, create entry
   *
   * @param tableName Name of table containing column
   * @param column Column schema
   */
  private addColumnEntry(tableName: string, column: ColumnSchema): void {
    const colName = column.name.toLowerCase()

    if (!this.index.columns.has(colName)) {
      // New column
      this.index.columns.set(colName, {
        name: column.name,
        tables: [],
      })
      this.index.totalColumns++
    }

    const entry = this.index.columns.get(colName)!
    entry.tables.push({
      tableName,
      column,
    })
  }

  /**
   * Find column by name - O(1) lookup
   *
   * Returns all tables containing this column
   *
   * @param columnName Name of column to find
   * @returns Array of {tableName, column} or empty if not found
   */
  findColumn(columnName: string): Array<{ tableName: string; column: ColumnSchema }> {
    const entry = this.index.columns.get(columnName.toLowerCase())
    return entry?.tables || []
  }

  /**
   * Find columns by partial name match - O(n) search
   *
   * Searches column names using pattern matching
   * Used for field search across all tables
   *
   * @param pattern Regex pattern or string to match
   * @returns Matching columns
   */
  findColumnsMatching(
    pattern: string | RegExp
  ): Array<{ columnName: string; tables: Array<{ tableName: string; column: ColumnSchema }> }> {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern
    const results: Array<{
      columnName: string
      tables: Array<{ tableName: string; column: ColumnSchema }>
    }> = []

    for (const [colName, entry] of this.index.columns.entries()) {
      if (regex.test(entry.name)) {
        results.push({
          columnName: entry.name,
          tables: entry.tables,
        })
      }
    }

    return results
  }

  /**
   * Get columns in specific table - O(n) filtered search
   *
   * @param tableName Name of table
   * @returns All columns in this table
   */
  getTableColumns(tableName: string): ColumnSchema[] {
    const results: ColumnSchema[] = []

    for (const entry of this.index.columns.values()) {
      const tableEntry = entry.tables.find((t) => t.tableName === tableName)
      if (tableEntry) {
        results.push(tableEntry.column)
      }
    }

    return results
  }

  /**
   * Find columns by type - O(n) search
   *
   * Useful for finding all integer columns, varchar columns, etc.
   *
   * @param type Column type to search for
   * @returns Columns matching this type
   */
  findColumnsByType(type: string): Array<{ tableName: string; column: ColumnSchema }> {
    const results: Array<{ tableName: string; column: ColumnSchema }> = []
    const typePattern = new RegExp(type, 'i')

    for (const entry of this.index.columns.values()) {
      for (const tableEntry of entry.tables) {
        if (typePattern.test(tableEntry.column.type)) {
          results.push(tableEntry)
        }
      }
    }

    return results
  }

  /**
   * Find primary key columns
   *
   * Searches for columns marked as primary keys
   *
   * @returns All primary key columns
   */
  findPrimaryKeys(): Array<{ tableName: string; column: ColumnSchema }> {
    const results: Array<{ tableName: string; column: ColumnSchema }> = []

    for (const entry of this.index.columns.values()) {
      for (const tableEntry of entry.tables) {
        if (tableEntry.column.primaryKey) {
          results.push(tableEntry)
        }
      }
    }

    return results
  }

  /**
   * Find nullable columns
   *
   * @returns All columns that allow NULL
   */
  findNullableColumns(): Array<{ tableName: string; column: ColumnSchema }> {
    const results: Array<{ tableName: string; column: ColumnSchema }> = []

    for (const entry of this.index.columns.values()) {
      for (const tableEntry of entry.tables) {
        if (tableEntry.column.nullable) {
          results.push(tableEntry)
        }
      }
    }

    return results
  }

  /**
   * Get index statistics
   *
   * @returns Index size and lookup metrics
   */
  getStats() {
    return {
      totalColumns: this.index.totalColumns,
      totalTables: this.index.totalTables,
      uniqueColumnNames: this.index.columns.size,
      averageTablesPerColumn:
        this.index.columns.size > 0
          ? Array.from(this.index.columns.values()).reduce(
              (sum, entry) => sum + entry.tables.length,
              0
            ) / this.index.columns.size
          : 0,
      timestamp: this.index.timestamp,
    }
  }

  /**
   * Export index for caching
   *
   * @returns Serializable index object
   */
  export() {
    const serialized = {
      columns: Array.from(this.index.columns.entries()).reduce(
        (acc, [key, value]) => {
          acc[key] = value
          return acc
        },
        {} as Record<string, ColumnIndexEntry>
      ),
      totalColumns: this.index.totalColumns,
      totalTables: this.index.totalTables,
      timestamp: this.index.timestamp,
    }

    return serialized
  }

  /**
   * Import index from serialized form
   *
   * @param exported Exported index data
   */
  import(exported: ReturnType<typeof this.export>) {
    this.index = {
      columns: new Map(Object.entries(exported.columns)),
      totalColumns: exported.totalColumns,
      totalTables: exported.totalTables,
      timestamp: exported.timestamp,
    }
  }
}
