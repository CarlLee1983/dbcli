/**
 * Zod 驗證模式用於 .dbcli 配置和連接參數
 */

import { z } from 'zod'

/**
 * 連接配置模式
 * 驗證資料庫連接的必需欄位和有效值
 */
export const ConnectionConfigSchema = z.object({
  system: z.enum(['postgresql', 'mysql', 'mariadb']),
  host: z.string().min(1, '主機位址為必需'),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1, '資料庫使用者為必需'),
  password: z.string().default(''),
  database: z.string().min(1, '資料庫名稱為必需')
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
 * DbcliConfig 完整模式
 */
export const DbcliConfigSchema = z.object({
  connection: ConnectionConfigSchema,
  permission: PermissionSchema,
  schema: z.record(z.any()).optional().default({}),
  metadata: MetadataSchema
})

/**
 * 從 Zod 模式推導的型別
 */
export type DbcliConfig = z.infer<typeof DbcliConfigSchema>
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>
