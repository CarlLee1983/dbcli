/**
 * dbcli use command — switch or list named connections (v2 config)
 */

import { Command } from 'commander'
import { readV2Config, writeV2Config } from '@/core/config-v2'
import { configModule } from '@/core/config'
import type { DbcliConfigV2 } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { resolveConfigPath } from '@/utils/config-path'
import { join } from 'path'
import { t, t_vars } from '@/i18n/message-loader'
import { resolveConfigStoragePath } from '@/core/config-binding'

/**
 * Switch the default connection in v2 config.
 * Accepts an already-loaded config to avoid a redundant read.
 */
export async function switchDefault(
  configPath: string,
  name: string,
  config: DbcliConfigV2
): Promise<void> {
  if (!config.connections[name]) {
    const available = Object.keys(config.connections).join(', ')
    throw new ConfigError(
      `${t_vars('init.connection_not_found', { name })}. ${t('use.available')}: ${available}`
    )
  }

  const updated: DbcliConfigV2 = {
    ...config,
    default: name,
  }

  await writeV2Config(configPath, updated)
}

/**
 * Format connections for display
 */
export function listConnectionsForDisplay(config: DbcliConfigV2): string[] {
  return Object.entries(config.connections).map(([name, conn]) => {
    const marker = name === config.default ? '*' : ' '
    const host = typeof conn.host === 'object' ? `\${${conn.host.$env}}` : conn.host
    const port = typeof conn.port === 'object' ? `\${${conn.port.$env}}` : conn.port
    const db = typeof conn.database === 'object' ? `\${${conn.database.$env}}` : conn.database

    return `${marker} ${name.padEnd(12)} ${conn.system.padEnd(12)} ${host}:${port}/${db}`
  })
}

/**
 * Check if config is v2 format, throw helpful error if not.
 * Supports V1 config by returning a virtual V2 config for display purposes.
 */
async function ensureV2Config(configPath: string): Promise<DbcliConfigV2> {
  const storagePath = await resolveConfigStoragePath(configPath)
  const configFile = Bun.file(join(storagePath, 'config.json'))

  // Handle case where config might be a legacy single-file .dbcli (not a directory)
  const legacyFile = Bun.file(configPath)

  if (!(await configFile.exists()) && !(await legacyFile.exists())) {
    throw new ConfigError(t('init.config_not_found'))
  }

  try {
    const raw = await (async () => {
      if (await configFile.exists()) return JSON.parse(await configFile.text())
      return JSON.parse(await legacyFile.text())
    })()

    if (!raw.version || raw.version !== 2 || !raw.connections) {
      // It's a V1 config. Return a virtual V2 representation.
      const v1Config = await configModule.read(configPath)
      return {
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
      } as DbcliConfigV2
    }

    return readV2Config(storagePath)
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError(t('use.requires_v2'))
  }
}

export const useCommand = new Command('use')
  .description('Switch or display the default database connection (v2 config)')
  .argument('[name]', 'Connection name to switch to')
  .option('--list', 'List all connections')
  .action(async (name: string | undefined, options: any) => {
    try {
      const configPath = resolveConfigPath(useCommand)
      const config = await ensureV2Config(configPath)

      if (options.list || !name) {
        if (!name) {
          console.log(t_vars('use.current', { name: config.default }))
        }

        console.log('')
        for (const line of listConnectionsForDisplay(config)) {
          console.log(line)
        }
        return
      }

      // Switch default
      await switchDefault(configPath, name, config)
      console.log(t_vars('use.switched', { name }))
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
      } else {
        console.error(String(error))
      }
      process.exit(1)
    }
  })
