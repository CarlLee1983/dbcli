/**
 * MySQL database adapter using Bun.sql
 * Implements the DatabaseAdapter interface for MySQL and MariaDB connections
 * Note: MariaDB is a MySQL fork with compatible protocol and schema
 */

import { DatabaseAdapter, ConnectionOptions, TableSchema, ColumnSchema, ConnectionError } from './types'
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
      // Query information_schema.TABLES for table list
      const query = `
        SELECT
          table_name,
          table_rows as row_count
        FROM information_schema.TABLES
        WHERE table_schema = DATABASE()
        ORDER BY table_name
      `

      const results = await this.execute<{
        table_name: string
        row_count: number | null
      }>(query)

      return results.map((row) => ({
        name: row.table_name,
        columns: [],
        rowCount: row.row_count || 0,
        engine: this.system === 'mariadb' ? 'MariaDB' : 'MySQL'
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

      // Get row count
      const countResult = await this.execute<{ count: number }>(
        `SELECT COUNT(*) as count FROM \`${tableName}\``
      )

      const schema: TableSchema = {
        name: tableName,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          default: col.default_value || undefined,
          primaryKey: col.is_primary_key,
          foreignKey: undefined
        })),
        rowCount: countResult[0]?.count || 0,
        engine: this.system === 'mariadb' ? 'MariaDB' : 'MySQL'
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
