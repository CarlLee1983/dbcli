/**
 * dbcli delete 命令
 * 透過 --where 旗標從資料庫資料表中刪除資料（僅限 Admin）
 */

import { AdapterFactory, ConnectionError } from '@/adapters'
import { DataExecutor } from '@/core/data-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'

/**
 * 從字串格式的 WHERE 子句解析出條件對象
 * 例如: "id=1" → { id: "1" }
 * 例如: "id=1 AND status='active'" → { id: "1", status: "active" }
 *
 * @param whereClause WHERE 條件字串
 * @returns 條件對象 {column: value, ...}
 * @throws Error 如果無法解析 WHERE 子句
 */
function parseWhereClause(whereClause: string): Record<string, any> {
  if (!whereClause || whereClause.trim() === '') {
    throw new Error('DELETE 需要 --where 子句 (例如: --where "id=1")')
  }

  const conditions: Record<string, any> = {}

  // 分割 AND 條件
  const andParts = whereClause.split(/\s+AND\s+/i)

  for (const part of andParts) {
    // 匹配 "column=value" 模式
    const match = part.match(/^(\w+)\s*=\s*(.+)$/)
    if (!match || !match[1] || !match[2]) {
      throw new Error(
        `無法解析 WHERE 子句: "${part}"。使用格式 "column=value" 或 "col1=val1 AND col2=val2"`
      )
    }

    const column: string = match[1]
    const valueStr: string = match[2]
    let value: any = valueStr.trim()

    // 移除引號
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1)
    }

    // 嘗試轉換為數字
    if (!isNaN(value) && value !== '') {
      value = Number(value)
    }

    // 處理 true/false
    if (value === 'true') value = true
    if (value === 'false') value = false
    if (value === 'null') value = null

    conditions[column] = value
  }

  return conditions
}

/**
 * Delete 命令操作處理器
 * 接受 table 和 where 條件，驗證，執行刪除操作，並格式化輸出
 * 限制：僅允許 Admin 權限
 */
export async function deleteCommand(
  table: string,
  options: {
    where: string
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

    // 2. 驗證 --where 旗標（強制）
    if (!options.where || options.where.trim() === '') {
      throw new Error('DELETE 需要 --where 子句 (例如: --where "id=1")')
    }

    // 3. 解析 WHERE 條件字串
    let whereConditions: Record<string, any>
    try {
      whereConditions = parseWhereClause(options.where)
    } catch (error) {
      throw new Error(`WHERE 子句解析失敗: ${(error as Error).message}`)
    }

    // 4. 載入組態
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('執行 "dbcli init" 以設定資料庫連線')
    }

    // 5. 驗證 Admin 權限（DELETE 操作必須 Admin）
    if (config.permission !== 'admin') {
      throw new PermissionError(
        '權限被拒: DELETE 操作需要 Admin 權限。',
        { type: 'DELETE', isDangerous: true, keywords: ['DELETE'], isComposite: false, confidence: 'HIGH' },
        config.permission
      )
    }

    // 6. 建立資料庫適配器
    const adapter = AdapterFactory.createAdapter(config.connection)
    await adapter.connect()

    try {
      // 7. 取得資料表結構
      const schema = await adapter.getTableSchema(table)

      // 8. 建立 DataExecutor 並執行 DELETE
      const dbSystem = (config.connection.system === 'postgresql' ? 'postgresql' : 'mysql') as 'postgresql' | 'mysql'
      const executor = new DataExecutor(adapter, config.permission, dbSystem)
      const result = await executor.executeDelete(table, whereConditions, schema, {
        dryRun: options.dryRun,
        force: options.force,
      })

      // 9. 格式化輸出為 JSON
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
      console.error(`   需要: Admin 權限（DELETE 僅限 Admin）`)
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
      operation: 'delete',
      rows_affected: 0,
      error: (error as Error).message,
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }
}
