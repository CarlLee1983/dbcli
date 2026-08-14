// Shared type definitions for dbcli
export type {
  DataExecutionResult,
  DataExecutionOptions,
  MutationConfirmationRequest,
  MutationConfirmer,
} from './data'
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
  /** Auth database; defaults to 'admin' when credentials are present */
  authSource?: string | { $env: string }
  replicaSet?: string | { $env: string }
  tls?: boolean
  /** Build a mongodb+srv:// URI from host and expand it via DNS SRV lookup */
  srv?: boolean
}

/**
 * Redis Connection configuration (stored in .dbcli file)
 *
 * `user`/`password` are always present (matching the MongoDB pattern); pass
 * an empty string when Redis has no auth so the merge/write/round-trip
 * pipeline keeps a consistent shape across all connection variants.
 */
export interface RedisConnectionConfig {
  system: 'redis'
  host: string | { $env: string }
  port: number | { $env: string }
  user: string | { $env: string }
  password: string | { $env: string }
  /** Redis logical DB index, kept as string for env-binding parity */
  database: string | { $env: string }
}

/**
 * Elasticsearch Connection configuration (stored in .dbcli file)
 */
export interface ElasticsearchConnectionConfig {
  system: 'elasticsearch'
  protocol?: 'http' | 'https'
  host: string | { $env: string }
  port: number | { $env: string }
  user: string | { $env: string }
  password: string | { $env: string }
  database: string | { $env: string }
  nodes?: string[]
  cloudId?: string | { $env: string }
  apiKey?: string | { $env: string }
  caPath?: string
  rejectUnauthorized?: boolean
}

/**
 * Connection configuration (stored in .dbcli file) — union of SQL, MongoDB, Redis, Elasticsearch
 */
export type ConnectionConfig =
  | SqlConnectionConfig
  | MongoDBConnectionConfig
  | RedisConnectionConfig
  | ElasticsearchConnectionConfig

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
