/**
 * dbcli insert 命令
 * 透過 JSON stdin 或 --data 旗標將資料插入到資料庫資料表中
 */

import { AdapterFactory, ConnectionError } from '@/adapters'
import { DataExecutor } from '@/core/data-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'

/**
 * 從 stdin 非同步讀取 JSON 資料
 * 用於 `echo '{}' | dbcli insert table` 模式
 */
async function readStdinJSON(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''

    process.stdin.on('data', (chunk) => {
      data += chunk.toString()
    })

    process.stdin.on('end', () => {
      resolve(data)
    })

    process.stdin.on('error', (error) => {
      reject(error)
    })

    // Timeout: 如果 5 秒內沒有資料，則繼續
    setTimeout(() => {
      if (!data) {
        resolve('')
      }
    }, 5000)
  })
}

/**
 * 判斷是否有 stdin 資料可讀
 */
function isStdinAvailable(): boolean {
  return !process.stdin.isTTY
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
      throw new Error('資料表名稱必需')
    }
    table = table.trim()

    // 2. 取得 JSON 資料 - 優先級：--data > stdin
    let jsonInput = ''

    if (options.data) {
      jsonInput = options.data
    } else if (isStdinAvailable()) {
      jsonInput = await readStdinJSON()
    } else {
      throw new Error('必須提供 JSON 資料 (透過 --data 或 stdin)')
    }

    if (!jsonInput || jsonInput.trim() === '') {
      throw new Error('JSON 資料不能為空')
    }

    // 3. 解析 JSON
    let data: Record<string, any>
    try {
      data = JSON.parse(jsonInput)
    } catch (error) {
      throw new Error(`無效的 JSON: ${(error as Error).message}`)
    }

    // 驗證 data 是物件而非陣列或原始值
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('JSON 必須是物件 (例如: {"name":"Alice","email":"a@b.com"})')
    }

    // 4. 載入組態
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('執行 "dbcli init" 以設定資料庫連線')
    }

    // 5. 建立資料庫適配器
    const adapter = AdapterFactory.createAdapter(config.connection)
    await adapter.connect()

    try {
      // 6. 取得資料表結構
      const schema = await adapter.getTableSchema(table)

      // 7. 建立 DataExecutor 並執行 INSERT
      const executor = new DataExecutor(adapter, config.permission)
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
    // 權限錯誤
    if (error instanceof PermissionError) {
      console.error('❌ 權限被拒')
      console.error(`   操作: ${error.classification.type}`)
      console.error(`   需要: ${error.requiredPermission} 模式或更高")
      console.error(`   訊息: ${error.message}`)
      process.exit(1)
    }

    // 連接錯誤
    if (error instanceof ConnectionError) {
      console.error('❌ 資料庫連線失敗')
      console.error(`   ${error.message}`)
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
