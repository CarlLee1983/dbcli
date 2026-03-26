/**
 * Schema Updater - Type Definitions
 *
 * Types for incremental schema updates, patches, and refresh results
 */

import type { SchemaDiffReport } from './schema-diff'
import type { DbcliConfig } from '@/utils/validation'
import type { TableSchema } from '@/adapters/types'

/**
 * Schema patch - represents changes between two schema versions
 * Only contains added, modified, deleted items (delta)
 */
export interface SchemaPatch {
  /** Tables newly added to database */
  added: Record<string, TableSchema>
  /** Tables modified (partial schema with only changed fields) */
  modified: Record<string, {
    table: string
    columnsAdded: Record<string, any>
    columnsRemoved: string[]
    columnsModified: Record<string, {
      previous: any
      current: any
    }>
  }>
  /** Table names that were deleted */
  deletedTables: string[]
  /** Timestamp when patch was created */
  timestamp: string
}

/**
 * Schema refresh result - response from refreshSchema operation
 */
export interface SchemaRefreshResult {
  /** Number of tables added */
  added: number
  /** Number of tables modified */
  modified: number
  /** Number of tables deleted */
  deleted: number
  /** Total time in milliseconds */
  totalTime: number
  /** Human-readable summary */
  details: string
  /** Full schema report from diff engine */
  diffReport?: SchemaDiffReport
}

/**
 * Options for schema refresh operation
 */
export interface RefreshOptions {
  /** Specific tables to refresh (if omitted, refresh all) */
  tablesToRefresh?: string[]
  /** Force full refresh even if cache is fresh */
  forceRefresh?: boolean
  /** Timeout for refresh operation in milliseconds */
  timeout?: number
}

/**
 * Write operation result for atomic writer
 */
export interface WriteResult {
  /** Path to the file that was written */
  filePath: string
  /** Size of the file written in bytes */
  sizeBytes: number
  /** Timestamp of the write */
  timestamp: string
  /** Whether backup was created */
  backupCreated: boolean
  /** Path to backup file if created */
  backupPath?: string
}

/**
 * Atomic write options
 */
export interface AtomicWriteOptions {
  /** Create backup before writing */
  createBackup?: boolean
  /** Permissions mode for the file */
  mode?: number
  /** Timeout in milliseconds */
  timeout?: number
}
