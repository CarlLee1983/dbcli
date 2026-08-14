/**
 * dbcli update command
 * Updates rows in a database table via --where and --set flags
 */

import crypto from 'node:crypto'
import { t_vars } from '@/i18n/message-loader'
import { formatCliError, printLocalizedCliError } from '@/utils/cli-error'
import { presentConnectionError } from '@/utils/connection-error-message'
import {
  AdapterFactory,
  ConnectionError,
  type ConnectionOptions,
  type SqlConnectionOptions,
} from '@/adapters'
import { DataExecutor } from '@/core/data-executor'
import { confirmMutationInteractively } from '@/commands/mutation-confirm'
import { auditOutcomeForMutation } from '@/commands/mutation-audit'
import { configModule } from '@/core/config'
import { enforcePermission, PermissionError } from '@/core/permission-guard'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { resolveConfigPath } from '@/utils/config-path'
import { parseWhereClause } from '@/utils/where-parser'
import { previewUpdate } from '@/core/mongo/dry-run-formatter'
import { runDmlPlanAnalysis } from '@/commands/dml-plan'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { DbcliConfig } from '@/utils/validation'

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
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
    plan?: boolean
    format?: 'text' | 'json'
  },
  command?: import('commander').Command
): Promise<void> {
  let config: DbcliConfig | undefined
  try {
    // 1. Validate table name
    if (!table || table.trim() === '') {
      throw new Error('Table name required')
    }
    table = table.trim()

    // 2. Validate --where flag (relaxed under --plan; non-SQL engines may have
    // no meaningful WHERE clause and the planner handles empty filters itself).
    if (!options.plan && (!options.where || options.where.trim() === '')) {
      throw new Error('UPDATE requires --where clause (e.g. --where "id=1")')
    }

    // 3. Validate --set flag
    if (!options.set || options.set.trim() === '') {
      throw new Error('UPDATE requires --set flag with JSON data (e.g. --set \'{"name":"Bob"}\')')
    }

    // 4. Load configuration
    const configPath = resolveConfigPath(command, options)
    config = await configModule.read(configPath)
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

    // --plan branch: planner-only preflight, no adapter, no DB connection.
    // Engine-aware: SQL builds an analyzer SQL string internally; non-SQL engines
    // hit their own pure analyzers. Errors here mirror `dbcli plan`:
    // console.error + process.exit(1), not the JSON envelope used by the real
    // DML execution path.
    if (options.plan) {
      if (options.dryRun) {
        console.error('--plan cannot be used with --dry-run')
        process.exit(1)
        return
      }
      const rawWhere = options.where ?? ''
      let whereForPlan: Record<string, unknown> | null = null
      if (rawWhere.trim() !== '') {
        try {
          const parsed = JSON.parse(rawWhere) as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            whereForPlan = parsed as Record<string, unknown>
          }
        } catch {
          whereForPlan = null
        }
        if (whereForPlan === null) {
          try {
            whereForPlan = parseWhereClause(rawWhere)
          } catch {
            whereForPlan = {}
          }
        }
      }
      await runDmlPlanAnalysis(
        {
          operation: 'update',
          target: table,
          set: setData,
          where: whereForPlan,
          rawWhere,
        },
        { format: options.format, config: options.config },
        command
      )
      await writeAuditEntry(config, 'update', options, {
        success: true,
        target: table,
        metadata: { plan: true },
      })
      return
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
        await writeAuditEntry(config, 'update', options, {
          success: true,
          target: table,
          metadata: { rows_affected: 0, dry_run: true },
        })
        return
      }

      const adapter = AdapterFactory.createRedisAdapter(
        config.connection as ConnectionOptions,
        config.blacklist?.tables ?? []
      )
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
        await writeAuditEntry(config, 'update', options, {
          success: true,
          target: table,
          metadata: { rows_affected: result.affectedRows },
        })
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
      await writeAuditEntry(config, 'update', options, {
        success: false,
        target: table,
        error: new Error('Elasticsearch does not support update command'),
      })
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
        await writeAuditEntry(config, 'update', options, {
          success: true,
          target: table,
          metadata: { rows_affected: 0, dry_run: true },
        })
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
        await writeAuditEntry(config, 'update', options, {
          success: true,
          target: table,
          metadata: { rows_affected: result.affectedRows },
        })
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
    const adapter = AdapterFactory.createSqlAdapter(
      requireSqlConnection(config.connection as ConnectionOptions)
    )
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
        confirm: confirmMutationInteractively,
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

      await writeAuditEntry(config, 'update', options, auditOutcomeForMutation(result, table))

      // Exit with code 1 if there is an error
      if (result.status === 'error') {
        process.exit(1)
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    let auditId: string | null = null
    let envelopeId: string | undefined
    if (options.recovery === true) {
      envelopeId = crypto.randomUUID()
    }
    if (config) {
      auditId = await writeAuditEntry(config, 'update', options, {
        success: false,
        target: table,
        error,
        ...(envelopeId && { recovery_ref: envelopeId }),
      })
    }

    if (envelopeId !== undefined) {
      const { emitRecoveryEnvelope } = await import('@/core/recovery')
      emitRecoveryEnvelope(
        error,
        { operation: 'update', table, writeOperation: 'UPDATE' },
        { envelopeId, auditRef: auditId ?? undefined }
      )
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
      printLocalizedCliError(formatCliError(presentConnectionError(error)), error)
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
