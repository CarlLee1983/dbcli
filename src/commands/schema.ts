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
      if (options.refresh) {
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
 * 處理整個資料庫架構掃描和 .dbcli 更新
 */
async function handleFullDatabaseScan(
  adapter: any,
  config: any,
  options: { config: string; format: string; force: boolean }
): Promise<void> {
  console.log('🔍 正在掃描資料庫架構...')

  // 獲取所有表格
  const tables = await adapter.listTables()
  console.log(`📍 找到 ${tables.length} 個表格。正在獲取架構詳情...\n`)

  // 構建架構對象
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
    // 每 10 個表格或最後顯示進度
    if (processed % 10 === 0 || processed === tables.length) {
      console.log(`   處理了 ${processed}/${tables.length} 個表格`)
    }
  }

  // 檢查架構是否已在配置中存在
  if (config.schema && Object.keys(config.schema).length > 0 && !options.force) {
    console.log('\n⚠️  資料庫架構已存在於 .dbcli')
    console.log('   使用 --force 進行覆蓋而無需確認')
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
