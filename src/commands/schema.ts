/**
 * dbcli schema command
 * Displays table schema information or scans the entire database schema
 * Supports single-table inspection or full-database schema refresh
 */

import crypto from 'node:crypto'
import { Command } from 'commander'
import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { TableFormatter, TableSchemaJSONFormatter } from '@/formatters'
import { configModule, getSchemaIsolationConnectionName } from '@/core/config'
import { patchConnectionSchema, readV2Config } from '@/core/config-v2'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { SchemaDiffEngine } from '@/core/schema-diff'
import { SchemaWriter } from '@/core'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { TableSchema, DatabaseAdapter, ColumnSchema } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'
import { validateFormat } from '@/utils/validation'
import { createConnectionSelectorOption } from '@/core/connection-selector'
import { suggestTableName } from '@/utils/error-suggester'
import { compilePatterns, matchAny } from '@/core/mongo/path-matcher'
import type { BlacklistConfig } from '@/types/blacklist'

export function markRedactedColumns(
  cols: ColumnSchema[],
  collection: string,
  blacklist: BlacklistConfig
): ColumnSchema[] {
  const raw = (blacklist.columns ?? {})[collection]
  if (!raw || raw.length === 0) return cols
  const { patterns } = compilePatterns(raw)
  if (patterns.length === 0) return cols
  return cols.map((c) => (matchAny(c.name, patterns) ? { ...c, redacted: true } : c))
}

export interface MongoDecorateMeta {
  blacklist: BlacklistConfig
  sampleMethod: 'random' | 'natural'
  sampleSize: number
}

function decorateMongoSchema(schema: TableSchema, meta: MongoDecorateMeta): TableSchema {
  const columns = markRedactedColumns(schema.columns, schema.name, meta.blacklist)
  return {
    ...schema,
    columns,
    ...({ sampleMethod: meta.sampleMethod, sampleSize: meta.sampleSize } as Record<
      string,
      unknown
    >),
  }
}

import { resolveConfigPath } from '@/utils/config-path'
import { mapWithConcurrency } from '@/utils/bounded-parallel'
import type { TableSchemaOptions } from '@/adapters/types'

/**
 * Enrich a TABLE_NOT_FOUND ConnectionError with fuzzy-match suggestions.
 * Pure pass-through for any other error code. Safe to call on every catch path.
 */
export async function attachTableSuggestions(
  err: ConnectionError,
  adapter: DatabaseAdapter,
  attemptedName: string
): Promise<ConnectionError> {
  if (err.code !== 'TABLE_NOT_FOUND') return err
  try {
    const { suggestions } = await suggestTableName(
      `Table '${attemptedName}' doesn't exist`,
      adapter
    )
    if (suggestions.length === 0) return err
    const suggestionLine = `Did you mean: ${suggestions.join(', ')}?`
    return new ConnectionError(err.code, err.message, [...err.hints, suggestionLine])
  } catch {
    // If listing tables itself fails (e.g. permission), don't mask the original error.
    return err
  }
}

const ALLOWED_FORMATS = ['table', 'json'] as const

export const schemaCommand = new Command()
  .name('schema')
  .description(
    'Display table schema, scan database schema, or refresh existing schema with detected changes'
  )
  .argument('[table]', 'Optional: table name to inspect (if omitted, scans all tables)')
  .option('--format <format>', 'Output format: table (default) or json', 'table')
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')
  .addOption(createConnectionSelectorOption())
  .option('--refresh', 'Refresh schema by detecting changes from database', false)
  .option('--reset', 'Clear all existing schema data and re-fetch from database', false)
  .option('--force', 'Skip confirmation when updating schema data', false)
  .option(
    '--sample-size <n>',
    'MongoDB only: number of documents to sample for schema inference (default 100, max 1000). Ignored on SQL connections.'
  )
  .option(
    '--sample-method <method>',
    'MongoDB only: "random" (default, uses $sample) or "natural" (uses find().limit()). Ignored on SQL connections.',
    'random'
  )
  .option(
    '--recovery',
    'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
    false
  )
  .action(schemaAction)

/**
 * Schema command action handler
 * If a table is specified: display that table's schema
 * If no table is specified: scan the entire database and update .dbcli
 */

/**
 * 全庫掃描的每表並行度。
 *
 * 逐一 await 會讓總時間變成「表數 × 往返延遲」；不設限則會同時對同一條連線
 * 開上百個查詢。4 是保守值：足以蓋掉延遲，又不會把單一連線塞爆。
 */
const SCHEMA_SCAN_CONCURRENCY = 4

/**
 * 掃描模式的 getTableSchema 選項：不要精確列數。
 *
 * 精確列數要對每張表做全表 COUNT——百張表的資料庫上，那是掃描慢到不可用的
 * 主因，而掃描要的本來就是概況（rowCount 會落在引擎的估計值上）。單表
 * `schema <table>` 不走這條路徑，仍然給精確值。
 */
function scanSchemaOptions(inferenceOptions?: TableSchemaOptions): TableSchemaOptions {
  return { ...(inferenceOptions ?? {}), exactRowCount: false }
}

async function schemaAction(
  table: string | undefined,
  options: {
    format: string
    config: string
    refresh: boolean
    reset: boolean
    force: boolean
    sampleSize?: string
    sampleMethod?: string
    recovery?: boolean
  },
  command: Command
) {
  let config: DbcliConfig | undefined
  try {
    validateFormat(options.format, ALLOWED_FORMATS, 'schema')

    const configPath = resolveConfigPath(command, options)
    const storagePath = await resolveConfigStoragePath(configPath)

    // Load configuration from .dbcli
    config = await configModule.read(configPath)

    if (!config.connection) {
      throw new Error('Database not configured. Run: dbcli init')
    }

    let inferenceOptions: { sampleSize?: number; sampleMethod?: 'random' | 'natural' } | undefined
    if (options.sampleSize !== undefined) {
      const parsed = Number(options.sampleSize)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`--sample-size must be a positive integer (received ${options.sampleSize})`)
      }
      if (config.connection.system === 'mongodb') {
        inferenceOptions = { sampleSize: Math.floor(parsed) }
      } else {
        console.error('--sample-size is MongoDB-only and is being ignored for this connection.')
      }
    }
    if (options.sampleMethod && options.sampleMethod !== 'random') {
      if (options.sampleMethod !== 'natural') {
        throw new Error(
          `--sample-method must be 'random' or 'natural' (received '${options.sampleMethod}')`
        )
      }
      if (config.connection.system === 'mongodb') {
        inferenceOptions = { ...(inferenceOptions ?? {}), sampleMethod: 'natural' }
      } else {
        console.error('--sample-method is MongoDB-only and is being ignored for this connection.')
      }
    }

    // Resolve connection name for per-connection schema isolation (V2 only; undefined for V1)
    const connectionName = await getSchemaIsolationConnectionName(configPath)

    // Determine how many tables exist in this connection's dedicated schema slot.
    let existingSchemaCount: number
    if (connectionName !== undefined) {
      try {
        const v2Raw = await readV2Config(storagePath)
        existingSchemaCount = Object.keys(v2Raw.schemas?.[connectionName] ?? {}).length
      } catch {
        existingSchemaCount = 0
      }
    } else {
      existingSchemaCount = Object.keys(config.schema ?? {}).length
    }

    // Redis: full-database scans aren't meaningful; only allow inspecting a single key.
    if (config.connection.system === 'redis') {
      if (options.reset || options.refresh) {
        throw new Error('schema --reset/--refresh is not supported for Redis connections.')
      }
      if (!table) {
        throw new Error('Redis schema inspection requires a key name: dbcli schema <key>')
      }
      const redisAdapter = AdapterFactory.createRedisAdapter(
        config
      )
      await redisAdapter.connect()
      try {
        if (!redisAdapter.getTableSchema) {
          throw new Error('Redis adapter does not implement getTableSchema')
        }
        const schema = await redisAdapter.getTableSchema(table)
        if (options.format === 'json') {
          const formatter = new TableSchemaJSONFormatter()
          console.log(formatter.format(schema))
        } else {
          console.log(`\nKey: ${schema.name}`)
          for (const col of schema.columns) {
            console.log(`  ${col.name}: ${col.type}`)
          }
        }
        await writeAuditEntry(config, 'schema', options, {
          success: true,
          target: table,
        })
      } finally {
        await redisAdapter.disconnect()
      }
      return
    }

    // Elasticsearch branch
    if (config.connection.system === 'elasticsearch') {
      const esAdapter = AdapterFactory.createElasticsearchAdapter(
        config.connection as ConnectionOptions
      )
      await esAdapter.connect()
      try {
        if (table) {
          if (!esAdapter.getTableSchema)
            throw new Error('Elasticsearch adapter does not implement getTableSchema')
          await handleSingleTableSchema(
            esAdapter as unknown as DatabaseAdapter,
            table,
            options.format,
            inferenceOptions
          )
          await writeAuditEntry(config, 'schema', options, {
            success: true,
            target: table,
          })
          return
        }
        await handleFullDatabaseScan(
          esAdapter as unknown as DatabaseAdapter,
          config,
          options,
          connectionName,
          existingSchemaCount,
          storagePath,
          inferenceOptions
        )
        await writeAuditEntry(config, 'schema', options, {
          success: true,
          target: '*',
        })
        return
      } finally {
        await esAdapter.disconnect()
      }
    }

    // Create adapter from configuration. MongoDB falls through here intentionally —
    // schema scan uses the DatabaseAdapter surface that both SQL and MongoDB adapters implement.
    const adapter = AdapterFactory.createAdapter(
      config.connection as ConnectionOptions
    ) as DatabaseAdapter
    await adapter.connect()

    const mongoMeta: MongoDecorateMeta | undefined =
      config.connection.system === 'mongodb'
        ? {
            blacklist: (config.blacklist ?? { tables: [], columns: {} }) as BlacklistConfig,
            sampleMethod: inferenceOptions?.sampleMethod ?? 'random',
            sampleSize: inferenceOptions?.sampleSize ?? 100,
          }
        : undefined

    try {
      if (options.reset) {
        // Clear all schema and re-fetch from database
        await handleSchemaReset(
          adapter,
          config,
          options,
          connectionName,
          existingSchemaCount,
          storagePath,
          inferenceOptions,
          mongoMeta
        )
      } else if (options.refresh) {
        // Handle schema refresh (NEW)
        await handleSchemaRefresh(
          adapter,
          config,
          options,
          connectionName,
          storagePath,
          inferenceOptions,
          mongoMeta
        )
      } else if (table) {
        // Single table schema inspection
        await handleSingleTableSchema(adapter, table, options.format, inferenceOptions, mongoMeta)
      } else {
        // Full database schema scan and config update
        await handleFullDatabaseScan(
          adapter,
          config,
          options,
          connectionName,
          existingSchemaCount,
          storagePath,
          inferenceOptions,
          mongoMeta
        )
      }

      await writeAuditEntry(config, 'schema', options, {
        success: true,
        target: table ?? '*',
      })
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    let auditId: string | null = null
    let envelopeId: string | undefined
    if (options.recovery === true) {
      envelopeId = crypto.randomUUID()
    }
    if (config) {
      auditId = await writeAuditEntry(config, 'schema', options, {
        success: false,
        target: table ?? '*',
        error,
        ...(envelopeId && { recovery_ref: envelopeId }),
      })
    }

    if (envelopeId !== undefined) {
      const { emitRecoveryEnvelope } = await import('@/core/recovery')
      emitRecoveryEnvelope(
        error,
        { operation: 'schema', table },
        { envelopeId, auditRef: auditId ?? undefined }
      )
    }

    throw error
  }
}

/**
 * Handles single table schema inspection
 */
async function handleSingleTableSchema(
  adapter: DatabaseAdapter,
  tableName: string,
  format: string,
  inferenceOptions?: { sampleSize?: number; sampleMethod?: 'random' | 'natural' },
  mongoMeta?: MongoDecorateMeta
): Promise<void> {
  let schema: TableSchema
  try {
    schema = await adapter.getTableSchema(tableName, inferenceOptions)
  } catch (error) {
    if (error instanceof ConnectionError) {
      throw await attachTableSuggestions(error, adapter, tableName)
    }
    throw error
  }
  if (mongoMeta) schema = decorateMongoSchema(schema, mongoMeta)

  if (format === 'json') {
    const formatter = new TableSchemaJSONFormatter()
    console.log(formatter.format(schema))
  } else {
    console.log(`\nTable: ${schema.name}\n`)

    if (schema.primaryKey && schema.primaryKey.length > 0) {
      console.log(`Primary Key: ${schema.primaryKey.join(', ')}`)
    }

    if (schema.foreignKeys && schema.foreignKeys.length > 0) {
      console.log(`Foreign Keys:`)
      schema.foreignKeys.forEach((fk: NonNullable<TableSchema['foreignKeys']>[number]) => {
        console.log(
          `   ${fk.name}: ${fk.columns.join(',')} → ${fk.refTable}(${fk.refColumns.join(',')})`
        )
      })
    }

    console.log(`\n${schema.columns.length} columns:\n`)

    const formatter = new TableFormatter()
    console.log(formatter.format(schema.columns))

    if (schema.rowCount !== undefined) {
      console.log(`\nRow count: ~${schema.rowCount.toLocaleString()}`)
    }
    if (schema.engine) {
      console.log(`Engine: ${schema.engine}`)
    }

    if (schema.estimatedRowCount !== undefined) {
      const { getSizeCategory } = await import('@/core/size-category')
      const category = getSizeCategory(schema.estimatedRowCount)
      console.log(`Estimated rows: ~${schema.estimatedRowCount.toLocaleString()} (${category})`)
    }

    if (schema.indexes && schema.indexes.length > 0) {
      console.log(`\nIndexes:`)
      schema.indexes.forEach((idx: NonNullable<TableSchema['indexes']>[number]) => {
        const uniqueTag = idx.unique ? ' [UNIQUE]' : ''
        console.log(`   ${idx.name}: (${idx.columns.join(', ')})${uniqueTag}`)
      })
    }
  }
}

/**
 * Handles schema refresh - detects incremental changes and applies them
 */
export async function handleSchemaRefresh(
  adapter: DatabaseAdapter,
  config: DbcliConfig,
  options: { config: string; refresh: boolean; force: boolean },
  connectionName: string | undefined,
  storagePath: string,
  inferenceOptions?: { sampleSize?: number; sampleMethod?: 'random' | 'natural' },
  mongoMeta?: MongoDecorateMeta
): Promise<void> {
  const diffEngine = new SchemaDiffEngine(adapter, config)
  const report = await diffEngine.diff()

  // Check if changes exist
  if (
    report.tablesAdded.length === 0 &&
    report.tablesRemoved.length === 0 &&
    Object.keys(report.tablesModified).length === 0
  ) {
    const updatedConfig = configModule.merge(config, {
      metadata: {
        ...config.metadata,
        schemaLastUpdated: new Date().toISOString(),
        schemaTableCount: Object.keys(config.schema || {}).length,
      },
    })

    await writeSchema(storagePath, updatedConfig, connectionName)
    console.log('✅ Schema is up-to-date (no changes detected)')
    return
  }

  // Display changes
  console.log('🔍 Schema changes detected:')
  console.log(`   ${report.summary}`)

  // First-time bootstrap: no existing cache to protect, skip --force gate.
  const isFirstTime = Object.keys(config.schema || {}).length === 0
  if (!options.force && !isFirstTime) {
    console.log('   Use --force to apply changes')
    return
  }
  if (isFirstTime) {
    console.log('   First-time bootstrap (no existing cache to protect)')
  }

  // Build new schema object with all table entries
  const newSchema: Record<string, TableSchema> = { ...config.schema }

  // Add/update tables detected as added or modified
  for (const tableName of report.tablesAdded.concat(Object.keys(report.tablesModified))) {
    let fullSchema = await adapter.getTableSchema(tableName, inferenceOptions)
    if (mongoMeta) fullSchema = decorateMongoSchema(fullSchema, mongoMeta)
    newSchema[tableName] = fullSchema
  }

  // Remove deleted tables (implicitly by not including them in new schema)
  report.tablesRemoved.forEach((t: string) => delete newSchema[t])

  // Apply immutable merge to config
  const updatedConfig = configModule.merge(config, {
    schema: newSchema,
    metadata: {
      ...config.metadata,
      schemaLastUpdated: new Date().toISOString(),
      schemaTableCount: Object.keys(newSchema).length,
    },
  })

  // Wave 1 Integration: Persist to layered storage
  const writer = new SchemaWriter(storagePath)
  await writer.save(newSchema, connectionName)
  if (isFirstTime) {
    console.log(`✅ Schema cache initialised (${Object.keys(newSchema).length} tables)`)
  } else {
    console.log(
      `✅ Schema updated (${report.tablesAdded.length} added / ${report.tablesRemoved.length} removed / ${Object.keys(report.tablesModified).length} modified)`
    )
  }

  await writeSchema(storagePath, updatedConfig, connectionName)
  console.log(`✅ Schema updated in .dbcli`)
}

/**
 * Handles schema reset — clears existing schema then re-fetches from the DB
 */
async function handleSchemaReset(
  adapter: DatabaseAdapter,
  config: DbcliConfig,
  options: { config: string; format: string; force: boolean },
  connectionName: string | undefined,
  existingCount: number,
  storagePath: string,
  inferenceOptions?: { sampleSize?: number; sampleMethod?: 'random' | 'natural' },
  mongoMeta?: MongoDecorateMeta
): Promise<void> {
  if (existingCount > 0 && !options.force) {
    // Wave 1: check if layered cache actually exists
    const { SchemaLayeredLoader } = await import('@/core/schema-loader')
    const loader = new SchemaLayeredLoader(storagePath, { connectionName })
    const { index } = await loader.initialize()

    if (!index || Object.keys(index.tables).length === 0) {
      console.log(
        `⚠ This will clear ${existingCount} existing table schemas and re-fetch from database.`
      )
      console.log('💡 Hint: Schema found in config.json but layered cache files are missing.')
      console.log('   Use --force to migrate to optimized layered storage.')
    } else {
      console.log(
        `⚠ This will clear ${existingCount} existing table schemas and re-fetch from database.`
      )
      console.log('  Use --force to confirm.')
    }
    return
  }

  console.log('🗑 Clearing existing schema data...')

  const emptyMeta = { schemaLastUpdated: undefined, schemaTableCount: 0 }
  const configWithoutSchema = {
    ...config,
    schema: {},
    metadata: { ...config.metadata, ...emptyMeta },
  }

  // Write cleared config first (in case scan fails, at least old stale data is gone)
  await writeSchema(storagePath, configWithoutSchema as DbcliConfig, connectionName)

  // Wave 1 Integration: Clear layered storage
  const writer = new SchemaWriter(storagePath)
  await writer.clear(connectionName)

  // Now do a full fresh scan
  console.log(t('schema.scanning_database'))
  const tables = await adapter.listTables()
  console.log(t_vars('schema.tables_found', { count: tables.length }))

  let processed = 0

  // 並行執行但依 listTables 的順序寫入：鍵的順序若隨完成時間浮動，兩次內容
  // 相同的掃描會產生不同的 config.json，diff 每次都在動。
  const scanned = await mapWithConcurrency(tables, SCHEMA_SCAN_CONCURRENCY, async (table) => {
    let fullSchema = await adapter.getTableSchema(table.name, scanSchemaOptions(inferenceOptions))
    if (mongoMeta) fullSchema = decorateMongoSchema(fullSchema, mongoMeta)
    const entry = {
      name: fullSchema.name,
      columns: fullSchema.columns,
      rowCount: fullSchema.rowCount,
      engine: fullSchema.engine,
      primaryKey: fullSchema.primaryKey || [],
      foreignKeys: fullSchema.foreignKeys || [],
      indexes: fullSchema.indexes || [],
      estimatedRowCount: fullSchema.estimatedRowCount || 0,
      // 掃描模式的 rowCount 是引擎估計值，不是 COUNT(*) 的結果。標出來，
      // 讀這份 schema 的人（與 agent）才分得出精確與估計。
      rowCountIsEstimate: true,
      tableType: fullSchema.tableType || 'table',
      ...(mongoMeta
        ? { sampleMethod: mongoMeta.sampleMethod, sampleSize: mongoMeta.sampleSize }
        : {}),
    }

    processed++
    if (processed % 10 === 0 || processed === tables.length) {
      console.log(t_vars('schema.processing_tables', { processed, total: tables.length }))
    }
    return entry
  })

  const schemaData: Record<string, unknown> = {}
  tables.forEach((table, index) => {
    schemaData[table.name] = scanned[index]
  })

  const updatedConfig = {
    ...configWithoutSchema,
    schema: schemaData,
    metadata: {
      ...configWithoutSchema.metadata,
      schemaLastUpdated: new Date().toISOString(),
      schemaTableCount: tables.length,
    },
  }

  // Wave 1 Integration: Persist to layered storage
  await writer.save(schemaData as Record<string, TableSchema>, connectionName)
  console.log(`✅ Schema persisted to layered storage (.dbcli/schemas/${connectionName || ''})`)

  await writeSchema(storagePath, updatedConfig as DbcliConfig, connectionName)

  if (existingCount > 0) {
    console.log(
      `\n✅ Schema reset complete — cleared ${existingCount} old tables, fetched ${tables.length} tables from database`
    )
  } else {
    console.log(`\n✅ Schema fetched — ${tables.length} tables from database`)
  }
}

/**
 * Handles full database schema scan and .dbcli update
 */
async function handleFullDatabaseScan(
  adapter: DatabaseAdapter,
  config: DbcliConfig,
  options: { config: string; format: string; force: boolean },
  connectionName: string | undefined,
  existingSchemaCount: number,
  storagePath: string,
  inferenceOptions?: { sampleSize?: number; sampleMethod?: 'random' | 'natural' },
  mongoMeta?: MongoDecorateMeta
): Promise<void> {
  console.log(t('schema.scanning_database'))

  // Get all tables
  const tables = await adapter.listTables()
  console.log(t_vars('schema.tables_found', { count: tables.length }))

  // Build schema object
  let processed = 0

  // 並行執行但依 listTables 的順序寫入：鍵的順序若隨完成時間浮動，兩次內容
  // 相同的掃描會產生不同的 config.json，diff 每次都在動。
  const scanned = await mapWithConcurrency(tables, SCHEMA_SCAN_CONCURRENCY, async (table) => {
    let fullSchema = await adapter.getTableSchema(table.name, scanSchemaOptions(inferenceOptions))
    if (mongoMeta) fullSchema = decorateMongoSchema(fullSchema, mongoMeta)
    const entry = {
      name: fullSchema.name,
      columns: fullSchema.columns,
      rowCount: fullSchema.rowCount,
      engine: fullSchema.engine,
      primaryKey: fullSchema.primaryKey || [],
      foreignKeys: fullSchema.foreignKeys || [],
      indexes: fullSchema.indexes || [],
      estimatedRowCount: fullSchema.estimatedRowCount || 0,
      // 掃描模式的 rowCount 是引擎估計值，不是 COUNT(*) 的結果。標出來，
      // 讀這份 schema 的人（與 agent）才分得出精確與估計。
      rowCountIsEstimate: true,
      tableType: fullSchema.tableType || 'table',
      ...(mongoMeta
        ? { sampleMethod: mongoMeta.sampleMethod, sampleSize: mongoMeta.sampleSize }
        : {}),
    }

    processed++
    // Show progress every 10 tables or at the end
    if (processed % 10 === 0 || processed === tables.length) {
      console.log(t_vars('schema.processing_tables', { processed, total: tables.length }))
    }
    return entry
  })

  const schemaData: Record<string, unknown> = {}
  tables.forEach((table, index) => {
    schemaData[table.name] = scanned[index]
  })

  // Check if schema already exists for this connection
  if (existingSchemaCount > 0 && !options.force) {
    // Wave 1: check if layered cache actually exists
    const { SchemaLayeredLoader } = await import('@/core/schema-loader')
    const loader = new SchemaLayeredLoader(storagePath, { connectionName })
    const { index } = await loader.initialize()

    if (!index || Object.keys(index.tables).length === 0) {
      console.log('\n' + t('schema.schema_exists_warning'))
      console.log('💡 Hint: Schema found in config.json but layered cache files are missing.')
      console.log('   Run with --force to migrate your schema to optimized layered storage.')
    } else {
      console.log('\n' + t('schema.schema_exists_warning'))
      console.log(t('schema.use_force_to_override'))
    }
    // In interactive mode we could prompt here; for now just exit
    process.exit(0)
  }

  const now = new Date().toISOString()
  const updatedConfig = {
    ...config,
    schema: schemaData,
    metadata: {
      ...config.metadata,
      schemaLastUpdated: now,
      schemaTableCount: tables.length,
    },
  }

  // Wave 1 Integration: Persist to layered storage
  const writer = new SchemaWriter(storagePath)
  await writer.save(schemaData as Record<string, TableSchema>, connectionName)
  console.log(`✅ Schema persisted to layered storage (.dbcli/schemas/${connectionName || ''})`)

  await writeSchema(storagePath, updatedConfig as DbcliConfig, connectionName)

  console.log(`\n✅ Schema updated in .dbcli`)
  console.log(`   ${tables.length} tables with full column details and relationships`)
  console.log(`   Timestamp: ${now}`)
}

/**
 * Write schema changes: V2 config → patch per-connection slot; V1 → full config write.
 */
async function writeSchema(
  configPath: string,
  config: DbcliConfig,
  connectionName: string | undefined
): Promise<void> {
  if (connectionName !== undefined) {
    await patchConnectionSchema(
      configPath,
      connectionName,
      (config.schema ?? {}) as Record<string, unknown>,
      {
        schemaLastUpdated: config.metadata?.schemaLastUpdated,
        schemaTableCount: config.metadata?.schemaTableCount,
      }
    )
  } else {
    await configModule.write(configPath, config)
  }
}
