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
 * Connection configuration (stored in .dbcli file)
 */
export interface ConnectionConfig {
  system: 'postgresql' | 'mysql' | 'mariadb'
  host: string
  port: number
  user: string
  password: string
  database: string
}

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

