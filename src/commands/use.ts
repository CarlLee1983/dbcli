/**
 * dbcli use command — switch or list named connections (v2 config)
 */

import { Command } from 'commander'
import { readV2Config, writeV2Config } from '@/core/config-v2'
import type { DbcliConfigV2 } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { join } from 'path'

/**
 * Switch the default connection in v2 config
 */
export async function switchDefault(
  configPath: string,
  name: string
): Promise<void> {
  const config = await readV2Config(configPath)

  if (!config.connections[name]) {
    const available = Object.keys(config.connections).join(', ')
    throw new ConfigError(
      `連線 '${name}' 不存在。可用連線：${available}`
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
    throw new ConfigError('找不到設定檔。請先執行 dbcli init')
  }

  const raw = JSON.parse(await configFile.text())

  if (!raw.version || raw.version !== 2 || !raw.connections) {
    throw new ConfigError(
      '此功能需要新格式設定。請使用 dbcli init --conn-name <名稱> 建立多連線設定'
    )
  }

  return readV2Config(configPath)
}

export const useCommand = new Command('use')
  .description('Switch or display the default database connection (v2 config)')
  .argument('[name]', 'Connection name to switch to')
  .option('--list', 'List all connections')
  .action(async (name: string | undefined, options: any) => {
    try {
      const configPath = useCommand.parent?.opts().config ?? '.dbcli'

      if (options.list || !name) {
        const config = await ensureV2Config(configPath)
        const lines = listConnectionsForDisplay(config)

        if (!name) {
          console.log(`目前預設連線：${config.default}`)
        }

        if (options.list || !name) {
          console.log('')
          for (const line of lines) {
            console.log(line)
          }
        }
        return
      }

      // Switch default
      await ensureV2Config(configPath)
      await switchDefault(configPath, name)
      console.log(`已切換預設連線為 ${name}`)
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
      } else {
        console.error(String(error))
      }
      process.exit(1)
    }
  })
