/**
 * dbcli schema 命令
 * 顯示表格架構信息或掃描整個資料庫架構
 * 支持單表檢查或全資料庫架構刷新
 */

import { Command } from 'commander'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { TableFormatter, TableSchemaJSONFormatter, JSONFormatter } from '@/formatters'
import { configModule } from '@/core/config'

export const schemaCommand = new Command()
  .name('schema')
  .description('Display table schema or scan database schema')
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
    force: boolean
  }
) {
  try {
    // 從 .dbcli 加載配置
    const config = await configModule.read(options.config)

    if (!config.connection) {
      console.error('❌ 未配置資料庫。執行: dbcli init')
      process.exit(1)
    }

    // 使用配置創建適配器
    const adapter = AdapterFactory.create(config.connection)
    await adapter.connect()

    try {
      if (table) {
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
      console.error(`❌ 錯誤: ${error.message}`)
      if (error instanceof ConnectionError) {
        error.hints.forEach((hint: string) => console.error(`   💡 ${hint}`))
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
    console.log(`\n📋 表格: ${schema.name}\n`)

    if (schema.primaryKey && schema.primaryKey.length > 0) {
      console.log(`🔑 主鍵: ${schema.primaryKey.join(', ')}`)
    }

    if (schema.foreignKeys && schema.foreignKeys.length > 0) {
      console.log(`🔗 外鍵:`)
      schema.foreignKeys.forEach((fk: any) => {
        console.log(`   ${fk.name}: ${fk.columns.join(',')} → ${fk.refTable}(${fk.refColumns.join(',')})`)
      })
    }

    console.log(`\n${schema.columns.length} 個列:\n`)

    const formatter = new TableFormatter()
    console.log(formatter.format(schema.columns))

    if (schema.rowCount !== undefined) {
      console.log(`\n📊 行數: ~${schema.rowCount.toLocaleString()}`)
    }
    if (schema.engine) {
      console.log(`🔧 引擎: ${schema.engine}`)
    }
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
