/**
 * MySQL database adapter using mysql2/promise
 * Implements the DatabaseAdapter interface for MySQL and MariaDB connections
 * Note: MariaDB is a MySQL fork with compatible protocol and schema
 */

import mysql from 'mysql2/promise'
import type { DatabaseAdapter, ConnectionOptions, TableSchema, ColumnSchema } from './types'
import { ConnectionError } from './types'
import { mapError } from './error-mapper'

/**
 * Parse enum values from MySQL COLUMN_TYPE string
 * e.g. "enum('a','b','c')" → ['a', 'b', 'c']
 */
function parseEnumValues(columnType: string): string[] | undefined {
  const match = columnType.match(/^enum\((.+)\)$/i)
  if (!match) return undefined
  return match[1]
    .split(',')
    .map(v => v.trim().replace(/^'|'$/g, ''))
}

/**
 * MySQL adapter implementation using mysql2/promise
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
      // Create connection using mysql2/promise
      // Note: mysql2/promise does not support connectionTimeout in createConnection
      // Timeout should be configured at query execution level if needed
      this.db = await mysql.createConnection({
        host: this.options.host,
        port: this.options.port,
        user: this.options.user,
        password: this.options.password || undefined,
        database: this.options.database
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
        // Close mysql2 connection
        await this.db.end()
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
      // mysql2/promise returns [rows, fields]
      const [rows] = params
        ? await this.db.execute(sql, params)
        : await this.db.execute(sql)

      return Array.isArray(rows) ? rows : []
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
      // Query information_schema.TABLES and count columns for each table
      const query = `
        SELECT
          t.TABLE_NAME as table_name,
          t.TABLE_ROWS as row_count,
          t.ENGINE as engine,
          t.TABLE_TYPE as table_type,
          COUNT(c.COLUMN_NAME) as column_count
        FROM information_schema.TABLES t
        LEFT JOIN information_schema.COLUMNS c
          ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
        WHERE t.TABLE_SCHEMA = DATABASE()
        GROUP BY t.TABLE_NAME, t.TABLE_ROWS, t.ENGINE, t.TABLE_TYPE
        ORDER BY t.TABLE_NAME
      `

      const results = await this.execute<{
        table_name: string
        row_count: number | null
        engine: string
        table_type: string
        column_count: number
      }>(query)

      return results.map((row) => ({
        name: row.table_name,
        columns: [],
        columnCount: row.column_count,
        rowCount: row.row_count || 0,
        engine: row.engine,
        estimatedRowCount: row.row_count || 0,
        tableType: (row.table_type === 'VIEW' ? 'view' : 'table') as 'table' | 'view'
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
          COLUMN_KEY = 'PRI' as is_primary_key,
          EXTRA LIKE '%auto_increment%' as auto_increment,
          COLUMN_COMMENT as comment
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
        auto_increment: boolean
        comment: string
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

      // Extract primary key columns from already-fetched column data
      // (COLUMN_KEY is only available in COLUMNS table, not KEY_COLUMN_USAGE)
      const primaryKeyColumns = columns
        .filter(col => col.is_primary_key)
        .map(col => col.name)

      // Extract index information (excluding PRIMARY)
      const indexQuery = `
        SELECT
          INDEX_NAME as name,
          GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as columns,
          NOT NON_UNIQUE as is_unique
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND INDEX_NAME != 'PRIMARY'
        GROUP BY INDEX_NAME, NON_UNIQUE
      `

      const indexResults = await this.execute<{
        name: string
        columns: string
        is_unique: boolean
      }>(indexQuery, [tableName])

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

      // Get estimated row count from information_schema (zero-cost)
      const estimateQuery = `
        SELECT TABLE_ROWS as estimated_rows
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      `
      const estimateResults = await this.execute<{ estimated_rows: number | null }>(
        estimateQuery, [tableName]
      )

      const schema: TableSchema = {
        name: tableName,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          default: col.default_value || undefined,
          primaryKey: col.is_primary_key,
          foreignKey: fkMap.get(col.name),
          autoIncrement: col.auto_increment,
          comment: col.comment || null,
          enumValues: parseEnumValues(col.type)
        })),
        rowCount: countResult[0]?.count || 0,
        engine: tableResults[0]?.engine || 'MySQL',
        primaryKey: primaryKeyColumns,
        foreignKeys: fkResults.map(fk => ({
          name: fk.name,
          columns: fk.columns.split(',').map(c => c.trim()),
          refTable: fk.ref_table,
          refColumns: fk.ref_columns.split(',').map(c => c.trim())
        })),
        indexes: indexResults.map(idx => ({
          name: idx.name,
          columns: idx.columns.split(',').map(c => c.trim()),
          unique: idx.is_unique
        })),
        estimatedRowCount: estimateResults[0]?.estimated_rows || 0
      }

      return schema
    } catch (error) {
      throw mapError(error, this.system, this.options)
    }
  }

}
