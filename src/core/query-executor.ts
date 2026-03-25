/**
 * Query Executor — Handles SQL execution with permission checks and error handling
 *
 * Responsibility: Execute queries with permission enforcement, auto-limiting,
 * and intelligent error handling with table name suggestions.
 */

import type { DatabaseAdapter } from '@/adapters/types'
import type { Permission } from '@/types'
import type { QueryResult } from '@/types/query'
import { enforcePermission, PermissionError } from '@/core/permission-guard'
import { suggestTableName } from '@/utils/error-suggester'

/**
 * QueryExecutor class for executing SQL queries with permission checks
 */
export class QueryExecutor {
  constructor(
    private adapter: DatabaseAdapter,
    private permission: Permission
  ) {}

  /**
   * Execute a SQL query with permission enforcement and error handling
   *
   * @param sql The SQL query string
   * @param options Execution options (autoLimit, limitValue)
   * @returns QueryResult with rows and metadata
   * @throws PermissionError if query violates permission level
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

      // 3. Execute query and measure time
      const start = performance.now()
      const rows = await this.adapter.execute<Record<string, any>>(executeSql)
      const executionTimeMs = Math.round(performance.now() - start)

      // 4. Collect result metadata
      const columnNames = rows.length > 0 ? Object.keys(rows[0]) : []
      const columnTypes = columnNames.map(col => {
        const value = rows[0]?.[col]
        return inferColumnType(value)
      })

      // 5. Build QueryResult object
      const result: QueryResult<Record<string, any>> = {
        rows,
        rowCount: rows.length,
        columnNames,
        columnTypes,
        executionTimeMs,
        metadata: {
          statement: classification.type as any,
          affectedRows: rows.length
        }
      }

      return result
    } catch (error) {
      // Permission errors pass through as-is
      if (error instanceof PermissionError) {
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
