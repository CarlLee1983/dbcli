/**
 * Zod 驗證模式用於 .dbcli 配置和連接參數
 *
 * 支持：
 * 1. 直接值：host: "localhost"
 * 2. 環境變量引用：host: { "$env": "DB_HOST" }
 */

import { z } from 'zod'

/**
 * 環境變量引用模式
 * 允許 { "$env": "KEY" } 的引用語法
 */
const EnvRefSchema = z.object({
  $env: z.string()
}).strict()

/**
 * 值可以是字符串或環境變量引用
 */
const StringOrEnvRef = z.union([
  z.string().min(1),
  EnvRefSchema
])

const NumberOrEnvRef = z.union([
  z.number().int().min(1).max(65535),
  EnvRefSchema
])

/**
 * 連接配置模式
 * 驗證資料庫連接的必需欄位和有效值
 * 支持環境變量引用
 */
export const ConnectionConfigSchema = z.object({
  system: z.enum(['postgresql', 'mysql', 'mariadb']),
  host: StringOrEnvRef,
  port: NumberOrEnvRef,
  user: StringOrEnvRef,
  password: z.union([z.string(), EnvRefSchema]).default(''),
  database: StringOrEnvRef
})

/**
 * 權限模式
 */
export const PermissionSchema = z.enum(['query-only', 'read-write', 'admin']).default('query-only')

/**
 * 元數據模式
 */
export const MetadataSchema = z
  .object({
    createdAt: z.string().datetime().optional(),
    version: z.string().default('1.0')
  })
  .optional()
  .default({})

/**
 * Blacklist configuration schema
 * Optional field for backward compatibility with existing .dbcli files
 */
export const BlacklistConfigSchema = z
  .object({
    tables: z.array(z.string()).default([]),
    columns: z.record(z.array(z.string())).default({})
  })
  .optional()
  .default({ tables: [], columns: {} })

/**
 * DbcliConfig 完整模式
 */
export const DbcliConfigSchema = z.object({
  connection: ConnectionConfigSchema,
  permission: PermissionSchema,
  schema: z.record(z.any()).optional().default({}),
  metadata: MetadataSchema,
  blacklist: BlacklistConfigSchema
})

/**
 * 從 Zod 模式推導的型別
 */
export type DbcliConfig = z.infer<typeof DbcliConfigSchema>
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>
