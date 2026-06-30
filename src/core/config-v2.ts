/**
 * V2 config format: multiple named connections
 *
 * Handles detection, reading, writing, and connection resolution for v2 configs.
 * V1 configs are NOT handled here — they continue using the original config.ts logic.
 */

import { type DbcliConfigV2, DbcliConfigV2Schema } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { loadEnvFile } from '@/core/env-loader'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { join } from 'path'
import { mkdir, rename } from 'node:fs/promises'

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
    const available = Object.keys(config.connections).join(', ')
    throw new ConfigError(`連線 '${connectionName}' 不存在。可用連線：${available}`)
  }

  const { permission, envFile, ...connectionFields } = conn

  return {
    name: connectionName,
    connection: connectionFields,
    permission,
    envFile,
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

  const content = await file.text()
  const raw = JSON.parse(content)

  return DbcliConfigV2Schema.parse(raw)
}

/**
 * Write a v2 config to disk atomically (temp file + rename).
 * Writing to a temp file then renaming over the target is an atomic operation
 * on the same filesystem, so a crash mid-write can never leave a corrupt config.
 */
export async function writeV2Config(path: string, config: DbcliConfigV2): Promise<void> {
  DbcliConfigV2Schema.parse(config)

  const storagePath = await resolveConfigStoragePath(path)
  const configPath = join(storagePath, 'config.json')
  const tmpPath = `${configPath}.tmp`
  // Use node:fs APIs (not shelled-out mkdir/mv) so writes are portable: Bun's
  // shell can't handle Windows drive-letter/backslash paths. node's rename
  // replaces an existing target on every platform (atomic on the same fs).
  await mkdir(storagePath, { recursive: true })
  const json = JSON.stringify(config, null, 2)
  await Bun.write(tmpPath, json)
  await rename(tmpPath, configPath) // same-filesystem rename: atomic overwrite
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
