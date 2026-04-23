/**
 * dbcli insert command
 * Inserts data into a database table via JSON stdin or --data flag
 */

import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { DataExecutor } from '@/core/data-executor'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { resolveConfigPath } from '@/utils/config-path'

/**
 * Asynchronously reads JSON data from stdin
 * Used for the `echo '{}' | dbcli insert table` pattern
 * Uses Bun native API
 */
async function readStdinJSON(): Promise<string> {
  try {
    // Try reading the entire input with Bun.stdin.text()
    if (typeof Bun !== 'undefined' && Bun.stdin) {
      const text = await Bun.stdin.text()
      return text
    }

    // Fallback: empty string
    return ''
  } catch {
    return ''
  }
}

/**
 * Determines whether stdin data is available
 * In Bun, we assume data is present if stdin is not a TTY
 */
function isStdinAvailable(): boolean {
  // Check whether stdin is a TTY in Bun
  try {
    return !process.stdin.isTTY
  } catch {
    return false
  }
}

/**
 * Insert command action handler
 * Accepts data, validates, executes the insert operation, and formats output
 */
export async function insertCommand(
  table: string,
  options: {
    data?: string
    dryRun?: boolean
    force?: boolean
    config?: string
  },
  command?: import('commander').Command
): Promise<void> {
  try {
    // 1. Validate table name
    if (!table || table.trim() === '') {
      throw new Error('Table name required')
    }
    table = table.trim()

    // 2. Get JSON data - priority: --data > stdin
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

    // 3. Parse JSON
    let data: Record<string, any>
    try {
      data = JSON.parse(jsonInput)
    } catch (error) {
      throw new Error(t_vars('errors.invalid_json', { message: (error as Error).message }))
    }

    // Validate data is an object, not an array or primitive
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('JSON must be an object (e.g. {"name":"Alice","email":"a@b.com"})')
    }

    // 4. Load configuration
    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" to configure database connection')
    }

    if (config.connection.system === 'mongodb') {
      console.error('此命令目前不支援 MongoDB')
      process.exit(1)
    }

    // 5. Create database adapter
    const adapter = AdapterFactory.createAdapter(config.connection as ConnectionOptions)
    await adapter.connect()

    try {
      // 6. Get table schema
      const schema = await adapter.getTableSchema(table)

      // 7. Create DataExecutor and execute INSERT
      const dbSystem = (config.connection.system === 'postgresql' ? 'postgresql' : 'mysql') as
        | 'postgresql'
        | 'mysql'
      // Construct blacklist validator from config
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      const executor = new DataExecutor(adapter, config.permission, dbSystem, blacklistValidator)
      const result = await executor.executeInsert(table, data, schema, {
        dryRun: options.dryRun,
        force: options.force,
      })

      // 8. Format output as JSON
      const output = {
        status: result.status,
        operation: result.operation,
        rows_affected: result.rows_affected,
        timestamp: result.timestamp,
        ...(result.sql && { sql: result.sql }),
        ...(result.error && { error: result.error }),
      }

      console.log(JSON.stringify(output, null, 2))

      // Exit with code 1 if there is an error
      if (result.status === 'error') {
        process.exit(1)
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    // Blacklist error
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

    // Permission error
    if (error instanceof PermissionError) {
      console.error(t_vars('errors.permission_denied', { required: error.requiredPermission }))
      console.error(`   Operation: ${error.classification.type}`)
      console.error(`   Message: ${error.message}`)
      process.exit(1)
    }

    // Connection error
    if (error instanceof ConnectionError) {
      console.error(t_vars('errors.connection_failed', { message: error.message }))
      process.exit(1)
    }

    // Validation or other errors
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
