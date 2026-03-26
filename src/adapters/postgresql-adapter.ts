/**
 * PostgreSQL database adapter using pg package
 * Implements the DatabaseAdapter interface for PostgreSQL connections
 */

import type { DatabaseAdapter, ConnectionOptions, TableSchema, ColumnSchema } from './types'
import { ConnectionError } from './types'
import { mapError } from './error-mapper'
import { Pool, type PoolClient } from 'pg'

/**
 * PostgreSQL adapter implementation using pg library
 * Handles connection management, query execution, and schema introspection
 */
export class PostgreSQLAdapter implements DatabaseAdapter {
  private pool: Pool | null = null
  private client: PoolClient | null = null
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
      // Create connection pool with options
      this.pool = new Pool({
        host: this.options.host,
        port: this.options.port,
        user: this.options.user,
        password: this.options.password,
        database: this.options.database,
        connectionTimeoutMillis: this.options.timeout || 5000,
        statement_timeout: this.options.timeout || 5000
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
      if (this.client) {
        await this.client.release()
        this.client = null
      }
      if (this.pool) {
        await this.pool.end()
        this.pool = null
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
    if (!this.pool) {
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
    if (!this.pool) {
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
        ? await this.pool.query(sql, params)
        : await this.pool.query(sql)

      // Return rows from result
      return result.rows as T[]
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
    if (!this.pool) {
      throw new ConnectionError(
        'UNKNOWN',
        '資料庫連接未建立',
        ['呼叫 connect() 以建立連接']
      )
    }

    try {
      // Query pg_class to get tables and views with estimated row counts
      const query = `
        SELECT
          c.relname as table_name,
          c.reltuples::bigint as estimated_rows,
          CASE c.relkind
            WHEN 'r' THEN 'table'
            WHEN 'v' THEN 'view'
            WHEN 'm' THEN 'view'
            ELSE 'table'
          END as table_type
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'v', 'm')
        ORDER BY c.relname
      `

      const results = await this.execute<{
        table_name: string
        estimated_rows: number | null
        table_type: string
      }>(query)

      return results.map((row) => ({
        name: row.table_name,
        columns: [],
        rowCount: Math.max(0, row.estimated_rows || 0),
        engine: 'PostgreSQL',
        estimatedRowCount: Math.max(0, row.estimated_rows || 0),
        tableType: row.table_type as 'table' | 'view'
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
    if (!this.pool) {
      throw new ConnectionError(
        'UNKNOWN',
        '資料庫連接未建立',
        ['呼叫 connect() 以建立連接']
      )
    }

    try {
      // Query information_schema for column details including autoIncrement and comment
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
              WHERE tc.table_name = $1
                AND tc.table_schema = 'public'
                AND tc.constraint_type = 'PRIMARY KEY'
                AND kcu.column_name = c.column_name
            )
          ) as is_primary_key,
          (c.column_default LIKE 'nextval%') as auto_increment,
          pgd.description as comment
        FROM information_schema.columns c
        LEFT JOIN pg_catalog.pg_statio_all_tables st
          ON st.schemaname = c.table_schema AND st.relname = c.table_name
        LEFT JOIN pg_catalog.pg_description pgd
          ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
        WHERE c.table_name = $1
          AND c.table_schema = 'public'
        ORDER BY c.ordinal_position
      `

      const columns = await this.execute<{
        name: string
        type: string
        nullable: boolean
        default_value: string | null
        is_primary_key: boolean
        auto_increment: boolean
        comment: string | null
      }>(columnQuery, [tableName])

      // Query enum values for columns with enum types
      const enumQuery = `
        SELECT
          c.column_name as name,
          array_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
        FROM information_schema.columns c
        JOIN pg_type t ON t.typname = c.udt_name
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE c.table_name = $1
          AND c.table_schema = 'public'
        GROUP BY c.column_name
      `

      const enumResults = await this.execute<{
        name: string
        enum_values: string[]
      }>(enumQuery, [tableName])

      const enumMap = new Map<string, string[]>()
      for (const row of enumResults) {
        enumMap.set(row.name, Array.isArray(row.enum_values) ? row.enum_values : [])
      }

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

      // Query non-primary indexes
      const indexQuery = `
        SELECT
          i.relname as name,
          array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
          ix.indisunique as is_unique
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        WHERE t.relname = $1
          AND n.nspname = 'public'
          AND NOT ix.indisprimary
        GROUP BY i.relname, ix.indisunique
      `

      const indexResults = await this.execute<{
        name: string
        columns: string[]
        is_unique: boolean
      }>(indexQuery, [tableName])

      // Get estimated row count from pg_class
      const estimateQuery = `
        SELECT reltuples::bigint as estimated_rows
        FROM pg_class
        WHERE relname = $1
      `
      const estimateResults = await this.execute<{ estimated_rows: number | null }>(
        estimateQuery, [tableName]
      )

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

      // Ensure primaryKey is always an array
      const primaryKeyArray = Array.isArray(pkResults[0]?.columns)
        ? pkResults[0].columns
        : []

      // Ensure all foreign key arrays are proper arrays
      const safeForeignKeys = fkResults.map(fk => ({
        name: fk.name,
        columns: Array.isArray(fk.columns) ? fk.columns : [],
        refTable: fk.ref_table,
        refColumns: Array.isArray(fk.ref_columns) ? fk.ref_columns : []
      }))

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
          enumValues: enumMap.get(col.name)
        })),
        rowCount: countResult[0]?.count || 0,
        engine: 'PostgreSQL',
        primaryKey: primaryKeyArray,
        foreignKeys: safeForeignKeys,
        indexes: indexResults.map(idx => ({
          name: idx.name,
          columns: Array.isArray(idx.columns) ? idx.columns : [],
          unique: idx.is_unique
        })),
        estimatedRowCount: Math.max(0, estimateResults[0]?.estimated_rows || 0)
      }

      return schema
    } catch (error) {
      throw mapError(error, 'postgresql', this.options)
    }
  }

}
