/**
 * dbcli update 命令
 * 透過 --where 和 --set 旗標更新資料庫資料表中的資料
 */

import { t, t_vars } from '@/i18n/message-loader'
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
    throw new Error('WHERE clause cannot be empty')
  }

  const conditions: Record<string, any> = {}

  // 分割 AND 條件
  const andParts = whereClause.split(/\s+AND\s+/i)

  for (const part of andParts) {
    // 匹配 "column=value" 模式
    const match = part.match(/^(\w+)\s*=\s*(.+)$/)
    if (!match) {
      throw new Error(
        `Cannot parse WHERE clause: "${part}". Use format "column=value" or "col1=val1 AND col2=val2"`
      )
    }

    const [_, column, valueStr] = match
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
 * Update 命令操作處理器
 * 接受 table、where 條件和 set 資料，驗證，執行更新操作，並格式化輸出
 */
export async function updateCommand(
  table: string,
  options: {
    where: string
    set: string
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

    // 2. 驗證 --where 旗標
    if (!options.where || options.where.trim() === '') {
      throw new Error('UPDATE requires --where clause (e.g. --where "id=1")')
    }

    // 3. 驗證 --set 旗標
    if (!options.set || options.set.trim() === '') {
      throw new Error('UPDATE requires --set flag with JSON data (e.g. --set \'{"name":"Bob"}\')')
    }

    // 4. 解析 WHERE 條件字串
    let whereConditions: Record<string, any>
    try {
      whereConditions = parseWhereClause(options.where)
    } catch (error) {
      throw new Error(`WHERE clause parsing failed: ${(error as Error).message}`)
    }

    // 5. 解析 --set JSON
    let setData: Record<string, any>
    try {
      setData = JSON.parse(options.set)
    } catch (error) {
      throw new Error(t_vars('errors.invalid_json', { message: (error as Error).message }))
    }

    // 驗證 setData 是物件而非陣列或原始值
    if (!setData || typeof setData !== 'object' || Array.isArray(setData)) {
      throw new Error('JSON in --set must be an object (e.g. {"name":"Bob","email":"b@example.com"})')
    }

    // 6. 載入組態
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('Run "dbcli init" to configure database connection')
    }

    // 7. 建立資料庫適配器
    const adapter = AdapterFactory.createAdapter(config.connection)
    await adapter.connect()

    try {
      // 8. 取得資料表結構
      const schema = await adapter.getTableSchema(table)

      // 9. 建立 DataExecutor 並執行 UPDATE
      const dbSystem = (config.connection.system === 'postgresql' ? 'postgresql' : 'mysql') as 'postgresql' | 'mysql'
      const executor = new DataExecutor(adapter, config.permission, dbSystem)
      const result = await executor.executeUpdate(table, setData, whereConditions, schema, {
        dryRun: options.dryRun,
        force: options.force,
      })

      // 10. 格式化輸出為 JSON
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
      operation: 'update',
      rows_affected: 0,
      error: (error as Error).message,
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }
}
