import { t } from '@/i18n/message-loader'
/**
 * MySQL database adapter using mysql2/promise
 * Implements the DatabaseAdapter interface for MySQL and MariaDB connections
 * Note: MariaDB is a MySQL fork with compatible protocol and schema
 */

// 只留型別；driver 本體在 connect() 時才載入（見 postgresql-adapter 的說明）
import type mysql from 'mysql2/promise'
import type {
  DatabaseAdapter,
  ConnectionOptions,
  TableSchema,
  TableSchemaOptions,
  ExecutionResult,
  SqlExecutionMode,
} from './types'
import {
  queryOnlyBoundaryError,
  queryOnlyCleanupError,
  requireConnected,
  withMappedConnectionError,
} from './sql-adapter-utils'
import { ConnectionError } from './types'
import { mapError } from './error-mapper'
import { checkDbVersion, warnIfUnsupported } from '@/utils/db-version-check'
import { fixDoubleEncodedUtf8 } from '@/utils/encoding'
import { quoteIdentifier } from './identifier-quote'
import { resolveTimeoutPolicy, statementTimeoutSql } from './timeout-policy'
import { isTransportFailure } from '@/utils/connection-error-message'
import { isGrantQuery } from './grant-query'
import { redactGrant, OMITTED_GRANT } from './grant-redaction'

/**
 * Parse enum values from MySQL COLUMN_TYPE string
 * e.g. "enum('a','b','c')" → ['a', 'b', 'c']
 */
function parseEnumValues(columnType: string): string[] | undefined {
  const match = columnType.match(/^enum\((.+)\)$/i)
  if (!match) return undefined
  return (match[1] ?? '').split(',').map((v) => v.trim().replace(/^'|'$/g, ''))
}

/**
 * MySQL adapter implementation using mysql2/promise
 * Works for both MySQL 8.0+ and MariaDB 10.5+
 * Handles connection management, query execution, and schema introspection
 */
export class MySQLAdapter implements DatabaseAdapter {
  private db: mysql.Connection | null = null
  private serverVersion?: string
  private executionTail: Promise<void> = Promise.resolve()
  private options: ConnectionOptions
  private system: 'mysql' | 'mariadb'

  constructor(options: ConnectionOptions) {
    this.options = options
    this.system = (options.system === 'mariadb' ? 'mariadb' : 'mysql') as 'mysql' | 'mariadb'

    // Validate port range
    if (options.port < 1 || options.port > 65535) {
      throw new Error(`Invalid port number: ${options.port}`)
    }
  }

  /**
   * Establish connection to MySQL/MariaDB database
   * Validates credentials and connectivity
   * @throws ConnectionError if connection fails
   */
  async connect(): Promise<void> {
    if (this.options.sqlTls !== undefined) {
      throw new Error(t('errors.sql_tls_unsupported'))
    }
    this.serverVersion = undefined
    await withMappedConnectionError(this.system, this.options, async () => {
      // Create connection using mysql2/promise
      const timeouts = resolveTimeoutPolicy(this.options)
      const { default: driver } = await import('mysql2/promise')
      this.db = await driver.createConnection({
        host: this.options.host,
        port: this.options.port,
        user: this.options.user,
        password: this.options.password || undefined,
        database: this.options.database,
        charset: 'utf8mb4',
        connectTimeout: timeouts.connectMs,
      })

      // Ensure utf8mb4 for information_schema comments
      await this.db.execute('SET NAMES utf8mb4')

      // 語句逾時是 session 級設定；沒有它時 --timeout 對 MySQL 只影響連線，
      // 慢查詢仍會無限期等下去。伺服器太舊而不認得這個變數時不該讓連線失敗。
      if (timeouts.statementMs !== undefined) {
        try {
          await this.db.query(statementTimeoutSql(this.system, timeouts.statementMs))
        } catch {
          // MySQL < 5.7.8 / MariaDB < 10.1 沒有這個 session 變數
        }
      }

      // Test connection with lightweight query
      await this.testConnection()

      // Check server version against minimum requirements
      try {
        const rawVersion = await this.getServerVersion()
        this.serverVersion = rawVersion
        const result = checkDbVersion(rawVersion, this.system)
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
    requireConnected(this.db)

    return withMappedConnectionError(this.system, this.options, async () => {
      // Execute lightweight SELECT 1 query
      const result = await this.execute<{ count: number }>('SELECT 1 as count')
      return result.rows.length > 0
    })
  }

  /**
   * Execute SQL query with parameterized values
   * Prevents SQL injection using parameter binding
   * @param sql Query string with ? placeholders
   * @param params Array of parameter values
   * @returns Execution result with rows and metadata
   * @throws ConnectionError if not connected or query fails
   */
  async execute<T>(
    sql: string,
    params?: (string | number | boolean | null)[],
    options?: { sqlMode?: SqlExecutionMode }
  ): Promise<ExecutionResult<T>> {
    const db = requireConnected(this.db)

    return withMappedConnectionError(this.system, this.options, async () => {
      const grantQuery = isGrantQuery(sql, this.serverVersion)
      const execution = this.executionTail.then(async () => {
        if (options?.sqlMode === 'native-read-only') {
          return this.executeReadOnly<T>(db, sql, params)
        }

        // Use parameterized query to prevent SQL injection
        // mysql2/promise returns [rows, fields]
        const [result] = params ? await db.execute(sql, params) : await db.execute(sql)

        // Handle query results (array of rows)
        if (Array.isArray(result)) {
          return {
            rows: result as T[],
            affectedRows: result.length,
          }
        }

        // Handle DML results (ResultSetHeader)
        const header = result as mysql.ResultSetHeader
        return {
          rows: [],
          affectedRows: header.affectedRows || 0,
          lastInsertId: header.insertId,
        }
      })
      this.executionTail = execution.then(
        () => undefined,
        () => undefined
      )
      const result = await execution
      if (!grantQuery) return result
      // The shared result boundary also covers native-read-only transactions and shell/export.
      // Never allow a formatter or direct consumer to receive the original grant payloads.
      try {
        return {
          ...result,
          rows: result.rows.map((row) => {
            if (Array.isArray(row)) return row.map(redactGrant) as T
            if (!row || typeof row !== 'object') return OMITTED_GRANT as T
            return Object.fromEntries(
              Object.entries(row).map(([key, value]) => [key, redactGrant(value)])
            ) as T
          }),
        }
      } catch {
        throw new ConnectionError('UNKNOWN', 'Could not safely redact SHOW GRANTS results.', [])
      }
    })
  }

  private async executeReadOnly<T>(
    db: mysql.Connection,
    sql: string,
    params?: (string | number | boolean | null)[]
  ): Promise<ExecutionResult<T>> {
    let primaryError: unknown
    let cleanupError: unknown
    let executionResult!: ExecutionResult<T>
    let transactionStarted = false
    try {
      try {
        await db.query('START TRANSACTION READ ONLY')
        transactionStarted = true
      } catch (error) {
        const mapped = mapError(error, this.system, this.options)
        if (isTransportFailure(mapped)) throw mapped
        throw queryOnlyBoundaryError(this.system, error)
      }

      const [result] = params ? await db.execute(sql, params) : await db.execute(sql)
      if (Array.isArray(result)) {
        executionResult = { rows: result as T[], affectedRows: result.length }
      } else {
        const header = result as mysql.ResultSetHeader
        executionResult = {
          rows: [],
          affectedRows: header.affectedRows || 0,
          lastInsertId: header.insertId,
        }
      }
    } catch (error) {
      primaryError = error
    } finally {
      if (transactionStarted) {
        try {
          await db.query('ROLLBACK')
        } catch (error) {
          db.destroy()
          this.db = null
          cleanupError = error
        }
      }
    }

    if (cleanupError !== undefined) {
      throw queryOnlyCleanupError(this.system, cleanupError, primaryError === undefined)
    }
    if (primaryError !== undefined) throw primaryError
    return executionResult
  }

  /**
   * Get the database server version string
   * MySQL returns e.g. "8.0.35", MariaDB returns e.g. "10.11.6-MariaDB"
   */
  async getServerVersion(): Promise<string> {
    const result = await this.execute<{ version: string }>('SELECT VERSION() as version')
    return result.rows[0]?.version ?? 'unknown'
  }

  /**
   * List all tables in the connected database
   * @returns Array of table schemas with metadata
   * @throws ConnectionError if query fails
   */
  async listTables(): Promise<TableSchema[]> {
    requireConnected(this.db)

    return withMappedConnectionError(this.system, this.options, async () => {
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

      const result = await this.execute<{
        table_name: string
        row_count: number | null
        engine: string
        table_type: string
        column_count: number
      }>(query)

      return result.rows.map((row) => ({
        name: row.table_name,
        columns: [],
        columnCount: row.column_count,
        rowCount: row.row_count || 0,
        engine: row.engine,
        estimatedRowCount: row.row_count || 0,
        tableType: (row.table_type === 'VIEW' ? 'view' : 'table') as 'table' | 'view',
      }))
    })
  }

  /**
   * Get detailed schema for a single table
   * Includes all columns with types and constraints
   * Note: MySQL uses UPPERCASE table/column names in information_schema
   * @param tableName Name of table to inspect
   * @returns Complete table schema with column details
   * @throws ConnectionError if query fails
   */
  async getTableSchema(tableName: string, options?: TableSchemaOptions): Promise<TableSchema> {
    requireConnected(this.db)

    return withMappedConnectionError(this.system, this.options, async () => {
      const namespaceSQL = options?.namespace !== undefined ? '?' : 'DATABASE()'
      const namespace = options?.namespace ?? this.options.database
      const columnParams = options?.namespace !== undefined ? [namespace, tableName] : [tableName]
      const fkParams = options?.namespace !== undefined ? [tableName, namespace] : [tableName]
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
        WHERE TABLE_SCHEMA = ${namespaceSQL}
          AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `

      const columnResult = await this.execute<{
        name: string
        type: string
        nullable: boolean
        default_value: string | null
        is_primary_key: boolean
        auto_increment: boolean
        comment: string
      }>(columnQuery, columnParams)
      const columns = columnResult.rows

      // Keep one row per column: comma delimiters and GROUP_CONCAT limits cannot
      // represent arbitrary identifier names or long composite constraints.
      const fkQuery = `
        SELECT rc.CONSTRAINT_NAME as name, kcu.COLUMN_NAME as column_name,
          rc.REFERENCED_TABLE_NAME as ref_table,
          kcu.REFERENCED_TABLE_SCHEMA as ref_schema,
          kcu.REFERENCED_COLUMN_NAME as ref_column
        FROM information_schema.REFERENTIAL_CONSTRAINTS rc
        JOIN information_schema.KEY_COLUMN_USAGE kcu
          ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.TABLE_NAME = kcu.TABLE_NAME
          AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
        WHERE kcu.TABLE_NAME = ? AND rc.CONSTRAINT_SCHEMA = ${namespaceSQL}
        ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
      `
      const fkResult = await this.execute<{
        name: string
        column_name: string
        ref_table: string
        ref_schema: string
        ref_column: string
      }>(fkQuery, fkParams)
      const fkGroups = new Map<string, NonNullable<TableSchema['foreignKeys']>[number]>()
      for (const row of fkResult.rows) {
        const fk = fkGroups.get(row.name) ?? {
          name: row.name,
          columns: [],
          refSchema: row.ref_schema,
          refTable: row.ref_table,
          refColumns: [],
        }
        fk.columns.push(row.column_name)
        fk.refColumns.push(row.ref_column)
        fkGroups.set(row.name, fk)
      }
      const foreignKeys = [...fkGroups.values()]
      const fkMap = new Map<string, { table: string; column: string }>()
      for (const fk of foreignKeys) {
        if (fk.columns.length === 1 && fk.refColumns.length === 1) {
          fkMap.set(fk.columns[0]!, { table: fk.refTable, column: fk.refColumns[0]! })
        }
      }
      const indexQuery = `
        SELECT INDEX_NAME as name, COLUMN_NAME as column_name, NOT NON_UNIQUE as is_unique
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ${namespaceSQL} AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
      `
      const indexResult = await this.execute<{
        name: string
        column_name: string
        is_unique: boolean
      }>(indexQuery, columnParams)
      const indexGroups = new Map<string, NonNullable<TableSchema['indexes']>[number]>()
      for (const row of indexResult.rows) {
        const index = indexGroups.get(row.name) ?? {
          name: row.name,
          columns: [],
          unique: Boolean(row.is_unique),
        }
        if (row.column_name === null) {
          if (options?.metadataProtection) index.columnsComplete = false
        } else index.columns.push(row.column_name)
        indexGroups.set(row.name, index)
      }
      const primaryKeyColumns = indexGroups.get('PRIMARY')?.columns ?? []
      indexGroups.delete('PRIMARY')
      const indexes = [...indexGroups.values()]

      // Engine 與估計列數同源，一次查回來就好——先前是兩趟一模一樣的
      // information_schema.TABLES 查詢（#49）
      const tableMetaQuery = `
        SELECT ENGINE as engine, TABLE_ROWS as estimated_rows, TABLE_TYPE as table_type, TABLE_SCHEMA as schema_name, TABLE_NAME as table_name
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ${namespaceSQL} AND TABLE_NAME = ?
      `
      const tableMetaResult = await this.execute<{
        engine: string
        table_type: string
        schema_name: string
        table_name: string
        estimated_rows: number | null
      }>(tableMetaQuery, columnParams)
      const tableMeta = tableMetaResult.rows[0]
      if (options?.namespace !== undefined && !tableMeta) {
        throw new ConnectionError(
          'TABLE_NOT_FOUND',
          `Object ${JSON.stringify(namespace)}.${JSON.stringify(tableName)} does not exist or is not visible with the current privileges.`,
          []
        )
      }
      const estimatedRowCount =
        options?.namespace !== undefined
          ? tableMeta?.table_type !== 'VIEW' &&
            tableMeta?.estimated_rows != null &&
            Number(tableMeta.estimated_rows) >= 0
            ? Number(tableMeta.estimated_rows)
            : undefined
          : Math.max(0, tableMeta?.estimated_rows || 0)

      // 精確列數要掃全表。掃描模式關掉它——一百張表的資料庫做不起一百次
      // 全表 COUNT，而掃描要的本來就是概況。
      const exactRowCount =
        options?.namespace !== undefined || options?.exactRowCount === false
          ? undefined
          : (
              await this.execute<{ count: number }>(
                `SELECT COUNT(*) as count FROM ${quoteIdentifier(tableName, this.system)}`
              )
            ).rows[0]?.count

      const schema: TableSchema = {
        name: tableMeta?.table_name ?? tableName,
        schema: tableMeta?.schema_name ?? namespace,
        tableType: tableMeta?.table_type?.includes('VIEW') ? 'view' : 'table',
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          default: col.default_value || undefined,
          primaryKey: col.is_primary_key,
          foreignKey: fkMap.get(col.name),
          autoIncrement: col.auto_increment,
          comment: col.comment ? fixDoubleEncodedUtf8(col.comment) : null,
          enumValues: parseEnumValues(col.type),
        })),
        rowCount:
          options?.namespace !== undefined ? undefined : (exactRowCount ?? estimatedRowCount),
        engine: tableMeta?.engine || 'MySQL',
        primaryKey: primaryKeyColumns,
        foreignKeys,
        indexes,
        estimatedRowCount,
      }

      return schema
    })
  }
}
