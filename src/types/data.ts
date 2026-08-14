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

  /**
   * How to ask the caller's user whether to proceed.
   *
   * Core states what is about to happen; the caller decides how to present it
   * and how to collect an answer. Required whenever a mutation would execute
   * without `force`, and absent by design rather than defaulted: silently
   * proceeding unconfirmed, or silently declining, are both worse than saying
   * that nobody was available to ask.
   */
  confirm?: MutationConfirmer
}

/**
 * Everything a caller needs to describe a pending mutation to its user.
 */
export interface MutationConfirmationRequest {
  operation: DataExecutionResult['operation']

  /** The parameterised statement that will run if confirmed */
  sql: string

  /** Values bound to the statement's placeholders */
  params: (string | number | boolean | null)[]

  /** Present when the operation is irreversible */
  warning?: string

  /** The question to put to the user */
  prompt: string
}

/**
 * Returns true to proceed, false to abandon the mutation.
 */
export type MutationConfirmer = (request: MutationConfirmationRequest) => Promise<boolean>
