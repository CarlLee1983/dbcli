// Shared type definitions for dbcli
export type { DataExecutionResult, DataExecutionOptions } from './data'
export type { BlacklistConfig, ColumnBlacklist, BlacklistState } from './blacklist'
export { BlacklistError } from './blacklist'

/**
 * 資料庫連接環境變數（來自 .env 解析）
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
 * 連接配置（儲存在 .dbcli 文件中）
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
 * 權限級別（粗粒度訪問控制）
 */
export type Permission = 'query-only' | 'read-write' | 'admin'

/**
 * 元數據信息（審計和版本控制）
 */
export interface Metadata {
  createdAt?: string
  version: string
}

/**
 * DbcliConfig 完整配置結構（儲存在 .dbcli 文件）
 */
export interface DbcliConfig {
  connection: ConnectionConfig
  permission: Permission
  schema?: Record<string, unknown>
  metadata?: Metadata
  blacklist?: import('./blacklist').BlacklistConfig
}

