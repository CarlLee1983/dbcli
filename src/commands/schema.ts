/**
 * dbcli schema command
 * Displays table schema information or scans the entire database schema
 * Supports single-table inspection or full-database schema refresh
 */

import { Command } from 'commander'
import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { TableFormatter, TableSchemaJSONFormatter, JSONFormatter } from '@/formatters'
import { configModule, getSchemaIsolationConnectionName } from '@/core/config'
import { patchConnectionSchema, readV2Config } from '@/core/config-v2'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { SchemaDiffEngine } from '@/core/schema-diff'
import { SchemaWriter } from '@/core'
import type { TableSchema } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'
import { validateFormat } from '@/utils/validation'

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
  }
) {
  try {
    validateFormat(options.format, ALLOWED_FORMATS, 'schema')

    const storagePath = await resolveConfigStoragePath(options.config)

    // Load configuration from .dbcli
    const config = await configModule.read(options.config)

    if (!config.connection) {
      console.error('Database not configured. Run: dbcli init')
      process.exit(1)
    }

    if (config.connection?.system === 'mongodb') {
      console.error('此命令目前不支援 MongoDB')
      process.exit(1)
    }

    // Resolve connection name for per-connection schema isolation (V2 only; undefined for V1)
    const connectionName = await getSchemaIsolationConnectionName(options.config)

    // Determine how many tables exist in this connection's dedicated schema slot.
    // V2: read the connection-specific slot only — the fallback shared `schema` must not
    //     mislead the "schema already exists" guard on a first-time per-connection scan.
    // V1: simply count config.schema tables.
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

    // Create adapter from configuration
    const adapter = AdapterFactory.createAdapter(config.connection as ConnectionOptions)
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
          storagePath
        )
      } else if (options.refresh) {
        // Handle schema refresh (NEW)
        await handleSchemaRefresh(adapter, config, options, connectionName, storagePath)
      } else if (table) {
        // Single table schema inspection
        await handleSingleTableSchema(adapter, table, options.format)
      } else {
        // Full database schema scan and config update
        await handleFullDatabaseScan(
          adapter,
          config,
          options,
          connectionName,
          existingSchemaCount,
          storagePath
        )
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
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
  adapter: any,
  tableName: string,
  format: string
): Promise<void> {
  const schema = await adapter.getTableSchema(tableName)

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
      schema.foreignKeys.forEach((fk: any) => {
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
      schema.indexes.forEach((idx: any) => {
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
  adapter: any,
  config: any,
  options: { config: string; refresh: boolean; force: boolean },
  connectionName: string | undefined,
  storagePath: string
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
    const fullSchema = await adapter.getTableSchema(tableName)
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
  adapter: any,
  config: any,
  options: { config: string; format: string; force: boolean },
  connectionName: string | undefined,
  existingCount: number,
  storagePath: string
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

  const schemaData: Record<string, any> = {}
  let processed = 0

  for (const table of tables) {
    const fullSchema = await adapter.getTableSchema(table.name)
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
  adapter: any,
  config: any,
  options: { config: string; format: string; force: boolean },
  connectionName: string | undefined,
  existingSchemaCount: number,
  storagePath: string
): Promise<void> {
  console.log(t('schema.scanning_database'))

  // Get all tables
  const tables = await adapter.listTables()
  console.log(t_vars('schema.tables_found', { count: tables.length }))

  // Build schema object
  const schemaData: Record<string, any> = {}
  let processed = 0

  for (const table of tables) {
    const fullSchema = await adapter.getTableSchema(table.name)
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
