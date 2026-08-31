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
 * Lower bound is not 1: `--timeout` also becomes the statement timeout when no
 * separate one is given, so a tiny value fails every query with what reads like
 * a connection error. Upper bound keeps a typo from hanging the CLI.
 */
export const MIN_CONNECTION_TIMEOUT_MS = 100
export const MAX_CONNECTION_TIMEOUT_MS = 600_000

/**
 * Statement timeout bounds (milliseconds).
 *
 * 0 是合法值且意義明確——取消上限，讓一句分析查詢想跑多久就跑多久。上限比
 * 連線逾時寬鬆：等一句查詢一小時是合理的請求，等一個 TCP 連線一小時不是。
 */
export const MIN_STATEMENT_TIMEOUT_MS = 0
export const MAX_STATEMENT_TIMEOUT_MS = 3_600_000

const TimeoutField = {
  timeout: z
    .number()
    .int()
    .min(MIN_CONNECTION_TIMEOUT_MS)
    .max(MAX_CONNECTION_TIMEOUT_MS)
    .optional(),
  statementTimeout: z
    .number()
    .int()
    .min(MIN_STATEMENT_TIMEOUT_MS)
    .max(MAX_STATEMENT_TIMEOUT_MS)
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
 * Parse a --statement-timeout CLI value into milliseconds
 *
 * @throws Error with the accepted range when the value is out of bounds
 */
export function parseStatementTimeoutOption(value: string): number {
  const parsed = Number(value)
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_STATEMENT_TIMEOUT_MS ||
    parsed > MAX_STATEMENT_TIMEOUT_MS
  ) {
    throw new Error(
      `Invalid --statement-timeout '${value}': expected an integer between ` +
        `${MIN_STATEMENT_TIMEOUT_MS} and ${MAX_STATEMENT_TIMEOUT_MS} milliseconds ` +
        `(0 removes the limit)`
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
/**
 * 看起來在設定安全性、實際什麼都不做的鍵。
 *
 * zod 預設剝掉未知鍵，於是拼成 Elasticsearch 詞彙的黑名單——`indices`、
 * `fields`——會被靜靜丟掉，解析結果是空黑名單而沒有任何警告：使用者看著設定檔
 * 以為有保護，實際完全沒有。與第七輪那個 CRITICAL 同一個形狀。
 *
 * 檢查必須在解析**之前**做，因為解析會先把它們剝掉——`superRefine` 拿到的是
 * 剝完的物件，寫在那裡是一個永遠不會觸發的檢查（實測確認過）。
 *
 * 不改成全域 `.strict()`：那會拒絕無害的額外鍵，代價落在與安全無關的設定上。
 */
const BLACKLIST_KEY_ALIASES: Record<string, string> = {
  indices: 'tables',
  index: 'tables',
  fields: 'columns',
  keys: 'tables',
}

export const BlacklistConfigSchema = z
  .object({
    tables: z.array(z.string()).default([]),
    columns: z.record(z.array(z.string())).default({}),
  })
  // `passthrough` 讓未知鍵活到 refine 那一步——預設的剝除發生在 refine 之前，
  // 所以寫在 `superRefine` 裡的檢查永遠不會觸發（實測確認過）。看到之後再
  // `transform` 掉，對外的型別與行為不變。
  .passthrough()
  .superRefine((value, ctx) => {
    for (const [wrong, right] of Object.entries(BLACKLIST_KEY_ALIASES)) {
      if (wrong in value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [wrong],
          message: `blacklist.${wrong} is not a setting and would be silently ignored — did you mean blacklist.${right}?`,
        })
      }
    }
  })
  .transform((value) => ({ tables: value.tables, columns: value.columns }))
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
/**
 * The rotation ceilings, in one place.
 *
 * They were written out at five call sites — the schema, its own `.default`,
 * the v1→v2 migration, `config.ts` and `init-shared.ts` — so raising one raised
 * one. ADR-0015's shape: a value copied per call site is a value that drifts.
 */
export const DEFAULT_AUDIT_ROTATION = { max_bytes: 10_485_760, max_entries: 10_000 } as const

export const AuditRotationConfigSchema = z
  .object({
    max_bytes: z.number().int().positive().default(DEFAULT_AUDIT_ROTATION.max_bytes),
    // D-11 set this at 1000. ADR-0016 makes the SQL shell audit every
    // statement in two rows, and a working interactive session reaches 1000 on
    // its own — rotation would then discard the writes to keep the reads.
    max_entries: z.number().int().positive().default(DEFAULT_AUDIT_ROTATION.max_entries),
  })
  .optional()
  .default({ ...DEFAULT_AUDIT_ROTATION })

/**
 * Audit configuration schema (CONFIG-01)
 * D-01: default enabled (opt-out).
 * D-11: rotation thresholds default to 10 MiB / 10,000 entries (ADR-0016).
 * Missing `audit` key in an upgraded .dbcli (CONFIG-03) is auto-filled by the zod default.
 */
export const AuditConfigSchema = z
  .object({
    enabled: z.boolean().default(true), // D-01: opt-out default ON
    /**
     * 稽核寫不出來就不要動資料庫。
     *
     * audit 一直是 best-effort：磁碟滿、目錄不可寫、lock budget 耗盡時，操作
     * 照樣執行而紀錄不存在，只有一行 stderr 警告（一個 process 只印一次，
     * 管線模式通常看不到）。對多數使用者這是對的取捨——遺失一列紀錄不該讓
     * 工具停擺。但把稽核當成控制本身的人（ES shell 的 permission 就是這種
     * 情形）需要能表達相反的取捨，而先前連表達都表達不了。
     *
     * 強制點是「效果發生前」的稽核寫入（`writeAuditEntryBeforeEffect`）：
     * ES shell 送出請求前的那一列，與 SQL 的 gate decision。效果已經發生之後
     * 才寫的紀錄不在範圍內——那時拒絕擋不回任何東西，只會把一次成功的操作
     * 回報成失敗。
     *
     * 預設關閉：這改的是既有行為，開啟與否是使用者的判斷。
     */
    strict: z.boolean().default(false),
    rotation: AuditRotationConfigSchema,
  })
  // `enabled: false` 配 `strict: true` 的語意是「不記錄、也不擋」，與寫下
  // strict 的人想要的完全相反。這種組合是打字錯誤或誤解，不是取捨——
  // 讓它在讀設定時就失敗，而不是在需要它的那一刻靜靜地什麼都不做。
  .refine((audit) => !(audit.strict && !audit.enabled), {
    message:
      'audit.strict requires audit.enabled: with audit off there is nothing to write, so ' +
      'strict would refuse nothing. Enable audit, or turn strict off.',
    path: ['strict'],
  })
  .optional()
  .default({
    enabled: true,
    strict: false,
    rotation: { ...DEFAULT_AUDIT_ROTATION },
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

const NamedConnectionUnion = z.union([
  SqlNamedConnectionSchema,
  MongoDBNamedConnectionSchema,
  RedisNamedConnectionSchema,
  ElasticsearchNamedConnectionSchema,
])
// `permission` 是 per-connection 的，`blacklist` 不是——它只有頂層一份。
// 寫在連線裡會被靜靜剝掉，而使用者文件說「每條連線各自帶著自己的 blacklist
// filtering」，正好強化這個誤解。與其讓保護靜默消失，不如在讀設定時就說出來。
//
// 檢查的是 union **解析前**的原始輸入：union 的每個分支都會先剝掉未知鍵，
// 所以 refine 拿到的物件裡不會再有 `blacklist`。

export const NamedConnectionSchema = z.preprocess((raw, ctx) => {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    if ('blacklist' in (raw as Record<string, unknown>)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blacklist'],
        message:
          'blacklist is configured once at the top level, not per connection — a blacklist here ' +
          'would be ignored. Move it to the top-level blacklist.',
      })
    }
  }
  return raw
}, NamedConnectionUnion)

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
