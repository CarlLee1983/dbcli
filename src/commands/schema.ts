/**
 * dbcli schema 命令
 * 顯示表格架構信息或掃描整個資料庫架構
 * 支持單表檢查或全資料庫架構刷新
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
 * Schema 命令操作處理器
 * 如果指定了表格：顯示單個表格架構
 * 如果未指定表格：掃描整個資料庫並更新 .dbcli
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
    // 從 .dbcli 加載配置
    const config = await configModule.read(options.config)

    if (!config.connection) {
      console.error('Database not configured. Run: dbcli init')
      process.exit(1)
    }

    // 使用配置創建適配器
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
        // 單個表格架構檢查
        await handleSingleTableSchema(adapter, table, options.format)
      } else {
        // 整個資料庫架構掃描和配置更新
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
 * 處理單個表格架構檢查
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
  }
}

/**
 * 處理架構刷新 - 檢測增量更改並應用
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
 * 處理 schema 重置 — 清空現有 schema 後重新從 DB 抓取
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
      foreignKeys: fullSchema.foreignKeys || []
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
 * 處理整個資料庫架構掃描和 .dbcli 更新
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
      foreignKeys: fullSchema.foreignKeys || []
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
    // 在交互模式中可以在此進行提示；目前直接退出
    process.exit(0)
  }

  // 使用架構更新配置
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

  console.log(`\n✅ 架構已在 .dbcli 中更新`)
  console.log(`   ${tables.length} 個表格及完整列詳情和關係`)
  console.log(`   時間戳: ${updatedConfig.metadata.schemaLastUpdated}`)
}
