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
const EnvRefSchema = z
  .object({
    $env: z.string(),
  })
  .strict()

/**
 * Value can be a string or an environment variable reference
 */
const StringOrEnvRef = z.union([z.string().min(1), EnvRefSchema])

const NumberOrEnvRef = z.union([z.number().int().min(1).max(65535), EnvRefSchema])

/**
 * MongoDB optional fields: accepts empty string as default (unlike StringOrEnvRef which requires min(1))
 */
const OptStringOrEnvRef = z.union([z.string(), EnvRefSchema]).optional().default('')
const OptNumberOrEnvRef = z.union([z.number().int(), EnvRefSchema]).optional().default(27017)

/**
 * Connection timeout bounds (milliseconds).
 *
 * Every adapter honours ConnectionOptions.timeout; without a config field or a
 * CLI flag the built-in 5000ms was unreachable, which is too tight for MongoDB
 * over a VPN or against Atlas.
 *
 * Lower bound is not 1: PostgreSQL maps this value onto `statement_timeout` as
 * well as the connect timeout, so a tiny value fails every query with what reads
 * like a connection error. Upper bound keeps a typo from hanging the CLI.
 */
export const MIN_CONNECTION_TIMEOUT_MS = 100
export const MAX_CONNECTION_TIMEOUT_MS = 600_000

const TimeoutField = {
  timeout: z
    .number()
    .int()
    .min(MIN_CONNECTION_TIMEOUT_MS)
    .max(MAX_CONNECTION_TIMEOUT_MS)
    .optional(),
}

/**
 * Parse a --timeout CLI value into milliseconds
 *
 * @throws Error with the accepted range when the value is not a positive integer
 */
export function parseTimeoutOption(value: string): number {
  const parsed = Number(value)
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_CONNECTION_TIMEOUT_MS ||
    parsed > MAX_CONNECTION_TIMEOUT_MS
  ) {
    throw new Error(
      `Invalid --timeout '${value}': expected an integer between ` +
        `${MIN_CONNECTION_TIMEOUT_MS} and ${MAX_CONNECTION_TIMEOUT_MS} milliseconds`
    )
  }
  return parsed
}

/**
 * MongoDB connection schema — all SQL fields optional (defaulted), uri optional.
 * After parse(), host/port/user/password/database are always strings (empty by default).
 *
 * authSource/replicaSet/tls/srv express the driver options that previously could
 * only be reached by hand-writing a full `uri`; see
 * docs/adr/0002-mongodb-connection-field-first-config.md.
 */
export const MongoDBConnectionConfigSchema = z.object({
  system: z.literal('mongodb'),
  uri: z.union([z.string(), EnvRefSchema]).optional(),
  host: OptStringOrEnvRef,
  port: OptNumberOrEnvRef,
  user: OptStringOrEnvRef,
  password: OptStringOrEnvRef,
  database: OptStringOrEnvRef,
  authSource: z.union([z.string(), EnvRefSchema]).optional(),
  replicaSet: z.union([z.string(), EnvRefSchema]).optional(),
  tls: z.boolean().optional(),
  srv: z.boolean().optional().default(false),
  ...TimeoutField,
})

/**
 * SQL connection configuration schema
 * Validates required fields and valid values for database connections
 * Supports environment variable references
 */
const SqlConnectionConfigSchema = z.object({
  system: z.enum(['postgresql', 'mysql', 'mariadb']),
  host: StringOrEnvRef,
  port: NumberOrEnvRef,
  user: StringOrEnvRef,
  password: z.union([z.string(), EnvRefSchema]).default(''),
  database: StringOrEnvRef,
  ...TimeoutField,
})

/**
 * Redis connection schema — host/port required, user/password optional,
 * database is the logical DB index (kept as string for env-binding parity).
 */
export const RedisConnectionConfigSchema = z.object({
  system: z.literal('redis'),
  host: StringOrEnvRef,
  port: NumberOrEnvRef,
  user: OptStringOrEnvRef,
  password: z.union([z.string(), EnvRefSchema]).optional().default(''),
  database: OptStringOrEnvRef,
  ...TimeoutField,
})

/**
 * Elasticsearch connection schema
 */
export const ElasticsearchConnectionConfigSchema = z.object({
  system: z.literal('elasticsearch'),
  protocol: z.enum(['http', 'https']).optional().default('https'),
  host: OptStringOrEnvRef,
  port: z.union([z.number().int(), EnvRefSchema]).optional().default(9200),
  user: OptStringOrEnvRef,
  password: z.union([z.string(), EnvRefSchema]).optional().default(''),
  database: OptStringOrEnvRef,
  nodes: z.array(z.string()).optional(),
  cloudId: z.union([z.string(), EnvRefSchema]).optional(),
  apiKey: z.union([z.string(), EnvRefSchema]).optional(),
  caPath: z.string().optional(),
  rejectUnauthorized: z.boolean().optional().default(true),
  ...TimeoutField,
})

/**
 * Connection configuration schema (union of SQL, MongoDB, Redis, Elasticsearch)
 */
export const ConnectionConfigSchema = z.union([
  SqlConnectionConfigSchema,
  MongoDBConnectionConfigSchema,
  RedisConnectionConfigSchema,
  ElasticsearchConnectionConfigSchema,
])

/**
 * Permission schema
 */
export const PermissionSchema = z
  .enum(['query-only', 'read-write', 'data-admin', 'admin'])
  .default('query-only')

const EnvironmentLabelSchema = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional()

/**
 * Metadata schema
 */
export const MetadataSchema = z
  .object({
    createdAt: z.string().datetime().optional(),
    version: z.string().default('1.0'),
    schemaLastUpdated: z.string().datetime().optional(),
    schemaTableCount: z.number().int().nonnegative().optional(),
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
    columns: z.record(z.array(z.string())).default({}),
  })
  .optional()
  .default({ tables: [], columns: {} })

/**
 * Redis value/hash-field masking rule schema.
 * Keys matching keyPattern have their value (or named hash fields) redacted on read.
 */
export const RedisMaskRuleSchema = z.object({
  keyPattern: z.string().min(1),
  fields: z.array(z.string()).optional(),
})

/**
 * Redis-specific config block. Currently carries masking rules.
 * Optional for backward compatibility with existing .dbcli files.
 */
export const RedisConfigSchema = z
  .object({
    mask: z.array(RedisMaskRuleSchema).default([]),
  })
  .optional()

/**
 * Audit rotation thresholds schema (D-11)
 * Both thresholds default to the locked values; either trigger triggers rotation (OR relationship).
 */
export const AuditRotationConfigSchema = z
  .object({
    max_bytes: z.number().int().positive().default(10_485_760), // 10 MiB (D-11)
    max_entries: z.number().int().positive().default(1000), // D-11
  })
  .optional()
  .default({ max_bytes: 10_485_760, max_entries: 1000 })

/**
 * Audit configuration schema (CONFIG-01)
 * D-01: default enabled (opt-out).
 * D-11: rotation thresholds default to 10 MiB / 1000 entries.
 * Missing `audit` key in an upgraded .dbcli (CONFIG-03) is auto-filled by the zod default.
 */
export const AuditConfigSchema = z
  .object({
    enabled: z.boolean().default(true), // D-01: opt-out default ON
    rotation: AuditRotationConfigSchema,
  })
  .optional()
  .default({
    enabled: true,
    rotation: { max_bytes: 10_485_760, max_entries: 1000 },
  })

/**
 * DbcliConfig complete schema
 */
export const DbcliConfigSchema = z.object({
  connection: ConnectionConfigSchema,
  permission: PermissionSchema,
  schema: z.record(z.any()).optional().default({}),
  metadata: MetadataSchema,
  blacklist: BlacklistConfigSchema,
  audit: AuditConfigSchema,
  redis: RedisConfigSchema,
})

/**
 * Types inferred from Zod schemas
 */
export type DbcliConfig = z.infer<typeof DbcliConfigSchema>
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>

/**
 * Named connection schemas (v2 format)
 * Extends SQL/MongoDB connection schemas with per-connection permission and optional envFile
 */
const SqlNamedConnectionSchema = SqlConnectionConfigSchema.extend({
  permission: PermissionSchema,
  envFile: z.string().optional(),
  environment: EnvironmentLabelSchema,
})

const MongoDBNamedConnectionSchema = MongoDBConnectionConfigSchema.extend({
  permission: PermissionSchema,
  envFile: z.string().optional(),
  environment: EnvironmentLabelSchema,
})

const RedisNamedConnectionSchema = RedisConnectionConfigSchema.extend({
  permission: PermissionSchema,
  envFile: z.string().optional(),
  environment: EnvironmentLabelSchema,
})

const ElasticsearchNamedConnectionSchema = ElasticsearchConnectionConfigSchema.extend({
  permission: PermissionSchema,
  envFile: z.string().optional(),
  environment: EnvironmentLabelSchema,
})

export const NamedConnectionSchema = z.union([
  SqlNamedConnectionSchema,
  MongoDBNamedConnectionSchema,
  RedisNamedConnectionSchema,
  ElasticsearchNamedConnectionSchema,
])

/**
 * V2 config schema with multiple named connections
 */
export const DbcliConfigV2Schema = z
  .object({
    version: z.literal(2),
    default: z.string().min(1),
    connections: z.record(NamedConnectionSchema).refine((conns) => Object.keys(conns).length > 0, {
      message: 'At least one connection is required',
    }),
    schema: z.record(z.any()).optional().default({}),
    schemas: z.record(z.record(z.any())).optional().default({}),
    metadata: MetadataSchema,
    blacklist: BlacklistConfigSchema,
    audit: AuditConfigSchema,
    redis: RedisConfigSchema,
  })
  .refine((config) => config.default in config.connections, {
    message: 'Default connection must exist in connections',
    path: ['default'],
  })

export type NamedConnection = z.infer<typeof NamedConnectionSchema>
export type DbcliConfigV2 = z.infer<typeof DbcliConfigV2Schema>

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
    throw new Error(`Invalid format "${value}" for ${commandName}. Allowed: ${allowed}`)
  }
}
