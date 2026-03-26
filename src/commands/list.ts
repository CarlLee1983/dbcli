/**
 * dbcli list 命令
 * 列出所有資料庫表格及其元數據
 * 支持表格（默認）和 JSON 輸出格式
 */

import { Command } from 'commander'
import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { TableListFormatter, JSONFormatter } from '@/formatters'
import { configModule } from '@/core/config'

export const listCommand = new Command()
  .name('list')
  .description('List all tables in the database with metadata')
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
  .action(listAction)

/**
 * List 命令操作處理器
 * 連接資料庫，獲取表格列表，格式化輸出
 */
async function listAction(options: { format: string; config: string }) {
  try {
    // 從 .dbcli 加載配置
    const config = await configModule.read(options.config)

    if (!config.connection) {
      console.error('Database not configured. Run: dbcli init')
      process.exit(1)
    }

    // 使用配置創建適配器
    const adapter = AdapterFactory.createAdapter(config.connection)

    // 連接到資料庫
    await adapter.connect()

    try {
      // 獲取表格列表
      const tables = await adapter.listTables()

      if (tables.length === 0) {
        console.log(t('list.no_tables'))
        return
      }

      // 根據 --format 選項格式化輸出
      if (options.format === 'json') {
        const formatter = new JSONFormatter()
        console.log(formatter.format(tables, { compact: false }))
      } else {
        const formatter = new TableListFormatter()
        console.log(formatter.format(tables))
      }

      // 摘要
      console.log(`\n✓ Found ${tables.length} tables`)
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
