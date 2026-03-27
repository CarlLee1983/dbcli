/**
 * dbcli query command
 * Executes a SQL query and returns results, supporting multiple output formats
 */

import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { QueryResultFormatter } from '@/formatters'
import { QueryExecutor } from '@/core/query-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'

/**
 * Query command action handler
 * Accepts a SQL query, executes it, and formats the output
 */
export async function queryCommand(
  sql: string,
  options: {
    format?: 'table' | 'json' | 'csv'
    limit?: number
    noLimit?: boolean
  }
): Promise<void> {
  try {
    // 1. Argument validation
    if (!sql || sql.trim() === '') {
      throw new Error('SQL query required')
    }
    sql = sql.trim()

    // 2. Load configuration
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    // 2b. Size guard: block full-table SELECT on huge tables
    const mainTable = extractMainTable(sql)
    if (mainTable && config.schema && !options.noLimit) {
      const tableSchema = (config.schema as Record<string, any>)[mainTable]
      if (tableSchema) {
        const { shouldBlockQuery } = await import('./query-size-guard')
        const guard = shouldBlockQuery(sql, tableSchema)
        if (guard.blocked) {
          console.error(`\u26A0 ${guard.reason}`)
          process.exit(1)
        }
      }
    }

    // 3. Create database adapter
    const adapter = AdapterFactory.createAdapter(config.connection)
    await adapter.connect()

    try {
      // 3b. Construct blacklist validator (manager handles undefined config.blacklist gracefully)
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)

      // 4. Create QueryExecutor
      const executor = new QueryExecutor(adapter, config.permission, blacklistValidator)

      // 5. Execute query
      const autoLimit = !options.noLimit
      const result = await executor.execute(sql, {
        autoLimit,
        limitValue: options.limit
      })

      // 6. Format output
      const formatter = new QueryResultFormatter()
      const output = formatter.format(result, {
        format: options.format || 'table'
      })

      // 7. Print results
      console.log(output)
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    if (error instanceof BlacklistError) {
      console.error(error.message)
      process.exit(1)
    }

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

    // Other errors (missing table, syntax, etc.)
    console.error(t_vars('errors.message', { message: (error as Error).message }))
    process.exit(1)
  }
}

function extractMainTable(sql: string): string | null {
  const match = sql.match(/\bFROM\s+[`"']?(\w+)[`"']?/i)
  return match ? match[1] : null
}
