/**
 * dbcli query command
 * Executes a SQL query and returns results, supporting multiple output formats
 */

import { t_vars } from '@/i18n/message-loader'
import {
  AdapterFactory,
  ConnectionError,
  type ConnectionOptions,
  type SqlConnectionOptions,
} from '@/adapters'
import { QueryResultFormatter } from '@/formatters'
import { generateHtmlReport } from '@/formatters/html-formatter'
import { openInBrowser } from '@/utils/opener'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}

const ALLOWED_FORMATS = ['table', 'json', 'csv'] as const

/**
 * Query command action handler
 * Accepts a SQL query, executes it, and formats the output
 */
export async function queryCommand(
  sql: string,
  options: {
    format?: 'table' | 'json' | 'csv' | 'html'
    ui?: boolean
    limit?: number
    noLimit?: boolean
    collection?: string
    index?: string
    config?: string
    recovery?: boolean
  },
  command?: import('commander').Command
): Promise<void> {
  try {
    // 1. Argument validation
    if (!sql || sql.trim() === '') {
      throw new Error('SQL query required')
    }

    if (options.format) {
      validateFormat(options.format, [...ALLOWED_FORMATS, 'html'] as any, 'query')
    }
    sql = sql.trim()

    // 2. Load configuration
    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    // 2c. MongoDB: route to QueryableAdapter path
    // NOTE: `return await` is intentional — bare `return promise` would resolve
    // the wrapper before the inner promise settles, so any rejection would
    // bypass this try/catch and skip the recovery envelope handler below.
    if (config.connection.system === 'mongodb') {
      return await mongoQueryBranch(sql, options, config)
    }

    // 2d. Redis: route to QueryableAdapter path
    if (config.connection.system === 'redis') {
      return await redisQueryBranch(sql, options, config)
    }

    // 2e. Elasticsearch: route to QueryableAdapter path
    if (config.connection.system === 'elasticsearch') {
      return await elasticsearchQueryBranch(sql, options, config)
    }

    // 2b. Size guard: block full-table SELECT on huge tables
    const mainTable = extractMainTable(sql)
    if (mainTable && config.schema && !options.noLimit) {
      const tableSchema = (config.schema as Record<string, unknown>)[mainTable]
      if (tableSchema) {
        const { shouldBlockQuery } = await import('./query-size-guard')
        const guard = shouldBlockQuery(sql, tableSchema as { estimatedRowCount: number })
        if (guard.blocked) {
          // Throw so the outer catch can route this through --recovery /
          // human stderr / formatter consistently. Do not call process.exit
          // directly \u2014 it bypasses the recovery envelope.
          throw new Error(`\u26A0 ${guard.reason}`)
        }
      }
    }

    // 3. Create database adapter
    const adapter = AdapterFactory.createSqlAdapter(
      requireSqlConnection(config.connection as ConnectionOptions)
    )
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
      if (options.ui || options.format === 'html') {
        const html = await generateHtmlReport({
          meta: {
            name: 'Query Results',
            key: 'raw-sql',
            params: [],
            tags: [],
            description: sql.length > 100 ? sql.slice(0, 97) + '...' : sql,
          },
          rows: result.rows as Record<string, unknown>[],
        })

        if (options.ui) {
          const tempPath = join(tmpdir(), `dbcli-query-${Date.now()}.html`)
          await Bun.write(tempPath, html)
          await openInBrowser(tempPath)
        } else {
          console.log(html)
        }
        return
      }

      const formatter = new QueryResultFormatter()
      const output = formatter.format(result, {
        format: (options.format as any) || 'table',
      })

      // 7. Print results
      console.log(output)
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    if (options.recovery === true) {
      const { emitRecoveryEnvelope } = await import('@/core/recovery')
      emitRecoveryEnvelope(error, {
        operation: 'query',
        table: extractMainTable(sql) ?? undefined,
      })
    }

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
    format?: 'table' | 'json' | 'csv' | 'html'
    limit?: number
    noLimit?: boolean
    collection?: string
  },
  config: DbcliConfig
): Promise<void> {
  const collection = options.collection
  const format = options.format ?? 'table'

  if (SQL_PATTERN.test(queryStr)) {
    throw new Error(
      `這是 MongoDB 連線，請使用 JSON filter 語法。\n範例：dbcli query '{"field": "value"}' --collection <name>`
    )
  }

  if (!collection) {
    throw new Error('MongoDB 查詢需要指定 --collection <name>')
  }

  try {
    JSON.parse(queryStr)
  } catch {
    throw new Error('MongoDB 查詢必須是有效的 JSON（object filter 或 array pipeline）')
  }

  // Blacklist validation — propagate so the outer catch (recovery / human
  // stderr) handles it once, instead of double-handling here.
  const blacklistManager = new BlacklistManager(config)
  const blacklistValidator = new BlacklistValidator(blacklistManager)
  blacklistValidator.checkTableBlacklist('SELECT', collection, [])

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
        throw new Error(`\u26A0 ${guard.reason}`)
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
      format,
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
    format?: 'table' | 'json' | 'csv' | 'html'
    limit?: number
    noLimit?: boolean
    recovery?: boolean
  },
  config: DbcliConfig
): Promise<void> {
  const format = options.format ?? 'table'

  const { enforceRedisPermission } = await import('@/core/permission-guard')
  const head = command.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
  // Skip the human KEYS warning under --recovery so the recovery envelope
  // remains the sole source of truth on stdout and stderr stays clean for
  // agent consumption.
  if (head === 'KEYS' && options.recovery !== true) {
    console.error(
      '\u26A0 Warning: "KEYS" command is dangerous on production servers as it blocks the main thread.'
    )
    console.error('  Please use "SCAN" instead for better performance and safety.')
    console.error('  For more info: https://redis.io/commands/keys/')
  }
  // Let PermissionError propagate to the outer catch so --recovery and the
  // human stderr formatter both see it.
  enforceRedisPermission(command, config.permission)

  const redisAdapter = AdapterFactory.createRedisAdapter(config.connection as ConnectionOptions)
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

async function elasticsearchQueryBranch(
  queryStr: string,
  options: {
    format?: 'table' | 'json' | 'csv' | 'html'
    limit?: number
    noLimit?: boolean
    collection?: string
    index?: string
  },
  config: DbcliConfig
): Promise<void> {
  const indexName = options.index ?? options.collection
  const format = options.format ?? 'table'

  if (!indexName) {
    throw new Error('Elasticsearch 查詢需要指定 --collection <index> 或 --index <index>')
  }

  const { enforceElasticsearchPermission } = await import('@/core/permission-guard')
  // Propagate PermissionError to outer catch for unified --recovery / stderr handling.
  enforceElasticsearchPermission(
    {
      method: 'POST',
      apiPath: `/${indexName}/_search`,
      body: queryStr.trim().startsWith('{') ? queryStr : undefined,
    },
    config.permission
  )

  let effectiveLimit: number
  if (options.noLimit) {
    effectiveLimit = 10000
    console.error(
      'Elasticsearch --no-limit is capped at size 10000; for more rows use saved-query with search_after.'
    )
  } else if (typeof options.limit === 'number') {
    effectiveLimit = options.limit
  } else {
    effectiveLimit = DEFAULT_QUERY_ONLY_LIMIT
    if (config.permission === 'query-only') {
      console.error(`Query-only mode: auto-limiting to ${effectiveLimit} rows`)
    }
  }

  const blacklistManager = new BlacklistManager(config)
  const blacklistValidator = new BlacklistValidator(blacklistManager)
  // Propagate BlacklistError to outer catch.
  blacklistValidator.checkTableBlacklist('SELECT', indexName, [])

  const esAdapter = AdapterFactory.createElasticsearchAdapter(
    config.connection as ConnectionOptions
  )
  await esAdapter.connect()
  try {
    const result = await esAdapter.execute<Record<string, unknown>>(queryStr, [indexName], {
      limit: effectiveLimit,
    })
    const columnNames = result.rows[0] ? Object.keys(result.rows[0]) : []
    const filterResult = blacklistValidator.filterColumns(indexName, result.rows, columnNames)
    const queryResult = {
      rows: filterResult.filteredRows,
      rowCount: filterResult.filteredRows.length,
      columnNames: columnNames.filter((col) => !filterResult.omittedColumns.includes(col)),
    }
    const formatter = new QueryResultFormatter()
    const output = formatter.format(queryResult as QueryResult<Record<string, unknown>>, {
      format,
    })
    const securityNote = blacklistValidator.buildSecurityNotification(
      indexName,
      filterResult.omittedColumns
    )

    console.log(output)
    if (securityNote) console.log(`\nℹ ${securityNote}`)
  } finally {
    await esAdapter.disconnect()
  }
}
