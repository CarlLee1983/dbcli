/**
 * dbcli export command
 * Executes a SQL query and exports the results, supporting JSON/CSV formats and file output.
 * For MongoDB connections, exports a collection scan or aggregation pipeline.
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
import { QueryExecutor } from '@/core/query-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'
import { promptUser } from '@/utils/prompts'
import { resolveConfigPath } from '@/utils/config-path'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { DEFAULT_QUERY_ONLY_LIMIT } from '@/core/limits'
import type { DbcliConfig } from '@/utils/validation'

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}

const SQL_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|SHOW|DESCRIBE)\b/i

export type ExportFormat = 'json' | 'jsonl' | 'csv' | 'html'

interface ExportOptions {
  format: ExportFormat
  output?: string
  force?: boolean
  config?: string
  collection?: string
  limit?: number
  noLimit?: boolean
  recovery?: boolean
}

/**
 * Export command action handler
 * Accepts a SQL query (or JSON filter / aggregation pipeline for MongoDB),
 * executes it, formats the result, and outputs to stdout or a file.
 */
export async function exportCommand(
  sql: string,
  options: ExportOptions,
  command?: import('commander').Command
): Promise<void> {
  try {
    if (!sql || sql.trim() === '') {
      throw new Error('Query required')
    }
    if (!options.format || !['json', 'jsonl', 'csv', 'html'].includes(options.format)) {
      throw new Error('--format must be json, jsonl, csv, or html')
    }
    sql = sql.trim()

    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    if (config.connection.system === 'redis') {
      await redisExportBranch(sql, options, config as DbcliConfig)
      return
    }

    if (config.connection.system === 'elasticsearch') {
      throw new Error(
        'Elasticsearch 不支援 export 指令；目前請改用 query --index <index> 並重新導向輸出，或使用外部工具（如 elasticdump）'
      )
    }

    if (config.connection.system === 'mongodb') {
      await mongoExportBranch(sql, options, config as DbcliConfig)
      return
    }

    if (options.format === 'jsonl') {
      throw new Error('--format jsonl is only supported on MongoDB connections')
    }

    const adapter = AdapterFactory.createSqlAdapter(
      requireSqlConnection(config.connection as ConnectionOptions)
    )
    await adapter.connect()

    try {
      const executor = new QueryExecutor(adapter, config.permission)
      const result = await executor.execute(sql, { autoLimit: true })

      let formatted: string
      if (options.format === 'html') {
        formatted = await generateHtmlReport({
          meta: {
            name: 'Exported Report',
            key: 'export',
            params: [],
            tags: [],
            description: sql,
          },
          rows: result.rows as Record<string, unknown>[],
        })
      } else {
        const formatter = new QueryResultFormatter()
        formatted = formatter.format(result, {
          format: options.format as 'json' | 'csv',
        })
      }

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
    if (options.recovery === true) {
      const { emitRecoveryEnvelope } = await import('@/core/recovery')
      const m = sql.match(/\bFROM\s+[`"']?(\w+)[`"']?/i)
      emitRecoveryEnvelope(error, {
        operation: 'export',
        table: m?.[1],
      })
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

    if (error instanceof BlacklistError) {
      console.error(error.message)
      process.exit(1)
    }

    console.error(t_vars('errors.message', { message: (error as Error).message }))
    process.exit(1)
  }
}

async function redisExportBranch(
  command: string,
  options: ExportOptions,
  config: DbcliConfig
): Promise<void> {
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
    const formatted = formatter.format(
      queryResult as unknown as import('@/types/query').QueryResult<Record<string, unknown>>,
      { format: options.format as 'json' | 'csv' }
    )

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
      console.error(
        t_vars('export.exported', {
          count: result.rowCount ?? result.rows.length ?? 0,
          file: options.output,
        })
      )
    } else {
      console.log(formatted)
    }
  } finally {
    await redisAdapter.disconnect()
  }
}

async function mongoExportBranch(
  query: string,
  options: ExportOptions,
  config: DbcliConfig
): Promise<void> {
  if (SQL_PATTERN.test(query)) {
    console.error('這是 MongoDB 連線，請使用 JSON filter 或 aggregation pipeline。')
    console.error(`範例：dbcli export '{"status":"open"}' --collection orders --format jsonl`)
    process.exit(1)
  }

  if (!options.collection) {
    console.error('MongoDB export 需要指定 --collection <name>')
    process.exit(1)
  }

  try {
    JSON.parse(query)
  } catch {
    console.error('MongoDB 查詢必須是有效的 JSON（object filter 或 array pipeline）')
    process.exit(1)
  }

  const collection = options.collection

  const blacklistManager = new BlacklistManager(config)
  const blacklistValidator = new BlacklistValidator(blacklistManager)
  blacklistValidator.checkTableBlacklist('SELECT', collection, [])

  let effectiveLimit: number | undefined
  if (options.noLimit) {
    effectiveLimit = undefined
  } else if (typeof options.limit === 'number') {
    effectiveLimit = options.limit
  } else if (config.permission === 'query-only') {
    effectiveLimit = DEFAULT_QUERY_ONLY_LIMIT
    console.error(`Query-only mode: auto-limiting to ${effectiveLimit} rows`)
  }

  const adapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
  await adapter.connect()
  try {
    const result = await adapter.execute<Record<string, unknown>>(
      query,
      [collection],
      effectiveLimit !== undefined ? { limit: effectiveLimit } : undefined
    )

    const columnNames = collectColumnUnion(result.rows)
    const filterResult = blacklistValidator.filterColumns(collection, result.rows, columnNames)
    const visibleColumns = columnNames.filter((col) => !filterResult.omittedColumns.includes(col))

    const formatted = formatMongoRows(filterResult.filteredRows, visibleColumns, options.format)

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
      console.error(
        t_vars('export.exported', {
          count: filterResult.filteredRows.length,
          file: options.output,
        })
      )
    } else {
      console.log(formatted)
    }

    const securityNote = blacklistValidator.buildSecurityNotification(
      collection,
      filterResult.omittedColumns
    )
    if (securityNote) {
      console.error(`ℹ ${securityNote}`)
    }
  } finally {
    await adapter.disconnect()
  }
}

function collectColumnUnion(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        order.push(key)
      }
    }
  }
  return order
}

function formatMongoRows(
  rows: Record<string, unknown>[],
  columns: string[],
  format: ExportFormat
): string {
  if (format === 'jsonl') {
    return rows.map((row) => JSON.stringify(row)).join('\n')
  }

  if (format === 'json') {
    return JSON.stringify(rows, null, 2)
  }

  let nestedSeen = false
  const headerLine = columns.map(escapeCsvField).join(',')
  const dataLines = rows.map((row) => {
    return columns
      .map((col) => {
        const value = row[col]
        if (value !== null && typeof value === 'object') {
          nestedSeen = true
          return escapeCsvField(JSON.stringify(value))
        }
        return escapeCsvField(value)
      })
      .join(',')
  })

  if (nestedSeen) {
    console.error(
      'Warning: nested object/array fields were JSON-stringified for CSV. Use --format jsonl to preserve structure.'
    )
  }

  return [headerLine, ...dataLines].join('\n')
}

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}
