/**
 * Query Executor — Handles SQL execution with permission checks and error handling
 *
 * Responsibility: Execute queries with permission enforcement, auto-limiting,
 * blacklist column filtering, and intelligent error handling with table name suggestions.
 */

import type { DatabaseAdapter } from '@/adapters/types'
import type { Permission } from '@/types'
import type { QueryResult } from '@/types/query'
import { enforcePermission, PermissionError } from '@/core/permission-guard'
import { suggestTableName } from '@/utils/error-suggester'
import type { BlacklistValidator } from '@/core/blacklist-validator'

/**
 * QueryExecutor class for executing SQL queries with permission checks
 */
export class QueryExecutor {
  constructor(
    private adapter: DatabaseAdapter,
    private permission: Permission,
    private blacklistValidator?: BlacklistValidator
  ) {}

  /**
   * Execute a SQL query with permission enforcement and error handling
   *
   * @param sql The SQL query string
   * @param options Execution options (autoLimit, limitValue)
   * @returns QueryResult with rows and metadata
   * @throws PermissionError if query violates permission level
   * @throws BlacklistError if table is blacklisted
   * @throws Error for database execution errors
   */
  async execute(
    sql: string,
    options?: {
      autoLimit?: boolean
      limitValue?: number
    }
  ): Promise<QueryResult<Record<string, any>>> {
    try {
      // 1. Enforce permission before execution
      const classification = enforcePermission(sql, this.permission)

      // 1b. Warn on dangerous DDL operations even in admin mode
      if (classification.isDangerous && this.permission === 'admin') {
        console.error(
          `⚠ Warning: executing ${classification.type} operation (admin mode)`
        )
      }

      // 2. Auto-limit in query-only mode (safety default)
      let executeSql = sql
      if (
        this.permission === 'query-only' &&
        !executeSql.match(/LIMIT\s+\d+/i) &&
        options?.autoLimit !== false
      ) {
        const limitValue = options?.limitValue || 1000
        executeSql = `${executeSql} LIMIT ${limitValue}`
        console.error(`Query-only mode: auto-limiting to ${limitValue} rows`)
      }

      // 3. Check table blacklist before execution (for SELECT queries)
      if (this.blacklistValidator) {
        const tableName = extractTableName(sql)
        if (tableName) {
          // checkTableBlacklist throws BlacklistError if blocked
          this.blacklistValidator.checkTableBlacklist(classification.type, tableName, [])
        }
      }

      // 4. Execute query and measure time
      const start = performance.now()
      const rows = await this.adapter.execute<Record<string, any>>(executeSql)
      const executionTimeMs = Math.round(performance.now() - start)

      // 5. Collect result metadata
      let columnNames = rows.length > 0 ? Object.keys(rows[0]) : []
      const columnTypes = columnNames.map(col => {
        const value = rows[0]?.[col]
        return inferColumnType(value)
      })

      // 6. Apply blacklist column filtering if validator is present
      let filteredRows = rows
      let securityNotification: string | undefined

      if (this.blacklistValidator) {
        const tableName = extractTableName(sql)
        if (tableName) {
          const filterResult = this.blacklistValidator.filterColumns(tableName, rows, columnNames)
          filteredRows = filterResult.filteredRows
          if (filterResult.omittedColumns.length > 0) {
            columnNames = columnNames.filter(col => !filterResult.omittedColumns.includes(col))
            securityNotification = this.blacklistValidator.buildSecurityNotification(
              tableName,
              filterResult.omittedColumns
            )
          }
        }
      }

      // 7. Build QueryResult object
      const result: QueryResult<Record<string, any>> = {
        rows: filteredRows,
        rowCount: filteredRows.length,
        columnNames,
        columnTypes,
        executionTimeMs,
        metadata: {
          statement: classification.type as any,
          affectedRows: filteredRows.length,
          ...(securityNotification ? { securityNotification } : {})
        }
      }

      return result
    } catch (error) {
      // Permission errors pass through as-is
      if (error instanceof PermissionError) {
        throw error
      }

      // BlacklistError passes through as-is
      if (error instanceof Error && error.name === 'BlacklistError') {
        throw error
      }

      // For database errors, try to suggest missing table
      const errorMessage = (error as Error).message
      if (
        errorMessage.includes('does not exist') ||
        errorMessage.includes('not found')
      ) {
        try {
          const { suggestions, tables } = await suggestTableName(
            errorMessage,
            this.adapter
          )
          const enhancedError = new Error(
            `${errorMessage}\n` +
              (suggestions.length > 0
                ? `Did you mean: ${suggestions.join(', ')}?`
                : `Available tables: ${tables.slice(0, 5).join(', ')}...`)
          )
          throw enhancedError
        } catch (suggestionError) {
          // If suggestion fails, throw original error
          throw error
        }
      }

      // Otherwise throw original error
      throw error
    }
  }
}

/**
 * Extract the primary table name from a SQL query.
 * Uses regex to find the FROM clause table name.
 *
 * @param sql SQL query string
 * @returns Table name or null if not found
 */
export function extractTableName(sql: string): string | null {
  // Handle common SELECT ... FROM table patterns
  const match = sql.match(/\bFROM\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i)
  if (match) {
    return match[1]
  }

  // Handle INSERT INTO table patterns
  const insertMatch = sql.match(/\bINSERT\s+INTO\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i)
  if (insertMatch) {
    return insertMatch[1]
  }

  // Handle UPDATE table patterns
  const updateMatch = sql.match(/\bUPDATE\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i)
  if (updateMatch) {
    return updateMatch[1]
  }

  // Handle DELETE FROM table patterns
  const deleteMatch = sql.match(/\bDELETE\s+FROM\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i)
  if (deleteMatch) {
    return deleteMatch[1]
  }

  return null
}

/**
 * Infer SQL column type from a JavaScript value
 * Uses simple runtime type inference for data display
 */
function inferColumnType(value: any): string {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (value instanceof Date) {
    return 'timestamp'
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'decimal'
  }

  if (typeof value === 'boolean') {
    return 'boolean'
  }

  if (typeof value === 'string') {
    return 'varchar'
  }

  return 'unknown'
}
