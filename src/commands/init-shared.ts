/**
 * Shared helpers for the init command family
 *
 * Extracted from init.ts so both the SQL/Redis/Elasticsearch path (init.ts)
 * and the MongoDB path (init-mongodb.ts) can use them without a circular
 * import between the two command files.
 */

import { join } from 'path'
import { t, t_vars } from '@/i18n/message-loader'
import { configModule } from '@/core/config'
import { readV2Config, writeV2Config, detectConfigVersion } from '@/core/config-v2'
import { promptUser } from '@/utils/prompts'
import type { ConnectionConfig } from '@/types'
import type { DbcliConfigV2 } from '@/utils/validation'
import {
  getProjectStoragePath,
  isGlobalConfigPath,
  migrateLegacyProjectEnvLocal,
  resolveConfigStoragePath,
  writeProjectBinding,
} from '@/core/config-binding'

/**
 * Check if .dbcli exists and handle overwrite confirmation
 * Shared by both env-ref and normal mode paths
 */
export async function checkOverwrite(
  configPath: string,
  shouldPrompt: boolean,
  force: boolean
): Promise<boolean> {
  const storagePath = await resolveConfigStoragePath(configPath)
  const fileExists = await Bun.file(configPath).exists()
  const dirConfigExists = await Bun.file(join(configPath, 'config.json')).exists()
  const storageConfigExists = await Bun.file(join(storagePath, 'config.json')).exists()

  if ((!fileExists && !dirConfigExists && !storageConfigExists) || force) return true

  if (shouldPrompt) {
    const overwrite = await promptUser.confirm(t('init.config_exists_overwrite'))
    if (!overwrite) {
      console.log(t('init.cancelled'))
      return false
    }
    return true
  }

  throw new Error(t('init.config_exists_use_force'))
}

export async function writeV2InitConfig(
  configPath: string,
  connectionName: string,
  connection: ConnectionConfig,
  permission: string,
  envFile?: string
): Promise<void> {
  const globalConfig = isGlobalConfigPath(configPath)
  const storagePath = globalConfig ? configPath : getProjectStoragePath(configPath)
  const configJsonPath = join(storagePath, 'config.json')
  const configFile = Bun.file(configJsonPath)
  const projectConfigFile = Bun.file(join(configPath, 'config.json'))
  let existingV2: DbcliConfigV2 | null = null

  // Check for existing v2 config, or migrate from V1
  // configFile is join(storagePath, 'config.json') — valid when storagePath is a directory
  if (await configFile.exists()) {
    const raw = JSON.parse(await configFile.text())
    if (detectConfigVersion(raw) === 2) {
      existingV2 = await readV2Config(storagePath)
    } else {
      // Directory-based V1 config — import it as 'default' connection
      const v1Config = await configModule.read(storagePath)
      existingV2 = {
        version: 2,
        default: 'default',
        connections: {
          default: {
            ...v1Config.connection,
            permission: v1Config.permission,
          },
        },
        schema: v1Config.schema || {},
        schemas: { default: v1Config.schema || {} },
        metadata: v1Config.metadata || { version: '1.0' },
        blacklist: v1Config.blacklist || { tables: [], columns: {} },
        audit: v1Config.audit,
      }
    }
  } else if (await projectConfigFile.exists()) {
    const raw = JSON.parse(await projectConfigFile.text())
    if (detectConfigVersion(raw) === 2) {
      const v1Config = await configModule.read(configPath)
      existingV2 = {
        version: 2,
        default: 'default',
        connections: {
          default: {
            ...v1Config.connection,
            permission: v1Config.permission,
          },
        },
        schema: v1Config.schema || {},
        schemas: { default: v1Config.schema || {} },
        metadata: v1Config.metadata || { version: '1.0' },
        blacklist: v1Config.blacklist || { tables: [], columns: {} },
        audit: v1Config.audit,
      }
    } else {
      // V1 config in the project directory — import it as 'default' connection
      const v1Config = await configModule.read(configPath)
      existingV2 = {
        version: 2,
        default: 'default',
        connections: {
          default: {
            ...v1Config.connection,
            permission: v1Config.permission,
          },
        },
        schema: v1Config.schema || {},
        schemas: { default: v1Config.schema || {} },
        metadata: v1Config.metadata || { version: '1.0' },
        blacklist: v1Config.blacklist || { tables: [], columns: {} },
        audit: v1Config.audit,
      }
    }
  } else {
    // Check if configPath itself is a legacy V1 file (e.g. a single .dbcli JSON file)
    const legacyFile = Bun.file(storagePath)
    if (await legacyFile.exists()) {
      const raw = JSON.parse(await legacyFile.text())
      if (detectConfigVersion(raw) !== 2) {
        // V1 single-file config — import it as 'default' connection
        const v1Config = await configModule.read(storagePath)
        existingV2 = {
          version: 2,
          default: 'default',
          connections: {
            default: {
              ...v1Config.connection,
              permission: v1Config.permission,
            },
          },
          schema: v1Config.schema || {},
          schemas: { default: v1Config.schema || {} },
          metadata: v1Config.metadata || { version: '1.0' },
          blacklist: v1Config.blacklist || { tables: [], columns: {} },
          audit: v1Config.audit,
        }
      }
    }
  }

  // Build connection entry. Typed loosely because the v2 connections map
  // is a union of per-engine shapes; spreading partial state then narrowing
  // at the call site keeps both branches compilable.

  const connEntry: any = {
    ...connection,
    permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin',
  }
  if (envFile) {
    connEntry.envFile = envFile
  }

  // Build v2 config
  const v2Config: DbcliConfigV2 = existingV2
    ? {
        ...existingV2,
        connections: {
          ...existingV2.connections,
          [connectionName]: connEntry,
        },
      }
    : {
        version: 2,
        default: connectionName,
        connections: {
          [connectionName]: connEntry,
        },
        schema: {},
        schemas: {},
        metadata: { version: '1.0', createdAt: new Date().toISOString() },
        blacklist: { tables: [], columns: {} },
        audit: {
          enabled: true,
          strict: false,
          rotation: { max_bytes: 10_485_760, max_entries: 1000 },
        },
      }

  await writeV2Config(storagePath, v2Config)
  if (!globalConfig) {
    await migrateLegacyProjectEnvLocal(configPath, storagePath)
    await writeProjectBinding(configPath, storagePath)
  }
  console.log(
    globalConfig
      ? t_vars('init.config_saved_global', { path: join(configPath, 'config.json') })
      : t('init.config_saved')
  )
}
