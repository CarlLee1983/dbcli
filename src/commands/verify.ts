// src/commands/verify.ts
import { Command } from 'commander'
import {
  AdapterFactory,
  ConnectionError,
  type ConnectionOptions,
  type SqlConnectionOptions,
} from '@/adapters'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { QueryExecutor } from '@/core/query-executor'
import { analyzeQueryRisk } from '@/core/query-risk-analyzer'
import { parseExpect, AssertExpressionError } from '@/core/assert/grammar'
import { evaluateExpect, AssertShapeError } from '@/core/assert/evaluator'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import { writeVerificationArtifact } from '@/core/verification'
import type { BlacklistConfig } from '@/types/blacklist'
import type { TableSchema } from '@/adapters/types'
import {
  normalizeSafeBackfillInput,
  runSafeBackfillPreflight,
  runSafeBackfillAfterWrite,
  isPlainSelectVerifyQuery,
  isUpdateOperation,
  extractUpdateTargetTable,
  updateTargetMatchesTable,
  VerifyInputError,
  boundedReason,
  normalizeMigrationInput,
  runMigrationPreflight,
  runMigrationAfterWrite,
  classifyMigrationDdl,
  ddlTargetMatchesTable,
  extractAlterTableTarget,
  type SafeBackfillInput,
  type SafeBackfillRunners,
  type GuardOutcome,
  type AssertionOutcome,
  type PreflightResult,
  type AfterWriteResult,
  type MigrationInput,
  type MigrationRunners,
  type MigrationPreflightResult,
  type MigrationAfterWriteResult,
} from '@/core/verify'

const SQL_SYSTEMS = ['postgresql', 'mysql', 'mariadb']

function requireSqlConnection(
  connection: ConnectionOptions,
  scenario: string
): SqlConnectionOptions {
  if (!SQL_SYSTEMS.includes(connection.system)) {
    throw new Error(
      `verify ${scenario} currently supports SQL engines only, got: ${connection.system}`
    )
  }
  return connection as SqlConnectionOptions
}

interface RealRunnerContext {
  // Resolved once and shared across guards/assertion.
  adapter: ReturnType<typeof AdapterFactory.createSqlAdapter>
  config: Awaited<ReturnType<typeof configModule.read>>
  options: { config?: string }
  // The declared --table; the plan guard requires the UPDATE target to match it.
  targetTable: string
}

/** Build the production runners that touch config / adapter / analyzer. */
function buildRealRunners(ctx: RealRunnerContext): SafeBackfillRunners {
  const { adapter, config } = ctx
  const blacklist = (config.blacklist ?? { tables: [], columns: {} }) as BlacklistConfig
  const schema = (config.schema ?? {}) as Record<string, TableSchema>
  const schemaLookup = { tables: schema, cacheAvailable: Object.keys(schema).length > 0 }

  // analyze with the live connection permission (used for verify-query readonly check)
  const analyze = (sql: string) =>
    analyzeQueryRisk({ sql: sql.trim(), permission: config.permission, blacklist, schemaLookup })

  // analyzePlan uses read-write permission so the plan guard can approve a valid UPDATE
  // even when the connection is query-only. The plan guard validates structural safety
  // (UPDATE with WHERE, no mass-delete risk, etc.); connection permission is enforced
  // separately by the execution layer — which never actually runs the backfill write.
  const analyzePlan = (sql: string) =>
    analyzeQueryRisk({ sql: sql.trim(), permission: 'read-write', blacklist, schemaLookup })

  return {
    blacklistGuard: async (table): Promise<GuardOutcome> => {
      const bm = new BlacklistManager(config)
      if (bm.isTableBlacklisted(table) && !bm.canOverrideBlacklist()) {
        return { ok: false, reason: boundedReason(`Target table '${table}' is blacklisted.`) }
      }
      return { ok: true }
    },
    schemaGuard: async (table): Promise<GuardOutcome> => {
      try {
        await adapter.getTableSchema(table)
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: boundedReason(`schema check failed: ${(e as Error).message}`) }
      }
    },
    planGuard: async (query): Promise<GuardOutcome> => {
      const r = analyzePlan(query)
      if (!isUpdateOperation(r.operation)) {
        return {
          ok: false,
          reason: boundedReason(`--query must be an UPDATE statement (got ${r.operation}).`),
        }
      }
      if (r.decision === 'BLOCK') {
        const why = r.riskFactors[0]?.message ?? 'plan blocked the write'
        return { ok: false, reason: boundedReason(`plan blocked the write: ${why}`) }
      }
      if (!updateTargetMatchesTable(query, ctx.targetTable)) {
        const got = extractUpdateTargetTable(query) ?? 'unknown'
        return {
          ok: false,
          reason: boundedReason(
            `--query UPDATE target '${got}' must match --table '${ctx.targetTable}'.`
          ),
        }
      }
      return { ok: true }
    },
    verifyReadonlyGuard: async (verifyQuery): Promise<GuardOutcome> => {
      const r = analyze(verifyQuery)
      if (!isPlainSelectVerifyQuery(r.operation, verifyQuery)) {
        return {
          ok: false,
          reason: boundedReason(
            `--verify-query must be a read-only plain SELECT (got ${r.operation}).`
          ),
        }
      }
      return { ok: true }
    },
    runAssertion: async (input: SafeBackfillInput): Promise<AssertionOutcome> => {
      try {
        const blacklistValidator = new BlacklistValidator(new BlacklistManager(config))
        const executor = new QueryExecutor(
          adapter,
          config.permission,
          blacklistValidator,
          config,
          ctx.options
        )
        const result = await executor.execute(input.verifyQuery, { autoLimit: true })
        const check = evaluateExpect(parseExpect(input.expect), result)
        const auditRef = await writeAuditEntry(config, 'verify', ctx.options, {
          success: check.pass,
          sql: input.verifyQuery,
        })
        return { ran: true, pass: check.pass, auditRef }
      } catch (e) {
        // Expression/shape errors mean we can't trust a verdict -> indeterminate.
        if (e instanceof AssertExpressionError || e instanceof AssertShapeError) {
          return { ran: false, reason: boundedReason((e as Error).message) }
        }
        // Any other failure executing the read-back query is also indeterminate here
        // (guards already confirmed the query is read-only and the table exists).
        return { ran: false, reason: boundedReason((e as Error).message) }
      }
    },
  }
}

function buildMigrationRunners(ctx: RealRunnerContext): MigrationRunners {
  const { adapter, config } = ctx
  const blacklist = (config.blacklist ?? { tables: [], columns: {} }) as BlacklistConfig
  const schema = (config.schema ?? {}) as Record<string, TableSchema>
  const schemaLookup = { tables: schema, cacheAvailable: Object.keys(schema).length > 0 }

  const analyze = (sql: string) =>
    analyzeQueryRisk({ sql: sql.trim(), permission: config.permission, blacklist, schemaLookup })

  return {
    blacklistGuard: async (table): Promise<GuardOutcome> => {
      const bm = new BlacklistManager(config)
      if (bm.isTableBlacklisted(table) && !bm.canOverrideBlacklist()) {
        return { ok: false, reason: boundedReason(`Target table '${table}' is blacklisted.`) }
      }
      return { ok: true }
    },
    schemaGuard: async (table): Promise<GuardOutcome> => {
      try {
        await adapter.getTableSchema(table)
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: boundedReason(`schema check failed: ${(e as Error).message}`) }
      }
    },
    ddlGuard: async (ddl, table): Promise<GuardOutcome> => {
      // Structural MVP gate: single-statement ALTER TABLE only.
      const classified = classifyMigrationDdl(ddl)
      if (!classified.ok) return { ok: false, reason: classified.reason }
      // Defence in depth: the analyzer must also see this as DDL, never as DML/SELECT.
      const r = analyze(ddl)
      if (r.operation !== 'DDL') {
        return {
          ok: false,
          reason: boundedReason(`--ddl did not classify as DDL (got ${r.operation}).`),
        }
      }
      if (!ddlTargetMatchesTable(ddl, table)) {
        const got = extractAlterTableTarget(ddl) ?? 'unknown'
        return {
          ok: false,
          reason: boundedReason(`--ddl ALTER TABLE target '${got}' must match --table '${table}'.`),
        }
      }
      return { ok: true }
    },
    verifyReadonlyGuard: async (verifyQuery): Promise<GuardOutcome> => {
      const r = analyze(verifyQuery)
      if (!isPlainSelectVerifyQuery(r.operation, verifyQuery)) {
        return {
          ok: false,
          reason: boundedReason(
            `--verify-query must be a read-only plain SELECT (got ${r.operation}).`
          ),
        }
      }
      return { ok: true }
    },
    runAssertion: async (input: MigrationInput): Promise<AssertionOutcome> => {
      try {
        const blacklistValidator = new BlacklistValidator(new BlacklistManager(config))
        const executor = new QueryExecutor(
          adapter,
          config.permission,
          blacklistValidator,
          config,
          ctx.options
        )
        const result = await executor.execute(input.verifyQuery, { autoLimit: true })
        const check = evaluateExpect(parseExpect(input.expect), result)
        const auditRef = await writeAuditEntry(config, 'verify', ctx.options, {
          success: check.pass,
          sql: input.verifyQuery,
        })
        return { ran: true, pass: check.pass, auditRef }
      } catch (e) {
        if (e instanceof AssertExpressionError || e instanceof AssertShapeError) {
          return { ran: false, reason: boundedReason((e as Error).message) }
        }
        return { ran: false, reason: boundedReason((e as Error).message) }
      }
    },
  }
}

function renderPreflightTable(r: PreflightResult): string {
  const lines = [
    `Scenario:    ${r.scenario}`,
    `Mode:        preflight`,
    `Table:       ${r.table}`,
    `Status:      ${r.status}`,
    'Guards:',
  ]
  for (const g of r.guards) {
    lines.push(`  - ${g.name}: ${g.status}${g.reason ? ` (${g.reason})` : ''}`)
  }
  lines.push('', 'Planned update (you run this yourself; this command never executes it):')
  lines.push(`  ${r.plannedUpdate}`)
  lines.push('', 'After-write command (run AFTER you execute the approved backfill write):')
  lines.push(`  ${r.afterWriteCommand}`)
  lines.push('', 'Note: this scenario never executes the backfill write itself.')
  return lines.join('\n')
}

function renderAfterWriteTable(r: AfterWriteResult, artifactPath?: string): string {
  const lines = [
    `Scenario:    ${r.scenario}`,
    `Mode:        after-write`,
    `Table:       ${r.table}`,
    `Status:      ${r.status}`,
  ]
  if (r.assertion)
    lines.push(`Assertion:   ${r.assertion.expect} -> ${r.assertion.passed ? 'PASS' : 'FAIL'}`)
  if (r.blockedReason) lines.push(`Reason:      ${r.blockedReason}`)
  lines.push(`Summary:     ${r.artifact.summary}`)
  lines.push(`Artifact id: ${r.artifact.id}`)
  if (artifactPath) lines.push(`Artifact:    ${artifactPath}`)
  lines.push('', `Next: dbcli verification show ${r.artifact.id}`)
  return lines.join('\n')
}

function preflightJson(r: PreflightResult): unknown {
  return {
    scenario: r.scenario,
    mode: r.mode,
    status: r.status,
    table: r.table,
    plannedUpdate: r.plannedUpdate,
    guards: r.guards.map((g) => ({
      name: g.name,
      status: g.status,
      ...(g.reason ? { reason: g.reason } : {}),
    })),
    afterWriteCommand: r.afterWriteCommand,
  }
}

function afterWriteJson(r: AfterWriteResult, artifactPath?: string): unknown {
  return {
    scenario: r.scenario,
    mode: r.mode,
    status: r.status,
    table: r.table,
    artifact: {
      id: r.artifact.id,
      ...(artifactPath ? { path: artifactPath } : {}),
      subject: r.artifact.subject,
    },
    ...(r.assertion ? { assertion: r.assertion } : {}),
    ...(r.blockedReason ? { blockedReason: r.blockedReason } : {}),
  }
}

function renderMigrationPreflightTable(r: MigrationPreflightResult): string {
  const lines = [
    `Scenario:    ${r.scenario}`,
    `Mode:        preflight`,
    `Table:       ${r.table}`,
    `Status:      ${r.status}`,
    'Guards:',
  ]
  for (const g of r.guards) {
    lines.push(`  - ${g.name}: ${g.status}${g.reason ? ` (${g.reason})` : ''}`)
  }
  lines.push(
    '',
    'Planned migration DDL (you apply this externally; this command never executes it):'
  )
  lines.push(`  ${r.plannedDdl}`)
  lines.push('', 'After-write command (run AFTER the migration is applied externally):')
  lines.push(`  ${r.afterWriteCommand}`)
  lines.push('', 'Note: this scenario never executes the migration DDL itself.')
  return lines.join('\n')
}

function renderMigrationAfterWriteTable(
  r: MigrationAfterWriteResult,
  artifactPath?: string
): string {
  const lines = [
    `Scenario:    ${r.scenario}`,
    `Mode:        after-write`,
    `Table:       ${r.table}`,
    `Status:      ${r.status}`,
  ]
  if (r.assertion)
    lines.push(`Assertion:   ${r.assertion.expect} -> ${r.assertion.passed ? 'PASS' : 'FAIL'}`)
  if (r.blockedReason) lines.push(`Reason:      ${r.blockedReason}`)
  lines.push(`Summary:     ${r.artifact.summary}`)
  lines.push(`Artifact id: ${r.artifact.id}`)
  if (artifactPath) lines.push(`Artifact:    ${artifactPath}`)
  lines.push('', `Next: dbcli verification show ${r.artifact.id}`)
  return lines.join('\n')
}

function migrationPreflightJson(r: MigrationPreflightResult): unknown {
  return {
    scenario: r.scenario,
    mode: r.mode,
    status: r.status,
    table: r.table,
    plannedDdl: r.plannedDdl,
    guards: r.guards.map((g) => ({
      name: g.name,
      status: g.status,
      ...(g.reason ? { reason: g.reason } : {}),
    })),
    afterWriteCommand: r.afterWriteCommand,
  }
}

function migrationAfterWriteJson(r: MigrationAfterWriteResult, artifactPath?: string): unknown {
  return {
    scenario: r.scenario,
    mode: r.mode,
    status: r.status,
    table: r.table,
    artifact: {
      id: r.artifact.id,
      ...(artifactPath ? { path: artifactPath } : {}),
      subject: r.artifact.subject,
    },
    ...(r.assertion ? { assertion: r.assertion } : {}),
    ...(r.blockedReason ? { blockedReason: r.blockedReason } : {}),
  }
}

export const verifyCommand = new Command('verify').description(
  'Run verification scenarios (preflight or after-write). Never executes writes.'
)

verifyCommand
  .command('safe-backfill')
  .description(
    'Preflight or after-write verification for a safe backfill; never executes the UPDATE'
  )
  .requiredOption('--table <table>', 'Target table name')
  .requiredOption('--query <sql>', 'Proposed backfill UPDATE statement (analyzed, never executed)')
  .requiredOption('--verify-query <sql>', 'Read-only SELECT used by the final assertion')
  .requiredOption('--expect <expr>', 'Assertion expression, e.g. "rows == 0"')
  .option('--after-write', 'Run the read-back assertion and write a verification artifact', false)
  .option('--format <format>', 'Output format: table (default) or json', 'table')
  .option('--subject-name <name>', 'Optional artifact subject name (default: table)')
  .option('--summary <text>', 'Optional artifact summary override (after-write mode)')
  .action(async (options: Record<string, unknown>, command: Command) => {
    let input: SafeBackfillInput
    try {
      input = normalizeSafeBackfillInput({
        table: options.table,
        query: options.query,
        verifyQuery: options.verifyQuery,
        expect: options.expect,
        afterWrite: options.afterWrite === true,
        format: options.format,
        subjectName: options.subjectName,
        summary: options.summary,
      })
    } catch (e) {
      // Input errors fail closed before any DB connection.
      console.error(
        e instanceof VerifyInputError || e instanceof Error ? (e as Error).message : String(e)
      )
      process.exit(1)
    }

    try {
      const configPath = resolveConfigPath(command, options as { config?: string })
      const config = await configModule.read(configPath)
      if (!config.connection) {
        console.error('Database not configured. Run: dbcli init')
        process.exit(1)
      }
      const adapter = AdapterFactory.createSqlAdapter(
        requireSqlConnection(config.connection as ConnectionOptions, 'safe-backfill')
      )
      await adapter.connect()

      const runners = buildRealRunners({
        adapter,
        config,
        options: options as { config?: string },
        targetTable: input.table,
      })

      if (!input.afterWrite) {
        let result: PreflightResult
        try {
          result = await runSafeBackfillPreflight(input, runners)
        } finally {
          await adapter.disconnect()
        }
        if (input.format === 'json') console.log(JSON.stringify(preflightJson(result), null, 2))
        else console.log(renderPreflightTable(result))
        process.exit(result.status === 'ready' ? 0 : 1)
      }

      // After-write mode.
      let result: AfterWriteResult
      try {
        result = await runSafeBackfillAfterWrite(input, runners)
      } finally {
        await adapter.disconnect()
      }

      let artifactPath: string | undefined
      let artifactError: string | undefined
      try {
        artifactPath = await writeVerificationArtifact(process.cwd(), result.artifact)
      } catch (e) {
        artifactError = (e as Error).message
      }

      if (input.format === 'json') {
        console.log(
          JSON.stringify(
            {
              ...(afterWriteJson(result, artifactPath) as object),
              ...(artifactError ? { artifactError } : {}),
            },
            null,
            2
          )
        )
      } else {
        console.log(renderAfterWriteTable(result, artifactPath))
        if (artifactError) console.error(`Failed to write verification artifact: ${artifactError}`)
      }

      // Verified exits 0 only when the artifact also persisted; any other state exits 1.
      const verifiedOk = result.status === 'verified' && !artifactError
      process.exit(verifiedOk ? 0 : 1)
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
        if (error instanceof ConnectionError)
          error.hints.forEach((h) => console.error(`   Hint: ${h}`))
      }
      process.exit(1)
    }
  })

verifyCommand
  .command('migration')
  .description(
    'Preflight or after-write verification for an externally-applied migration; never executes DDL'
  )
  .requiredOption('--table <table>', 'Table affected by the migration')
  .requiredOption('--ddl <sql>', 'Proposed ALTER TABLE DDL (analyzed, never executed)')
  .requiredOption('--verify-query <sql>', 'Read-only SELECT used by the post-migration assertion')
  .requiredOption('--expect <expr>', 'Assertion expression, e.g. "value == 0"')
  .option('--after-write', 'Run the read-back assertion and write a verification artifact', false)
  .option('--format <format>', 'Output format: table (default) or json', 'table')
  .option('--subject-name <name>', 'Optional artifact subject name (default: table)')
  .option('--summary <text>', 'Optional artifact summary override (after-write mode)')
  .action(async (options: Record<string, unknown>, command: Command) => {
    let input: MigrationInput
    try {
      input = normalizeMigrationInput({
        table: options.table,
        ddl: options.ddl,
        verifyQuery: options.verifyQuery,
        expect: options.expect,
        afterWrite: options.afterWrite === true,
        format: options.format,
        subjectName: options.subjectName,
        summary: options.summary,
      })
    } catch (e) {
      console.error(
        e instanceof VerifyInputError || e instanceof Error ? (e as Error).message : String(e)
      )
      process.exit(1)
    }

    try {
      const configPath = resolveConfigPath(command, options as { config?: string })
      const config = await configModule.read(configPath)
      if (!config.connection) {
        console.error('Database not configured. Run: dbcli init')
        process.exit(1)
      }
      const adapter = AdapterFactory.createSqlAdapter(
        requireSqlConnection(config.connection as ConnectionOptions, 'migration')
      )
      await adapter.connect()

      const runners = buildMigrationRunners({
        adapter,
        config,
        options: options as { config?: string },
        targetTable: input.table,
      })

      if (!input.afterWrite) {
        let result: MigrationPreflightResult
        try {
          result = await runMigrationPreflight(input, runners)
        } finally {
          await adapter.disconnect()
        }
        if (input.format === 'json')
          console.log(JSON.stringify(migrationPreflightJson(result), null, 2))
        else console.log(renderMigrationPreflightTable(result))
        process.exit(result.status === 'ready' ? 0 : 1)
      }

      let result: MigrationAfterWriteResult
      try {
        result = await runMigrationAfterWrite(input, runners)
      } finally {
        await adapter.disconnect()
      }

      let artifactPath: string | undefined
      let artifactError: string | undefined
      try {
        artifactPath = await writeVerificationArtifact(process.cwd(), result.artifact)
      } catch (e) {
        artifactError = (e as Error).message
      }

      if (input.format === 'json') {
        console.log(
          JSON.stringify(
            {
              ...(migrationAfterWriteJson(result, artifactPath) as object),
              ...(artifactError ? { artifactError } : {}),
            },
            null,
            2
          )
        )
      } else {
        console.log(renderMigrationAfterWriteTable(result, artifactPath))
        if (artifactError) console.error(`Failed to write verification artifact: ${artifactError}`)
      }

      const verifiedOk = result.status === 'verified' && !artifactError
      process.exit(verifiedOk ? 0 : 1)
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
        if (error instanceof ConnectionError)
          error.hints.forEach((h) => console.error(`   Hint: ${h}`))
      }
      process.exit(1)
    }
  })
