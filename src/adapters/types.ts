/**
 * Database adapter type definitions and interfaces
 * Defines the contract that all database adapters must implement
 */

/**
 * Connection configuration for database adapters
 */
export interface ConnectionOptions {
  /** Database system type */
  system: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb'
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
  /** Connection timeout in milliseconds (default: 5000) */
  timeout?: number
}

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
}

/**
 * Complete schema information for a table
 */
export interface TableSchema {
  /** Table name */
  name: string
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
    public code: 'ECONNREFUSED' | 'ETIMEDOUT' | 'AUTH_FAILED' | 'ENOTFOUND' | 'UNKNOWN',
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
  execute<T>(sql: string, params?: (string | number | boolean | null)[]): Promise<ExecutionResult<T>>

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
   * @returns Complete table schema including all column details
   * @throws {ConnectionError} If query fails
   */
  getTableSchema(tableName: string): Promise<TableSchema>

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
   * @returns Execution result containing rows and metadata
   * @throws {ConnectionError} If query execution fails
   */
  execute<T>(query: string, params?: unknown[]): Promise<ExecutionResult<T>>

  /**
   * List all collections in the connected database
   * Includes metadata such as document count
   * @returns Array of collection info with basic information
   * @throws {ConnectionError} If query fails
   */
  listCollections(): Promise<{ name: string; documentCount?: number }[]>

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
}
