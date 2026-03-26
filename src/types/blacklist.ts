/**
 * Blacklist type definitions for data access control
 *
 * Provides type-safe configuration and state for table and column-level
 * blacklisting to prevent AI agents from accessing sensitive data.
 */

/**
 * Immutable blacklist configuration stored in .dbcli
 * Used for serialization/deserialization
 */
export interface BlacklistConfig {
  /** Table names to block all operations on */
  tables: string[]
  /** Column names to omit per table: { tableName: [col1, col2] } */
  columns: Record<string, string[]>
}

/**
 * Column blacklist type alias for clarity
 * Maps table name to array of blacklisted column names
 */
export type ColumnBlacklist = Record<string, string[]>

/**
 * Mutable runtime state for efficient lookups
 * Uses Set/Map for O(1) lookups instead of array scanning
 */
export interface BlacklistState {
  /** Set of lowercase table names for O(1) case-insensitive lookup */
  tables: Set<string>
  /** Map of table name -> Set of blacklisted column names */
  columns: Map<string, Set<string>>
}

/**
 * Error thrown when an operation is blocked by blacklist rules
 */
export class BlacklistError extends Error {
  constructor(
    message: string,
    public readonly tableName: string,
    public readonly operation: string
  ) {
    super(message)
    this.name = 'BlacklistError'
  }
}
