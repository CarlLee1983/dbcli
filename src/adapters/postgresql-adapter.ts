/**
 * PostgreSQL database adapter using pg package
 * Implements the DatabaseAdapter interface for PostgreSQL connections
 */

import type { DatabaseAdapter, ConnectionOptions, TableSchema, ExecutionResult } from './types'
import { requireConnected, withMappedConnectionError } from './sql-adapter-utils'
// 型別匯入在執行期會被抹除；driver 本體改在 connect() 時才載入，這樣查
// Redis 或 Mongo 的命令不必為了 import 一個用不到的 SQL driver 付啟動成本
// （MongoDB adapter 的動態 import 是既有先例）。
import type { Pool, PoolClient } from 'pg'
import { checkDbVersion, warnIfUnsupported } from '@/utils/db-version-check'
import { fixDoubleEncodedUtf8 } from '@/utils/encoding'
import { quoteIdentifier } from './identifier-quote'
import { resolveTimeoutPolicy } from './timeout-policy'

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
      throw new Error(`Invalid port number: ${options.port}`)
    }
  }

  /**
   * Establish connection to PostgreSQL database
   * Validates credentials and connectivity
   * @throws ConnectionError if connection fails
   */
  async connect(): Promise<void> {
    await withMappedConnectionError('postgresql', this.options, async () => {
      // Create connection pool with options.
      // statement_timeout 只在使用者實際要求時才送——沒要求時交給伺服器預設，
      // 而不是拿連線逾時的預設值去砍每一句查詢（見 timeout-policy.ts）。
      const timeouts = resolveTimeoutPolicy(this.options)
      const { Pool } = await import('pg')
      this.pool = new Pool({
        host: this.options.host,
        port: this.options.port,
        user: this.options.user,
        password: this.options.password,
        database: this.options.database,
        connectionTimeoutMillis: timeouts.connectMs,
        ...(timeouts.statementMs !== undefined && { statement_timeout: timeouts.statementMs }),
      })

      // Test connection with lightweight query
      await this.testConnection()

      // Check server version against minimum requirements
      try {
        const rawVersion = await this.getServerVersion()
        const result = checkDbVersion(rawVersion, 'postgresql')
        warnIfUnsupported(result)
      } catch {
        // Version check is non-critical; silently continue
      }
    })
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
    requireConnected(this.pool)

    return withMappedConnectionError('postgresql', this.options, async () => {
      // Execute lightweight SELECT 1 query
      const result = await this.execute<{ count: number }>('SELECT 1 as count')
      return result.rows.length > 0
    })
  }

  /**
   * Execute SQL query with parameterized values
   * Prevents SQL injection using parameter binding
   * @param sql Query string with $1, $2, ... placeholders
   * @param params Array of parameter values
   * @returns Execution result with rows and metadata
   * @throws ConnectionError if not connected or query fails
   */
  async execute<T>(
    sql: string,
    params?: (string | number | boolean | null)[]
  ): Promise<ExecutionResult<T>> {
    const pool = requireConnected(this.pool)

    return withMappedConnectionError('postgresql', this.options, async () => {
      // Use parameterized query to prevent SQL injection
      // PostgreSQL uses $1, $2, ... placeholders
      const result = params ? await pool.query(sql, params) : await pool.query(sql)

      // Return ExecutionResult
      return {
        rows: result.rows as T[],
        affectedRows: result.rowCount ?? 0,
      }
    })
  }

  /**
   * Get the database server version string
   * PostgreSQL returns e.g. "15.4" or "15.4 (Ubuntu 15.4-1.pgdg22.04+1)"
   */
  async getServerVersion(): Promise<string> {
    const result = await this.execute<{ server_version: string }>('SHOW server_version')
    return result.rows[0]?.server_version ?? 'unknown'
  }

  /**
   * List all tables in the connected database
   * @returns Array of table schemas with metadata
   * @throws ConnectionError if query fails
   */
  async listTables(): Promise<TableSchema[]> {
    requireConnected(this.pool)

    return withMappedConnectionError('postgresql', this.options, async () => {
      // Query pg_class to get tables and views with estimated row counts
      const query = `
        SELECT
          n.nspname as schema_name,
          c.relname as table_name,
          c.reltuples::bigint as estimated_rows,
          CASE c.relkind
            WHEN 'r' THEN 'table'
            WHEN 'v' THEN 'view'
            WHEN 'm' THEN 'view'
            ELSE 'table'
          END as table_type,
          (SELECT COUNT(*) FROM information_schema.columns ic
           WHERE ic.table_schema = 'public' AND ic.table_name = c.relname)::int as column_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'v', 'm')
        ORDER BY c.relname
      `

      const result = await this.execute<{
        schema_name: string
        table_name: string
        estimated_rows: number | null
        table_type: string
        column_count: number
      }>(query)

      return result.rows.map((row) => ({
        name: row.table_name,
        schema: row.schema_name,
        columns: [],
        columnCount: row.column_count,
        rowCount: Math.max(0, row.estimated_rows || 0),
        engine: 'PostgreSQL',
        estimatedRowCount: Math.max(0, row.estimated_rows || 0),
        tableType: row.table_type as 'table' | 'view',
      }))
    })
  }

  /**
   * Get detailed schema for a single table
   * Includes all columns with types and constraints
   * @param tableName Name of table to inspect
   * @returns Complete table schema with column details
   * @throws ConnectionError if query fails
   */
  async getTableSchema(
    tableName: string,
    options?: { exactRowCount?: boolean; sampleSize?: number }
  ): Promise<TableSchema> {
    requireConnected(this.pool)

    return withMappedConnectionError('postgresql', this.options, async () => {
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
                ON tc.constraint_catalog = kcu.constraint_catalog
                AND tc.constraint_schema = kcu.constraint_schema
                AND tc.constraint_name = kcu.constraint_name
              WHERE tc.table_catalog = c.table_catalog
                AND tc.table_schema = c.table_schema
                AND tc.table_name = c.table_name
                AND kcu.table_catalog = c.table_catalog
                AND kcu.table_schema = c.table_schema
                AND kcu.table_name = c.table_name
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

      const columnResult = await this.execute<{
        name: string
        type: string
        nullable: boolean
        default_value: string | null
        is_primary_key: boolean
        auto_increment: boolean
        comment: string | null
      }>(columnQuery, [tableName])
      const columns = columnResult.rows

      // Query enum values for columns with enum types
      const enumQuery = `
        SELECT
          c.column_name as name,
          array_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
        FROM information_schema.columns c
        JOIN pg_catalog.pg_type AS enum_type
          ON enum_type.typname = c.udt_name
        JOIN pg_catalog.pg_namespace AS enum_schema
          ON enum_schema.oid = enum_type.typnamespace
          AND enum_schema.nspname = c.udt_schema
        JOIN pg_catalog.pg_enum AS e ON e.enumtypid = enum_type.oid
        WHERE c.table_name = $1
          AND c.table_schema = 'public'
        GROUP BY c.column_name
      `

      const enumResult = await this.execute<{
        name: string
        enum_values: string[]
      }>(enumQuery, [tableName])
      const enumResults = enumResult.rows

      const enumMap = new Map<string, string[]>()
      for (const row of enumResults) {
        enumMap.set(row.name, Array.isArray(row.enum_values) ? row.enum_values : [])
      }

      // Extract foreign key constraints
      const fkQuery = `
        SELECT
          constraint_info.conname as name,
          array_agg(source_column.attname ORDER BY source_key.ordinality) as columns,
          referenced_schema.nspname as ref_schema,
          referenced_table.relname as ref_table,
          array_agg(referenced_column.attname ORDER BY source_key.ordinality) as ref_columns
        FROM pg_catalog.pg_constraint AS constraint_info
        JOIN pg_catalog.pg_class AS source_table
          ON source_table.oid = constraint_info.conrelid
        JOIN pg_catalog.pg_namespace AS source_schema
          ON source_schema.oid = source_table.relnamespace
        JOIN pg_catalog.pg_class AS referenced_table
          ON referenced_table.oid = constraint_info.confrelid
        JOIN pg_catalog.pg_namespace AS referenced_schema
          ON referenced_schema.oid = referenced_table.relnamespace
        JOIN LATERAL unnest(constraint_info.conkey) WITH ORDINALITY
          AS source_key(attnum, ordinality) ON TRUE
        JOIN LATERAL unnest(constraint_info.confkey) WITH ORDINALITY
          AS referenced_key(attnum, ordinality)
          ON referenced_key.ordinality = source_key.ordinality
        JOIN pg_catalog.pg_attribute AS source_column
          ON source_column.attrelid = constraint_info.conrelid
          AND source_column.attnum = source_key.attnum
        JOIN pg_catalog.pg_attribute AS referenced_column
          ON referenced_column.attrelid = constraint_info.confrelid
          AND referenced_column.attnum = referenced_key.attnum
        WHERE constraint_info.contype = 'f'
          AND source_table.relname = $1
          AND source_schema.nspname = 'public'
        GROUP BY
          constraint_info.oid,
          constraint_info.conname,
          referenced_schema.nspname,
          referenced_table.relname
        ORDER BY constraint_info.oid
      `

      const fkResult = await this.execute<{
        name: string
        columns: string[]
        ref_schema: string
        ref_table: string
        ref_columns: string[]
      }>(fkQuery, [tableName])
      const fkResults = fkResult.rows

      // Create map of single-column foreign keys for quick lookup
      const fkMap = new Map<string, { table: string; column: string }>()
      for (const fk of fkResults) {
        if (fk.columns.length === 1 && fk.ref_columns.length === 1) {
          fkMap.set(fk.columns[0]!, { table: fk.ref_table, column: fk.ref_columns[0]! })
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

      const indexResult = await this.execute<{
        name: string
        columns: string[]
        is_unique: boolean
      }>(indexQuery, [tableName])
      const indexResults = indexResult.rows

      // Get estimated row count from pg_class
      const estimateQuery = `
        SELECT source_table.reltuples::bigint as estimated_rows
        FROM pg_catalog.pg_class AS source_table
        JOIN pg_catalog.pg_namespace AS source_schema
          ON source_schema.oid = source_table.relnamespace
        WHERE source_table.relname = $1
          AND source_schema.nspname = 'public'
      `
      const estimateResult = await this.execute<{ estimated_rows: number | null }>(estimateQuery, [
        tableName,
      ])
      const estimateResults = estimateResult.rows

      // Extract primary key constraint
      const pkQuery = `
        SELECT
          array_agg(primary_key_column.attname ORDER BY primary_key.ordinality) as columns
        FROM pg_catalog.pg_index AS index_info
        JOIN pg_catalog.pg_class AS source_table
          ON source_table.oid = index_info.indrelid
        JOIN pg_catalog.pg_namespace AS source_schema
          ON source_schema.oid = source_table.relnamespace
        JOIN LATERAL unnest(index_info.indkey) WITH ORDINALITY
          AS primary_key(attnum, ordinality) ON TRUE
        JOIN pg_catalog.pg_attribute AS primary_key_column
          ON primary_key_column.attrelid = source_table.oid
          AND primary_key_column.attnum = primary_key.attnum
        WHERE index_info.indisprimary
          AND source_table.relname = $1
          AND source_schema.nspname = 'public'
      `

      const pkResult = await this.execute<{ columns: string[] }>(pkQuery, [tableName])
      const pkResults = pkResult.rows

      // 精確列數要掃全表。掃描模式關掉它，改用 pg_class 的估計值——一百張表
      // 的資料庫做不起一百次全表 COUNT（#49）。
      const qualifiedTableName = `${quoteIdentifier('public', 'postgresql')}.${quoteIdentifier(tableName, 'postgresql')}`
      const exactRowCount =
        options?.exactRowCount === false
          ? undefined
          : (
              await this.execute<{ count: number }>(
                `SELECT COUNT(*) as count FROM ${qualifiedTableName}`
              )
            ).rows[0]?.count

      // Ensure primaryKey is always an array
      const primaryKeyArray = Array.isArray(pkResults[0]?.columns) ? pkResults[0].columns : []

      // Ensure all foreign key arrays are proper arrays
      const safeForeignKeys = fkResults.map((fk) => ({
        name: fk.name,
        columns: Array.isArray(fk.columns) ? fk.columns : [],
        refSchema: fk.ref_schema,
        refTable: fk.ref_table,
        refColumns: Array.isArray(fk.ref_columns) ? fk.ref_columns : [],
      }))

      const schema: TableSchema = {
        name: tableName,
        schema: 'public',
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          default: col.default_value || undefined,
          primaryKey: col.is_primary_key,
          foreignKey: fkMap.get(col.name),
          autoIncrement: col.auto_increment,
          comment: col.comment ? fixDoubleEncodedUtf8(col.comment) : null,
          enumValues: enumMap.get(col.name),
        })),
        rowCount: exactRowCount ?? Math.max(0, estimateResults[0]?.estimated_rows || 0),
        engine: 'PostgreSQL',
        primaryKey: primaryKeyArray,
        foreignKeys: safeForeignKeys,
        indexes: indexResults.map((idx) => ({
          name: idx.name,
          columns: Array.isArray(idx.columns) ? idx.columns : [],
          unique: idx.is_unique,
        })),
        estimatedRowCount: Math.max(0, estimateResults[0]?.estimated_rows || 0),
      }

      return schema
    })
  }
}
