/**
 * dbcli use command — switch or list named connections (v2 config)
 */

import { Command } from 'commander'
import { readV2Config, writeV2Config } from '@/core/config-v2'
import type { DbcliConfigV2 } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { resolveConfigPath } from '@/utils/config-path'
import { join } from 'path'
import { t, t_vars } from '@/i18n/message-loader'

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
    default: name
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
 * Check if config is v2 format, throw helpful error if not
 */
async function ensureV2Config(configPath: string): Promise<DbcliConfigV2> {
  const configFile = Bun.file(join(configPath, 'config.json'))
  if (!(await configFile.exists())) {
    throw new ConfigError(t('init.config_not_found'))
  }

  const raw = JSON.parse(await configFile.text())

  if (!raw.version || raw.version !== 2 || !raw.connections) {
    throw new ConfigError(t('use.requires_v2'))
  }

  return readV2Config(configPath)
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
