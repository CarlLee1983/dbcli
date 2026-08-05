/**
 * dbcli export command
 * Executes a SQL query and exports the results, supporting JSON/CSV formats and file output.
 * For MongoDB connections, exports a collection scan or aggregation pipeline.
 */

import crypto from 'node:crypto'
import { t_vars } from '@/i18n/message-loader'
import { AdapterFactory, type ConnectionOptions, type SqlConnectionOptions } from '@/adapters'
import { QueryResultFormatter } from '@/formatters'
import { generateHtmlReport } from '@/formatters/html-formatter'
import { QueryExecutor } from '@/core/query-executor'
import { configModule } from '@/core/config'
import { promptUser } from '@/utils/prompts'
import { resolveConfigPath } from '@/utils/config-path'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { DEFAULT_QUERY_ONLY_LIMIT } from '@/core/limits'
import { trimAppliedLimit } from '@/core/applied-limit'
import type { AppliedLimitMetadata } from '@/types/query'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import { extractTableName } from '@/utils/engine-hints'
import { maskMongoRows } from '@/core/mongo/field-masker'
import { scrollAll } from '@/adapters/elasticsearch/scroll-reader'
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
  // Open for audit-helper consumption (dryRun/plan/...).
  [key: string]: unknown
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
  let config: DbcliConfig | undefined
  try {
    if (!sql || sql.trim() === '') {
      throw new Error('Query required')
    }
    if (!options.format || !['json', 'jsonl', 'csv', 'html'].includes(options.format)) {
      throw new Error('--format must be json, jsonl, csv, or html')
    }
    sql = sql.trim()

    const configPath = resolveConfigPath(command, options)
    config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    if (config.connection.system === 'redis') {
      await redisExportBranch(sql, options, config as DbcliConfig)
      return
    }

    if (config.connection.system === 'elasticsearch') {
      await esExportBranch(sql, options, config as DbcliConfig)
      return
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

    const executor = new QueryExecutor(adapter, config.permission, undefined, undefined, {
      recovery: options.recovery,
      deferDiagnostics: true,
    })
    let formatted: string
    let rowCount: number
    try {
      const result = await executor.execute(sql, {
        autoLimit: options.noLimit !== true,
        ...(typeof options.limit === 'number' ? { limitValue: options.limit } : {}),
        detectTruncation: true,
      })
      assertExportNotSilentlyTruncated(result.appliedLimit, options)
      rowCount = result.rowCount

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
          ...(result.appliedLimit ? { appliedLimit: result.appliedLimit } : {}),
          ...(result.metadata?.securityNotification
            ? { securityNotification: result.metadata.securityNotification }
            : {}),
        })
      } else {
        const formatter = new QueryResultFormatter()
        formatted = formatter.format(result, {
          format: options.format as 'json' | 'csv',
        })
      }

      await writeAuditEntry(config, 'export', options, {
        success: true,
        target: extractTableName(sql) ?? '*',
        sql,
        metadata: {
          rows_affected: result.rowCount,
          output_format: options.format,
          ...(options.output && { output_file: options.output }),
        },
      })
    } finally {
      await adapter.disconnect()
    }
    const emitted = await emitExportOutput(formatted, rowCount, options)
    if (emitted && options.recovery !== true) {
      for (const diagnostic of executor.takeDiagnostics()) console.error(diagnostic)
    }
  } catch (error) {
    let auditId: string | null = null
    let envelopeId: string | undefined
    if (options.recovery === true) {
      envelopeId = crypto.randomUUID()
    }
    const m = sql.match(/\bFROM\s+[`"']?(\w+)[`"']?/i)
    if (config) {
      auditId = await writeAuditEntry(config, 'export', options, {
        success: false,
        target: m?.[1] ?? '*',
        sql,
        error,
        ...(envelopeId && { recovery_ref: envelopeId }),
      })
    }

    if (envelopeId !== undefined) {
      const { emitRecoveryEnvelope } = await import('@/core/recovery')
      emitRecoveryEnvelope(
        error,
        { operation: 'export', table: m?.[1] },
        { envelopeId, auditRef: auditId ?? undefined }
      )
    }

    throw error
  }
}

async function redisExportBranch(
  command: string,
  options: ExportOptions,
  config: DbcliConfig
): Promise<void> {
  const { enforceRedisPermission } = await import('@/core/permission-guard')
  enforceRedisPermission(command, config.permission)

  const redisAdapter = AdapterFactory.createRedisAdapter(
    config.connection as ConnectionOptions,
    config.blacklist?.tables ?? [],
    (config as { redis?: { mask?: import('@/types/blacklist').RedisMaskRule[] } }).redis?.mask ?? []
  )
  await redisAdapter.connect()
  let formatted: string
  let rowCount: number
  try {
    const result = await redisAdapter.execute<Record<string, unknown>>(command)

    const columnNames = result.rows[0] ? Object.keys(result.rows[0]) : ['value']
    const queryResult = {
      rows: result.rows,
      rowCount: result.rows.length,
      columnNames,
    }

    const formatter = new QueryResultFormatter()
    formatted = formatter.format(
      queryResult as unknown as import('@/types/query').QueryResult<Record<string, unknown>>,
      { format: options.format as 'json' | 'csv' }
    )
    rowCount = result.rowCount ?? result.rows.length ?? 0

    const target = command.trim().split(/\s+/)[1] || '<unknown-key>'
    await writeAuditEntry(config, 'export', options, {
      success: true,
      target,
      metadata: {
        rows_affected: rowCount,
        output_format: options.format,
        ...(options.output && { output_file: options.output }),
      },
    })
  } finally {
    await redisAdapter.disconnect()
  }
  await emitExportOutput(formatted, rowCount, options)
}

const ES_EXPORT_CAP = 1000

interface EsExportAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  request<T>(method: string, path: string, body?: unknown): Promise<T>
  execute<T>(
    query: string,
    params?: unknown[],
    options?: { limit?: number }
  ): Promise<{ rows: T[]; rowCount: number; columnNames: string[] }>
}

/**
 * An export that hit a cap dbcli chose for the caller writes an incomplete file
 * with nowhere to record that fact — jsonl and mongo json are bare shapes, and a
 * stderr line does not survive redirection. Fail closed instead and make the
 * caller state the intent. An explicit --limit or --no-limit is that statement.
 */
function assertExportNotSilentlyTruncated(
  appliedLimit: AppliedLimitMetadata | undefined,
  options: { limit?: number; noLimit?: boolean }
): void {
  if (!appliedLimit?.truncated) return
  if (options.noLimit === true || typeof options.limit === 'number') return

  throw new Error(
    `Export would silently drop rows — ${appliedLimit.limitApplied}-row auto-limit reached.\n` +
      `  Re-run with --no-limit to export everything,\n` +
      `  or --limit ${appliedLimit.limitApplied} to accept the cap explicitly.`
  )
}

/**
 * Testable core: resolve rows + target index from a DSL query or a bare index name.
 *
 * When a finite cap applies, one extra document is fetched so the caller can
 * tell a full result from a capped one; `cap` reports the real ceiling and the
 * caller trims the lookahead.
 */
export async function buildEsExportRows(
  query: string,
  options: { index?: string; collection?: string; noLimit?: boolean; limit?: number },
  adapter: EsExportAdapter
): Promise<{ rows: Record<string, unknown>[]; target: string; cap?: number }> {
  const cap = options.noLimit ? Number.POSITIVE_INFINITY : (options.limit ?? ES_EXPORT_CAP)
  const capped = Number.isFinite(cap)
  const isDsl = query.trim().startsWith('{')

  if (isDsl) {
    const index = options.index ?? options.collection
    if (!index) {
      throw new Error('Elasticsearch DSL export requires --index <name>')
    }
    const res = await adapter.execute<Record<string, unknown>>(query, [index], {
      limit: capped ? cap + 1 : 10000,
    })
    return { rows: res.rows, target: index, ...(capped ? { cap } : {}) }
  }

  const index = query.trim()
  const rows = await scrollAll(adapter as never, index, capped ? cap + 1 : 1_000_000)
  return { rows, target: index, ...(capped ? { cap } : {}) }
}

async function esExportBranch(
  query: string,
  options: ExportOptions,
  config: DbcliConfig
): Promise<void> {
  const blacklistManager = new BlacklistManager(config)
  const blacklistValidator = new BlacklistValidator(blacklistManager)

  const adapter = AdapterFactory.createElasticsearchAdapter(config.connection as ConnectionOptions)
  await adapter.connect()
  let formatted: string
  let rowCount: number
  const diagnostics: string[] = []
  try {
    const {
      rows: fetched,
      target,
      cap,
    } = await buildEsExportRows(query, options, adapter as unknown as EsExportAdapter)

    blacklistValidator.checkTableBlacklist('SELECT', target, [])
    const limitedResult = cap === undefined ? undefined : trimAppliedLimit(fetched, cap)
    assertExportNotSilentlyTruncated(limitedResult?.metadata, options)
    const rows = limitedResult?.rows ?? fetched
    rowCount = rows.length

    const columns = collectColumnUnion(rows)
    if (options.format === 'html') {
      formatted = await generateHtmlReport({
        meta: {
          name: 'Exported Report',
          key: 'export',
          params: [],
          tags: [],
          description: query,
        },
        rows,
        ...(limitedResult ? { appliedLimit: limitedResult.metadata } : {}),
      })
    } else {
      formatted = formatMongoRows(
        rows,
        columns,
        options.format,
        options.recovery === true ? undefined : diagnostics
      )
    }

    await writeAuditEntry(config, 'export', options, {
      success: true,
      target,
      metadata: {
        rows_affected: rowCount,
        output_format: options.format,
        ...(options.output && { output_file: options.output }),
      },
    })
  } finally {
    await adapter.disconnect()
  }
  const emitted = await emitExportOutput(formatted, rowCount, options)
  if (emitted && options.recovery !== true) {
    for (const diagnostic of diagnostics) console.error(diagnostic)
  }
}

async function mongoExportBranch(
  query: string,
  options: ExportOptions,
  config: DbcliConfig
): Promise<void> {
  if (SQL_PATTERN.test(query)) {
    throw new Error(
      '這是 MongoDB 連線，請使用 JSON filter 或 aggregation pipeline。' +
        ` 範例：dbcli export '{"status":"open"}' --collection orders --format jsonl`
    )
  }

  if (!options.collection) {
    throw new Error('MongoDB export 需要指定 --collection <name>')
  }

  try {
    JSON.parse(query)
  } catch {
    throw new Error('MongoDB 查詢必須是有效的 JSON（object filter 或 array pipeline）')
  }

  const collection = options.collection

  // `$out` / `$merge` write to a collection; export is a read operation.
  const { assertNoMongoWriteStages } = await import('@/core/mongo/write-stage-guard')
  assertNoMongoWriteStages(JSON.parse(query), config.permission, {
    allowWithPermission: false,
    context: 'MongoDB export',
  })

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
  }

  const adapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
  await adapter.connect()
  let formatted: string
  let rowCount: number
  let hasBlacklistedColumns = false
  const diagnostics: string[] = []
  try {
    const result = await adapter.execute<Record<string, unknown>>(
      query,
      [collection],
      // Fetch one row past the cap so truncation is observed, not inferred.
      effectiveLimit !== undefined ? { limit: effectiveLimit + 1 } : undefined
    )
    const limitedResult =
      effectiveLimit === undefined ? undefined : trimAppliedLimit(result.rows, effectiveLimit)
    assertExportNotSilentlyTruncated(limitedResult?.metadata, options)

    const blacklistCfg = (
      config as { blacklist?: { tables: string[]; columns: Record<string, string[]> } }
    ).blacklist ?? { tables: [], columns: {} }
    const maskedRows = maskMongoRows(limitedResult?.rows ?? result.rows, collection, blacklistCfg)
    rowCount = maskedRows.length
    hasBlacklistedColumns = (blacklistCfg.columns[collection] ?? []).length > 0
    const visibleColumns = collectColumnUnion(maskedRows)

    if (options.format === 'html') {
      formatted = await generateHtmlReport({
        meta: {
          name: 'Exported Report',
          key: 'export',
          params: [],
          tags: [],
          description: query,
        },
        rows: maskedRows,
        ...(limitedResult ? { appliedLimit: limitedResult.metadata } : {}),
        ...(hasBlacklistedColumns
          ? {
              securityNotification:
                'Some fields may have been redacted as [REDACTED] per .dbcli blacklist.',
            }
          : {}),
      })
    } else {
      formatted = formatMongoRows(
        maskedRows,
        visibleColumns,
        options.format,
        options.recovery === true ? undefined : diagnostics
      )
    }

    await writeAuditEntry(config, 'export', options, {
      success: true,
      target: collection,
      metadata: {
        rows_affected: rowCount,
        output_format: options.format,
        ...(options.output && { output_file: options.output }),
      },
    })
  } finally {
    await adapter.disconnect()
  }
  const emitted = await emitExportOutput(formatted, rowCount, options)
  if (!emitted) return
  if (options.recovery !== true) {
    for (const diagnostic of diagnostics) console.error(diagnostic)
  }
  if (hasBlacklistedColumns) {
    console.error(`ℹ Some fields may have been redacted as [REDACTED] per .dbcli blacklist.`)
  }
  if (
    options.recovery !== true &&
    options.limit === undefined &&
    !options.noLimit &&
    config.permission === 'query-only'
  ) {
    console.error(`Query-only mode: auto-limiting to ${effectiveLimit} rows`)
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
  format: ExportFormat,
  diagnostics?: string[]
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

  if (nestedSeen && diagnostics) {
    diagnostics.push(
      'Warning: nested object/array fields were JSON-stringified for CSV. Use --format jsonl to preserve structure.'
    )
  }

  return [headerLine, ...dataLines].join('\n')
}

async function emitExportOutput(
  formatted: string,
  rowCount: number,
  options: ExportOptions
): Promise<boolean> {
  if (!options.output) {
    console.log(formatted)
    return true
  }

  const file = Bun.file(options.output)
  if ((await file.exists()) && !options.force) {
    const confirmed = await promptUser.confirm(
      t_vars('export.overwrite_confirmation', { file: options.output })
    )
    if (!confirmed) {
      console.error('Operation cancelled by user')
      return false
    }
  }

  await file.write(formatted)
  console.error(t_vars('export.exported', { count: rowCount, file: options.output }))
  return true
}

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}
