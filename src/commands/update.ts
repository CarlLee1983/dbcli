/**
 * dbcli update command
 * Updates rows in a database table via --where and --set flags
 */

import { t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { DataExecutor } from '@/core/data-executor'
import { configModule } from '@/core/config'
import { enforcePermission, PermissionError } from '@/core/permission-guard'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { resolveConfigPath } from '@/utils/config-path'
import { previewUpdate } from '@/core/mongo/dry-run-formatter'

/**
 * Parses a WHERE clause string into a conditions object
 * e.g. "id=1" → { id: "1" }
 * e.g. "id=1 AND status='active'" → { id: "1", status: "active" }
 *
 * @param whereClause WHERE condition string
 * @returns Conditions object {column: value, ...}
 * @throws Error if the WHERE clause cannot be parsed
 */
function parseWhereClause(whereClause: string): Record<string, unknown> {
  if (!whereClause || whereClause.trim() === '') {
    throw new Error('WHERE clause cannot be empty')
  }

  const conditions: Record<string, unknown> = {}

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
    const trimmed = valueStr.trim()
    const stripped =
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
        ? trimmed.slice(1, -1)
        : trimmed

    let value: string | number | boolean | null = stripped
    if (stripped !== '' && !isNaN(Number(stripped))) {
      value = Number(stripped)
    }
    if (stripped === 'true') value = true
    else if (stripped === 'false') value = false
    else if (stripped === 'null') value = null

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
    recovery?: boolean
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

    // 4. Load configuration
    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" to configure database connection')
    }

    // 5. Parse --set JSON
    let setData: Record<string, unknown>
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

    if (config.connection?.system === 'redis') {
      enforcePermission('UPDATE dummy', config.permission)

      // Apply blacklist before opening any connection
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      blacklistValidator.checkTableBlacklist('UPDATE', table, [])

      // Redis update expects the key as 'table' and fields in 'setData'
      // We ignore 'where' for Redis since it's key-value based, or we could
      // treat 'table' as the key.
      if (options.dryRun) {
        const output = {
          status: 'success',
          operation: 'update',
          rows_affected: 0,
          sql: `HSET ${table} ... (Redis Update)`,
          timestamp: new Date().toISOString(),
        }
        console.log(JSON.stringify(output, null, 2))
        return
      }

      const adapter = AdapterFactory.createRedisAdapter(config.connection as ConnectionOptions)
      await adapter.connect()
      try {
        const result = await adapter.update(table, {}, setData)
        const output = {
          status: 'success',
          operation: 'update',
          rows_affected: result.affectedRows,
          timestamp: new Date().toISOString(),
        }
        console.log(JSON.stringify(output, null, 2))
        return
      } finally {
        await adapter.disconnect()
      }
    }

    if (config.connection?.system === 'elasticsearch') {
      const output = {
        status: 'error',
        operation: 'update',
        rows_affected: 0,
        timestamp: new Date().toISOString(),
        error:
          'Elasticsearch 不支援 update 指令；目前請使用外部工具（如 curl 或 Kibana DevTools）進行文件更新',
      }
      console.log(JSON.stringify(output, null, 2))
      process.exit(1)
    }

    if (config.connection?.system === 'mongodb') {
      enforcePermission('UPDATE dummy', config.permission)

      // Compute the update doc up-front so blacklist sees the real fields being written
      const hasOperator = Object.keys(setData).some((key) => key.startsWith('$'))
      const updateDoc = hasOperator ? setData : { $set: setData }

      // Collect top-level field names actually being written.
      // For operator docs we look inside $set / $unset (those write fields).
      const writtenFields = new Set<string>()
      if (hasOperator) {
        const operators = updateDoc as Record<string, unknown>
        for (const [op, payload] of Object.entries(operators)) {
          if (
            (op === '$set' || op === '$unset') &&
            payload &&
            typeof payload === 'object' &&
            !Array.isArray(payload)
          ) {
            for (const k of Object.keys(payload as Record<string, unknown>)) writtenFields.add(k)
          }
        }
      } else {
        for (const k of Object.keys(setData)) writtenFields.add(k)
      }

      // Apply blacklist before opening any connection
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      blacklistValidator.checkTableBlacklist('UPDATE', table, [])
      blacklistValidator.checkColumnBlacklistOnWrite(table, Array.from(writtenFields), 'UPDATE')

      let filter: Record<string, unknown>
      try {
        filter = JSON.parse(options.where)
      } catch {
        // If not JSON, try parsing as simple key=value pairs for convenience
        filter = parseWhereClause(options.where)
      }

      if (options.dryRun) {
        const output = {
          status: 'success',
          operation: 'update',
          rows_affected: 0,
          sql: previewUpdate(table, filter, updateDoc),
          timestamp: new Date().toISOString(),
        }
        console.log(JSON.stringify(output, null, 2))
        return
      }

      const adapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
      await adapter.connect()
      try {
        const result = await adapter.update(table, filter, updateDoc)
        const output = {
          status: 'success',
          operation: 'update',
          rows_affected: result.affectedRows,
          timestamp: new Date().toISOString(),
        }
        console.log(JSON.stringify(output, null, 2))
        return
      } finally {
        await adapter.disconnect()
      }
    }

    // 6. Parse WHERE condition string (SQL path)
    let whereConditions: Record<string, unknown>
    try {
      whereConditions = parseWhereClause(options.where)
    } catch (error) {
      throw new Error(`WHERE clause parsing failed: ${(error as Error).message}`)
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
    if (options.recovery === true) {
      const { emitRecoveryEnvelope } = await import('@/core/recovery')
      emitRecoveryEnvelope(error, {
        operation: 'update',
        table,
        writeOperation: 'UPDATE',
      })
    }

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
