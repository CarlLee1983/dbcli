/**
 * V2 config format: multiple named connections
 *
 * Handles detection, reading, writing, and connection resolution for v2 configs.
 * V1 configs are NOT handled here — they continue using the original config.ts logic.
 */

import { type DbcliConfigV2, DbcliConfigV2Schema } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { assertConfigMutationApproved } from '@/core/config-mutation-guard'
import {
  assertAgentReadableFile,
  assertConfigIntegrity,
  writeConfigWithIntegrity,
} from '@/core/config-integrity'
import { loadEnvFile } from '@/core/env-loader'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { levenshteinDistance } from '@/utils/levenshtein-distance'
import { join } from 'path'

/**
 * Detect config version from raw parsed JSON
 */
export function detectConfigVersion(raw: unknown): 1 | 2 {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'version' in raw &&
    (raw as Record<string, unknown>).version === 2 &&
    'connections' in raw
  ) {
    return 2
  }
  return 1
}

/**
 * Resolved connection result — what commands receive
 * Supports SQL, MongoDB, Redis, and Elasticsearch connections
 */
export interface ResolvedConnection {
  name: string
  connection: {
    system: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'redis' | 'elasticsearch'
    host: string | { $env: string }
    port: number | { $env: string }
    user: string | { $env: string }
    password: string | { $env: string }
    database: string | { $env: string }
    uri?: string | { $env: string }
    protocol?: 'http' | 'https'
    nodes?: string[]
    cloudId?: string | { $env: string }
    apiKey?: string | { $env: string }
    caPath?: string
    rejectUnauthorized?: boolean
  }
  permission: 'query-only' | 'read-write' | 'data-admin' | 'admin'
  envFile?: string
  environment?: string
}

/**
 * Production is an execution boundary, not merely a display label.  A caller
 * must name a production connection explicitly; falling through to a stored
 * default is too easy to mistake for a local or staging operation.
 */
export function assertExplicitProductionSelection(
  resolved: Pick<ResolvedConnection, 'name' | 'environment'>,
  requestedName: string | undefined
): void {
  if (resolved.environment !== 'production') return

  if (requestedName?.trim() === resolved.name) return

  throw new ConfigError(
    `連線 '${resolved.name}' 標記為 production，必須明確使用 --use ${resolved.name}（或設定 DBCLI_CONNECTION=${resolved.name}）才能執行。`
  )
}

/** Require a deliberate, non-interactive confirmation before changing the persisted default to production. */
export function assertProductionDefaultConfirmation(
  name: string,
  environment: string | undefined,
  confirmation: string | undefined
): void {
  if (environment !== 'production') return
  if (confirmation === name) return

  throw new ConfigError(
    `連線 '${name}' 標記為 production。若要變更預設連線，請加入 --confirm-production ${name}。`
  )
}

/**
 * Return nearby configured connection names for a failed selector without
 * exposing any connection credentials or endpoint values.
 */
export function findSimilarConnectionNames(
  requestedName: string,
  availableNames: readonly string[]
): string[] {
  const requested = requestedName.toLowerCase()
  const distanceLimit = Math.max(2, Math.floor(requested.length / 3))

  return availableNames
    .map((name) => {
      const candidate = name.toLowerCase()
      const distance = levenshteinDistance(requested, candidate)
      return {
        name,
        distance,
        isSimilar:
          candidate.includes(requested) ||
          requested.includes(candidate) ||
          distance <= distanceLimit,
      }
    })
    .filter(({ isSimilar }) => isSimilar)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(({ name }) => name)
}

export function connectionNotFoundMessage(
  requestedName: string,
  availableNames: readonly string[]
): string {
  const suggestions = findSimilarConnectionNames(requestedName, availableNames)
  const suggestion = suggestions.length > 0 ? ` 你是否要使用：${suggestions.join('、')}？` : ''
  return `連線 '${requestedName}' 不存在。${suggestion} 可用連線：${availableNames.join(', ')}`
}

/**
 * Resolve a named connection from v2 config
 */
export function resolveConnection(
  config: DbcliConfigV2,
  name: string | undefined
): ResolvedConnection {
  const connectionName = name ?? config.default
  const conn = config.connections[connectionName]

  if (!conn) {
    throw new ConfigError(
      connectionNotFoundMessage(connectionName, Object.keys(config.connections))
    )
  }

  const { permission, envFile, environment, ...connectionFields } = conn

  return {
    name: connectionName,
    connection: connectionFields,
    permission,
    envFile,
    environment,
  }
}

/**
 * Load env file for a connection if specified
 */
export async function loadConnectionEnv(
  resolved: ResolvedConnection,
  basePath: string
): Promise<void> {
  if (resolved.envFile) {
    const envPath = join(basePath, resolved.envFile)
    await loadEnvFile(envPath)
  }
}

/**
 * Read and validate a v2 config from disk
 */
export async function readV2Config(path: string): Promise<DbcliConfigV2> {
  const storagePath = await resolveConfigStoragePath(path)
  const configPath = join(storagePath, 'config.json')
  const file = Bun.file(configPath)

  if (!(await file.exists())) {
    throw new ConfigError(`找不到 V2 設定檔：${configPath}`)
  }

  await assertAgentReadableFile(configPath)
  const content = await file.text()
  await assertConfigIntegrity(storagePath, content, { requireRecord: true })
  const raw = JSON.parse(content)

  return DbcliConfigV2Schema.parse(raw)
}

/**
 * Write a v2 config and its integrity records as one recoverable publication.
 */
export async function writeV2Config(path: string, config: DbcliConfigV2): Promise<void> {
  assertConfigMutationApproved()
  DbcliConfigV2Schema.parse(config)

  const storagePath = await resolveConfigStoragePath(path)
  const json = JSON.stringify(config, null, 2)
  await writeConfigWithIntegrity(storagePath, json)
}

/**
 * Patch the schema for a single named connection without touching other V2 fields.
 * Safe to call from schema commands — preserves connections, default, blacklist, etc.
 */
export async function patchConnectionSchema(
  dbcliPath: string,
  connectionName: string,
  schema: Record<string, unknown>,
  metadataUpdate?: { schemaLastUpdated?: string; schemaTableCount?: number }
): Promise<void> {
  const storagePath = await resolveConfigStoragePath(dbcliPath)
  const v2Config = await readV2Config(storagePath)
  const updated = {
    ...v2Config,
    schemas: {
      ...v2Config.schemas,
      [connectionName]: schema,
    },
    metadata: {
      ...v2Config.metadata,
      ...(metadataUpdate ?? {}),
    },
  }
  await writeV2Config(storagePath, updated)
}

/**
 * Patch only the top-level blacklist of a v2 config.
 *
 * `blacklist add/remove` 原本走 `configModule.read()` → `configModule.write()`。
 * 前者對 v2 設定回傳的是「選中那一條連線」的扁平化 v1 形狀，後者以 v1 schema
 * 驗證後整包覆寫——於是加一條 blacklist 會把整份多連線設定壓成單一連線，
 * `connections`、`default`、`envFile`、`environment` 全部消失，而**預設 tier
 * 變成當時 `--use` 的那一條連線的 tier**。加黑名單這個動作因此可以把 ES shell
 * 的 gate 從 query-only 變成 admin，且完整性紀錄同步更新，事後沒有 tamper 訊號。
 *
 * 這個函式與 `patchConnectionSchema` 是同一個模式：讀 v2、只動一個欄位、寫回 v2。
 */
export async function patchBlacklist(
  dbcliPath: string,
  blacklist: { tables: string[]; columns: Record<string, string[]> }
): Promise<void> {
  const storagePath = await resolveConfigStoragePath(dbcliPath)
  const v2Config = await readV2Config(storagePath)
  await writeV2Config(storagePath, { ...v2Config, blacklist })
}

/**
 * Whether the config at this path is v2, without parsing it as either shape.
 *
 * Callers that mutate config need this: the v1 write path is destructive to a
 * v2 file, so "which shape is on disk" has to be answerable before writing.
 */
export async function isV2Config(dbcliPath: string): Promise<boolean> {
  try {
    const storagePath = await resolveConfigStoragePath(dbcliPath)
    const file = Bun.file(join(storagePath, 'config.json'))
    if (!(await file.exists())) return false
    return detectConfigVersion(await file.json()) === 2
  } catch {
    // 讀不到或不是 JSON：交給既有的讀取路徑去報那個錯，這裡只回答形狀問題。
    return false
  }
}

/**
 * List all connection names in a v2 config
 */
export function listConnections(config: DbcliConfigV2): Array<{
  name: string
  system: string
  host: string | { $env: string }
  port: number | { $env: string }
  database: string | { $env: string }
  uri?: string | { $env: string }
  isDefault: boolean
}> {
  return Object.entries(config.connections).map(([name, conn]) => {
    const c = conn as {
      host?: string | { $env: string }
      port?: number | { $env: string }
      database?: string | { $env: string }
      uri?: string | { $env: string }
    }
    return {
      name,
      system: conn.system,
      host: c.host ?? '',
      port: c.port ?? 27017,
      database: c.database ?? '',
      ...(c.uri !== undefined && { uri: c.uri }),
      isDefault: name === config.default,
    }
  })
}
