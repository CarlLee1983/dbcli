import type { DatabaseSystem } from '../adapters/types'

/**
 * Common regex for extracting table name from SQL.
 * Supports:
 * - SELECT ... FROM table
 * - INSERT INTO table
 * - UPDATE table
 * - DELETE FROM table
 */
const TABLE_NAME_RE = /\b(?:FROM|INTO|UPDATE)\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i

/**
 * Extract the primary table name from a SQL query.
 * (Moved from query-executor.ts)
 */
export function extractTableName(sql: string): string | null {
  const match = sql.match(TABLE_NAME_RE)
  return match ? (match[1] ?? null) : null
}

/**
 * Standardize operation target across different database engines.
 */
export function getOperationTarget(
  system: DatabaseSystem,
  command: string,
  options: { collection?: string; index?: string; [key: string]: unknown },
  sql?: string
): string {
  // 1. Explicit collection/index for MongoDB/ES
  if (system === 'mongodb') {
    return options.collection || '<unknown-collection>'
  }
  if (system === 'elasticsearch') {
    return options.index || options.collection || '<unknown-index>'
  }

  // 2. Redis typically uses the first positional arg as the target (handled by caller)
  // but if we have a table-like arg, we can use it.
  if (system === 'redis') {
    return (options.table as string) || (options.key as string) || '<unknown-key>'
  }

  // 3. SQL: Extract from body if provided
  if (sql) {
    const table = extractTableName(sql)
    if (table) return table
  }

  // 4. Fallback to command-specific option
  return (options.table as string) || '<unknown-target>'
}
