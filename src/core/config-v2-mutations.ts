import type { DbcliConfig, DbcliConfigV2 } from '@/utils/validation'

export type SqlSystem = 'postgresql' | 'mysql' | 'mariadb'

const SQL_SYSTEMS = ['postgresql', 'mysql', 'mariadb'] as const

/**
 * `$env` 變數名。per-connection 命名空間化:常駐 sidecar 共用 process.env,
 * 且 loadEnvFile 不覆寫既有 key——若兩連線都用 DB_PASSWORD 會撞名取到對方的值。
 */
export function envVarNameFor(connName: string, field: 'password'): string {
  const slug = connName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `DBCLI_${slug}_${field.toUpperCase()}`
}

export interface ConnectionInput {
  name: string
  system: SqlSystem
  host: string
  port: number
  user: string
  database: string
}

/** 刪除連線(immutable)。刪預設則改派為剩餘第一條;刪最後一條則擋下(v2 需至少一條)。 */
export function removeConnection(config: DbcliConfigV2, name: string): DbcliConfigV2 {
  if (!(name in config.connections)) throw new Error(`連線 '${name}' 不存在`)
  const rest = { ...config.connections }
  delete rest[name]
  const remaining = Object.keys(rest)
  if (remaining.length === 0) throw new Error('無法刪除最後一條連線')
  const nextDefault = config.default === name ? remaining[0] : config.default
  return { ...config, connections: rest, default: nextDefault } as DbcliConfigV2
}

/** 設定預設連線(immutable)。 */
export function setDefaultConnection(config: DbcliConfigV2, name: string): DbcliConfigV2 {
  if (!(name in config.connections)) throw new Error(`連線 '${name}' 不存在`)
  return { ...config, default: name } as DbcliConfigV2
}

/**
 * v1 單連線 → v2,產生唯一 'default' 連線。沿用 v1 既有密碼慣例:legacy
 * `.env.local` 的 `DB_PASSWORD`,故 default 連線 envFile 指向 '.env.local'、
 * password 設 {$env:'DB_PASSWORD'},不搬動既有 secret。blacklist/audit/metadata 原樣帶過。
 */
export function migrateV1ToV2(v1: DbcliConfig): DbcliConfigV2 {
  const system = (v1.connection as { system?: string }).system
  if (!SQL_SYSTEMS.includes(system as SqlSystem)) {
    throw new Error(
      `v1→v2 自動升級目前僅支援 SQL 連線(mysql/postgresql/mariadb),不支援 '${system}'`
    )
  }
  const c = v1.connection as {
    system: SqlSystem
    host: string
    port: number
    user: string
    database: string
  }
  return {
    version: 2,
    default: 'default',
    connections: {
      default: {
        system: c.system,
        host: c.host,
        port: c.port,
        user: c.user,
        database: c.database,
        password: { $env: 'DB_PASSWORD' },
        permission: v1.permission ?? 'query-only',
        envFile: '.env.local',
      },
    },
    schema: {},
    schemas: {},
    metadata: v1.metadata ?? { version: '2.0' },
    blacklist: v1.blacklist ?? { tables: [], columns: {} },
    audit: v1.audit ?? { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
  } as DbcliConfigV2
}

/** 新增或就地覆寫同名連線(immutable)。非機密欄存字面值,password 存 {$env} 參照 +
 *  per-connection envFile。編輯時保留既有 permission;新建預設 'query-only'。 */
export function upsertConnection(config: DbcliConfigV2, input: ConnectionInput): DbcliConfigV2 {
  const existing = config.connections[input.name] as { permission?: string } | undefined
  const connection = {
    system: input.system,
    host: input.host,
    port: input.port,
    user: input.user,
    database: input.database,
    password: { $env: envVarNameFor(input.name, 'password') },
    permission: existing?.permission ?? 'query-only',
    envFile: `.env.${input.name}`,
  }
  return {
    ...config,
    connections: { ...config.connections, [input.name]: connection },
  } as DbcliConfigV2
}
