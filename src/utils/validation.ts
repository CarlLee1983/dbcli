/**
 * Zod validation schemas for .dbcli configuration and connection parameters
 *
 * Supports:
 * 1. Direct values: host: "localhost"
 * 2. Environment variable references: host: { "$env": "DB_HOST" }
 */

import { z } from 'zod'

/**
 * Environment variable reference schema
 * Allows { "$env": "KEY" } reference syntax
 */
const EnvRefSchema = z.object({
  $env: z.string()
}).strict()

/**
 * Value can be a string or an environment variable reference
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
 * Connection configuration schema
 * Validates required fields and valid values for database connections
 * Supports environment variable references
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
 * Permission schema
 */
export const PermissionSchema = z.enum(['query-only', 'read-write', 'data-admin', 'admin']).default('query-only')

/**
 * Metadata schema
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
 * DbcliConfig complete schema
 */
export const DbcliConfigSchema = z.object({
  connection: ConnectionConfigSchema,
  permission: PermissionSchema,
  schema: z.record(z.any()).optional().default({}),
  metadata: MetadataSchema,
  blacklist: BlacklistConfigSchema
})

/**
 * Types inferred from Zod schemas
 */
export type DbcliConfig = z.infer<typeof DbcliConfigSchema>
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>

/**
 * Validate --format option value against allowed formats.
 * Throws with clear error message if invalid.
 */
export function validateFormat(
  value: string,
  allowedFormats: readonly string[],
  commandName: string
): void {
  if (!allowedFormats.includes(value)) {
    const allowed = allowedFormats.join(', ')
    throw new Error(
      `Invalid format "${value}" for ${commandName}. Allowed: ${allowed}`
    )
  }
}
