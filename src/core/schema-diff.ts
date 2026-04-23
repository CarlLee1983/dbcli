/**
 * Schema Diff Detection Engine
 * Compares a previous schema snapshot against the live database schema, detects and reports changes
 */

import type { DatabaseAdapter, ColumnSchema } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'
import type { SchemaDiffReport, TableDiffDetail, ColumnDiff } from '@/types/schema-diff'

/**
 * Schema Diff Detection Engine
 * Performs incremental schema comparison, detecting added, removed, and modified tables and columns
 */
export class SchemaDiffEngine {
  constructor(
    private adapter: DatabaseAdapter,
    private previousConfig: DbcliConfig
  ) {}

  /**
   * Run schema diff detection
   * Compares the previous schema snapshot (from .dbcli config) against the live database schema
   * @returns Diff report containing table and column level change details
   */
  async diff(): Promise<SchemaDiffReport> {
    // Phase 1: Table-level comparison

    // Get the list of tables currently in the database
    const currentTables = await this.adapter.listTables()
    const currentTableNames = new Set(currentTables.map((t) => t.name))

    // Get the list of tables from the previous config
    const previousTableNames = new Set(Object.keys(this.previousConfig.schema || {}))

    // Detect table-level changes
    const tablesAdded = Array.from(currentTableNames).filter((t) => !previousTableNames.has(t))
    const tablesRemoved = Array.from(previousTableNames).filter((t) => !currentTableNames.has(t))

    // Phase 2: Column-level comparison (for tables present on both sides)

    const tablesModified: Record<string, TableDiffDetail> = {}

    // Get table names that exist in both old config and new database
    const unmodifiedTableNames = Array.from(currentTableNames).filter((t) =>
      previousTableNames.has(t)
    )

    for (const tableName of unmodifiedTableNames) {
      const currentSchema = await this.adapter.getTableSchema(tableName)
      const previousSchema = this.previousConfig.schema![tableName]

      if (!previousSchema) continue

      // Convert column lists to Maps for fast lookup
      const currentColsMap = new Map<string, ColumnSchema>(
        currentSchema.columns.map((c: ColumnSchema) => [c.name, c])
      )
      const previousColsMap = new Map<string, ColumnSchema>(
        previousSchema.columns.map((c: ColumnSchema) => [c.name, c])
      )

      // Detect column-level changes
      const columnsAdded: string[] = Array.from(currentColsMap.keys()).filter(
        (c: string) => !previousColsMap.has(c)
      )
      const columnsRemoved: string[] = Array.from(previousColsMap.keys()).filter(
        (c: string) => !currentColsMap.has(c)
      )

      // Detect modified columns (same name but other attributes changed)
      const columnsModified: ColumnDiff[] = []
      for (const colName of Array.from(currentColsMap.keys()).filter((c: string) =>
        previousColsMap.has(c)
      )) {
        const prev = previousColsMap.get(colName) as ColumnSchema
        const curr = currentColsMap.get(colName) as ColumnSchema
        if (this.columnChanged(prev, curr)) {
          columnsModified.push({
            name: colName,
            previous: prev,
            current: curr,
          })
        }
      }

      // Only add this table to modified list if there are actual changes
      if (columnsAdded.length > 0 || columnsRemoved.length > 0 || columnsModified.length > 0) {
        tablesModified[tableName] = {
          columnsAdded,
          columnsRemoved,
          columnsModified,
        }
      }
    }

    // Generate human-readable summary string
    const summary = `${tablesAdded.length} added, ${tablesRemoved.length} removed, ${Object.keys(tablesModified).length} modified`

    return {
      tablesAdded,
      tablesRemoved,
      tablesModified,
      summary,
    }
  }

  /**
   * Check whether two column schemas differ
   * Compares type, nullability, default value, and primary key attributes
   * Type comparison is case-normalized to handle database-specific format differences
   *
   * @param prev Previous column schema
   * @param curr Current column schema
   * @returns true if the column has changed, false otherwise
   */
  private columnChanged(prev: ColumnSchema, curr: ColumnSchema): boolean {
    // Type comparison - normalize to lowercase to handle case differences (e.g. VARCHAR vs varchar)
    const typeChanged = prev.type.toLowerCase() !== curr.type.toLowerCase()

    // Nullability comparison
    const nullableChanged = prev.nullable !== curr.nullable

    // Default value comparison
    const defaultChanged = prev.default !== curr.default

    // Primary key attribute comparison
    const primaryKeyChanged = (prev.primaryKey ?? false) !== (curr.primaryKey ?? false)

    return typeChanged || nullableChanged || defaultChanged || primaryKeyChanged
  }
}
