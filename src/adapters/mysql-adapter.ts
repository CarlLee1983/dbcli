/**
 * MySQL database adapter using Bun.sql
 * Implements the DatabaseAdapter interface for MySQL and MariaDB connections
 * Note: MariaDB is a MySQL fork with compatible protocol and schema
 */

import type { DatabaseAdapter, ConnectionOptions, TableSchema, ColumnSchema } from './types'
import { ConnectionError } from './types'
import { mapError } from './error-mapper'

/**
 * MySQL adapter implementation using Bun.sql
 * Works for both MySQL 8.0+ and MariaDB 10.5+
 * Handles connection management, query execution, and schema introspection
 */
export class MySQLAdapter implements DatabaseAdapter {
  private db: any = null
  private options: ConnectionOptions
  private system: 'mysql' | 'mariadb'

  constructor(options: ConnectionOptions) {
    this.options = options
    this.system = (options.system === 'mariadb' ? 'mariadb' : 'mysql') as 'mysql' | 'mariadb'

    // Validate port range
    if (options.port < 1 || options.port > 65535) {
      throw new Error(`無效的埠號: ${options.port}`)
    }
  }

  /**
   * Establish connection to MySQL/MariaDB database
   * Validates credentials and connectivity
   * @throws ConnectionError if connection fails
   */
  async connect(): Promise<void> {
    try {
      const connectionUrl = this.buildConnectionString()

      // Create connection using Bun.sql
      const sql = require('bun:sql')

      this.db = sql({
        url: connectionUrl,
        timeout: this.options.timeout || 5000
      })

      // Test connection with lightweight query
      await this.testConnection()
    } catch (error) {
      // Pass actual system type for proper error messages
      throw mapError(error, this.system, this.options)
    }
  }

  /**
   * Close database connection gracefully
   * Never throws, safe to call multiple times
   */
  async disconnect(): Promise<void> {
    try {
      if (this.db) {
        // Close connection if available
        if (typeof this.db.close === 'function') {
          await this.db.close()
        }
        this.db = null
      }
    } catch {
      // Silently ignore errors during disconnect
    }
  }

  /**
   * Test connection with lightweight probe query
   * @returns true if connection successful
   * @throws ConnectionError if test fails
   */
  async testConnection(): Promise<boolean> {
    if (!this.db) {
      throw new ConnectionError(
        'UNKNOWN',
        '資料庫連接未建立',
        ['呼叫 connect() 以建立連接']
      )
    }

    try {
      // Execute lightweight SELECT 1 query
      const result = await this.execute<{ count: number }>('SELECT 1 as count')
      return result.length > 0
    } catch (error) {
      throw mapError(error, this.system, this.options)
    }
  }

  /**
   * Execute SQL query with parameterized values
   * Prevents SQL injection using parameter binding
   * @param sql Query string with ? placeholders
   * @param params Array of parameter values
   * @returns Array of result rows
   * @throws ConnectionError if not connected or query fails
   */
  async execute<T>(
    sql: string,
    params?: (string | number | boolean | null)[]
  ): Promise<T[]> {
    if (!this.db) {
      throw new ConnectionError(
        'UNKNOWN',
        '資料庫連接未建立',
        ['呼叫 connect() 以建立連接']
      )
    }

    try {
      // Use parameterized query to prevent SQL injection
      // MySQL uses ? placeholders
      const result = params
        ? await this.db.query(sql, params)
        : await this.db.query(sql)

      // Convert result to array if needed
      return Array.isArray(result) ? result : (result.rows || [])
    } catch (error) {
      throw mapError(error, this.system, this.options)
    }
  }

  /**
   * List all tables in the connected database
   * @returns Array of table schemas with metadata
   * @throws ConnectionError if query fails
   */
  async listTables(): Promise<TableSchema[]> {
    if (!this.db) {
      throw new ConnectionError(
        'UNKNOWN',
        '資料庫連接未建立',
        ['呼叫 connect() 以建立連接']
      )
    }

    try {
      // Query information_schema.TABLES for table list with row count and engine info
      const query = `
        SELECT
          TABLE_NAME as table_name,
          TABLE_ROWS as row_count,
          ENGINE as engine
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME
      `

      const results = await this.execute<{
        table_name: string
        row_count: number | null
        engine: string
      }>(query)

      return results.map((row) => ({
        name: row.table_name,
        columns: [],
        rowCount: row.row_count || 0,
        engine: row.engine
      }))
    } catch (error) {
      throw mapError(error, this.system, this.options)
    }
  }

  /**
   * Get detailed schema for a single table
   * Includes all columns with types and constraints
   * Note: MySQL uses UPPERCASE table/column names in information_schema
   * @param tableName Name of table to inspect
   * @returns Complete table schema with column details
   * @throws ConnectionError if query fails
   */
  async getTableSchema(tableName: string): Promise<TableSchema> {
    if (!this.db) {
      throw new ConnectionError(
        'UNKNOWN',
        '資料庫連接未建立',
        ['呼叫 connect() 以建立連接']
      )
    }

    try {
      // Query information_schema.COLUMNS for column details (UPPERCASE)
      const columnQuery = `
        SELECT
          COLUMN_NAME as name,
          COLUMN_TYPE as type,
          IS_NULLABLE = 'YES' as nullable,
          COLUMN_DEFAULT as default_value,
          COLUMN_KEY = 'PRI' as is_primary_key
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `

      const columns = await this.execute<{
        name: string
        type: string
        nullable: boolean
        default_value: string | null
        is_primary_key: boolean
      }>(columnQuery, [tableName])

      // Extract foreign key constraints
      const fkQuery = `
        SELECT
          rc.CONSTRAINT_NAME as name,
          GROUP_CONCAT(kcu.COLUMN_NAME) as columns,
          rc.REFERENCED_TABLE_NAME as ref_table,
          GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME) as ref_columns
        FROM information_schema.REFERENTIAL_CONSTRAINTS rc
        JOIN information_schema.KEY_COLUMN_USAGE kcu
          ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.TABLE_NAME = kcu.TABLE_NAME
        WHERE kcu.TABLE_NAME = ? AND rc.CONSTRAINT_SCHEMA = DATABASE()
        GROUP BY rc.CONSTRAINT_NAME
      `

      const fkResults = await this.execute<{
        name: string
        columns: string
        ref_table: string
        ref_columns: string
      }>(fkQuery, [tableName])

      // Create map of single-column foreign keys for quick lookup
      const fkMap = new Map<string, { table: string; column: string }>()
      for (const fk of fkResults) {
        const cols = fk.columns.split(',').map(c => c.trim())
        const refCols = fk.ref_columns.split(',').map(c => c.trim())
        if (cols.length === 1 && refCols.length === 1) {
          fkMap.set(cols[0], { table: fk.ref_table, column: refCols[0] })
        }
      }

      // Extract primary key columns
      const pkQuery = `
        SELECT COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_NAME = ? AND COLUMN_KEY = 'PRI' AND TABLE_SCHEMA = DATABASE()
        ORDER BY ORDINAL_POSITION
      `

      const pkResults = await this.execute<{ COLUMN_NAME: string }>(pkQuery, [tableName])

      // Get row count
      const countResult = await this.execute<{ count: number }>(
        `SELECT COUNT(*) as count FROM \`${tableName}\``
      )

      // Get engine type
      const tableQuery = `
        SELECT ENGINE as engine
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      `

      const tableResults = await this.execute<{ engine: string }>(tableQuery, [tableName])

      const schema: TableSchema = {
        name: tableName,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          default: col.default_value || undefined,
          primaryKey: col.is_primary_key,
          foreignKey: fkMap.get(col.name)
        })),
        rowCount: countResult[0]?.count || 0,
        engine: tableResults[0]?.engine || 'MySQL',
        primaryKey: pkResults.map(r => r.COLUMN_NAME),
        foreignKeys: fkResults.map(fk => ({
          name: fk.name,
          columns: fk.columns.split(',').map(c => c.trim()),
          refTable: fk.ref_table,
          refColumns: fk.ref_columns.split(',').map(c => c.trim())
        }))
      }

      return schema
    } catch (error) {
      throw mapError(error, this.system, this.options)
    }
  }

  /**
   * Build MySQL connection string from options
   * @returns Connection URL string
   */
  private buildConnectionString(): string {
    const { host, port, user, password, database } = this.options
    return `mysql://${user}${password ? `:${password}` : ''}@${host}:${port}/${database}`
  }
}
