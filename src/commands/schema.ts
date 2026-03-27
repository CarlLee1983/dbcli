/**
 * dbcli schema command
 * Displays table schema information or scans the entire database schema
 * Supports single-table inspection or full-database schema refresh
 */

import { Command } from 'commander'
import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { TableFormatter, TableSchemaJSONFormatter, JSONFormatter } from '@/formatters'
import { configModule } from '@/core/config'
import { SchemaDiffEngine } from '@/core/schema-diff'
import type { TableSchema } from '@/adapters/types'

export const schemaCommand = new Command()
  .name('schema')
  .description('Display table schema, scan database schema, or refresh existing schema with detected changes')
  .argument('[table]', 'Optional: table name to inspect (if omitted, scans all tables)')
  .option(
    '--format <format>',
    'Output format: table (default) or json',
    'table'
  )
  .option(
    '--config <path>',
    'Path to .dbcli config file',
    '.dbcli'
  )
  .option(
    '--refresh',
    'Refresh schema by detecting changes from database',
    false
  )
  .option(
    '--reset',
    'Clear all existing schema data and re-fetch from database',
    false
  )
  .option(
    '--force',
    'Skip confirmation when updating schema data',
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
  }
) {
  try {
    // Load configuration from .dbcli
    const config = await configModule.read(options.config)

    if (!config.connection) {
      console.error('Database not configured. Run: dbcli init')
      process.exit(1)
    }

    // Create adapter from configuration
    const adapter = AdapterFactory.createAdapter(config.connection)
    await adapter.connect()

    try {
      if (options.reset) {
        // Clear all schema and re-fetch from database
        await handleSchemaReset(adapter, config, options)
      } else if (options.refresh) {
        // Handle schema refresh (NEW)
        await handleSchemaRefresh(adapter, config, options)
      } else if (table) {
        // Single table schema inspection
        await handleSingleTableSchema(adapter, table, options.format)
      } else {
        // Full database schema scan and config update
        await handleFullDatabaseScan(adapter, config, options)
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
        console.log(`   ${fk.name}: ${fk.columns.join(',')} → ${fk.refTable}(${fk.refColumns.join(',')})`)
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
  options: { config: string; refresh: boolean; force: boolean }
): Promise<void> {
  const diffEngine = new SchemaDiffEngine(adapter, config)
  const report = await diffEngine.diff()

  // Check if changes exist
  if (
    report.tablesAdded.length === 0 &&
    report.tablesRemoved.length === 0 &&
    Object.keys(report.tablesModified).length === 0
  ) {
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
      schemaTableCount: Object.keys(newSchema).length
    }
  })

  // Write updated config
  await configModule.write(options.config, updatedConfig)
  console.log(`✅ Schema updated in .dbcli`)
}

/**
 * Handles schema reset — clears existing schema then re-fetches from the DB
 */
async function handleSchemaReset(
  adapter: any,
  config: any,
  options: { config: string; format: string; force: boolean }
): Promise<void> {
  const existingCount = config.schema ? Object.keys(config.schema).length : 0

  if (existingCount > 0 && !options.force) {
    console.log(`⚠ This will clear ${existingCount} existing table schemas and re-fetch from database.`)
    console.log('  Use --force to confirm.')
    return
  }

  console.log('🗑 Clearing existing schema data...')

  // Clear schema and re-scan
  const configWithoutSchema = {
    ...config,
    schema: {},
    metadata: {
      ...config.metadata,
      schemaLastUpdated: undefined,
      schemaTableCount: 0
    }
  }

  // Write cleared config first (in case scan fails, at least old stale data is gone)
  await configModule.write(options.config, configWithoutSchema)

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
      tableType: fullSchema.tableType || 'table'
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
      schemaTableCount: tables.length
    }
  }

  await configModule.write(options.config, updatedConfig)

  if (existingCount > 0) {
    console.log(`\n✅ Schema reset complete — cleared ${existingCount} old tables, fetched ${tables.length} tables from database`)
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
  options: { config: string; format: string; force: boolean }
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
      tableType: fullSchema.tableType || 'table'
    }

    processed++
    // Show progress every 10 tables or at the end
    if (processed % 10 === 0 || processed === tables.length) {
      console.log(t_vars('schema.processing_tables', { processed, total: tables.length }))
    }
  }

  // Check if schema already exists in config
  if (config.schema && Object.keys(config.schema).length > 0 && !options.force) {
    console.log('\n' + t('schema.schema_exists_warning'))
    console.log(t('schema.use_force_to_override'))
    // In interactive mode we could prompt here; for now just exit
    process.exit(0)
  }

  // Update configuration with schema
  const updatedConfig = {
    ...config,
    schema: schemaData,
    metadata: {
      ...config.metadata,
      schemaLastUpdated: new Date().toISOString(),
      schemaTableCount: tables.length
    }
  }

  await configModule.write(options.config, updatedConfig)

  console.log(`\n✅ Schema updated in .dbcli`)
  console.log(`   ${tables.length} tables with full column details and relationships`)
  console.log(`   Timestamp: ${updatedConfig.metadata.schemaLastUpdated}`)
}
