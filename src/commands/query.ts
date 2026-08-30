/**
 * dbcli query command
 * Executes a SQL query and returns results, supporting multiple output formats
 */

import crypto from 'node:crypto' // Phase 25 D-51
import { sideEffectTierForStatement } from '@/utils/engine-hints'
import { AdapterFactory, type ConnectionOptions, type SqlConnectionOptions } from '@/adapters'
import { QueryResultFormatter } from '@/formatters'
import { DEFAULT_TABLE_CELL_LIMIT } from '@/formatters/query-result-formatter'
import { MultiQueryResultFormatter } from '@/formatters/multi-query-result-formatter'
import { generateHtmlReport } from '@/formatters/html-formatter'
import { openInBrowser } from '@/utils/opener'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueryResult } from '@/types/query'
import { QueryExecutor } from '@/core/query-executor'
import { configModule } from '@/core/config'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat, type DbcliConfig } from '@/utils/validation'
import { DEFAULT_QUERY_ONLY_LIMIT } from '@/core/limits'
import { trimAppliedLimit } from '@/core/applied-limit'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import { maskMongoRowsForCollections } from '@/core/mongo/field-masker'
import {
  findMongoCollectionReferences,
  findMongoCollectionScopes,
  type MongoCollectionScope,
} from '@/core/mongo/collection-references'

/**
 * Collections a MongoDB query body reaches beyond the one named by
 * `--collection`. An unparseable body yields none; the preflight already
 * rejected it in that case.
 */
function mongoCollectionRefs(query: string): MongoCollectionScope[] {
  try {
    return findMongoCollectionScopes(JSON.parse(query))
  } catch {
    return []
  }
}
import { BlacklistRejection } from '@/adapters/redis/types'
import { resolveQueryInput } from '@/core/query-input'
import {
  parseFieldSelection,
  projectRows,
  toMongoProjection,
  type FieldSelection,
} from '@/core/field-projection'
import { parseConnectionNames } from '@/core/connection-selector'
import {
  aggregateFanOutExitCode,
  assertFanOutReadOnlySql,
  runQueryFanOut,
} from '@/core/query-fanout'
import { enforceElasticsearchPermission } from '@/core/permission/elasticsearch'
import { assertValidSlowQueryThreshold, attachSlowQueryAdvisory } from '@/core/slow-query-advisory'

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}

const ALLOWED_FORMATS = ['table', 'json', 'csv'] as const

interface QueryCommandOptions {
  format?: 'table' | 'json' | 'csv' | 'html'
  ui?: boolean
  limit?: number
  noLimit?: boolean
  collection?: string
  index?: string
  config?: string
  recovery?: boolean
  queryFile?: string
  fields?: string
  truncate?: number
  noTruncate?: boolean
  connectionSelector?: string
  slowMs?: number
  /** Skip the tier-one confirmation. Tier two ignores it by design. */
  yes?: boolean
}

interface QueryExecutionContext {
  config: DbcliConfig
  configPath: string
  connectionName?: string
}

/** What one connection's execution hands back. Exported so a caller substituting
 * the `executeConnection` seam can type its stand-in against the real contract. */
export interface QueryExecutionOutput {
  result: QueryResult<Record<string, unknown>>
  diagnostics: string[]
  notices: string[]
}

export interface QueryCommandRuntime {
  loadConfig: (configPath: string, connectionName?: string) => Promise<DbcliConfig>
  runMultiConnection: (
    query: string,
    options: QueryCommandOptions,
    configPath: string,
    connectionNames: string[],
    fieldSelection: FieldSelection | undefined,
    tableCellLimit: number | false
  ) => Promise<void>
  preflight: (
    query: string,
    options: QueryCommandOptions,
    context: QueryExecutionContext,
    fieldSelection: FieldSelection | undefined,
    multiConnection: boolean
  ) => Promise<void>
  executeConnection: (
    query: string,
    options: QueryCommandOptions,
    context: QueryExecutionContext,
    fieldSelection: FieldSelection | undefined
  ) => Promise<QueryExecutionOutput>
  presentResult: (
    query: string,
    options: QueryCommandOptions,
    execution: QueryExecutionOutput,
    tableCellLimit: number | false
  ) => Promise<void>
  writeAudit: typeof writeAuditEntry
  enforceGate: (
    query: string,
    options: QueryCommandOptions,
    context: QueryExecutionContext
  ) => Promise<boolean>
  randomUUID: () => string
  emitRecovery: (
    error: unknown,
    context: { operation: 'query'; table?: string },
    options: { envelopeId: string; auditRef?: string }
  ) => Promise<void>
  extractTableName: (query: string) => Promise<string | undefined>
}

const defaultQueryCommandRuntime: QueryCommandRuntime = {
  // 查詢不需要整份 schema 索引：size guard 只會用到查詢提到的那幾張表，
  // 由 resolveTableSchema() 按需取得（#43）。
  loadConfig: (configPath, connectionName) =>
    configModule.read(configPath, connectionName, { loadLayeredSchema: false }),
  runMultiConnection: runMultiConnectionQuery,
  preflight: preflightQuery,
  executeConnection: executeConnectionQuery,
  presentResult: presentSingleResult,
  writeAudit: writeAuditEntry,
  enforceGate: enforceQueryWriteGate,
  randomUUID: () => crypto.randomUUID(),
  emitRecovery: async (error, context, options) => {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(error, context, options)
  },
  extractTableName: async (query) => {
    const { extractTableName } = await import('@/utils/engine-hints')
    return extractTableName(query) ?? undefined
  },
}

/**
 * Query command action handler
 * Accepts a SQL query, executes it, and formats the output
 */
export async function queryCommand(
  sql: string | undefined,
  options: QueryCommandOptions,
  command?: import('commander').Command
): Promise<void> {
  return executeQueryCommand(sql, options, command)
}

export async function executeQueryCommand(
  sql: string | undefined,
  options: QueryCommandOptions,
  command?: import('commander').Command,
  runtimeOverrides: Partial<QueryCommandRuntime> = {}
): Promise<void> {
  const runtime = { ...defaultQueryCommandRuntime, ...runtimeOverrides }
  let config: DbcliConfig | undefined
  let resolvedSql = sql ?? ''
  let configPath = options.config ?? '.dbcli'
  let connectionName: string | undefined
  let multiConnectionRequest = false
  try {
    // 1. Argument validation
    resolvedSql = await resolveQueryInput({ positional: sql, queryFile: options.queryFile })
    const fieldSelection = parseFieldSelection(options.fields)

    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
      throw new Error('--limit must be a positive integer')
    }
    assertValidSlowQueryThreshold(options.slowMs)

    if (options.format) {
      validateFormat(options.format, [...ALLOWED_FORMATS, 'html'] as any, 'query')
    }
    const tableCellLimit = resolveTableCellLimit(options)
    configPath = resolveConfigPath(command, options)
    // Treat comma syntax as a multi-connection request before parsing so an
    // invalid list combined with --recovery cannot emit a single-connection
    // recovery envelope.
    multiConnectionRequest = options.connectionSelector?.includes(',') ?? false
    const connectionNames =
      options.connectionSelector === undefined
        ? []
        : parseConnectionNames(options.connectionSelector)
    multiConnectionRequest = connectionNames.length > 1

    if (multiConnectionRequest) {
      await runtime.runMultiConnection(
        resolvedSql,
        options,
        configPath,
        connectionNames,
        fieldSelection,
        tableCellLimit
      )
      return
    }

    connectionName = connectionNames[0]
    config = await runtime.loadConfig(configPath, connectionName)
    const context = { config, configPath, connectionName }
    // Before the preflight, because the preflight reads table schemas and the
    // point of a refusal is that a statement nobody confirmed reaches nothing.
    if (!(await runtime.enforceGate(resolvedSql, options, context))) return
    await runtime.preflight(resolvedSql, options, context, fieldSelection, false)
    const execution = await runtime.executeConnection(resolvedSql, options, context, fieldSelection)
    await runtime.presentResult(resolvedSql, options, execution, tableCellLimit)
  } catch (error) {
    // A refusal is not a failed statement. Its audit row was written by the gate
    // with the tier and reason on it, `--recovery` has no plan to offer for a
    // statement that was never sent, and a caller reading stdout under
    // `--format json` needs the reason as data rather than as localized prose.
    const { WriteGateRefusal } = await import('./write-gate-prompt')
    if (error instanceof WriteGateRefusal) {
      if (options.format === 'json') {
        console.log(
          JSON.stringify(
            {
              status: 'refused',
              code: error.code,
              reason: error.reason,
              ...(error.table && { table: error.table }),
            },
            null,
            2
          )
        )
      }
      throw error
    }

    let auditId: string | null = null
    let envelopeId: string | undefined
    if (options.recovery === true && !multiConnectionRequest) {
      envelopeId = runtime.randomUUID() // Phase 25 D-51 / D-J
    }
    // A sub-branch (e.g. redisQueryBranch) may have already written a richer
    // audit entry — with engine-specific metadata — before re-throwing. Skip
    // writing here to avoid a duplicate, metadata-less generic entry.
    const alreadyAudited = (error as { __auditWritten?: boolean })?.__auditWritten === true
    if (config && !alreadyAudited) {
      auditId = await runtime.writeAudit(
        config,
        'query',
        { ...options, config: configPath, connectionName },
        {
          success: false,
          sql: resolvedSql,
          error,
          ...(envelopeId && { recovery_ref: envelopeId }), // Phase 25 D-J
        }
      )
    }

    if (envelopeId !== undefined) {
      await runtime.emitRecovery(
        error,
        {
          operation: 'query',
          table: await runtime.extractTableName(resolvedSql),
        },
        {
          envelopeId, // Phase 25 D-51
          auditRef: auditId ?? undefined, // Phase 25 K1
        }
      )
    }

    throw error
  }
}

async function runMultiConnectionQuery(
  query: string,
  options: QueryCommandOptions,
  configPath: string,
  connectionNames: string[],
  fieldSelection: FieldSelection | undefined,
  tableCellLimit: number | false
): Promise<void> {
  if (options.recovery === true) {
    throw new Error('--recovery is not supported with multiple connections')
  }
  if (options.ui === true || !['table', 'json'].includes(options.format ?? 'table')) {
    throw new Error('Multiple connections support only --format table or --format json')
  }

  const contexts: QueryExecutionContext[] = []
  for (const connectionName of connectionNames) {
    const config = await configModule.read(configPath, connectionName, {
      loadLayeredSchema: false,
    })
    contexts.push({ config, configPath, connectionName })
  }

  // Complete validation for every selected connection before any adapter is
  // created or connected. This keeps an invalid fan-out request atomic.
  for (const context of contexts) {
    await preflightQuery(query, options, context, fieldSelection, true)
  }

  const executions = new Map<string, QueryExecutionOutput>()
  const contextsByName = new Map(contexts.map((context) => [context.connectionName!, context]))
  const outcomes = await runQueryFanOut(connectionNames, async (selectedName) => {
    const context = contextsByName.get(selectedName)!
    const execution = scopeMultiConnectionNotices(
      await executeConnectionQuery(query, options, context, fieldSelection)
    )
    executions.set(selectedName, execution)
    return execution.result
  })

  const format = (options.format ?? 'table') as 'table' | 'json'
  const formatter = new MultiQueryResultFormatter()
  console.log(
    formatter.format(outcomes, {
      format,
      truncate: format === 'table' ? tableCellLimit : false,
    })
  )
  for (const connection of connectionNames) {
    const execution = executions.get(connection)
    if (!execution) continue
    for (const diagnostic of execution.diagnostics) console.error(diagnostic)
  }
  process.exitCode = aggregateFanOutExitCode(outcomes)
}

function scopeMultiConnectionNotices(execution: QueryExecutionOutput): QueryExecutionOutput {
  if (execution.notices.length === 0) return execution

  const securityNotification = execution.notices
    .map((notice) => notice.trim().replace(/^\u2139\s*/, ''))
    .filter(Boolean)
    .join('\n')
  if (!securityNotification) return { ...execution, notices: [] }

  return {
    ...execution,
    result: {
      ...execution.result,
      metadata: {
        statement: execution.result.metadata?.statement ?? 'SELECT',
        ...execution.result.metadata,
        securityNotification,
      },
    },
    notices: [],
  }
}

/**
 * The two-tier gate on raw SQL (#70).
 *
 * `dbcli query` is the entry point with no mandatory WHERE and no generated
 * statement to inspect, which made it the only write path in the product with
 * no confirmation at all — and the one an agent reaches for. The gate runs
 * before anything else touches the connection, so a refusal means the statement
 * was never sent rather than sent and regretted.
 *
 * Non-SQL engines return early: Redis, MongoDB and Elasticsearch each have
 * their own write guard, and none of them has the statement shape this reads.
 */
async function enforceQueryWriteGate(
  query: string,
  options: QueryCommandOptions,
  context: QueryExecutionContext
): Promise<boolean> {
  const { config } = context
  const { toSqlDialect, enforcePermission } = await import('@/core/permission-guard')
  const dialect = toSqlDialect(config.connection?.system)
  if (!dialect) return true

  const { classifySqlWriteGate } = await import('./write-gate')
  const verdict = await classifySqlWriteGate(query, { dialect })
  if (verdict.tier === 'none') return true

  // Permission first, and with the real statement. A connection that may not
  // run this at all should be told that, not asked to confirm something it was
  // never going to be allowed to do. The executor checks again against the same
  // function once connected; this only moves the verdict earlier, before any
  // socket is opened.
  enforcePermission(query, config.permission, dialect)

  const { enforceWriteGate, WriteGateRefusal } = await import('./write-gate-prompt')
  const { humanOutputContext } = await import('./mutation-outcome')

  const { recordGateDecision } = await import('./write-gate-guard')
  const record = (outcome: 'allowed' | 'declined' | 'refused') =>
    recordGateDecision({
      config,
      command: 'query',
      options: { ...options, config: context.configPath, connectionName: context.connectionName },
      verdict,
      outcome,
      tier: verdict.tier === 'two' ? 'two' : 'one',
      sql: query,
    })

  try {
    const proceed = await enforceWriteGate({
      verdict,
      statement: query,
      operation: verdict.operation ?? 'WRITE',
      human: humanOutputContext(options),
      ...(options.yes !== undefined && { yes: options.yes }),
    })
    // Tier two is recorded either way — that log is the only evidence the gate's
    // effect can be measured from. Tier one is recorded only when somebody
    // declined, because a confirmed routine write is already audited by the
    // execution path and a second row would say nothing new.
    if (verdict.tier === 'two') await record(proceed ? 'allowed' : 'declined')
    else if (!proceed) await record('declined')
    return proceed
  } catch (error) {
    if (error instanceof WriteGateRefusal) await record('refused')
    throw error
  }
}

async function preflightQuery(
  query: string,
  options: QueryCommandOptions,
  context: QueryExecutionContext,
  fieldSelection: FieldSelection | undefined,
  multiConnection: boolean
): Promise<void> {
  const { config } = context
  if (!config.connection) throw new Error('Run "dbcli init" first')

  const system = config.connection.system
  if (fieldSelection && (system === 'redis' || system === 'elasticsearch')) {
    throw new Error(`--fields is not supported for ${system} queries`)
  }

  if (system === 'redis') {
    if (multiConnection) {
      throw new Error('Redis queries do not support multiple connections')
    }
    const { enforceRedisPermission } = await import('@/core/permission/redis')
    enforceRedisPermission(query, config.permission)
    return
  }

  if (system === 'mongodb') {
    await preflightMongoQuery(query, options, context, multiConnection)
    return
  }

  if (system === 'elasticsearch') {
    preflightElasticsearchQuery(query, options, config, multiConnection)
    return
  }

  if (multiConnection) assertFanOutReadOnlySql(query, system)
  await preflightSqlSizeGuard(query, options, context)
}

async function preflightSqlSizeGuard(
  query: string,
  options: QueryCommandOptions,
  context: QueryExecutionContext
): Promise<void> {
  if (options.noLimit) return
  const { config, configPath, connectionName } = context
  const { extractTableReferences } = await import('@/utils/sql-tables')
  const { SQL_DIALECTS } = await import('@/core/permission-guard')
  const dialect = SQL_DIALECTS.find((candidate) => candidate === config.connection?.system)
  // Every referenced table is considered. The previous single-match extraction
  // returned `public` for `FROM public.users`, which is not a schema key, so
  // the guard silently did nothing for every schema-qualified query.
  const tables = extractTableReferences(query, { ...(dialect ? { dialect } : {}) })

  const { resolveTableSchema } = await import('./query-table-schema')
  const { shouldBlockQuery } = await import('./query-size-guard')
  for (const table of tables) {
    const tableSchema = await resolveTableSchema(config, configPath, connectionName, table)
    if (!tableSchema) continue
    const guard = shouldBlockQuery(query, tableSchema as { estimatedRowCount: number })
    if (guard.blocked) throw new Error(`\u26A0 ${guard.reason}`)
  }
}

async function preflightMongoQuery(
  query: string,
  options: QueryCommandOptions,
  context: QueryExecutionContext,
  multiConnection: boolean
): Promise<void> {
  const { config, configPath, connectionName } = context
  const collection = options.collection
  if (!collection) throw new Error('MongoDB 查詢需要指定 --collection <name>')

  const SQL_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|SHOW|DESCRIBE)\b/i
  if (SQL_PATTERN.test(query)) {
    throw new Error(
      `這是 MongoDB 連線，請使用 JSON filter 語法。\n範例：dbcli query '{"field": "value"}' --collection <name>`
    )
  }

  let parsedQuery: unknown
  try {
    parsedQuery = JSON.parse(query)
  } catch {
    throw new Error('MongoDB 查詢必須是有效的 JSON（object filter 或 array pipeline）')
  }

  if (
    multiConnection &&
    (parsedQuery === null || (typeof parsedQuery !== 'object' && !Array.isArray(parsedQuery)))
  ) {
    throw new Error('MongoDB multi-connection query must be an object filter or array pipeline')
  }
  // `$out` / `$merge` write to a collection. Fan-out is read-only by contract;
  // a single connection may write only at data-admin or above.
  const { assertNoMongoWriteStages } = await import('@/core/mongo/write-stage-guard')
  assertNoMongoWriteStages(parsedQuery, config.permission, {
    allowWithPermission: !multiConnection,
    context: 'MongoDB multi-connection pipelines',
  })

  const blacklistValidator = new BlacklistValidator(new BlacklistManager(config))
  // `$lookup.from` / `$unionWith.coll` name a second collection — the MongoDB
  // spelling of the JOIN in issue #23.
  blacklistValidator.checkTablesBlacklist('SELECT', [
    collection,
    ...findMongoCollectionReferences(parsedQuery),
  ])

  if (options.noLimit) return
  const { resolveTableSchema } = await import('./query-table-schema')
  const tableSchema = await resolveTableSchema(config, configPath, connectionName, collection)
  if (!tableSchema) return
  const { shouldBlockQuery } = await import('./query-size-guard')
  const isFiltered = query.length > 2
  const hasLimit = options.limit !== undefined
  const dummySql = `SELECT * FROM ${collection}${isFiltered ? ' WHERE' : ''}${hasLimit ? ' LIMIT' : ''}`
  const guard = shouldBlockQuery(dummySql, tableSchema as { estimatedRowCount: number })
  if (guard.blocked) throw new Error(`\u26A0 ${guard.reason}`)
}

function preflightElasticsearchQuery(
  query: string,
  options: QueryCommandOptions,
  config: DbcliConfig,
  multiConnection: boolean
): void {
  const indexName = options.index ?? options.collection
  if (!indexName) {
    throw new Error('Elasticsearch 查詢需要指定 --collection <index> 或 --index <index>')
  }

  const body = query.trim().startsWith('{') ? query : undefined
  if (body !== undefined) JSON.parse(body)
  enforceElasticsearchPermission(
    { method: 'POST', rawPath: `/${indexName}/_search`, body },
    multiConnection ? 'query-only' : config.permission
  )

  const blacklistValidator = new BlacklistValidator(new BlacklistManager(config))
  // `--index` accepts comma lists and wildcards, so equality against one name
  // is not a check.
  blacklistValidator.checkIndexBlacklist('SELECT', indexName)
}

async function executeConnectionQuery(
  query: string,
  options: QueryCommandOptions,
  context: QueryExecutionContext,
  fieldSelection: FieldSelection | undefined
): Promise<QueryExecutionOutput> {
  const { config, configPath, connectionName } = context
  const system = config.connection!.system
  const auditOptions = { ...options, config: configPath, connectionName }
  const start = performance.now()

  try {
    let execution: QueryExecutionOutput
    if (system === 'mongodb') {
      execution = await mongoQueryBranch(query, options, context, fieldSelection)
    } else if (system === 'redis') {
      execution = await redisQueryBranch(query, options, context)
    } else if (system === 'elasticsearch') {
      execution = await elasticsearchQueryBranch(query, options, context)
    } else {
      execution = await sqlQueryBranch(query, options, context, fieldSelection)
    }

    execution = {
      ...execution,
      result: attachSlowQueryAdvisory(execution.result, {
        slowMs: options.slowMs,
        recovery: options.recovery,
        system,
      }),
    }

    await writeAuditEntry(config, 'query', auditOptions, {
      success: true,
      sql: query,
      target: queryAuditTarget(system, query, options),
      // 語句的效果，不是命令的能力。`query` 的能力是 readonly，所以少了這個
      // 欄位，經由 query 執行的每一筆 DML 都以 readonly 入帳——而被閘門拒絕的
      // DROP 由 `recordGateDecision` 帶著 db-write，兩者剛好顛倒。
      ...(isSqlSystem(system) && { sideEffectTier: sideEffectTierForStatement(query) }),
      metadata: {
        rows_affected: execution.result.rowCount,
        execution_ms: execution.result.executionTimeMs ?? Math.round(performance.now() - start),
      },
    })
    return execution
  } catch (error) {
    // Recovery mode needs the outer command boundary to create the envelope id
    // before it writes the linked audit entry.
    if (options.recovery !== true) {
      const metadata =
        error instanceof BlacklistRejection
          ? {
              rejection_reason: 'blacklist',
              matched_pattern: error.matchedPattern,
              ...(error.matchedKey ? { matched_key: error.matchedKey } : {}),
              execution_ms: Math.round(performance.now() - start),
            }
          : { execution_ms: Math.round(performance.now() - start) }
      await writeAuditEntry(config, 'query', auditOptions, {
        success: false,
        sql: query,
        target: queryAuditTarget(system, query, options),
        // 被拒絕的寫入仍然是寫入：欄位說的是「這句話會做什麼」，`success`
        // 說的是「它有沒有發生」。
        ...(isSqlSystem(system) && { sideEffectTier: sideEffectTierForStatement(query) }),
        error,
        metadata,
      })
      ;(error as { __auditWritten?: boolean }).__auditWritten = true
    }
    throw error
  }
}

/** SQL 方言的引擎——只有它們的 `query` 參數是 SQL 語句。 */
function isSqlSystem(system: ConnectionOptions['system']): boolean {
  return system !== 'mongodb' && system !== 'redis' && system !== 'elasticsearch'
}

function queryAuditTarget(
  system: ConnectionOptions['system'],
  query: string,
  options: QueryCommandOptions
): string | undefined {
  if (system === 'mongodb') return options.collection
  if (system === 'elasticsearch') return options.index ?? options.collection
  if (system === 'redis') return query.trim().split(/\s+/)[1] || '<unknown-key>'
  return undefined
}

async function sqlQueryBranch(
  query: string,
  options: QueryCommandOptions,
  context: QueryExecutionContext,
  fieldSelection: FieldSelection | undefined
): Promise<QueryExecutionOutput> {
  const { config } = context
  const adapter = AdapterFactory.createSqlAdapter(
    requireSqlConnection(config.connection as ConnectionOptions)
  )

  let executionError: unknown
  try {
    await adapter.connect()
    const blacklistValidator = new BlacklistValidator(new BlacklistManager(config))
    const executor = new QueryExecutor(adapter, config.permission, blacklistValidator, config, {
      ...options,
      deferDiagnostics: true,
    })
    const result = await executor.execute(query, {
      autoLimit: !options.noLimit,
      limitValue: options.limit,
      detectTruncation: true,
      fieldSelection,
    })
    return { result, diagnostics: executor.takeDiagnostics(), notices: [] }
  } catch (error) {
    executionError = error
    throw error
  } finally {
    await disconnectPreservingError(adapter, executionError)
  }
}

async function presentSingleResult(
  query: string,
  options: QueryCommandOptions,
  execution: QueryExecutionOutput,
  tableCellLimit: number | false
): Promise<void> {
  const noticeText = execution.notices
    .map((notice) => notice.trim().replace(/^ℹ\s*/, ''))
    .filter(Boolean)
    .join('\n')
  if (options.ui || options.format === 'html') {
    const html = await generateHtmlReport({
      meta: {
        name: 'Query Results',
        key: 'raw-sql',
        params: [],
        tags: [],
        description: query.length > 100 ? query.slice(0, 97) + '...' : query,
      },
      rows: execution.result.rows,
      ...(execution.result.appliedLimit ? { appliedLimit: execution.result.appliedLimit } : {}),
      ...(execution.result.metadata?.securityNotification || noticeText
        ? {
            securityNotification: execution.result.metadata?.securityNotification ?? noticeText,
          }
        : {}),
    })
    if (options.ui) {
      const tempPath = join(tmpdir(), `dbcli-query-${Date.now()}.html`)
      await Bun.write(tempPath, html)
      await openInBrowser(tempPath)
    } else {
      console.log(html)
    }
  } else {
    const format = options.format ?? 'table'
    const formatter = new QueryResultFormatter()
    console.log(
      formatter.format(execution.result, {
        format,
        truncate: format === 'table' ? tableCellLimit : false,
      })
    )
  }

  if (!options.ui && options.format !== 'html') {
    for (const notice of execution.notices) console.log(notice)
  }
  if (options.recovery !== true) {
    for (const diagnostic of execution.diagnostics) console.error(diagnostic)
  }
}

async function mongoQueryBranch(
  queryStr: string,
  options: QueryCommandOptions,
  context: QueryExecutionContext,
  fieldSelection: FieldSelection | undefined
): Promise<QueryExecutionOutput> {
  const { config } = context
  const collection = options.collection!
  const parsedQuery = JSON.parse(queryStr) as unknown

  let effectiveLimit: number | undefined
  if (options.noLimit) {
    effectiveLimit = undefined
  } else if (typeof options.limit === 'number') {
    effectiveLimit = options.limit
  } else if (config.permission === 'query-only') {
    effectiveLimit = DEFAULT_QUERY_ONLY_LIMIT
  }

  const hasUserAuthoredLimit =
    Array.isArray(parsedQuery) &&
    parsedQuery.some(
      (stage) =>
        stage !== null &&
        typeof stage === 'object' &&
        Object.prototype.hasOwnProperty.call(stage, '$limit')
    )
  const appliedLimit =
    effectiveLimit !== undefined && effectiveLimit > 0 && !hasUserAuthoredLimit
      ? effectiveLimit
      : undefined

  const mongoAdapter = AdapterFactory.createMongoDBAdapter(config)
  let executionError: unknown
  try {
    await mongoAdapter.connect()
    const start = performance.now()
    const projection = fieldSelection ? toMongoProjection(fieldSelection) : undefined
    const executeOptions =
      appliedLimit !== undefined || projection !== undefined
        ? {
            ...(appliedLimit !== undefined ? { limit: appliedLimit + 1 } : {}),
            ...(projection !== undefined ? { projection } : {}),
          }
        : undefined
    const result = await mongoAdapter.execute<Record<string, unknown>>(
      queryStr,
      [collection],
      executeOptions
    )
    const executionTimeMs = Math.round(performance.now() - start)
    const limitedResult =
      appliedLimit === undefined ? undefined : trimAppliedLimit(result.rows, appliedLimit)
    const visibleRows = limitedResult?.rows ?? result.rows

    const blacklistCfg = (
      config as { blacklist?: { tables: string[]; columns: Record<string, string[]> } }
    ).blacklist ?? { tables: [], columns: {} }
    const maskedRows = maskMongoRowsForCollections(
      visibleRows,
      [collection, ...mongoCollectionRefs(queryStr)],
      blacklistCfg
    )
    const projected = fieldSelection ? projectRows(maskedRows, fieldSelection) : undefined
    const outputRows = projected?.rows ?? maskedRows
    const columnNames = projected?.columnNames ?? (outputRows[0] ? Object.keys(outputRows[0]) : [])

    const queryResult = {
      rows: outputRows,
      rowCount: outputRows.length,
      columnNames,
      executionTimeMs,
      ...(limitedResult ? { appliedLimit: limitedResult.metadata } : {}),
    }

    const notices: string[] = []
    if ((blacklistCfg.columns[collection] ?? []).length > 0) {
      notices.push(
        '\n\u2139 Some fields may have been redacted as [REDACTED] per .dbcli blacklist.'
      )
    }
    const diagnostics: string[] = []
    if (
      options.recovery !== true &&
      appliedLimit !== undefined &&
      options.limit === undefined &&
      config.permission === 'query-only'
    ) {
      diagnostics.push(`Query-only mode: auto-limiting to ${appliedLimit} rows`)
    }
    return {
      result: queryResult as QueryResult<Record<string, unknown>>,
      diagnostics,
      notices,
    }
  } catch (error) {
    executionError = error
    throw error
  } finally {
    await disconnectPreservingError(mongoAdapter, executionError)
  }
}

/** Render a Redis size-guard/blacklist warning as one human-readable stderr line. */
function describeRedisWarning(warning: import('@/adapters/types').RedisWarning): string {
  switch (warning.code) {
    case 'REDIS_SIZE_TRUNCATE':
      return `⚠ REDIS_SIZE_TRUNCATE: ${warning.command} reply kept ${warning.kept} entries and dropped at least ${warning.droppedAtLeast}. Use --no-limit for the full reply.`
    case 'REDIS_SIZE_REWRITE':
      return `⚠ REDIS_SIZE_REWRITE: ${warning.command} was rewritten to bound the reply (${warning.original.join(' ')} → ${warning.rewritten.join(' ')}). Use --no-limit to run it as written.`
    case 'REDIS_BLACKLIST_FILTERED':
      return `⚠ REDIS_BLACKLIST_FILTERED: ${warning.count} key(s) were withheld by the blacklist.`
  }
}

async function redisQueryBranch(
  command: string,
  options: QueryCommandOptions,
  context: QueryExecutionContext
): Promise<QueryExecutionOutput> {
  const { config } = context
  const head = command.trim().split(/\s+/)[0]?.toUpperCase() ?? ''

  const redisAdapter = AdapterFactory.createRedisAdapter(config)
  let executionError: unknown
  try {
    await redisAdapter.connect()
    const result = await redisAdapter.execute<Record<string, unknown>>(command, undefined, {
      noLimit: options.noLimit ?? false,
    })
    const columnNames = result.rows[0] ? Object.keys(result.rows[0]) : ['value']
    // The adapter's size guard already knows whether the reply was trimmed.
    // Report it through the same appliedLimit contract as every other engine
    // instead of leaving a full-looking result behind.
    const sizeTruncation = result.warnings?.find((w) => w.code === 'REDIS_SIZE_TRUNCATE')
    const queryResult = {
      rows: result.rows,
      rowCount: result.rows.length,
      columnNames,
      ...(sizeTruncation
        ? { appliedLimit: { truncated: true, limitApplied: sizeTruncation.kept } }
        : {}),
    }
    const diagnostics =
      options.recovery === true
        ? []
        : [
            ...(head === 'KEYS'
              ? ['\u26A0 Warning: "KEYS" command is dangerous on production servers.']
              : []),
            ...(result.warnings ?? []).map(describeRedisWarning),
          ]
    return {
      result: queryResult as QueryResult<Record<string, unknown>>,
      diagnostics,
      notices: [],
    }
  } catch (error) {
    executionError = error
    throw error
  } finally {
    await disconnectPreservingError(redisAdapter, executionError)
  }
}

async function elasticsearchQueryBranch(
  queryStr: string,
  options: QueryCommandOptions,
  context: QueryExecutionContext
): Promise<QueryExecutionOutput> {
  const { config } = context
  const indexName = options.index ?? options.collection

  let effectiveLimit: number
  if (options.noLimit) {
    effectiveLimit = 10000
  } else {
    effectiveLimit = options.limit || DEFAULT_QUERY_ONLY_LIMIT
  }

  let hasUserAuthoredSize = false
  if (queryStr.trim().startsWith('{')) {
    const parsed = JSON.parse(queryStr) as unknown
    hasUserAuthoredSize =
      parsed !== null &&
      typeof parsed === 'object' &&
      Object.prototype.hasOwnProperty.call(parsed, 'size')
  }
  const appliedLimit = !options.noLimit && !hasUserAuthoredSize ? effectiveLimit : undefined

  const blacklistValidator = new BlacklistValidator(new BlacklistManager(config))

  const esAdapter = AdapterFactory.createElasticsearchAdapter(
    config.connection as ConnectionOptions
  )
  let executionError: unknown
  try {
    await esAdapter.connect()
    const start = performance.now()
    const result = await esAdapter.execute<Record<string, unknown>>(queryStr, [indexName!], {
      limit: appliedLimit === undefined ? effectiveLimit : appliedLimit + 1,
    })
    const executionTimeMs = Math.round(performance.now() - start)
    const limitedResult =
      appliedLimit === undefined ? undefined : trimAppliedLimit(result.rows, appliedLimit)
    const visibleRows = limitedResult?.rows ?? result.rows

    const columnNames = visibleRows[0] ? Object.keys(visibleRows[0]) : []
    const filterResult = blacklistValidator.filterColumnsForIndexExpression(
      indexName!,
      visibleRows,
      columnNames
    )

    const queryResult = {
      rows: filterResult.filteredRows,
      rowCount: filterResult.filteredRows.length,
      columnNames: columnNames.filter((col) => !filterResult.omittedColumns.includes(col)),
      executionTimeMs,
      ...(limitedResult ? { appliedLimit: limitedResult.metadata } : {}),
    }

    const securityNote = blacklistValidator.buildSecurityNotification(
      indexName!,
      filterResult.omittedColumns
    )
    return {
      result: queryResult as QueryResult<Record<string, unknown>>,
      diagnostics:
        options.noLimit && options.recovery !== true
          ? [
              'Elasticsearch --no-limit is capped at size 10000; for more rows use saved-query with search_after.',
            ]
          : [],
      notices: securityNote ? [`\n\u2139 ${securityNote}`] : [],
    }
  } catch (error) {
    executionError = error
    throw error
  } finally {
    await disconnectPreservingError(esAdapter, executionError)
  }
}

async function disconnectPreservingError(
  adapter: { disconnect(): Promise<void> },
  executionError: unknown
): Promise<void> {
  try {
    await adapter.disconnect()
  } catch (disconnectError) {
    if (executionError === undefined) throw disconnectError
  }
}

function resolveTableCellLimit(options: {
  format?: 'table' | 'json' | 'csv' | 'html'
  ui?: boolean
  truncate?: number
  noTruncate?: boolean
}): number | false {
  if (
    options.truncate !== undefined &&
    (!Number.isSafeInteger(options.truncate) || options.truncate <= 0)
  ) {
    throw new Error('--truncate must be a positive integer')
  }
  if (options.truncate !== undefined && options.noTruncate === true) {
    throw new Error('--truncate and --no-truncate cannot be used together')
  }
  if (
    options.truncate !== undefined &&
    (options.ui === true || (options.format ?? 'table') !== 'table')
  ) {
    throw new Error('--truncate is supported only with --format table')
  }
  if (options.noTruncate === true) return false
  return options.truncate ?? DEFAULT_TABLE_CELL_LIMIT
}
