/**
 * dbcli insert 命令
 * 透過 JSON stdin 或 --data 旗標將資料插入到資料庫資料表中
 */

import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { DataExecutor } from '@/core/data-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'

/**
 * 從 stdin 非同步讀取 JSON 資料
 * 用於 `echo '{}' | dbcli insert table` 模式
 * 使用 Bun 原生 API
 */
async function readStdinJSON(): Promise<string> {
  try {
    // 嘗試使用 Bun.stdin.text() 讀取整個輸入
    if (typeof Bun !== 'undefined' && Bun.stdin) {
      const text = await Bun.stdin.text()
      return text
    }

    // Fallback: 空字符串
    return ''
  } catch {
    return ''
  }
}

/**
 * 判斷是否有 stdin 資料可讀
 * 在 Bun 中，我們假設如果不是 TTY 就有資料
 */
function isStdinAvailable(): boolean {
  // 在 Bun 中檢查是否為 TTY
  try {
    return !process.stdin.isTTY
  } catch {
    return false
  }
}

/**
 * Insert 命令操作處理器
 * 接受資料，驗證，執行插入操作，並格式化輸出
 */
export async function insertCommand(
  table: string,
  options: {
    data?: string
    dryRun?: boolean
    force?: boolean
  }
): Promise<void> {
  try {
    // 1. 驗證資料表名稱
    if (!table || table.trim() === '') {
      throw new Error('Table name required')
    }
    table = table.trim()

    // 2. 取得 JSON 資料 - 優先級：--data > stdin
    let jsonInput = ''

    if (options.data) {
      jsonInput = options.data
    } else if (isStdinAvailable()) {
      jsonInput = await readStdinJSON()
    } else {
      throw new Error('JSON data required (via --data or stdin)')
    }

    if (!jsonInput || jsonInput.trim() === '') {
      throw new Error('JSON data cannot be empty')
    }

    // 3. 解析 JSON
    let data: Record<string, any>
    try {
      data = JSON.parse(jsonInput)
    } catch (error) {
      throw new Error(t_vars('errors.invalid_json', { message: (error as Error).message }))
    }

    // 驗證 data 是物件而非陣列或原始值
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('JSON must be an object (e.g. {"name":"Alice","email":"a@b.com"})')
    }

    // 4. 載入組態
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('Run "dbcli init" to configure database connection')
    }

    // 5. 建立資料庫適配器
    const adapter = AdapterFactory.createAdapter(config.connection)
    await adapter.connect()

    try {
      // 6. 取得資料表結構
      const schema = await adapter.getTableSchema(table)

      // 7. 建立 DataExecutor 並執行 INSERT
      const dbSystem = (config.connection.system === 'postgresql' ? 'postgresql' : 'mysql') as 'postgresql' | 'mysql'
      // Construct blacklist validator from config
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      const executor = new DataExecutor(adapter, config.permission, dbSystem, blacklistValidator)
      const result = await executor.executeInsert(table, data, schema, {
        dryRun: options.dryRun,
        force: options.force,
      })

      // 8. 格式化輸出為 JSON
      const output = {
        status: result.status,
        operation: result.operation,
        rows_affected: result.rows_affected,
        timestamp: result.timestamp,
        ...(result.sql && { sql: result.sql }),
        ...(result.error && { error: result.error }),
      }

      console.log(JSON.stringify(output, null, 2))

      // 如果有錯誤，退出碼為 1
      if (result.status === 'error') {
        process.exit(1)
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    // 黑名單錯誤
    if (error instanceof BlacklistError) {
      const output = {
        status: 'error',
        operation: 'insert',
        rows_affected: 0,
        error: error.message,
      }
      console.log(JSON.stringify(output, null, 2))
      process.exit(1)
    }

    // 權限錯誤
    if (error instanceof PermissionError) {
      console.error(t_vars('errors.permission_denied', { required: error.requiredPermission }))
      console.error(`   Operation: ${error.classification.type}`)
      console.error(`   Message: ${error.message}`)
      process.exit(1)
    }

    // 連接錯誤
    if (error instanceof ConnectionError) {
      console.error(t_vars('errors.connection_failed', { message: error.message }))
      process.exit(1)
    }

    // 驗證或其他錯誤
    const output = {
      status: 'error',
      operation: 'insert',
      rows_affected: 0,
      error: (error as Error).message,
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }
}
