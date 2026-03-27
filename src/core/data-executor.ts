/**
 * Data Executor — handles execution of INSERT, UPDATE, DELETE operations
 *
 * Responsibilities: execute data modification operations, enforce permission checks,
 * validate data columns, handle parameterized queries to prevent SQL injection.
 */

import type { DatabaseAdapter, TableSchema, ColumnSchema } from '@/adapters/types'
import type { Permission } from '@/types'
import type { DataExecutionResult, DataExecutionOptions } from '@/types/data'
import { enforcePermission, PermissionError } from '@/core/permission-guard'
import { promptUser } from '@/utils/prompts'
import type { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'

/**
 * DataExecutor class for executing INSERT, UPDATE, DELETE operations
 */
export class DataExecutor {
  constructor(
    private adapter: DatabaseAdapter,
    private permission: Permission,
    private dbSystem: 'postgresql' | 'mysql' = 'postgresql',
    private blacklistValidator?: BlacklistValidator
  ) {}

  /**
   * Build a parameterized INSERT SQL statement
   * Returns {sql, params} form to prevent SQL injection
   *
   * @param tableName Table name
   * @param data Data object to insert {column: value, ...}
   * @param schema Table schema
   * @returns Parameterized SQL and parameters array
   * @throws Error if a data column is not found in the table schema
   */
  buildInsertSql(
    tableName: string,
    data: Record<string, any>,
    schema: TableSchema
  ): { sql: string; params: any[] } {
    // Validate that all data columns exist in the table schema
    const columnNames = schema.columns.map((col) => col.name)
    const dataKeys = Object.keys(data)

    for (const key of dataKeys) {
      if (!columnNames.includes(key)) {
        throw new Error(
          `Column "${key}" not found in table "${tableName}". Valid columns: ${columnNames.join(', ')}`
        )
      }
    }

    // Build parameterized query
    const columns = dataKeys
    const values = dataKeys.map((key) => data[key])

    // Determine parameter placeholder based on database system type
    // PostgreSQL uses $1, $2, ...
    // MySQL uses ?
    const systemType = this.getSystemType()
    const placeholders =
      systemType === 'postgresql'
        ? dataKeys.map((_, index) => `$${index + 1}`).join(', ')
        : dataKeys.map(() => '?').join(', ')

    const quote = this.getQuoteChar()
    const sql = `INSERT INTO ${quote}${tableName}${quote} (${columns.map((col) => `${quote}${col}${quote}`).join(', ')}) VALUES (${placeholders})`

    return {
      sql,
      params: values,
    }
  }

  /**
   * Execute an INSERT operation
   * Enforces permission check, builds SQL, shows confirmation prompt, executes
   *
   * @param tableName Table name
   * @param data Data object to insert
   * @param schema Table schema
   * @param options Execution options (dryRun, force, verbose)
   * @returns DataExecutionResult
   * @throws PermissionError if insufficient permissions
   * @throws Error if execution fails
   */
  async executeInsert(
    tableName: string,
    data: Record<string, any>,
    schema: TableSchema,
    options?: DataExecutionOptions
  ): Promise<DataExecutionResult> {
    const timestamp = new Date().toISOString()

    try {
      // 0. Check table blacklist before doing anything else
      if (this.blacklistValidator) {
        this.blacklistValidator.checkTableBlacklist('INSERT', tableName, [])
      }

      // 1. Enforce permission check - INSERT requires read-write or admin
      enforcePermission('INSERT INTO dummy', this.permission)

      // 2. Build parameterized SQL
      const { sql, params } = this.buildInsertSql(tableName, data, schema)

      // 3. Dry-run mode: show SQL but do not execute
      if (options?.dryRun) {
        return {
          status: 'success',
          operation: 'insert',
          rows_affected: 0,
          timestamp,
          sql,
        }
      }

      // 4. Non-forced mode: show SQL and require confirmation
      if (!options?.force) {
        console.log('\nGenerated SQL:')
        console.log(`  ${sql}`)
        console.log('\nParameters:')
        console.log(`  ${JSON.stringify(params, null, 2)}`)

        const confirmed = await promptUser.confirm('Proceed with this operation?')
        if (!confirmed) {
          return {
            status: 'success',
            operation: 'insert',
            rows_affected: 0,
            timestamp,
            sql,
          }
        }
      }

      // 5. Execute INSERT
      const result = await this.adapter.execute(sql, params)

      // Return result
      const affectedRows = Array.isArray(result) ? result.length : 0
      return {
        status: 'success',
        operation: 'insert',
        rows_affected: affectedRows,
        timestamp,
        sql,
      }
    } catch (error) {
      // BlacklistError passes through to caller
      if (error instanceof BlacklistError) {
        throw error
      }

      const errorMessage = error instanceof Error ? error.message : String(error)

      // Special handling for permission errors
      if (error instanceof PermissionError) {
        return {
          status: 'error',
          operation: 'insert',
          rows_affected: 0,
          timestamp,
          error: 'Permission denied: Query-only mode only allows SELECT. Use Read-Write or Admin mode to execute INSERT.',
        }
      }

      return {
        status: 'error',
        operation: 'insert',
        rows_affected: 0,
        timestamp,
        error: `INSERT failed: ${errorMessage}`,
      }
    }
  }

  /**
   * Execute an UPDATE operation
   * Enforces permission check, builds SQL, shows confirmation prompt, executes
   *
   * @param tableName Table name
   * @param data Updated data object
   * @param where WHERE clause condition object
   * @param schema Table schema
   * @param options Execution options
   * @returns DataExecutionResult
   */
  async executeUpdate(
    tableName: string,
    data: Record<string, any>,
    where: Record<string, any>,
    schema: TableSchema,
    options?: DataExecutionOptions
  ): Promise<DataExecutionResult> {
    const timestamp = new Date().toISOString()

    try {
      // 0. Check table blacklist before doing anything else
      if (this.blacklistValidator) {
        this.blacklistValidator.checkTableBlacklist('UPDATE', tableName, [])
      }

      // 1. Enforce permission check
      enforcePermission('UPDATE dummy', this.permission)

      // 2. Build parameterized UPDATE SQL
      const { sql, params } = this.buildUpdateSql(
        tableName,
        data,
        where,
        schema
      )

      // 3. Dry-run mode
      if (options?.dryRun) {
        return {
          status: 'success',
          operation: 'update',
          rows_affected: 0,
          timestamp,
          sql,
        }
      }

      // 4. Non-forced mode: show SQL and require confirmation
      if (!options?.force) {
        console.log('\nGenerated SQL:')
        console.log(`  ${sql}`)
        console.log('\nParameters:')
        console.log(`  ${JSON.stringify(params, null, 2)}`)

        const confirmed = await promptUser.confirm('Proceed with this operation?')
        if (!confirmed) {
          return {
            status: 'success',
            operation: 'update',
            rows_affected: 0,
            timestamp,
            sql,
          }
        }
      }

      // 5. Execute UPDATE
      const result = await this.adapter.execute(sql, params)
      const affectedRows = Array.isArray(result) ? result.length : 0

      return {
        status: 'success',
        operation: 'update',
        rows_affected: affectedRows,
        timestamp,
        sql,
      }
    } catch (error) {
      // BlacklistError passes through to caller
      if (error instanceof BlacklistError) {
        throw error
      }

      const errorMessage = error instanceof Error ? error.message : String(error)

      if (error instanceof PermissionError) {
        return {
          status: 'error',
          operation: 'update',
          rows_affected: 0,
          timestamp,
          error: 'Permission denied: Query-only mode only allows SELECT. Use Read-Write or Admin mode to execute UPDATE.',
        }
      }

      return {
        status: 'error',
        operation: 'update',
        rows_affected: 0,
        timestamp,
        error: `UPDATE failed: ${errorMessage}`,
      }
    }
  }

  /**
   * Execute a DELETE operation
   * Admin-only operation, requires strict permission check
   *
   * @param tableName Table name
   * @param where WHERE clause condition object
   * @param schema Table schema
   * @param options Execution options
   * @returns DataExecutionResult
   */
  async executeDelete(
    tableName: string,
    where: Record<string, any>,
    schema: TableSchema,
    options?: DataExecutionOptions
  ): Promise<DataExecutionResult> {
    const timestamp = new Date().toISOString()

    try {
      // 0. Check table blacklist before doing anything else
      if (this.blacklistValidator) {
        this.blacklistValidator.checkTableBlacklist('DELETE', tableName, [])
      }

      // 1. DELETE requires data-admin or admin permission
      if (this.permission !== 'data-admin' && this.permission !== 'admin') {
        return {
          status: 'error',
          operation: 'delete',
          rows_affected: 0,
          timestamp,
          error: 'Permission denied: DELETE operation requires Data-Admin or Admin permission.',
        }
      }

      // 2. Build parameterized DELETE SQL
      const { sql, params } = this.buildDeleteSql(
        tableName,
        where,
        schema
      )

      // 3. Dry-run mode
      if (options?.dryRun) {
        return {
          status: 'success',
          operation: 'delete',
          rows_affected: 0,
          timestamp,
          sql,
        }
      }

      // 4. DELETE usually requires confirmation (unless --force flag)
      if (!options?.force) {
        console.log('\n⚠️  Warning: DELETE operation is destructive and cannot be undone!')
        console.log('\nGenerated SQL:')
        console.log(`  ${sql}`)
        console.log('\nParameters:')
        console.log(`  ${JSON.stringify(params, null, 2)}`)

        const confirmed = await promptUser.confirm(
          'Are you sure you want to execute this DELETE operation? This cannot be undone.'
        )
        if (!confirmed) {
          return {
            status: 'success',
            operation: 'delete',
            rows_affected: 0,
            timestamp,
            sql,
          }
        }
      }

      // 5. Execute DELETE
      const result = await this.adapter.execute(sql, params)
      const affectedRows = Array.isArray(result) ? result.length : 0

      return {
        status: 'success',
        operation: 'delete',
        rows_affected: affectedRows,
        timestamp,
        sql,
      }
    } catch (error) {
      // BlacklistError passes through to caller
      if (error instanceof BlacklistError) {
        throw error
      }

      const errorMessage = error instanceof Error ? error.message : String(error)

      return {
        status: 'error',
        operation: 'delete',
        rows_affected: 0,
        timestamp,
        error: `DELETE failed: ${errorMessage}`,
      }
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Get database system type (used to determine parameter placeholder and identifier quoting)
   */
  private getSystemType(): 'postgresql' | 'mysql' {
    return this.dbSystem
  }

  /**
   * Get identifier quote character (for table names and column names)
   */
  private getQuoteChar(): string {
    return this.dbSystem === 'mysql' ? '`' : '"'
  }

  /**
   * Build a parameterized UPDATE SQL statement
   */
  private buildUpdateSql(
    tableName: string,
    data: Record<string, any>,
    where: Record<string, any>,
    schema: TableSchema
  ): { sql: string; params: any[] } {
    const dataKeys = Object.keys(data)
    const whereKeys = Object.keys(where)
    const columnNames = schema.columns.map((col) => col.name)

    // Validate columns
    for (const key of [...dataKeys, ...whereKeys]) {
      if (!columnNames.includes(key)) {
        throw new Error(
          `Column "${key}" not found in table "${tableName}"`
        )
      }
    }

    // Build UPDATE SET clause
    const systemType = this.getSystemType()
    const quote = this.getQuoteChar()
    let paramIndex = 1

    const setClause = dataKeys
      .map((key) => {
        const placeholder =
          systemType === 'postgresql' ? `$${paramIndex++}` : '?'
        return `${quote}${key}${quote} = ${placeholder}`
      })
      .join(', ')

    // Build WHERE clause
    const whereClause = whereKeys
      .map((key) => {
        const placeholder =
          systemType === 'postgresql' ? `$${paramIndex++}` : '?'
        return `${quote}${key}${quote} = ${placeholder}`
      })
      .join(' AND ')

    const sql = `UPDATE ${quote}${tableName}${quote} SET ${setClause} WHERE ${whereClause}`
    const params = [...dataKeys.map((key) => data[key]), ...whereKeys.map((key) => where[key])]

    return { sql, params }
  }

  /**
   * Build a parameterized DELETE SQL statement
   */
  private buildDeleteSql(
    tableName: string,
    where: Record<string, any>,
    schema: TableSchema
  ): { sql: string; params: any[] } {
    const whereKeys = Object.keys(where)
    const columnNames = schema.columns.map((col) => col.name)

    // Validate columns
    for (const key of whereKeys) {
      if (!columnNames.includes(key)) {
        throw new Error(
          `Column "${key}" not found in table "${tableName}"`
        )
      }
    }

    // Build WHERE clause
    const systemType = this.getSystemType()
    const quote = this.getQuoteChar()
    let paramIndex = 1

    const whereClause = whereKeys
      .map((key) => {
        const placeholder =
          systemType === 'postgresql' ? `$${paramIndex++}` : '?'
        return `${quote}${key}${quote} = ${placeholder}`
      })
      .join(' AND ')

    const sql = `DELETE FROM ${quote}${tableName}${quote} WHERE ${whereClause}`
    const params = whereKeys.map((key) => where[key])

    return { sql, params }
  }
}
