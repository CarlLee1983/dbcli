/**
 * dbcli update command
 * Updates rows in a database table via --where and --set flags
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
 * Parses a WHERE clause string into a conditions object
 * e.g. "id=1" → { id: "1" }
 * e.g. "id=1 AND status='active'" → { id: "1", status: "active" }
 *
 * @param whereClause WHERE condition string
 * @returns Conditions object {column: value, ...}
 * @throws Error if the WHERE clause cannot be parsed
 */
function parseWhereClause(whereClause: string): Record<string, any> {
  if (!whereClause || whereClause.trim() === '') {
    throw new Error('WHERE clause cannot be empty')
  }

  const conditions: Record<string, any> = {}

  // Split AND conditions
  const andParts = whereClause.split(/\s+AND\s+/i)

  for (const part of andParts) {
    // Match "column=value" pattern
    const match = part.match(/^(\w+)\s*=\s*(.+)$/)
    if (!match) {
      throw new Error(
        `Cannot parse WHERE clause: "${part}". Use format "column=value" or "col1=val1 AND col2=val2"`
      )
    }

    const column = match[1]
    const valueStr = match[2]
    if (valueStr === undefined || column === undefined) {
      throw new Error(
        `Cannot parse WHERE clause: "${part}". Use format "column=value" or "col1=val1 AND col2=val2"`
      )
    }
    let value: any = valueStr.trim()

    // Strip quotes
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1)
    }

    // Attempt numeric conversion
    if (!isNaN(value) && value !== '') {
      value = Number(value)
    }

    // Handle true/false/null literals
    if (value === 'true') value = true
    if (value === 'false') value = false
    if (value === 'null') value = null

    conditions[column] = value
  }

  return conditions
}

/**
 * Update command action handler
 * Accepts table, where conditions, and set data, validates, executes the update, and formats output
 */
export async function updateCommand(
  table: string,
  options: {
    where: string
    set: string
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

    // 2. Validate --where flag
    if (!options.where || options.where.trim() === '') {
      throw new Error('UPDATE requires --where clause (e.g. --where "id=1")')
    }

    // 3. Validate --set flag
    if (!options.set || options.set.trim() === '') {
      throw new Error('UPDATE requires --set flag with JSON data (e.g. --set \'{"name":"Bob"}\')')
    }

    // 4. Parse WHERE condition string
    let whereConditions: Record<string, any>
    try {
      whereConditions = parseWhereClause(options.where)
    } catch (error) {
      throw new Error(`WHERE clause parsing failed: ${(error as Error).message}`)
    }

    // 5. Parse --set JSON
    let setData: Record<string, any>
    try {
      setData = JSON.parse(options.set)
    } catch (error) {
      throw new Error(t_vars('errors.invalid_json', { message: (error as Error).message }))
    }

    // Validate setData is an object, not an array or primitive
    if (!setData || typeof setData !== 'object' || Array.isArray(setData)) {
      throw new Error(
        'JSON in --set must be an object (e.g. {"name":"Bob","email":"b@example.com"})'
      )
    }

    // 6. Load configuration
    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" to configure database connection')
    }

    if (config.connection?.system === 'mongodb') {
      console.error('此命令目前不支援 MongoDB')
      process.exit(1)
    }

    // 7. Create database adapter
    const adapter = AdapterFactory.createAdapter(config.connection as ConnectionOptions)
    await adapter.connect()

    try {
      // 8. Get table schema
      const schema = await adapter.getTableSchema(table)

      // 9. Create DataExecutor and execute UPDATE
      const dbSystem = (config.connection.system === 'postgresql' ? 'postgresql' : 'mysql') as
        | 'postgresql'
        | 'mysql'
      // Construct blacklist validator from config
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      const executor = new DataExecutor(adapter, config.permission, dbSystem, blacklistValidator)
      const result = await executor.executeUpdate(table, setData, whereConditions, schema, {
        dryRun: options.dryRun,
        force: options.force,
      })

      // 10. Format output as JSON
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
        operation: 'update',
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
      operation: 'update',
      rows_affected: 0,
      error: (error as Error).message,
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }
}
