/**
 * dbcli query command
 * Executes a SQL query and returns results, supporting multiple output formats
 */

import { t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { QueryResultFormatter } from '@/formatters'
import type { QueryResult } from '@/types/query'
import { QueryExecutor } from '@/core/query-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat, type DbcliConfig } from '@/utils/validation'
import { DEFAULT_QUERY_ONLY_LIMIT } from '@/core/limits'

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
    config?: string
  },
  command?: import('commander').Command
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
    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    // 2c. MongoDB: route to QueryableAdapter path
    if (config.connection.system === 'mongodb') {
      return mongoQueryBranch(sql, options, config)
    }

    // 2d. Redis: route to QueryableAdapter path
    if (config.connection.system === 'redis') {
      return redisQueryBranch(sql, options, config)
    }

    // 2b. Size guard: block full-table SELECT on huge tables
    const mainTable = extractMainTable(sql)
    if (mainTable && config.schema && !options.noLimit) {
      const tableSchema = (config.schema as Record<string, unknown>)[mainTable]
      if (tableSchema) {
        const { shouldBlockQuery } = await import('./query-size-guard')
        const guard = shouldBlockQuery(sql, tableSchema as { estimatedRowCount: number })
        if (guard.blocked) {
          console.error(`\u26A0 ${guard.reason}`)
          process.exit(1)
        }
      }
    }

    // 3. Create database adapter
    const adapter = AdapterFactory.createAdapter(config.connection as ConnectionOptions)
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
        limitValue: options.limit,
      })

      // 6. Format output
      const formatter = new QueryResultFormatter()
      const output = formatter.format(result, {
        format: options.format || 'table',
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
  return match?.[1] ?? null
}

const SQL_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|SHOW|DESCRIBE)\b/i

async function mongoQueryBranch(
  queryStr: string,
  options: {
    format?: 'table' | 'json' | 'csv'
    limit?: number
    noLimit?: boolean
    collection?: string
  },
  config: DbcliConfig
): Promise<void> {
  const collection = options.collection
  const format = options.format ?? 'table'

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

  // Blacklist validation
  const blacklistManager = new BlacklistManager(config)
  const blacklistValidator = new BlacklistValidator(blacklistManager)

  try {
    blacklistValidator.checkTableBlacklist('SELECT', collection, [])
  } catch (error) {
    if (error instanceof BlacklistError) {
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }

  // Size guard: block unfiltered queries on huge collections
  if (config.schema && !options.noLimit) {
    const tableSchema = (config.schema as Record<string, unknown>)[collection]
    if (tableSchema) {
      const { shouldBlockQuery } = await import('./query-size-guard')
      const isFiltered = queryStr.length > 2
      const hasLimit = options.limit !== undefined
      const dummySql = `SELECT * FROM ${collection}${isFiltered ? ' WHERE' : ''}${hasLimit ? ' LIMIT' : ''}`

      const guard = shouldBlockQuery(dummySql, tableSchema as { estimatedRowCount: number })
      if (guard.blocked) {
        console.error(`\u26A0 ${guard.reason}`)
        process.exit(1)
      }
    }
  }

  // Resolve effective result-cardinality cap.
  // Priority: explicit --no-limit > explicit --limit > query-only auto-limit > none
  let effectiveLimit: number | undefined
  if (options.noLimit) {
    effectiveLimit = undefined
  } else if (typeof options.limit === 'number') {
    effectiveLimit = options.limit
  } else if (config.permission === 'query-only') {
    effectiveLimit = DEFAULT_QUERY_ONLY_LIMIT
    console.error(`Query-only mode: auto-limiting to ${effectiveLimit} rows`)
  }

  const mongoAdapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
  await mongoAdapter.connect()
  try {
    const result = await mongoAdapter.execute<Record<string, unknown>>(
      queryStr,
      [collection],
      effectiveLimit !== undefined ? { limit: effectiveLimit } : undefined
    )

    // Redact blacklisted columns using validator
    const columnNames = result.rows[0] ? Object.keys(result.rows[0]) : []
    const filterResult = blacklistValidator.filterColumns(collection, result.rows, columnNames)

    const queryResult = {
      rows: filterResult.filteredRows,
      rowCount: filterResult.filteredRows.length,
      columnNames: columnNames.filter((col) => !filterResult.omittedColumns.includes(col)),
    }

    const formatter = new QueryResultFormatter()
    const output = formatter.format(queryResult as QueryResult<Record<string, unknown>>, {
      format: format as 'table' | 'json' | 'csv',
    })

    // Add security notification if columns were omitted
    const securityNote = blacklistValidator.buildSecurityNotification(
      collection,
      filterResult.omittedColumns
    )

    console.log(output)
    if (securityNote) {
      console.log(`\n\u2139 ${securityNote}`)
    }
  } finally {
    await mongoAdapter.disconnect()
  }
}

async function redisQueryBranch(
  command: string,
  options: {
    format?: 'table' | 'json' | 'csv'
    limit?: number
    noLimit?: boolean
  },
  config: DbcliConfig
): Promise<void> {
  const format = options.format ?? 'table'

  const { enforceRedisPermission } = await import('@/core/permission-guard')
  try {
    enforceRedisPermission(command, config.permission)
  } catch (error) {
    if (error instanceof PermissionError) {
      console.error(t_vars('errors.permission_denied', { required: error.requiredPermission }))
      console.error(`   Operation: ${error.classification.type}`)
      console.error(`   Message: ${error.message}`)
      process.exit(1)
    }
    throw error
  }

  const redisAdapter = AdapterFactory.createRedisAdapter(
    config.connection as ConnectionOptions
  )
  await redisAdapter.connect()
  try {
    const result = await redisAdapter.execute<Record<string, unknown>>(command)

    const columnNames = result.rows[0] ? Object.keys(result.rows[0]) : ['value']
    const queryResult = {
      rows: result.rows,
      rowCount: result.rows.length,
      columnNames,
    }
    const formatter = new QueryResultFormatter()
    const output = formatter.format(queryResult as QueryResult<Record<string, unknown>>, {
      format,
    })
    console.log(output)
  } finally {
    await redisAdapter.disconnect()
  }
}
