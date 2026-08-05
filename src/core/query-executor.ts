/**
 * Query Executor — Handles SQL execution with permission checks and error handling
 *
 * Responsibility: Execute queries with permission enforcement, auto-limiting,
 * blacklist column filtering, and intelligent error handling with table name suggestions.
 */

import type { DatabaseAdapter } from '@/adapters/types'
import type { Permission } from '@/types'
import type { QueryResult } from '@/types/query'
import {
  enforcePermission,
  PermissionError,
  stripCommentsAndStrings,
  SQL_DIALECTS,
  type SqlDialect,
} from '@/core/permission-guard'
import { suggestTableName } from '@/utils/error-suggester'
import { extractTableName } from '@/utils/engine-hints'
import type { BlacklistValidator } from '@/core/blacklist-validator'
import { DEFAULT_QUERY_ONLY_LIMIT } from '@/core/limits'
import { trimAppliedLimit } from '@/core/applied-limit'
import { writeAuditEntry } from './audit/integration-helper'
import type { DbcliConfig } from '@/utils/validation'
import { projectRows, type FieldSelection } from '@/core/field-projection'

/**
 * QueryExecutor class for executing SQL queries with permission checks
 */
export class QueryExecutor {
  private pendingDiagnostics: string[] = []

  constructor(
    private adapter: DatabaseAdapter,
    private permission: Permission,
    private blacklistValidator?: BlacklistValidator,
    private config?: DbcliConfig,
    private options: {
      config?: string
      connectionName?: string
      recovery?: boolean
      deferDiagnostics?: boolean
      /**
       * Quoting rules that decide what counts as a statement separator differ
       * per dialect. Without this, the stacking check has to fail closed.
       */
      dialect?: SqlDialect
    } = {}
  ) {}

  /**
   * The dialect the statement will actually run under. Falls back to the
   * connection config, then to undefined — where the stacking check fails
   * closed rather than guessing.
   */
  private resolveDialect(): SqlDialect | undefined {
    if (this.options.dialect) return this.options.dialect
    const system = this.config?.connection?.system
    return SQL_DIALECTS.find((dialect) => dialect === system)
  }

  takeDiagnostics(): string[] {
    const diagnostics = this.pendingDiagnostics
    this.pendingDiagnostics = []
    return diagnostics
  }

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
      detectTruncation?: boolean
      fieldSelection?: FieldSelection
    }
  ): Promise<QueryResult<Record<string, unknown>>> {
    const start = performance.now()
    this.pendingDiagnostics = []
    try {
      // 1. Enforce permission before execution
      const classification = enforcePermission(sql, this.permission, this.resolveDialect())

      // 1b. Warn on dangerous DDL operations even in admin mode
      const dangerousOperationWarning =
        classification.isDangerous && this.permission === 'admin'
          ? `⚠ Warning: executing ${classification.type} operation (admin mode)`
          : undefined

      // 2. Auto-limit in query-only mode (safety default).
      // Only applies to SELECT — SHOW/DESCRIBE/EXPLAIN do not accept LIMIT and
      // server rejects with a syntax error. Classification was already computed
      // by enforcePermission() above.
      const AUTO_LIMIT_TYPES = new Set(['SELECT'])
      let executeSql = sql
      let appliedLimit: number | undefined
      let autoLimitWarning: string | undefined
      if (
        AUTO_LIMIT_TYPES.has(classification.type) &&
        !hasUserAuthoredLimit(executeSql) &&
        options?.autoLimit !== false
      ) {
        const requestedLimit =
          options?.limitValue ??
          (this.permission === 'query-only' ? DEFAULT_QUERY_ONLY_LIMIT : undefined)
        if (requestedLimit !== undefined) {
          const fetchLimit = requestedLimit + (options?.detectTruncation === true ? 1 : 0)
          appliedLimit = options?.detectTruncation === true ? requestedLimit : undefined
          executeSql = `${executeSql.replace(/;\s*$/, '')} LIMIT ${fetchLimit}`
          if (options?.limitValue === undefined && this.permission === 'query-only') {
            autoLimitWarning = `Query-only mode: auto-limiting to ${requestedLimit} rows`
          }
        }
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
      const resultData = await this.adapter.execute<Record<string, unknown>>(executeSql)
      const executionTimeMs = Math.round(performance.now() - start)

      const limitedResult =
        appliedLimit === undefined ? undefined : trimAppliedLimit(resultData.rows, appliedLimit)
      const rows = limitedResult?.rows ?? resultData.rows
      const affectedRows = resultData.affectedRows
      const visibleAffectedRows = limitedResult ? rows.length : affectedRows

      // 5. Collect result metadata
      let columnNames = rows.length > 0 && rows[0] ? Object.keys(rows[0]) : []

      // 6. Apply blacklist column filtering if validator is present
      let filteredRows = rows
      let securityNotification: string | undefined
      let omittedColumns: string[] = []

      if (this.blacklistValidator) {
        const tableName = extractTableName(sql)
        if (tableName) {
          const filterResult = this.blacklistValidator.filterColumns(tableName, rows, columnNames)
          filteredRows = filterResult.filteredRows
          if (filterResult.omittedColumns.length > 0) {
            omittedColumns = filterResult.omittedColumns
            columnNames = columnNames.filter((col) => !filterResult.omittedColumns.includes(col))
            securityNotification = this.blacklistValidator.buildSecurityNotification(
              tableName,
              filterResult.omittedColumns
            )
          }
        }
      }

      // Blacklist filtering has final authority. Projection is applied only to
      // the already-filtered rows and cannot recover an omitted column.
      if (options?.fieldSelection) {
        const fieldSelection =
          options.fieldSelection.mode === 'include'
            ? {
                mode: 'include' as const,
                paths: options.fieldSelection.paths.filter(
                  (path) =>
                    !omittedColumns.some(
                      (omitted) => path === omitted || path.startsWith(`${omitted}.`)
                    )
                ),
              }
            : options.fieldSelection
        const projection = projectRows(filteredRows, fieldSelection)
        filteredRows = projection.rows
        columnNames = projection.columnNames
      }
      const columnTypes = columnNames.map((column) => {
        const value = filteredRows.find((row) => row[column] !== undefined)?.[column]
        return inferColumnType(value)
      })

      // 7. Build QueryResult object
      const result: QueryResult<Record<string, unknown>> = {
        rows: filteredRows,
        rowCount: filteredRows.length,
        columnNames,
        columnTypes,
        executionTimeMs,
        metadata: {
          statement: classification.type as import('@/types/query').SqlStatementType,
          affectedRows: visibleAffectedRows,
          ...(securityNotification ? { securityNotification } : {}),
        },
        ...(limitedResult ? { appliedLimit: limitedResult.metadata } : {}),
      }

      // 8. Audit Success
      if (this.config) {
        await writeAuditEntry(this.config, 'query', this.options, {
          success: true,
          sql,
          metadata: {
            rows_affected: visibleAffectedRows,
            execution_ms: executionTimeMs,
          },
        })
      }

      // Human diagnostics belong to the success path. Printing them before
      // adapter execution would contaminate the CLI's single failure envelope.
      if (this.options.recovery !== true) {
        const diagnostics = [dangerousOperationWarning, autoLimitWarning].filter(
          (diagnostic): diagnostic is string => diagnostic !== undefined
        )
        if (this.options.deferDiagnostics === true) {
          this.pendingDiagnostics = diagnostics
        } else {
          for (const diagnostic of diagnostics) console.error(diagnostic)
        }
      }

      return result
    } catch (error) {
      // 8. Audit Failure
      if (this.config) {
        await writeAuditEntry(this.config, 'query', this.options, {
          success: false,
          sql,
          error,
          metadata: {
            execution_ms: Math.round(performance.now() - start),
          },
        })
      }

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
      if (errorMessage.includes('does not exist') || errorMessage.includes('not found')) {
        try {
          const { suggestions, tables } = await suggestTableName(errorMessage, this.adapter)
          const enhancedError = new Error(
            `${errorMessage}\n` +
              (suggestions.length > 0
                ? `Did you mean: ${suggestions.join(', ')}?`
                : `Available tables: ${tables.slice(0, 5).join(', ')}...`)
          )
          throw enhancedError
        } catch {
          // If suggestion fails, throw original error
          throw error
        }
      }

      // Otherwise throw original error
      throw error
    }
  }
}

function hasUserAuthoredLimit(sql: string): boolean {
  const executableSql = stripCommentsAndStrings(sql).replace(/`(?:``|[^`])*`/g, ' ')
  return /\bLIMIT\s+(?:\(\s*)?(?:\d+|ALL\b|\?|\$\d+|:[A-Za-z_][A-Za-z0-9_]*)/i.test(executableSql)
}

/**
 * Infer SQL column type from a JavaScript value
 * Uses simple runtime type inference for data display
 */
function inferColumnType(value: unknown): string {
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
