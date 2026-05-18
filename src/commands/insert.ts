/**
 * dbcli insert command
 * Inserts data into a database table via JSON stdin or --data flag
 */

import crypto from 'node:crypto'
import { t_vars } from '@/i18n/message-loader'
import {
  AdapterFactory,
  ConnectionError,
  type ConnectionOptions,
  type SqlConnectionOptions,
} from '@/adapters'
import { DataExecutor } from '@/core/data-executor'
import { configModule } from '@/core/config'
import { enforcePermission, PermissionError } from '@/core/permission-guard'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { resolveConfigPath } from '@/utils/config-path'
import { previewInsert } from '@/core/mongo/dry-run-formatter'
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
    let data: Record<string, unknown>
    try {
      data = JSON.parse(jsonInput)
    } catch (error) {
      throw new Error(t_vars('errors.invalid_json', { message: (error as Error).message }))
    }

    // Validate data is an object, not an array or primitive
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('JSON must be an object (e.g. {"name":"Alice","email":"a@b.com"})')
    }

    // 4. Load configuration (hoisted above --plan so audit-on-failure has it).
    const configPath = resolveConfigPath(command, options)
    config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" to configure database connection')
    }

    // --plan branch: planner-only preflight, no adapter, no DB connection.
    // Engine-aware: SQL builds an analyzer SQL string internally; MongoDB / Redis /
    // Elasticsearch hit their own pure analyzers. Errors here mirror `dbcli plan`:
    // console.error + process.exit(1), not the JSON envelope used by the real
    // DML execution path.
    if (options.plan) {
      if (options.dryRun) {
        console.error('--plan cannot be used with --dry-run')
        process.exit(1)
        return
      }
      await runDmlPlanAnalysis(
        { operation: 'insert', target: table, data },
        { format: options.format, config: options.config },
        command
      )
      await writeAuditEntry(config, 'insert', options, {
        success: true,
        target: table,
        metadata: { plan: true },
      })
      return
    }

    if (config.connection.system === 'redis') {
      enforcePermission('INSERT INTO dummy', config.permission)

      // Apply blacklist before opening any connection
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      blacklistValidator.checkTableBlacklist('INSERT', table, [])
      blacklistValidator.checkColumnBlacklistOnWrite(table, Object.keys(data), 'INSERT')

      if (options.dryRun) {
        const output = {
          status: 'success',
          operation: 'insert',
          rows_affected: 0,
          sql: `SET ${table} ... (Redis Insert)`,
          timestamp: new Date().toISOString(),
        }
        console.log(JSON.stringify(output, null, 2))
        await writeAuditEntry(config, 'insert', options, {
          success: true,
          target: table,
          metadata: { rows_affected: 0, dry_run: true },
        })
        return
      }

      const adapter = AdapterFactory.createRedisAdapter(config.connection as ConnectionOptions)
      await adapter.connect()
      try {
        const result = await adapter.insert(table, data)
        const output = {
          status: 'success',
          operation: 'insert',
          rows_affected: result.affectedRows,
          timestamp: new Date().toISOString(),
        }
        console.log(JSON.stringify(output, null, 2))
        await writeAuditEntry(config, 'insert', options, {
          success: true,
          target: table,
          metadata: { rows_affected: result.affectedRows },
        })
        return
      } finally {
        await adapter.disconnect()
      }
    }

    if (config.connection.system === 'elasticsearch') {
      const output = {
        status: 'error',
        operation: 'insert',
        rows_affected: 0,
        timestamp: new Date().toISOString(),
        error:
          'Elasticsearch 不支援 insert 指令；目前請使用外部工具（如 curl 或 Kibana DevTools）進行文件寫入',
      }
      await writeAuditEntry(config, 'insert', options, {
        success: false,
        target: table,
        error: new Error('Elasticsearch does not support insert command'),
      })
      console.log(JSON.stringify(output, null, 2))
      process.exit(1)
    }

    if (config.connection.system === 'mongodb') {
      enforcePermission('INSERT INTO dummy', config.permission)

      // Apply blacklist before opening any connection
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      blacklistValidator.checkTableBlacklist('INSERT', table, [])
      blacklistValidator.checkColumnBlacklistOnWrite(table, Object.keys(data), 'INSERT')

      if (options.dryRun) {
        const output = {
          status: 'success',
          operation: 'insert',
          rows_affected: 0,
          sql: previewInsert(table, data),
          timestamp: new Date().toISOString(),
        }
        console.log(JSON.stringify(output, null, 2))
        await writeAuditEntry(config, 'insert', options, {
          success: true,
          target: table,
          metadata: { rows_affected: 0, dry_run: true },
        })
        return
      }

      const adapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
      await adapter.connect()
      try {
        const result = await adapter.insert(table, data)
        const output = {
          status: 'success',
          operation: 'insert',
          rows_affected: result.affectedRows,
          timestamp: new Date().toISOString(),
          lastInsertId: result.lastInsertId,
        }
        console.log(JSON.stringify(output, null, 2))
        await writeAuditEntry(config, 'insert', options, {
          success: true,
          target: table,
          metadata: { rows_affected: result.affectedRows },
        })
        return
      } finally {
        await adapter.disconnect()
      }
    }

    // 5. Create database adapter
    const adapter = AdapterFactory.createSqlAdapter(
      requireSqlConnection(config.connection as ConnectionOptions)
    )
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

      await writeAuditEntry(config, 'insert', options, {
        success: result.status === 'success',
        target: table,
        ...(result.sql && { sql: result.sql }),
        metadata: {
          rows_affected: result.rows_affected,
          ...(options.dryRun && { dry_run: true }),
        },
        ...(result.status === 'error' && {
          error: new Error(result.error ?? 'insert failed'),
        }),
      })

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
      auditId = await writeAuditEntry(config, 'insert', options, {
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
        { operation: 'insert', table, writeOperation: 'INSERT' },
        { envelopeId, auditRef: auditId ?? undefined }
      )
    }

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
