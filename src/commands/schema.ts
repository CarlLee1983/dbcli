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
import type { TableSchema, DatabaseAdapter } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'
import { validateFormat } from '@/utils/validation'

import { resolveConfigPath } from '@/utils/config-path'

const ALLOWED_FORMATS = ['table', 'json'] as const

export const schemaCommand = new Command()
  .name('schema')
  .description(
    'Display table schema, scan database schema, or refresh existing schema with detected changes'
  )
  .argument('[table]', 'Optional: table name to inspect (if omitted, scans all tables)')
  .option('--format <format>', 'Output format: table (default) or json', 'table')
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')
  .option('--refresh', 'Refresh schema by detecting changes from database', false)
  .option('--reset', 'Clear all existing schema data and re-fetch from database', false)
  .option('--force', 'Skip confirmation when updating schema data', false)
  .option(
    '--sample-size <n>',
    'MongoDB only: number of documents to sample for schema inference (default 50, max 1000). Ignored on SQL connections.'
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
      console.error('Database not configured. Run: dbcli init')
      process.exit(1)
    }

    let inferenceOptions:
      | { sampleSize?: number; sampleMethod?: 'random' | 'natural' }
      | undefined
    if (options.sampleSize !== undefined) {
      const parsed = Number(options.sampleSize)
      if (!Number.isFinite(parsed) || parsed < 1) {
        console.error(`--sample-size must be a positive integer (received ${options.sampleSize})`)
        process.exit(1)
      }
      if (config.connection.system === 'mongodb') {
        inferenceOptions = { sampleSize: Math.floor(parsed) }
      } else {
        console.error('--sample-size is MongoDB-only and is being ignored for this connection.')
      }
    }
    if (options.sampleMethod && options.sampleMethod !== 'random') {
      if (options.sampleMethod !== 'natural') {
        console.error(
          `--sample-method must be 'random' or 'natural' (received '${options.sampleMethod}')`
        )
        process.exit(1)
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
        console.error('schema --reset/--refresh is not supported for Redis connections.')
        process.exit(1)
      }
      if (!table) {
        console.error('Redis schema inspection requires a key name: dbcli schema <key>')
        process.exit(1)
      }
      const redisAdapter = AdapterFactory.createRedisAdapter(config.connection as ConnectionOptions)
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
          inferenceOptions
        )
      } else if (options.refresh) {
        // Handle schema refresh (NEW)
        await handleSchemaRefresh(
          adapter,
          config,
          options,
          connectionName,
          storagePath,
          inferenceOptions
        )
      } else if (table) {
        // Single table schema inspection
        await handleSingleTableSchema(adapter, table, options.format, inferenceOptions)
      } else {
        // Full database schema scan and config update
        await handleFullDatabaseScan(
          adapter,
          config,
          options,
          connectionName,
          existingSchemaCount,
          storagePath,
          inferenceOptions
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

    if (error instanceof Error) {
      console.error(t_vars('errors.message', { message: error.message }))
      if (error instanceof ConnectionError) {
        error.hints.forEach((hint: string) => console.error(`   Hint: ${hint}`))
      }
    }
    process.exit(1)
  }
}

/**
 * Handles single table schema inspection
 */
async function handleSingleTableSchema(
  adapter: DatabaseAdapter,
  tableName: string,
  format: string,
  inferenceOptions?: { sampleSize?: number }
): Promise<void> {
  const schema = await adapter.getTableSchema(tableName, inferenceOptions)

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
async function handleSchemaRefresh(
  adapter: DatabaseAdapter,
  config: DbcliConfig,
  options: { config: string; refresh: boolean; force: boolean },
  connectionName: string | undefined,
  storagePath: string,
  inferenceOptions?: { sampleSize?: number }
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

  // Require --force to apply
  if (!options.force) {
    console.log('   Use --force to apply changes')
    return
  }

  // Build new schema object with all table entries
  const newSchema: Record<string, TableSchema> = { ...config.schema }

  // Add/update tables detected as added or modified
  for (const tableName of report.tablesAdded.concat(Object.keys(report.tablesModified))) {
    const fullSchema = await adapter.getTableSchema(tableName, inferenceOptions)
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
  console.log(`✅ Schema persisted to layered storage (.dbcli/schemas/${connectionName || ''})`)

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
  inferenceOptions?: { sampleSize?: number }
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

  const schemaData: Record<string, unknown> = {}
  let processed = 0

  for (const table of tables) {
    const fullSchema = await adapter.getTableSchema(table.name, inferenceOptions)
    schemaData[table.name] = {
      name: fullSchema.name,
      columns: fullSchema.columns,
      rowCount: fullSchema.rowCount,
      engine: fullSchema.engine,
      primaryKey: fullSchema.primaryKey || [],
      foreignKeys: fullSchema.foreignKeys || [],
      indexes: fullSchema.indexes || [],
      estimatedRowCount: fullSchema.estimatedRowCount || 0,
      tableType: fullSchema.tableType || 'table',
    }

    processed++
    if (processed % 10 === 0 || processed === tables.length) {
      console.log(t_vars('schema.processing_tables', { processed, total: tables.length }))
    }
  }

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
  inferenceOptions?: { sampleSize?: number }
): Promise<void> {
  console.log(t('schema.scanning_database'))

  // Get all tables
  const tables = await adapter.listTables()
  console.log(t_vars('schema.tables_found', { count: tables.length }))

  // Build schema object
  const schemaData: Record<string, unknown> = {}
  let processed = 0

  for (const table of tables) {
    const fullSchema = await adapter.getTableSchema(table.name, inferenceOptions)
    schemaData[table.name] = {
      name: fullSchema.name,
      columns: fullSchema.columns,
      rowCount: fullSchema.rowCount,
      engine: fullSchema.engine,
      primaryKey: fullSchema.primaryKey || [],
      foreignKeys: fullSchema.foreignKeys || [],
      indexes: fullSchema.indexes || [],
      estimatedRowCount: fullSchema.estimatedRowCount || 0,
      tableType: fullSchema.tableType || 'table',
    }

    processed++
    // Show progress every 10 tables or at the end
    if (processed % 10 === 0 || processed === tables.length) {
      console.log(t_vars('schema.processing_tables', { processed, total: tables.length }))
    }
  }

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
