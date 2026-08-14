/**
 * dbcli delete command
 * Deletes rows from a database table via --where flag (Admin only)
 */

import crypto from 'node:crypto'
import { t, t_vars } from '@/i18n/message-loader'
import { formatCliError, printLocalizedCliError } from '@/utils/cli-error'
import { presentConnectionError } from '@/utils/connection-error-message'
import {
  AdapterFactory,
  ConnectionError,
  type ConnectionOptions,
  type SqlConnectionOptions,
} from '@/adapters'
import { DataExecutor } from '@/core/data-executor'
import { confirmDirectMutation, confirmMutationInteractively } from '@/commands/mutation-confirm'
import { auditOutcomeForMutation } from '@/commands/mutation-audit'
import {
  cancelledOutcome,
  humanOutputContext,
  printMutationFailure,
  printMutationOutcome,
} from '@/commands/mutation-outcome'
import type { DataExecutionResult } from '@/types/data'
import { configModule } from '@/core/config'
import {
  classificationForType,
  minimumPermissionFor,
  PermissionError,
  permitsOperation,
} from '@/core/permission-guard'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { resolveConfigPath } from '@/utils/config-path'
import { parseWhereClause } from '@/utils/where-parser'
import { previewDelete } from '@/core/mongo/dry-run-formatter'
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

    // Reject an unsupported --format before any connection, schema read, or
    // audit write — the way `dbcli export` validates its own formats.
    if (options.format !== undefined && options.format !== 'text' && options.format !== 'json') {
      throw new Error(t_vars('errors.invalid_output_format', { format: options.format }))
    }

    // 2. Validate --where flag (relaxed under --plan; non-SQL engines may have
    // no meaningful WHERE clause and the planner handles empty filters itself).
    if (!options.plan && (!options.where || options.where.trim() === '')) {
      throw new Error('DELETE requires --where clause (e.g. --where "id=1")')
    }

    // 3. Load configuration
    const configPath = resolveConfigPath(command, options)
    config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" to configure database connection')
    }

    // --plan branch: planner-only preflight, no adapter, no DB connection.
    // Engine-aware. Must come BEFORE the admin permission check so the analyzer
    // can return BLOCK on permission_denied for read-only / read-write users.
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
          operation: 'delete',
          target: table,
          where: whereForPlan,
          rawWhere,
        },
        { format: options.format, config: options.config },
        command
      )
      await writeAuditEntry(config, 'delete', options, {
        success: true,
        target: table,
        metadata: { plan: true },
      })
      return
    }

    // 4. Validate permission before opening a connection. The rule comes from
    // the permission guard so it cannot drift from the one the executor applies;
    // only the wording is this command's, because it is localised.
    if (!permitsOperation('DELETE', config.permission)) {
      throw new PermissionError(
        t('delete.admin_only'),
        classificationForType('DELETE'),
        minimumPermissionFor('DELETE')
      )
    }

    if (config.connection?.system === 'redis') {
      // Apply blacklist before opening any connection
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      blacklistValidator.checkTableBlacklist('DELETE', table, [])

      let filter: Record<string, unknown>
      try {
        filter = JSON.parse(options.where)
      } catch {
        // If not JSON, try parsing as simple key=value pairs for convenience
        filter = parseWhereClause(options.where)
      }

      const preview = `DEL ${table} (Redis Delete)`

      if (options.dryRun) {
        const output: DataExecutionResult = {
          status: 'dry_run',
          operation: 'delete',
          rows_affected: 0,
          sql: preview,
          timestamp: new Date().toISOString(),
        }
        printMutationOutcome(output, table, 0, humanOutputContext(options))
        await writeAuditEntry(config, 'delete', options, auditOutcomeForMutation(output, table))
        return
      }

      // Ask before writing, the same as the SQL path: this write never passes
      // through DataExecutor, so the confirmation it performs never ran here.
      if (
        !(await confirmDirectMutation({
          operation: 'delete',
          engine: 'redis',
          preview,
          destructive: true,
          force: options.force,
        }))
      ) {
        const output = cancelledOutcome('delete', preview)
        printMutationOutcome(output, table, 0, humanOutputContext(options))
        await writeAuditEntry(config, 'delete', options, auditOutcomeForMutation(output, table))
        return
      }

      const adapter = AdapterFactory.createRedisAdapter(
        config.connection as ConnectionOptions,
        config.blacklist?.tables ?? []
      )
      await adapter.connect()
      try {
        const startedAt = performance.now()
        const result = await adapter.delete(table, filter)
        const output: DataExecutionResult = {
          status: 'success',
          operation: 'delete',
          rows_affected: result.affectedRows,
          timestamp: new Date().toISOString(),
        }
        printMutationOutcome(
          output,
          table,
          performance.now() - startedAt,
          humanOutputContext(options)
        )
        await writeAuditEntry(config, 'delete', options, auditOutcomeForMutation(output, table))
        return
      } finally {
        await adapter.disconnect()
      }
    }

    if (config.connection?.system === 'elasticsearch') {
      const output = {
        status: 'error',
        operation: 'delete',
        rows_affected: 0,
        timestamp: new Date().toISOString(),
        error: t('delete.elasticsearch_unsupported'),
      }
      await writeAuditEntry(config, 'delete', options, {
        success: false,
        target: table,
        error: new Error('Elasticsearch does not support delete command'),
      })
      console.log(JSON.stringify(output, null, 2))
      process.exit(1)
    }

    if (config.connection?.system === 'mongodb') {
      // Apply blacklist before opening any connection
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      blacklistValidator.checkTableBlacklist('DELETE', table, [])

      let filter: Record<string, unknown>
      try {
        filter = JSON.parse(options.where)
      } catch {
        // If not JSON, try parsing as simple key=value pairs for convenience
        filter = parseWhereClause(options.where)
      }

      const preview = previewDelete(table, filter)

      if (options.dryRun) {
        const output: DataExecutionResult = {
          status: 'dry_run',
          operation: 'delete',
          rows_affected: 0,
          sql: preview,
          timestamp: new Date().toISOString(),
        }
        printMutationOutcome(output, table, 0, humanOutputContext(options))
        await writeAuditEntry(config, 'delete', options, auditOutcomeForMutation(output, table))
        return
      }

      // Ask before writing, the same as the SQL path: this write never passes
      // through DataExecutor, so the confirmation it performs never ran here.
      if (
        !(await confirmDirectMutation({
          operation: 'delete',
          engine: 'mongodb',
          preview,
          destructive: true,
          force: options.force,
        }))
      ) {
        const output = cancelledOutcome('delete', preview)
        printMutationOutcome(output, table, 0, humanOutputContext(options))
        await writeAuditEntry(config, 'delete', options, auditOutcomeForMutation(output, table))
        return
      }

      const adapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
      await adapter.connect()
      try {
        const startedAt = performance.now()
        const result = await adapter.delete(table, filter)
        const output: DataExecutionResult = {
          status: 'success',
          operation: 'delete',
          rows_affected: result.affectedRows,
          timestamp: new Date().toISOString(),
        }
        printMutationOutcome(
          output,
          table,
          performance.now() - startedAt,
          humanOutputContext(options)
        )
        await writeAuditEntry(config, 'delete', options, auditOutcomeForMutation(output, table))
        return
      } finally {
        await adapter.disconnect()
      }
    }

    // 5. Parse WHERE condition string (SQL path)
    let whereConditions: Record<string, unknown>
    try {
      whereConditions = parseWhereClause(options.where)
    } catch (error) {
      throw new Error(`WHERE clause parsing failed: ${(error as Error).message}`)
    }

    // 6. Create database adapter
    const adapter = AdapterFactory.createSqlAdapter(
      requireSqlConnection(config.connection as ConnectionOptions)
    )
    await adapter.connect()

    try {
      // 7. Get table schema
      const schema = await adapter.getTableSchema(table)

      // 7b. The tier-two gate (#70). `--where "status=active"` reads like a
      // filter and deletes like a full-table statement; the schema is what
      // separates the two.
      // A dry run sends nothing, so there is nothing to gate — and the
      // documented habit is to preview first, which the gate would otherwise
      // refuse before it could be useful.
      const { guardStructuredWrite } = await import('./write-gate-guard')
      if (
        options.dryRun !== true &&
        !(await guardStructuredWrite({
          operation: 'delete',
          table,
          where: whereConditions,
          schema,
          config,
          options,
        }))
      ) {
        const cancelled = cancelledOutcome('delete', `DELETE FROM ${table}`)
        printMutationOutcome(cancelled, table, 0, humanOutputContext(options))
        await writeAuditEntry(config, 'delete', options, auditOutcomeForMutation(cancelled, table))
        return
      }

      // 8. Create DataExecutor and execute DELETE
      const dbSystem = (config.connection.system === 'postgresql' ? 'postgresql' : 'mysql') as
        | 'postgresql'
        | 'mysql'
      // Construct blacklist validator from config
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      const executor = new DataExecutor(adapter, config.permission, dbSystem, blacklistValidator)
      const startedAt = performance.now()
      const result = await executor.executeDelete(table, whereConditions, schema, {
        dryRun: options.dryRun,
        force: options.force,
        confirm: confirmMutationInteractively,
      })
      const elapsedMs = performance.now() - startedAt

      // 9. Report the outcome — prose for a person, the envelope for anything else
      const recoveryEnvelopeId =
        result.status === 'error' && options.recovery === true ? crypto.randomUUID() : undefined
      const auditId = await writeAuditEntry(
        config,
        'delete',
        options,
        auditOutcomeForMutation(result, table, recoveryEnvelopeId)
      )

      if (recoveryEnvelopeId !== undefined) {
        const { emitRecoveryEnvelope } = await import('@/core/recovery')
        emitRecoveryEnvelope(
          new Error(result.error ?? 'DELETE failed'),
          { operation: 'delete', table, writeOperation: 'DELETE' },
          { envelopeId: recoveryEnvelopeId, auditRef: auditId ?? undefined }
        )
      }

      printMutationOutcome(result, table, elapsedMs, humanOutputContext(options))

      // Exit with code 1 if there is an error
      if (result.status === 'error') {
        process.exit(1)
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    // A refusal by the write gate is not a failed statement: the gate already
    // wrote its own audit row with the tier and reason, and `--recovery` has no
    // plan to offer for something that was never sent.
    const { WriteGateRefusal } = await import('@/commands/write-gate-prompt')
    if (error instanceof WriteGateRefusal) {
      printMutationFailure(error, 'delete', humanOutputContext(options))
      process.exit(1)
    }

    let auditId: string | null = null
    let envelopeId: string | undefined
    if (options.recovery === true) {
      envelopeId = crypto.randomUUID()
    }
    if (config) {
      auditId = await writeAuditEntry(config, 'delete', options, {
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
        { operation: 'delete', table, writeOperation: 'DELETE' },
        { envelopeId, auditRef: auditId ?? undefined }
      )
    }

    // Blacklist error
    if (error instanceof BlacklistError) {
      printMutationFailure(error, 'delete', humanOutputContext(options))
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
    printMutationFailure(error as Error, 'delete', humanOutputContext(options))
    process.exit(1)
  }
}
