/**
 * Query result type definitions and interfaces
 * Defines the contract for query results returned by database adapters
 */

/**
 * SQL statement types classified by operation
 */
export type SqlStatementType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'UNKNOWN'

/**
 * Metadata about query execution and result characteristics
 */
export interface QueryMetadata {
  /** SQL statement type (SELECT, INSERT, UPDATE, DELETE) */
  statement: SqlStatementType
  /** Number of rows affected by INSERT/UPDATE/DELETE operations */
  affectedRows?: number
  /** Query execution time in milliseconds */
  executionTimeMs?: number
  /** Security notification when columns were omitted due to blacklist */
  securityNotification?: string
}

/**
 * Generic query result wrapper with rows and metadata
 * Used to wrap database query results with structured metadata for AI parsing
 * @template T - Type of individual row objects
 *
 * Example: SELECT query result
 * ```typescript
 * const result: QueryResult<{id: number; name: string}> = {
 *   rows: [{id: 1, name: 'Alice'}],
 *   rowCount: 1,
 *   columnNames: ['id', 'name'],
 *   columnTypes: ['integer', 'varchar'],
 *   executionTimeMs: 42,
 *   metadata: { statement: 'SELECT' }
 * }
 * ```
 */
export interface QueryResult<T> {
  /** Array of result rows */
  rows: T[]

  /** Total number of rows in result set */
  rowCount: number

  /** Column names in order (matches Object.keys(rows[0]) for consistent ordering) */
  columnNames: string[]

  /** Optional: column data types (PostgreSQL: "integer", "varchar"; MySQL: "INT", "VARCHAR") */
  columnTypes?: string[]

  /** Optional: query execution time in milliseconds (only database execution, not formatting) */
  executionTimeMs?: number

  /** Optional: metadata about query type and affected rows */
  metadata?: QueryMetadata
}
