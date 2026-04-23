/**
 * dbcli delete command
 * Deletes rows from a database table via --where flag (Admin only)
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
    throw new Error('DELETE requires --where clause (e.g. --where "id=1")')
  }

  const conditions: Record<string, any> = {}

  // Split AND conditions
  const andParts = whereClause.split(/\s+AND\s+/i)

  for (const part of andParts) {
    // Match "column=value" pattern
    const match = part.match(/^(\w+)\s*=\s*(.+)$/)
    if (!match || !match[1] || !match[2]) {
      throw new Error(
        `Cannot parse WHERE clause: "${part}". Use format "column=value" or "col1=val1 AND col2=val2"`
      )
    }

    const column: string = match[1]
    const valueStr: string = match[2]
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
 * Delete command action handler
 * Accepts table and where conditions, validates, executes the delete operation, and formats output
 * Restriction: Admin permission only
 */
export async function deleteCommand(
  table: string,
  options: {
    where: string
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

    // 2. Validate --where flag (required)
    if (!options.where || options.where.trim() === '') {
      throw new Error('DELETE requires --where clause (e.g. --where "id=1")')
    }

    // 3. Load configuration
    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" to configure database connection')
    }

    // 4. Validate permission (DELETE requires data-admin or admin)
    if (config.permission !== 'data-admin' && config.permission !== 'admin') {
      throw new PermissionError(
        t('delete.admin_only'),
        {
          type: 'DELETE',
          isDangerous: true,
          keywords: ['DELETE'],
          isComposite: false,
          confidence: 'HIGH',
        },
        config.permission
      )
    }

    if (config.connection?.system === 'mongodb') {
      const adapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
      await adapter.connect()
      try {
        let filter: Record<string, any>
        try {
          filter = JSON.parse(options.where)
        } catch {
          // If not JSON, try parsing as simple key=value pairs for convenience
          filter = parseWhereClause(options.where)
        }

        const result = await adapter.delete(table, filter)
        const output = {
          status: 'success',
          operation: 'delete',
          rows_affected: result.affectedRows,
          timestamp: new Date().toISOString(),
        }
        console.log(JSON.stringify(output, null, 2))
        return
      } finally {
        await adapter.disconnect()
      }
    }

    // 5. Parse WHERE condition string (SQL path)
    let whereConditions: Record<string, any>
    try {
      whereConditions = parseWhereClause(options.where)
    } catch (error) {
      throw new Error(`WHERE clause parsing failed: ${(error as Error).message}`)
    }

    // 6. Create database adapter
    const adapter = AdapterFactory.createAdapter(config.connection as ConnectionOptions)
    await adapter.connect()

    try {
      // 7. Get table schema
      const schema = await adapter.getTableSchema(table)

      // 8. Create DataExecutor and execute DELETE
      const dbSystem = (config.connection.system === 'postgresql' ? 'postgresql' : 'mysql') as
        | 'postgresql'
        | 'mysql'
      // Construct blacklist validator from config
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      const executor = new DataExecutor(adapter, config.permission, dbSystem, blacklistValidator)
      const result = await executor.executeDelete(table, whereConditions, schema, {
        dryRun: options.dryRun,
        force: options.force,
      })

      // 9. Format output as JSON
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
        operation: 'delete',
        rows_affected: 0,
        error: error.message,
      }
      console.log(JSON.stringify(output, null, 2))
      process.exit(1)
    }

    // Permission error
    if (error instanceof PermissionError) {
      console.error(t_vars('errors.permission_denied', { required: 'data-admin' }))
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
      operation: 'delete',
      rows_affected: 0,
      error: (error as Error).message,
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }
}
