/**
 * Schema diff detection type definitions
 * Used to compare a previous schema snapshot against the live database schema
 */

import type { ColumnSchema } from '@/adapters/types'

/**
 * Column change record
 * Records the before and after state of a single column
 */
export interface ColumnDiff {
  /** Column name */
  name: string
  /** Column schema before the change */
  previous: ColumnSchema
  /** Column schema after the change */
  current: ColumnSchema
}

/**
 * Table-level diff details
 * Records column changes (added, removed, modified) within a specific table
 */
export interface TableDiffDetail {
  /** Array of added column names */
  columnsAdded: string[]
  /** Array of removed column names */
  columnsRemoved: string[]
  /** Modified columns - includes before/after state comparison */
  columnsModified: ColumnDiff[]
}

/**
 * Complete schema diff report
 * Contains all table-level and column-level changes, plus a human-readable summary
 */
export interface SchemaDiffReport {
  /** Array of added table names */
  tablesAdded: string[]
  /** Array of removed table names */
  tablesRemoved: string[]
  /** Modified tables and their column change details - keyed by table name */
  tablesModified: Record<string, TableDiffDetail>
  /** Human-readable summary string, e.g. "3 added, 2 removed, 5 modified" */
  summary: string
}
