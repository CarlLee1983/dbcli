/**
 * Type definitions for data modification operations
 * Defines results and options for data modification (INSERT, UPDATE, DELETE) operations
 */

/**
 * Result of a data execution operation
 * Used to wrap the execution result and metadata of data modification operations
 */
export interface DataExecutionResult {
  /** Execution status: success or error */
  status: 'success' | 'error'

  /** Type of operation executed */
  operation: 'insert' | 'update' | 'delete'

  /** Number of rows affected */
  rows_affected: number

  /** Execution timestamp in ISO 8601 format */
  timestamp?: string

  /** Generated SQL statement (for confirmation and error messages) */
  sql?: string

  /** Error message (only when status is 'error') */
  error?: string
}

/**
 * Data execution options
 * Controls how data modification operations are executed
 */
export interface DataExecutionOptions {
  /** Dry run mode: display SQL without executing */
  dryRun?: boolean

  /** Skip confirmation prompt */
  force?: boolean

  /** Verbose output */
  verbose?: boolean
}
