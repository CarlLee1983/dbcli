/**
 * PostgreSQL database adapter using Bun.sql
 * Implements the DatabaseAdapter interface for PostgreSQL connections
 */

import type { DatabaseAdapter, ConnectionOptions, TableSchema, ColumnSchema } from './types'
import { ConnectionError } from './types'
import { mapError } from './error-mapper'

/**
 * PostgreSQL adapter implementation using Bun.sql
 * Handles connection management, query execution, and schema introspection
 */
export class PostgreSQLAdapter implements DatabaseAdapter {
  private db: any = null
  private options: ConnectionOptions

  constructor(options: ConnectionOptions) {
    this.options = options

    // Validate port range
    if (options.port < 1 || options.port > 65535) {
      throw new Error(`無效的埠號: ${options.port}`)
    }
  }

  /**
   * Establish connection to PostgreSQL database
   * Validates credentials and connectivity
   * @throws ConnectionError if connection fails
   */
  async connect(): Promise<void> {
    try {
      const connectionUrl = this.buildConnectionString()

      // Create connection using Bun.sql
      // Note: Bun.sql() constructor creates a connection pool
      // For simple connections, we use sql.query() directly
      const sql = require('bun:sql')

      this.db = sql({
        url: connectionUrl,
        timeout: this.options.timeout || 5000
      })

      // Test connection with lightweight query
      await this.testConnection()
    } catch (error) {
      throw mapError(error, 'postgresql', this.options)
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
      throw mapError(error, 'postgresql', this.options)
    }
  }

  /**
   * Execute SQL query with parameterized values
   * Prevents SQL injection using parameter binding
   * @param sql Query string with $1, $2, ... placeholders
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
      // PostgreSQL uses $1, $2, ... placeholders
      const result = params
        ? await this.db.query(sql, params)
        : await this.db.query(sql)

      // Convert result to array if needed
      return Array.isArray(result) ? result : (result.rows || [])
    } catch (error) {
      throw mapError(error, 'postgresql', this.options)
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
      // Query pg_stat_user_tables to get table list and row count estimates
      const query = `
        SELECT
          schemaname,
          relname as table_name,
          n_live_tup as row_count
        FROM pg_stat_user_tables
        ORDER BY relname
      `

      const results = await this.execute<{
        schemaname: string
        table_name: string
        row_count: number | null
      }>(query)

      return results.map((row) => ({
        name: row.table_name,
        columns: [],
        rowCount: row.row_count || 0,
        engine: 'PostgreSQL'
      }))
    } catch (error) {
      throw mapError(error, 'postgresql', this.options)
    }
  }

  /**
   * Get detailed schema for a single table
   * Includes all columns with types and constraints
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
      // Query information_schema for column details
      const columnQuery = `
        SELECT
          c.column_name as name,
          c.data_type as type,
          c.is_nullable = 'YES' as nullable,
          c.column_default as default_value,
          (
            SELECT EXISTS(
              SELECT 1 FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
              WHERE tc.table_name = t.table_name
                AND tc.constraint_type = 'PRIMARY KEY'
                AND kcu.column_name = c.column_name
            )
          ) as is_primary_key
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON c.table_name = t.table_name
        WHERE c.table_name = $1
          AND t.table_schema = 'public'
        ORDER BY c.ordinal_position
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
          tc.constraint_name as name,
          array_agg(kcu.column_name) as columns,
          ccu.table_name as ref_table,
          array_agg(ccu.column_name) as ref_columns
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.table_name = kcu.table_name AND tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'
        GROUP BY tc.constraint_name, ccu.table_name
      `

      const fkResults = await this.execute<{
        name: string
        columns: string[]
        ref_table: string
        ref_columns: string[]
      }>(fkQuery, [tableName])

      // Create map of single-column foreign keys for quick lookup
      const fkMap = new Map<string, { table: string; column: string }>()
      for (const fk of fkResults) {
        if (fk.columns.length === 1 && fk.ref_columns.length === 1) {
          fkMap.set(fk.columns[0], { table: fk.ref_table, column: fk.ref_columns[0] })
        }
      }

      // Extract primary key constraint
      const pkQuery = `
        SELECT array_agg(a.attname) as columns
        FROM (
          SELECT a.attname
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indisprimary AND i.indrelid = $1::regclass
          ORDER BY a.attnum
        ) a
      `

      const pkResults = await this.execute<{ columns: string[] }>(pkQuery, [tableName])

      // Get row count
      const countResult = await this.execute<{ count: number }>(
        `SELECT COUNT(*) as count FROM "${tableName}"`
      )

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
        engine: 'PostgreSQL',
        primaryKey: pkResults[0]?.columns || [],
        foreignKeys: fkResults.map(fk => ({
          name: fk.name,
          columns: fk.columns,
          refTable: fk.ref_table,
          refColumns: fk.ref_columns
        }))
      }

      return schema
    } catch (error) {
      throw mapError(error, 'postgresql', this.options)
    }
  }

  /**
   * Build PostgreSQL connection string from options
   * @returns Connection URL string
   */
  private buildConnectionString(): string {
    const { host, port, user, password, database } = this.options
    return `postgresql://${user}${password ? `:${password}` : ''}@${host}:${port}/${database}`
  }
}
