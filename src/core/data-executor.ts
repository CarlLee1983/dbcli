/**
 * Data Executor — handles execution of INSERT, UPDATE, DELETE operations
 *
 * Responsibilities: execute data modification operations, enforce permission checks,
 * validate data columns, handle parameterized queries to prevent SQL injection.
 */

import type { DatabaseAdapter, TableSchema } from '@/adapters/types'
import type { Permission } from '@/types'
import type { DataExecutionResult, DataExecutionOptions } from '@/types/data'
import { enforcePermissionForType, PermissionError } from '@/core/permission-guard'
import type { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'

type MutationOperation = DataExecutionResult['operation']
type SqlStatement = {
  sql: string
  params: (string | number | boolean | null)[]
}

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
    data: Record<string, unknown>,
    schema: TableSchema
  ): { sql: string; params: (string | number | boolean | null)[] } {
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
      params: values as (string | number | boolean | null)[],
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
    data: Record<string, unknown>,
    schema: TableSchema,
    options?: DataExecutionOptions
  ): Promise<DataExecutionResult> {
    const timestamp = new Date().toISOString()

    try {
      this.checkBlacklist('INSERT', tableName)
      enforcePermissionForType('INSERT', this.permission)
      return await this.executeMutation(
        'insert',
        this.buildInsertSql(tableName, data, schema),
        timestamp,
        options,
        { destructive: false }
      )
    } catch (error) {
      return this.handleMutationError('insert', timestamp, error)
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
    data: Record<string, unknown>,
    where: Record<string, unknown>,
    schema: TableSchema,
    options?: DataExecutionOptions
  ): Promise<DataExecutionResult> {
    const timestamp = new Date().toISOString()

    try {
      this.checkBlacklist('UPDATE', tableName)
      enforcePermissionForType('UPDATE', this.permission)
      return await this.executeMutation(
        'update',
        this.buildUpdateSql(tableName, data, where, schema),
        timestamp,
        options,
        { destructive: false }
      )
    } catch (error) {
      return this.handleMutationError('update', timestamp, error)
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
    where: Record<string, unknown>,
    schema: TableSchema,
    options?: DataExecutionOptions
  ): Promise<DataExecutionResult> {
    const timestamp = new Date().toISOString()

    try {
      this.checkBlacklist('DELETE', tableName)
      enforcePermissionForType('DELETE', this.permission)
      return await this.executeMutation(
        'delete',
        this.buildDeleteSql(tableName, where, schema),
        timestamp,
        options,
        { destructive: true }
      )
    } catch (error) {
      return this.handleMutationError('delete', timestamp, error)
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

  private checkBlacklist(operation: 'INSERT' | 'UPDATE' | 'DELETE', tableName: string): void {
    this.blacklistValidator?.checkTableBlacklist(operation, tableName, [])
  }

  private async executeMutation(
    operation: MutationOperation,
    statement: SqlStatement,
    timestamp: string,
    options: DataExecutionOptions | undefined,
    { destructive }: { destructive: boolean }
  ): Promise<DataExecutionResult> {
    if (options?.dryRun) {
      return this.outcomeResult('dry_run', operation, 0, timestamp, statement.sql)
    }

    if (!options?.force) {
      if (!options?.confirm) {
        throw new Error(
          `Refusing to ${operation} without confirmation: no confirmation handler was supplied. ` +
            'Pass options.confirm to ask the user, or options.force to proceed unattended.'
        )
      }

      const proceed = await options.confirm({
        operation,
        sql: statement.sql,
        params: statement.params,
        destructive,
      })

      if (!proceed) {
        return this.outcomeResult('cancelled', operation, 0, timestamp, statement.sql)
      }
    }

    const result = await this.adapter.execute(statement.sql, statement.params)
    return this.outcomeResult('success', operation, result.affectedRows, timestamp, statement.sql)
  }

  private outcomeResult(
    status: Exclude<DataExecutionResult['status'], 'error'>,
    operation: MutationOperation,
    rowsAffected: number,
    timestamp: string,
    sql: string
  ): DataExecutionResult {
    return {
      status,
      operation,
      rows_affected: rowsAffected,
      timestamp,
      sql,
    }
  }

  private handleMutationError(
    operation: MutationOperation,
    timestamp: string,
    error: unknown
  ): DataExecutionResult {
    if (error instanceof BlacklistError) {
      throw error
    }

    // The refusal already knows which level was in effect and why. This used to
    // substitute a fixed sentence naming query-only whatever the actual level
    // was — latent rather than wrong only because every tier that reaches here
    // today happens to be query-only.
    if (error instanceof PermissionError) {
      return {
        status: 'error',
        operation,
        rows_affected: 0,
        timestamp,
        error: `Permission denied: ${error.message}`,
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      status: 'error',
      operation,
      rows_affected: 0,
      timestamp,
      error: `${operation.toUpperCase()} failed: ${errorMessage}`,
    }
  }

  /**
   * Build a parameterized UPDATE SQL statement
   */
  private buildUpdateSql(
    tableName: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>,
    schema: TableSchema
  ): { sql: string; params: (string | number | boolean | null)[] } {
    const dataKeys = Object.keys(data)
    const whereKeys = Object.keys(where)
    const columnNames = schema.columns.map((col) => col.name)

    // Validate columns
    for (const key of [...dataKeys, ...whereKeys]) {
      if (!columnNames.includes(key)) {
        throw new Error(`Column "${key}" not found in table "${tableName}"`)
      }
    }

    // Build UPDATE SET clause
    const systemType = this.getSystemType()
    const quote = this.getQuoteChar()
    let paramIndex = 1

    const setClause = dataKeys
      .map((key) => {
        const placeholder = systemType === 'postgresql' ? `$${paramIndex++}` : '?'
        return `${quote}${key}${quote} = ${placeholder}`
      })
      .join(', ')

    // Build WHERE clause
    const whereClause = whereKeys
      .map((key) => {
        const placeholder = systemType === 'postgresql' ? `$${paramIndex++}` : '?'
        return `${quote}${key}${quote} = ${placeholder}`
      })
      .join(' AND ')

    const sql = `UPDATE ${quote}${tableName}${quote} SET ${setClause} WHERE ${whereClause}`
    const params = [...dataKeys.map((key) => data[key]), ...whereKeys.map((key) => where[key])]

    return { sql, params: params as (string | number | boolean | null)[] }
  }

  /**
   * Build a parameterized DELETE SQL statement
   */
  private buildDeleteSql(
    tableName: string,
    where: Record<string, unknown>,
    schema: TableSchema
  ): { sql: string; params: (string | number | boolean | null)[] } {
    const whereKeys = Object.keys(where)
    const columnNames = schema.columns.map((col) => col.name)

    // Validate columns
    for (const key of whereKeys) {
      if (!columnNames.includes(key)) {
        throw new Error(`Column "${key}" not found in table "${tableName}"`)
      }
    }

    // Build WHERE clause
    const systemType = this.getSystemType()
    const quote = this.getQuoteChar()
    let paramIndex = 1

    const whereClause = whereKeys
      .map((key) => {
        const placeholder = systemType === 'postgresql' ? `$${paramIndex++}` : '?'
        return `${quote}${key}${quote} = ${placeholder}`
      })
      .join(' AND ')

    const sql = `DELETE FROM ${quote}${tableName}${quote} WHERE ${whereClause}`
    const params = whereKeys.map((key) => where[key])

    return { sql, params: params as (string | number | boolean | null)[] }
  }
}
