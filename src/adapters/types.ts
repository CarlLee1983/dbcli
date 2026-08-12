/**
 * Database adapter type definitions and interfaces
 * Defines the contract that all database adapters must implement
 */

export type DatabaseSystem =
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'mongodb'
  | 'redis'
  | 'elasticsearch'

export type SqlDatabaseSystem = Extract<DatabaseSystem, 'postgresql' | 'mysql' | 'mariadb'>

export type QueryableDatabaseSystem = Exclude<DatabaseSystem, SqlDatabaseSystem>

/**
 * Connection configuration for database adapters
 */
export interface ConnectionOptions {
  /** Database system type */
  system: DatabaseSystem
  /** Database host address or hostname */
  host: string
  /** Database port number */
  port: number
  /** Database user name */
  user: string
  /** Database password */
  password: string
  /** Database name */
  database: string
  /** MongoDB connection URI (optional, for MongoDB connections) */
  uri?: string
  /** MongoDB auth database — used when building URI from host/port/user/password (default: 'admin') */
  authSource?: string
  /** MongoDB replica set name (optional, field-based config) */
  replicaSet?: string
  /** MongoDB TLS switch (optional, field-based config; implied true when srv) */
  tls?: boolean
  /** MongoDB SRV lookup — build a mongodb+srv:// URI from host (optional, field-based config) */
  srv?: boolean
  /** Connection timeout in milliseconds (default: 5000) */
  timeout?: number
  /**
   * Statement timeout in milliseconds. Falls back to `timeout` when unset, and
   * to the server default when neither is given — an unset statement timeout
   * means the server decides, not that 5000ms applies. 0 removes the limit.
   */
  statementTimeout?: number
  /** Elasticsearch protocol (http or https) */
  protocol?: 'http' | 'https'
  /** Elasticsearch nodes for round-robin (optional) */
  nodes?: string[]
  /** Elasticsearch Cloud ID (optional) */
  cloudId?: string
  /** Elasticsearch API Key (optional) */
  apiKey?: string
  /** Elasticsearch CA Certificate Path (optional) */
  caPath?: string
  /** Whether to reject unauthorized TLS connections (default: true) */
  rejectUnauthorized?: boolean
}

export type SqlConnectionOptions = ConnectionOptions & { system: SqlDatabaseSystem }

export type QueryableConnectionOptions = ConnectionOptions & { system: QueryableDatabaseSystem }

/**
 * Schema information for a single column
 */
export interface ColumnSchema {
  /** Column name */
  name: string
  /** Column data type */
  type: string
  /** Whether column allows NULL values */
  nullable: boolean
  /** Default value for column (if any) */
  default?: string
  /** Whether column is primary key */
  primaryKey?: boolean
  /** Foreign key reference if applicable */
  foreignKey?: {
    table: string
    column: string
  }
  /** Whether column is auto-incremented */
  autoIncrement?: boolean
  /** Column comment/description */
  comment?: string | null
  /** Enum values if column is ENUM type */
  enumValues?: string[]
  /** MongoDB only: 0..1 fraction of sampled docs that contained this dot-path. Undefined for SQL. */
  presence?: number
  /** MongoDB only: true when this dot-path matches a blacklist pattern. Undefined for SQL. */
  redacted?: boolean
}

/**
 * Complete schema information for a table
 */
export interface TableSchema {
  /** Table name */
  name: string
  /** Exact database schema/catalog namespace, when reliably available */
  schema?: string
  /** Array of columns in the table */
  columns: ColumnSchema[]
  /** Approximate row count (if available) */
  rowCount?: number
  /** Storage engine (PostgreSQL/MySQL) */
  engine?: string
  /** Primary key column names */
  primaryKey?: string[]
  /** Foreign key constraints with metadata */
  foreignKeys?: Array<{
    name: string
    columns: string[]
    refSchema?: string
    refTable: string
    refColumns: string[]
  }>
  /** Table indexes with column information */
  indexes?: Array<{
    name: string
    columns: string[]
    unique: boolean
  }>
  /** Column count (used by listTables when full column details are not loaded) */
  columnCount?: number
  /** Estimated row count in table */
  estimatedRowCount?: number
  /** Type of table (table or view) */
  tableType?: 'table' | 'view'
}

/**
 * Connection error with categorized error code and troubleshooting hints
 */
export class ConnectionError extends Error {
  constructor(
    /** Error category code */
    public code:
      | 'ECONNREFUSED'
      | 'ETIMEDOUT'
      | 'AUTH_FAILED'
      | 'ENOTFOUND'
      | 'SQL_SYNTAX_ERROR'
      | 'TABLE_NOT_FOUND'
      | 'COLUMN_NOT_FOUND'
      | 'UNKNOWN',
    /** User-friendly error message */
    message: string,
    /** Array of actionable troubleshooting hints */
    public hints: string[]
  ) {
    super(message)
    this.name = 'ConnectionError'
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ConnectionError.prototype)
  }
}

/**
 * Result of a database query or command execution
 */
export interface ExecutionResult<T> {
  /** Array of result rows as objects (for SELECT queries) */
  rows: T[]
  /** Number of rows affected by the operation (for INSERT/UPDATE/DELETE) */
  affectedRows: number
  /** Last inserted ID if applicable (for INSERT operations) */
  lastInsertId?: number | string
  /** Convenience row count — used by formatters; mirrors rows.length on read paths */
  rowCount?: number
  /** Column ordering for the rows, used by formatters that render tabular output */
  columnNames?: string[]
  /** Optional warnings — emitted today only by RedisAdapter (size guard / blacklist filter). */
  warnings?: RedisWarning[]
}

/**
 * Non-fatal warnings surfaced alongside a result. Currently Redis-only:
 * size-guard rewrites/truncations and blacklist-filtered key listings.
 */
export type RedisWarning =
  | { code: 'REDIS_SIZE_REWRITE'; command: string; original: string[]; rewritten: string[] }
  | { code: 'REDIS_SIZE_TRUNCATE'; command: string; kept: number; droppedAtLeast: number }
  | { code: 'REDIS_BLACKLIST_FILTERED'; count: number }

/**
 * `getTableSchema()` 的選項，所有 adapter 共用一份。
 *
 * 分開宣告是因為它同時出現在介面、兩個 SQL adapter 與掃描命令四個地方；
 * 各自就地拼一份 inline 型別時，MongoDB 的 sampleMethod 曾經在 SQL 側被
 * 悄悄漏掉。
 */
export interface TableSchemaOptions {
  /** MongoDB: 取樣文件數 */
  sampleSize?: number
  /** MongoDB: 取樣方式 */
  sampleMethod?: 'random' | 'natural'
  /**
   * 精確列數要掃全表。掃描整個資料庫時設為 false，改用引擎的估計值——
   * 一百張表的資料庫做不起一百次全表 COUNT。預設 true。
   */
  exactRowCount?: boolean
}

/**
 * Database adapter interface - contract for all database implementations
 * Defines methods that all database adapters must implement
 */
export interface DatabaseAdapter {
  /**
   * Establish connection and verify credentials
   * Throws ConnectionError with categorized error type on failure
   * @throws {ConnectionError} If connection fails (server down, auth failed, timeout, etc.)
   */
  connect(): Promise<void>

  /**
   * Close connection and release resources
   * Should never throw; safe to call multiple times
   * Handles cleanup gracefully even if already disconnected
   */
  disconnect(): Promise<void>

  /**
   * Execute arbitrary SQL query with parameterized values
   * Prevents SQL injection by using parameter binding
   * @param sql Query string with parameter placeholders ($1, $2, etc. for PostgreSQL or ? for MySQL)
   * @param params Array of parameter values in order
   * @returns Execution result containing rows and metadata
   * @throws {ConnectionError} If query execution fails
   */
  execute<T>(
    sql: string,
    params?: (string | number | boolean | null)[],
    options?: { noLimit?: boolean }
  ): Promise<ExecutionResult<T>>

  /**
   * List all tables in the connected database
   * Includes metadata such as row count and storage engine
   * @returns Array of table schemas with basic information
   * @throws {ConnectionError} If query fails
   */
  listTables(): Promise<TableSchema[]>

  /**
   * Fetch complete schema for a single table
   * Includes all columns with types and constraints
   * @param tableName Name of table to inspect
   * @param options Optional adapter-specific knobs (e.g. mongo `sampleSize`); SQL adapters ignore them.
   * @returns Complete table schema including all column details
   * @throws {ConnectionError} If query fails
   */
  getTableSchema(tableName: string, options?: TableSchemaOptions): Promise<TableSchema>

  /**
   * Test connection with lightweight probe query
   * Executes SELECT 1 or equivalent to verify connection is alive
   * @returns true if connection successful
   * @throws {ConnectionError} If connection test fails
   */
  testConnection(): Promise<boolean>

  /**
   * Get the database server version string
   * @returns Raw version string from the server (e.g. "8.0.35", "15.4", "10.11.6-MariaDB")
   * @throws {ConnectionError} If not connected or query fails
   */
  getServerVersion(): Promise<string>
}

/**
 * Queryable adapter interface for MongoDB — a read-focused subset of DatabaseAdapter.
 * execute() accepts JSON query strings; listCollections() replaces listTables().
 */
export interface QueryableAdapter {
  /**
   * Establish connection and verify credentials
   * Throws ConnectionError with categorized error type on failure
   * @throws {ConnectionError} If connection fails (server down, auth failed, timeout, etc.)
   */
  connect(): Promise<void>

  /**
   * Close connection and release resources
   * Should never throw; safe to call multiple times
   * Handles cleanup gracefully even if already disconnected
   */
  disconnect(): Promise<void>

  /**
   * Execute arbitrary query with parameterized values
   * Accepts JSON query strings for MongoDB operations
   * @param query Query string (JSON format for MongoDB)
   * @param params Array of parameter values in order
   * @param options Optional execution controls (e.g. result-cardinality limit)
   * @returns Execution result containing rows and metadata
   * @throws {ConnectionError} If query execution fails
   */
  execute<T>(
    query: string,
    params?: unknown[],
    options?: {
      limit?: number
      noLimit?: boolean
      projection?: Record<string, 0 | 1>
    }
  ): Promise<ExecutionResult<T>>

  /**
   * List all collections in the connected database
   * Includes metadata such as document count
   * @param options Optional filter for system indices
   * @returns Array of collection info with basic information
   * @throws {ConnectionError} If query fails
   */
  listCollections(options?: {
    includeSystem?: boolean
    /** Redis: 取樣上限。列 key 沒有 catalog 可查，只能掃，所以上限是必要的。 */
    limit?: number
  }): Promise<{ name: string; documentCount?: number }[]>

  /**
   * SQL-compatible collection listing for shared command surfaces.
   * @param options Optional filter for system indices
   */
  listTables?(options?: { includeSystem?: boolean }): Promise<TableSchema[]>

  /**
   * SQL-compatible schema lookup for shared command surfaces.
   * @param tableName Name of collection/table to inspect
   * @param options Optional adapter-specific knobs (e.g. mongo `sampleSize`).
   */
  getTableSchema?(
    tableName: string,
    options?: { sampleSize?: number; sampleMethod?: 'random' | 'natural' }
  ): Promise<TableSchema>

  /**
   * Test connection with lightweight probe query
   * Executes a ping or equivalent to verify connection is alive
   * @returns true if connection successful
   * @throws {ConnectionError} If connection test fails
   */
  testConnection(): Promise<boolean>

  /**
   * Get the database server version string
   * @returns Raw version string from the server
   * @throws {ConnectionError} If not connected or query fails
   */
  getServerVersion(): Promise<string>

  /**
   * Insert a single document/row
   * @param collection Collection or table name
   * @param data Data object to insert
   * @returns Execution result
   */
  insert(collection: string, data: Record<string, unknown>): Promise<ExecutionResult<unknown>>

  /**
   * Update documents/rows matching filter
   * @param collection Collection or table name
   * @param filter Filter object
   * @param update Update operations (e.g. {$set: ...})
   * @returns Execution result
   */
  update(
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<ExecutionResult<unknown>>

  /**
   * Delete documents/rows matching filter
   * @param collection Collection or table name
   * @param filter Filter object
   * @returns Execution result
   */
  delete(collection: string, filter: Record<string, unknown>): Promise<ExecutionResult<unknown>>
}
