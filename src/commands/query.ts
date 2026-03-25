/**
 * dbcli query 命令
 * 執行 SQL 查詢並返回結果，支持多種輸出格式
 */

import { AdapterFactory, ConnectionError } from '@/adapters'
import { QueryResultFormatter } from '@/formatters'
import { QueryExecutor } from '@/core/query-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'

/**
 * Query 命令操作處理器
 * 接受 SQL 查詢，執行，並格式化輸出
 */
export async function queryCommand(
  sql: string,
  options: {
    format?: 'table' | 'json' | 'csv'
    limit?: number
    noLimit?: boolean
  }
): Promise<void> {
  try {
    // 1. Argument validation
    if (!sql || sql.trim() === '') {
      throw new Error('SQL query required')
    }
    sql = sql.trim()

    // 2. Load configuration
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    // 3. Create database adapter
    const adapter = AdapterFactory.createAdapter(config.connection)
    await adapter.connect()

    try {
      // 4. Create QueryExecutor
      const executor = new QueryExecutor(adapter, config.permission)

      // 5. Execute query
      const autoLimit = !options.noLimit
      const result = await executor.execute(sql, {
        autoLimit,
        limitValue: options.limit
      })

      // 6. Format output
      const formatter = new QueryResultFormatter()
      const output = formatter.format(result, {
        format: options.format || 'table'
      })

      // 7. Print results
      console.log(output)
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    if (error instanceof PermissionError) {
      console.error('❌ Permission Denied')
      console.error(`   Operation: ${error.classification.type}`)
      console.error(`   Required: ${error.requiredPermission} mode`)
      console.error(`   Message: ${error.message}`)
      process.exit(1)
    }

    if (error instanceof ConnectionError) {
      console.error('❌ Database Connection Failed')
      console.error(`   ${error.message}`)
      process.exit(1)
    }

    // Other errors (missing table, syntax, etc.)
    console.error('❌ Query Error')
    console.error(`   ${(error as Error).message}`)
    process.exit(1)
  }
}
