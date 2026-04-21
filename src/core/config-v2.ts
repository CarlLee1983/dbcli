/**
 * V2 config format: multiple named connections
 *
 * Handles detection, reading, writing, and connection resolution for v2 configs.
 * V1 configs are NOT handled here — they continue using the original config.ts logic.
 */

import { DbcliConfigV2, DbcliConfigV2Schema } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { loadEnvFile } from '@/core/env-loader'
import { join } from 'path'

/**
 * Detect config version from raw parsed JSON
 */
export function detectConfigVersion(raw: unknown): 1 | 2 {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'version' in raw &&
    (raw as any).version === 2 &&
    'connections' in raw
  ) {
    return 2
  }
  return 1
}

/**
 * Resolved connection result — what commands receive
 * Supports both SQL and MongoDB connections
 */
export interface ResolvedConnection {
  name: string
  connection: {
    system: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb'
    host: string | { $env: string }
    port: number | { $env: string }
    user: string | { $env: string }
    password: string | { $env: string }
    database: string | { $env: string }
    uri?: string | { $env: string }
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
    const envPath = join(basePath, '..', resolved.envFile)
    await loadEnvFile(envPath)
  }
}

/**
 * Read and validate a v2 config from disk
 */
export async function readV2Config(path: string): Promise<DbcliConfigV2> {
  const configPath = join(path, 'config.json')
  const file = Bun.file(configPath)

  if (!(await file.exists())) {
    throw new ConfigError(`找不到 V2 設定檔：${configPath}`)
  }

  const content = await file.text()
  const raw = JSON.parse(content)

  return DbcliConfigV2Schema.parse(raw)
}

/**
 * Write a v2 config to disk
 */
export async function writeV2Config(path: string, config: DbcliConfigV2): Promise<void> {
  DbcliConfigV2Schema.parse(config)

  const configPath = join(path, 'config.json')
  const json = JSON.stringify(config, null, 2)
  await Bun.write(configPath, json)
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
  const v2Config = await readV2Config(dbcliPath)
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
  await writeV2Config(dbcliPath, updated)
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
  isDefault: boolean
}> {
  return Object.entries(config.connections).map(([name, conn]) => ({
    name,
    system: conn.system,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    isDefault: name === config.default,
  }))
}
