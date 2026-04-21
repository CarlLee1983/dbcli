// Shared type definitions for dbcli
export type { DataExecutionResult, DataExecutionOptions } from './data'
export type { BlacklistConfig, ColumnBlacklist, BlacklistState } from './blacklist'
export { BlacklistError } from './blacklist'

/**
 * Database connection environment variables (parsed from .env)
 */
export interface DatabaseEnv {
  system: 'postgresql' | 'mysql' | 'mariadb'
  host: string
  port: number
  user: string
  password: string
  database: string
}

/**
 * SQL Connection configuration (stored in .dbcli file)
 */
export interface SqlConnectionConfig {
  system: 'postgresql' | 'mysql' | 'mariadb'
  host: string | { $env: string }
  port: number | { $env: string }
  user: string | { $env: string }
  password: string | { $env: string }
  database: string | { $env: string }
}

/**
 * MongoDB Connection configuration (stored in .dbcli file)
 */
export interface MongoDBConnectionConfig {
  system: 'mongodb'
  uri?: string | { $env: string }
  host: string | { $env: string }
  port: number | { $env: string }
  user: string | { $env: string }
  password: string | { $env: string }
  database: string | { $env: string }
}

/**
 * Connection configuration (stored in .dbcli file) — union of SQL and MongoDB
 */
export type ConnectionConfig = SqlConnectionConfig | MongoDBConnectionConfig

/**
 * Permission level (coarse-grained access control)
 */
export type Permission = 'query-only' | 'read-write' | 'data-admin' | 'admin'

/**
 * Metadata information (auditing and version control)
 */
export interface Metadata {
  createdAt?: string
  version: string
}

/**
 * DbcliConfig complete configuration structure (stored in .dbcli file)
 */
export interface DbcliConfig {
  connection: ConnectionConfig
  permission: Permission
  schema?: Record<string, unknown>
  metadata?: Metadata
  blacklist?: import('./blacklist').BlacklistConfig
}

