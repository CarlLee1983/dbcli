/**
 * dbcli init 命令實現
 *
 * 初始化工作流程：
 * 1. 加載現有 .dbcli 配置（如果存在）
 * 2. 嘗試從 .env 解析資料庫配置
 * 3. 確定資料庫系統
 * 4. 提示用戶輸入缺少的值
 * 5. 檢查現有文件並提示覆蓋確認
 * 6. 驗證並寫入配置
 */

import { Command } from 'commander'
import { parseEnvDatabase } from '@/core/env-parser'
import { configModule } from '@/core/config'
import { getDefaultsForSystem } from '@/adapters/defaults'
import { promptUser } from '@/utils/prompts'
import { ConnectionConfig } from '@/types'
import { AdapterFactory, ConnectionError } from '@/adapters'

/**
 * 建立並配置 init 命令
 */
export const initCommand = new Command('init')
  .description('Initialize dbcli configuration with .env parsing and interactive prompts')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--name <name>', 'Database name')
  .option('--system <system>', 'Database system (postgresql, mysql, mariadb)')
  .option('--permission <permission>', 'Permission level (query-only, read-write, admin)', 'query-only')
  .option('--no-interactive', 'Non-interactive mode (requires all values via flags)')
  .option('--force', 'Skip overwrite confirmation if .dbcli exists')
  .action(async (options) => {
    try {
      await initCommandHandler(options)
    } catch (error) {
      if (error instanceof Error) {
        console.error(`錯誤: ${error.message}`)
      } else {
        console.error(`錯誤: ${String(error)}`)
      }
      process.exit(1)
    }
  })

/**
 * Init 命令的實際處理器
 */
async function initCommandHandler(
  options: Record<string, unknown>
): Promise<void> {
  // 1. 加載現有配置
  const existingConfig = await configModule.read('.dbcli')

  // 2. 嘗試從 .env 解析資料庫配置
  let envConfig = null
  try {
    envConfig = parseEnvDatabase(process.env)
  } catch {
    if (options.interactive) {
      // 在互動模式下，.env 解析失敗不是致命的，我們會提示用戶
      console.log('注意: 無法解析 .env 配置，將使用互動提示')
    }
  }

  // 3. 確定資料庫系統
  let system = options.system || envConfig?.system || 'postgresql'

  if (options.interactive && !options.system && !envConfig?.system) {
    system = await promptUser.select('選擇資料庫系統:', [
      'postgresql',
      'mysql',
      'mariadb'
    ])
  }

  // 驗證系統值
  if (!['postgresql', 'mysql', 'mariadb'].includes(system)) {
    throw new Error(`無效的資料庫系統: ${system}`)
  }

  const defaults = getDefaultsForSystem(system as 'postgresql' | 'mysql' | 'mariadb')

  // 4. 為每個連接參數收集值
  const connection: Partial<ConnectionConfig> = {
    system: system as 'postgresql' | 'mysql' | 'mariadb'
  }

  // 主機名
  connection.host =
    options.host ||
    envConfig?.host ||
    (options.interactive
      ? await promptUser.text('資料庫主機:', defaults.host || 'localhost')
      : defaults.host || 'localhost')

  // 埠號
  const portStr =
    options.port ||
    (envConfig?.port ? String(envConfig.port) : null) ||
    (options.interactive
      ? await promptUser.text('資料庫埠號:', String(defaults.port || 5432))
      : String(defaults.port || 5432))

  const port = parseInt(portStr, 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`無效的埠號: ${portStr}`)
  }
  connection.port = port

  // 用戶名
  connection.user =
    options.user ||
    envConfig?.user ||
    (options.interactive
      ? await promptUser.text('資料庫用戶名:')
      : '')

  if (!connection.user && !options.interactive) {
    throw new Error('非互動模式下需要提供 --user 選項')
  }

  // 密碼
  connection.password =
    options.password ||
    envConfig?.password ||
    (options.interactive
      ? await promptUser.text('資料庫密碼 (可選):')
      : '')

  // 資料庫名稱
  connection.database =
    options.name ||
    envConfig?.database ||
    (options.interactive
      ? await promptUser.text('資料庫名稱:')
      : '')

  if (!connection.database && !options.interactive) {
    throw new Error('非互動模式下需要提供 --name 選項')
  }

  // 5. 選擇權限級別
  let permission = options.permission || 'query-only'

  if (options.interactive && !options.permission) {
    permission = await promptUser.select('選擇權限級別:', [
      'query-only',
      'read-write',
      'admin'
    ])
  }

  // 驗證權限值
  if (!['query-only', 'read-write', 'admin'].includes(permission)) {
    throw new Error(`無效的權限級別: ${permission}`)
  }

  // 6. 合併新配置
  const newConfig = configModule.merge(existingConfig, {
    connection: connection as ConnectionConfig,
    permission: permission as 'query-only' | 'read-write' | 'admin'
  })

  // 7. 檢查現有文件並提示覆蓋確認
  const configFile = Bun.file('.dbcli')
  const fileExists = await configFile.exists()

  if (fileExists && !options.force) {
    if (options.interactive) {
      const overwrite = await promptUser.confirm(
        '檔案 .dbcli 已存在。是否覆蓋?'
      )
      if (!overwrite) {
        console.log('已取消。配置未更改。')
        return
      }
    } else {
      throw new Error('.dbcli 已存在。使用 --force 選項覆蓋。')
    }
  }

  // 8. 測試資料庫連接
  console.log('測試資料庫連接...')
  const adapter = AdapterFactory.createAdapter(newConfig.connection)

  try {
    await adapter.connect()
    const isHealthy = await adapter.testConnection()
    if (isHealthy) {
      console.log('✓ 資料庫連接成功')
    }
  } catch (error) {
    if (error instanceof ConnectionError) {
      console.error(`✗ 連接失敗: ${error.message}`)
      console.error('提示:')
      error.hints.forEach((hint) => console.error(`  • ${hint}`))
      process.exit(1)
    }
    throw error
  } finally {
    await adapter.disconnect()
  }

  // 9. 寫入配置
  await configModule.write('.dbcli', newConfig)
  console.log('✓ 配置已保存至 .dbcli')
}
