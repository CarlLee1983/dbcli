/**
 * dbcli export command
 * Executes a SQL query and exports the results, supporting JSON/CSV formats and file output
 */

import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { QueryResultFormatter } from '@/formatters'
import { QueryExecutor } from '@/core/query-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'
import { promptUser } from '@/utils/prompts'
import { resolveConfigPath } from '@/utils/config-path'

/**
 * Export command action handler
 * Accepts a SQL query, executes it, formats the result, and outputs to stdout or a file
 */
export async function exportCommand(
  sql: string,
  options: {
    format: 'json' | 'csv'
    output?: string
    force?: boolean
    config?: string
  },
  command?: import('commander').Command
): Promise<void> {
  try {
    // 1. Argument validation
    if (!sql || sql.trim() === '') {
      throw new Error('SQL query required')
    }
    if (!options.format || !['json', 'csv'].includes(options.format)) {
      throw new Error('--format must be json or csv')
    }
    sql = sql.trim()

    // 2. Load configuration
    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    if (config.connection?.system === 'mongodb') {
      console.error('此命令目前不支援 MongoDB')
      process.exit(1)
    }

    // 3. Create database adapter
    const adapter = AdapterFactory.createAdapter(config.connection)
    await adapter.connect()

    try {
      // 4. Create QueryExecutor (enforces permission checks and auto-limit)
      const executor = new QueryExecutor(adapter, config.permission)

      // 5. Execute query with auto-limit enabled
      const result = await executor.execute(sql, {
        autoLimit: true
      })

      // 6. Format output
      const formatter = new QueryResultFormatter()
      const formatted = formatter.format(result, {
        format: options.format
      })

      // 7. Output to file or stdout
      if (options.output) {
        const file = Bun.file(options.output)
        const exists = await file.exists()

        if (exists && !options.force) {
          const confirmed = await promptUser.confirm(
            t_vars('export.overwrite_confirmation', { file: options.output })
          )
          if (!confirmed) {
            console.error('Operation cancelled by user')
            return
          }
        }

        await file.write(formatted)
        console.error(t_vars('export.exported', { count: result.rowCount, file: options.output }))
      } else {
        console.log(formatted)
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    if (error instanceof PermissionError) {
      console.error(t_vars('errors.permission_denied', { required: error.requiredPermission }))
      console.error(`   Operation: ${error.classification.type}`)
      console.error(`   Message: ${error.message}`)
      process.exit(1)
    }

    if (error instanceof ConnectionError) {
      console.error(t_vars('errors.connection_failed', { message: error.message }))
      process.exit(1)
    }

    // Other errors
    console.error(t_vars('errors.message', { message: (error as Error).message }))
    process.exit(1)
  }
}
