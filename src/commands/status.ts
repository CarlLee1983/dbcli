/**
 * dbcli status command
 * Displays non-sensitive information about the current configuration (permission, system, blacklist summary)
 * Designed for AI agents — does not expose connection credentials
 */

import { Command } from 'commander'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'

const ALLOWED_FORMATS = ['text', 'json'] as const

export const statusCommand = new Command('status')
  .description('Show current configuration status (safe for AI agents, no credentials exposed)')
  .option('--format <type>', 'Output format: text, json', 'json')
  .action(async (options) => {
    try {
      validateFormat(options.format, ALLOWED_FORMATS, 'status')

      const configPath = resolveConfigPath(statusCommand)
      const config = await configModule.read(configPath)

      if (!config.connection) {
        console.error('No configuration found. Run "dbcli init" first.')
        process.exit(1)
      }

      const blacklistTables = config.blacklist?.tables ?? []
      const blacklistColumns = config.blacklist?.columns ?? {}
      const columnCount = Object.values(blacklistColumns).reduce(
        (sum, cols) => sum + cols.length,
        0
      )

      // A SQLite connection's target is a path, and `status` says where a
      // connection points for every other engine by naming the system alone —
      // there is no host to omit here, so omitting the path would leave the
      // command unable to distinguish two SQLite connections. A path is not a
      // credential; this command still exposes none.
      const file = (config.connection as { file?: string }).file

      const status = {
        permission: config.permission,
        system: config.connection.system,
        ...(file !== undefined && { file }),
        blacklist: {
          tables: blacklistTables.length,
          columns: columnCount,
        },
        version: config.metadata?.version ?? 'unknown',
      }

      if (options.format === 'text') {
        console.log(`Permission: ${status.permission}`)
        console.log(`System:     ${status.system}`)
        if (file !== undefined) console.log(`File:       ${file}`)
        console.log(
          `Blacklist:  ${status.blacklist.tables} table(s), ${status.blacklist.columns} column(s)`
        )
        console.log(`Version:    ${status.version}`)
      } else {
        console.log(JSON.stringify(status, null, 2))
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`)
      process.exit(1)
    }
  })
