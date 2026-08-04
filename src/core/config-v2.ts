/**
 * V2 config format: multiple named connections
 *
 * Handles detection, reading, writing, and connection resolution for v2 configs.
 * V1 configs are NOT handled here — they continue using the original config.ts logic.
 */

import { type DbcliConfigV2, DbcliConfigV2Schema } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { assertConfigMutationApproved } from '@/core/config-mutation-guard'
import { assertAgentReadableFile, assertConfigIntegrity, writeConfigIntegrity } from '@/core/config-integrity'
import { loadEnvFile } from '@/core/env-loader'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { levenshteinDistance } from '@/utils/levenshtein-distance'
import { join } from 'path'
import { chmod, mkdir, rename } from 'node:fs/promises'

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
 * Write a v2 config to disk atomically (temp file + rename).
 * Writing to a temp file then renaming over the target is an atomic operation
 * on the same filesystem, so a crash mid-write can never leave a corrupt config.
 */
export async function writeV2Config(path: string, config: DbcliConfigV2): Promise<void> {
  assertConfigMutationApproved()
  DbcliConfigV2Schema.parse(config)

  const storagePath = await resolveConfigStoragePath(path)
  const configPath = join(storagePath, 'config.json')
  const tmpPath = `${configPath}.tmp`
  // Use node:fs APIs (not shelled-out mkdir/mv) so writes are portable: Bun's
  // shell can't handle Windows drive-letter/backslash paths. node's rename
  // replaces an existing target on every platform (atomic on the same fs).
  await mkdir(storagePath, { recursive: true })
  const json = JSON.stringify(config, null, 2)
  // Publish the expected hash before replacing config.json. If the process is
  // interrupted between these operations, agent-mode reads fail closed rather
  // than accepting an unverified new file.
  await writeConfigIntegrity(storagePath, json)
  await Bun.write(tmpPath, json)
  await rename(tmpPath, configPath) // same-filesystem rename: atomic overwrite
  // writeConfigIntegrity runs before the replacement so interrupted writes fail
  // closed; apply the private mode again after the new file exists.
  await chmod(configPath, 0o600).catch(() => undefined)
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
