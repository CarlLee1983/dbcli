/**
 * dbcli query command
 * Executes a SQL query and returns results, supporting multiple output formats
 */

import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { QueryResultFormatter } from '@/formatters'
import { QueryExecutor } from '@/core/query-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { validateFormat } from '@/utils/validation'

const ALLOWED_FORMATS = ['table', 'json', 'csv'] as const

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
    collection?: string
  }
): Promise<void> {
  try {
    // 1. Argument validation
    if (!sql || sql.trim() === '') {
      throw new Error('SQL query required')
    }

    if (options.format) {
      validateFormat(options.format, ALLOWED_FORMATS, 'query')
    }
    sql = sql.trim()

    // 2. Load configuration
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    // 2c. MongoDB: route to QueryableAdapter path
    if (config.connection.system === 'mongodb') {
      return mongoQueryBranch(sql, options.collection, config, options.format ?? 'table')
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

const SQL_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|SHOW|DESCRIBE)\b/i

async function mongoQueryBranch(
  queryStr: string,
  collection: string | undefined,
  config: any,
  format: string
): Promise<void> {
  if (SQL_PATTERN.test(queryStr)) {
    console.error('這是 MongoDB 連線，請使用 JSON filter 語法。')
    console.error(`範例：dbcli query '{"field": "value"}' --collection <name>`)
    process.exit(1)
  }

  if (!collection) {
    console.error('MongoDB 查詢需要指定 --collection <name>')
    process.exit(1)
  }

  try {
    JSON.parse(queryStr)
  } catch {
    console.error('MongoDB 查詢必須是有效的 JSON（object filter 或 array pipeline）')
    process.exit(1)
  }

  const mongoAdapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
  await mongoAdapter.connect()
  try {
    const result = await mongoAdapter.execute<Record<string, unknown>>(queryStr, [collection])
    const formatter = new QueryResultFormatter()
    const output = formatter.format(result as any, { format: format as any })
    console.log(output)
  } finally {
    await mongoAdapter.disconnect()
  }
}
