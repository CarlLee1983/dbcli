/**
 * dbcli export 命令
 * 執行 SQL 查詢並導出結果，支持 JSON/CSV 格式和檔案輸出
 */

import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { QueryResultFormatter } from '@/formatters'
import { QueryExecutor } from '@/core/query-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'

/**
 * Export 命令操作處理器
 * 接受 SQL 查詢，執行，格式化，輸出到 stdout 或檔案
 */
export async function exportCommand(
  sql: string,
  options: {
    format: 'json' | 'csv'
    output?: string
  }
): Promise<void> {
  try {
    // 1. Argument validation
    if (!sql || sql.trim() === '') {
      throw new Error('SQL query required')
    }
    if (!options.format || !['json', 'csv'].includes(options.format)) {
      throw new Error('--format must be json or csv')
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
      // 4. Create QueryExecutor (enforces permission checks and auto-limit)
      const executor = new QueryExecutor(adapter, config.permission)

      // 5. Execute query with auto-limit enabled
      const result = await executor.execute(sql, {
        autoLimit: true
      })

      // 6. Format output
      const formatter = new QueryResultFormatter()
      const formatted = formatter.format(result, {
        format: options.format
      })

      // 7. Output to file or stdout
      if (options.output) {
        const file = Bun.file(options.output)
        await file.write(formatted)
        console.error(t_vars('export.exported', { count: result.rowCount, file: options.output }))
      } else {
        console.log(formatted)
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    if (error instanceof PermissionError) {
      console.error(t_vars('errors.permission_denied', { required: error.requiredPermission }))
      console.error(`   Operation: ${error.classification.type}`)
      console.error(`   Message: ${error.message}`)
      process.exit(1)
    }

    if (error instanceof ConnectionError) {
      console.error(t_vars('errors.connection_failed', { message: error.message }))
      process.exit(1)
    }

    // Other errors
    console.error(t_vars('errors.message', { message: (error as Error).message }))
    process.exit(1)
  }
}
