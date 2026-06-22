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
import { evaluateExpect, AssertShapeError, firstScalar } from '@/core/assert/evaluator'
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
  classifyMigrationTarget,
  isSingleStatement,
  isAlterTableDdl,
  extractAlterTableTarget,
  ddlTargetMatchesTable,
  normalizeRollbackInput,
  runRollbackPreflight,
  runRollbackAfterWrite,
  normalizeConstraintInput,
  buildViolationQuery,
  runConstraintPreflight,
  runConstraintAfterWrite,
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
  type RollbackInput,
  type RollbackRunners,
  type RollbackPreflightResult,
  type RollbackAfterWriteResult,
  type ConstraintInput,
  type ConstraintRunners,
  type ConstraintEngine,
  type ConstraintPreflightResult,
  type ConstraintAfterWriteResult,
  type ViolationCountOutcome,
  type RealRunnerContext,
  type VerifyScenarioDefinition,
  type VerifyScenarioInputBase,
  type AnyVerifyScenario,
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
      // Target must be fully parsable AND match --table; the helper distinguishes
      // an unparsable target from a clean mismatch in its bounded reason.
      const targetCheck = classifyMigrationTarget(ddl, table)
      if (!targetCheck.ok) return { ok: false, reason: targetCheck.reason }
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

/**
 * Build the rollback runners. The statement guard branches on `input.kind` and
 * reuses the sibling scenarios' predicates (no duplicated safety logic): the DDL
 * path reuses the migration ALTER TABLE classifiers, the DML path reuses the
 * safe-backfill UPDATE plan checks. Bounded reasons name the actual `--statement`
 * flag rather than `--ddl` / `--query`.
 */
function buildRollbackRunners(ctx: RealRunnerContext, input: RollbackInput): RollbackRunners {
  const { adapter, config } = ctx
  const blacklist = (config.blacklist ?? { tables: [], columns: {} }) as BlacklistConfig
  const schema = (config.schema ?? {}) as Record<string, TableSchema>
  const schemaLookup = { tables: schema, cacheAvailable: Object.keys(schema).length > 0 }

  const analyze = (sql: string) =>
    analyzeQueryRisk({ sql: sql.trim(), permission: config.permission, blacklist, schemaLookup })
  // read-write so the plan guard can approve a valid reverting UPDATE even on a
  // query-only connection; the reverting write is never executed here.
  const analyzePlan = (sql: string) =>
    analyzeQueryRisk({ sql: sql.trim(), permission: 'read-write', blacklist, schemaLookup })

  const ddlStatementGuard = async (statement: string, table: string): Promise<GuardOutcome> => {
    if (!isSingleStatement(statement)) {
      return {
        ok: false,
        reason: boundedReason(
          '--statement must be a single statement (no `;`-separated statements).'
        ),
      }
    }
    if (!isAlterTableDdl(statement)) {
      return {
        ok: false,
        reason: boundedReason(
          '--statement must be an ALTER TABLE statement for --kind ddl; CREATE/DROP/INDEX are blocked.'
        ),
      }
    }
    const r = analyze(statement)
    if (r.operation !== 'DDL') {
      return {
        ok: false,
        reason: boundedReason(`--statement did not classify as DDL (got ${r.operation}).`),
      }
    }
    const target = extractAlterTableTarget(statement)
    if (target === null) {
      return {
        ok: false,
        reason: boundedReason(
          '--statement ALTER TABLE target could not be parsed under the supported identifier ' +
            'contract (simple or quoted names, up to catalog.schema.table).'
        ),
      }
    }
    if (!ddlTargetMatchesTable(statement, table)) {
      return {
        ok: false,
        reason: boundedReason(
          `--statement ALTER TABLE target '${target}' must match --table '${table}'.`
        ),
      }
    }
    return { ok: true }
  }

  const dmlStatementGuard = async (statement: string, table: string): Promise<GuardOutcome> => {
    const r = analyzePlan(statement)
    if (!isUpdateOperation(r.operation)) {
      return {
        ok: false,
        reason: boundedReason(
          `--statement must be an UPDATE statement for --kind dml (got ${r.operation}).`
        ),
      }
    }
    if (r.decision === 'BLOCK') {
      const why = r.riskFactors[0]?.message ?? 'plan blocked the write'
      return { ok: false, reason: boundedReason(`plan blocked the rollback write: ${why}`) }
    }
    if (!updateTargetMatchesTable(statement, table)) {
      const got = extractUpdateTargetTable(statement) ?? 'unknown'
      return {
        ok: false,
        reason: boundedReason(`--statement UPDATE target '${got}' must match --table '${table}'.`),
      }
    }
    return { ok: true }
  }

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
    statementGuard: input.kind === 'ddl' ? ddlStatementGuard : dmlStatementGuard,
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
    runAssertion: async (rollbackInput: RollbackInput): Promise<AssertionOutcome> => {
      try {
        const blacklistValidator = new BlacklistValidator(new BlacklistManager(config))
        const executor = new QueryExecutor(
          adapter,
          config.permission,
          blacklistValidator,
          config,
          ctx.options
        )
        const result = await executor.execute(rollbackInput.verifyQuery, { autoLimit: true })
        const check = evaluateExpect(parseExpect(rollbackInput.expect), result)
        const auditRef = await writeAuditEntry(config, 'verify', ctx.options, {
          success: check.pass,
          sql: rollbackInput.verifyQuery,
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

function constraintEngineOf(system: string): ConstraintEngine {
  // SQL_SYSTEMS guard already restricts to these three.
  return system as ConstraintEngine
}

function buildConstraintRunners(
  ctx: RealRunnerContext,
  input: ConstraintInput
): ConstraintRunners {
  const { adapter, config } = ctx
  const blacklist = (config.blacklist ?? { tables: [], columns: {} }) as BlacklistConfig
  const schema = (config.schema ?? {}) as Record<string, TableSchema>
  const schemaLookup = { tables: schema, cacheAvailable: Object.keys(schema).length > 0 }
  const analyze = (sql: string) =>
    analyzeQueryRisk({ sql: sql.trim(), permission: config.permission, blacklist, schemaLookup })

  const engine = constraintEngineOf(
    (config.connection as ConnectionOptions).system
  )
  const violationSql = buildViolationQuery(input, engine)

  const columnsExist = async (table: string, cols: string[]): Promise<string | null> => {
    const ts = await adapter.getTableSchema(table)
    const present = new Set(ts.columns.map((c) => c.name.toLowerCase()))
    const missing = cols.filter((c) => !present.has(c.trim().toLowerCase()))
    return missing.length > 0 ? `unknown column(s) on ${table}: ${missing.join(', ')}` : null
  }

  return {
    violationSql,
    blacklistGuard: async (): Promise<GuardOutcome> => {
      const bm = new BlacklistManager(config)
      const targets = [input.table, ...(input.references ? [input.references.table] : [])]
      for (const t of targets) {
        if (bm.isTableBlacklisted(t) && !bm.canOverrideBlacklist()) {
          return { ok: false, reason: boundedReason(`Target table '${t}' is blacklisted.`) }
        }
      }
      return { ok: true }
    },
    schemaGuard: async (): Promise<GuardOutcome> => {
      try {
        if (input.check !== 'custom') {
          const miss = await columnsExist(input.table, input.columns)
          if (miss) return { ok: false, reason: boundedReason(miss) }
        } else {
          await adapter.getTableSchema(input.table)
        }
        if (input.references) {
          const refMiss = await columnsExist(input.references.table, [input.references.column])
          if (refMiss) return { ok: false, reason: boundedReason(refMiss) }
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: boundedReason(`schema check failed: ${(e as Error).message}`) }
      }
    },
    violationReadonlyGuard: async (): Promise<GuardOutcome> => {
      const r = analyze(violationSql)
      if (!isPlainSelectVerifyQuery(r.operation, violationSql)) {
        return {
          ok: false,
          reason: boundedReason(
            `violation query must be a read-only plain SELECT (got ${r.operation}).`
          ),
        }
      }
      return { ok: true }
    },
    runViolationCount: async (): Promise<ViolationCountOutcome> => {
      try {
        const blacklistValidator = new BlacklistValidator(new BlacklistManager(config))
        const executor = new QueryExecutor(
          adapter,
          config.permission,
          blacklistValidator,
          config,
          ctx.options
        )
        const result = await executor.execute(violationSql, { autoLimit: true })
        const scalar = firstScalar(result)
        const auditRef = await writeAuditEntry(config, 'verify', ctx.options, {
          success: true,
          sql: violationSql,
        })
        if (scalar === null) {
          return { ran: false, reason: boundedReason('violation query returned no count'), auditRef }
        }
        const count = typeof scalar === 'number' ? scalar : Number(scalar)
        if (!Number.isFinite(count)) {
          return { ran: false, reason: boundedReason(`violation count not numeric: ${scalar}`), auditRef }
        }
        return { ran: true, count, auditRef }
      } catch (e) {
        return { ran: false, reason: boundedReason((e as Error).message) }
      }
    },
  }
}

function formatPreflightTable(r: PreflightResult): string {
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

function formatAfterWriteTable(r: AfterWriteResult, artifactPath?: string): string {
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

function buildPreflightJson(r: PreflightResult): unknown {
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

function buildAfterWriteJson(r: AfterWriteResult, artifactPath?: string): unknown {
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

function formatMigrationPreflightTable(r: MigrationPreflightResult): string {
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

function formatMigrationAfterWriteTable(
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

function buildMigrationPreflightJson(r: MigrationPreflightResult): unknown {
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

function buildMigrationAfterWriteJson(
  r: MigrationAfterWriteResult,
  artifactPath?: string
): unknown {
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

function formatRollbackPreflightTable(r: RollbackPreflightResult): string {
  const lines = [
    `Scenario:    ${r.scenario}`,
    `Mode:        preflight`,
    `Kind:        ${r.kind}`,
    `Table:       ${r.table}`,
    `Status:      ${r.status}`,
    'Guards:',
  ]
  for (const g of r.guards) {
    lines.push(`  - ${g.name}: ${g.status}${g.reason ? ` (${g.reason})` : ''}`)
  }
  lines.push(
    '',
    'Planned rollback statement (you apply this externally; this command never executes it):'
  )
  lines.push(`  ${r.plannedStatement}`)
  lines.push('', 'After-write command (run AFTER the rollback is applied externally):')
  lines.push(`  ${r.afterWriteCommand}`)
  lines.push('', 'Note: this scenario never executes the rollback statement itself.')
  return lines.join('\n')
}

function formatRollbackAfterWriteTable(r: RollbackAfterWriteResult, artifactPath?: string): string {
  const lines = [
    `Scenario:    ${r.scenario}`,
    `Mode:        after-write`,
    `Kind:        ${r.kind}`,
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

function buildRollbackPreflightJson(r: RollbackPreflightResult): unknown {
  return {
    scenario: r.scenario,
    mode: r.mode,
    status: r.status,
    kind: r.kind,
    table: r.table,
    plannedStatement: r.plannedStatement,
    guards: r.guards.map((g) => ({
      name: g.name,
      status: g.status,
      ...(g.reason ? { reason: g.reason } : {}),
    })),
    afterWriteCommand: r.afterWriteCommand,
  }
}

function buildRollbackAfterWriteJson(r: RollbackAfterWriteResult, artifactPath?: string): unknown {
  return {
    scenario: r.scenario,
    mode: r.mode,
    status: r.status,
    kind: r.kind,
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

function formatConstraintPreflightTable(r: ConstraintPreflightResult): string {
  const lines = [
    `Scenario:    ${r.scenario}`,
    `Mode:        preflight`,
    `Check:       ${r.check}`,
    `Table:       ${r.table}`,
    `Status:      ${r.status}`,
    'Guards:',
  ]
  for (const g of r.guards) {
    lines.push(`  - ${g.name}: ${g.status}${g.reason ? ` (${g.reason})` : ''}`)
  }
  if (r.baseline !== undefined) lines.push('', `Baseline violations: ${r.baseline}`)
  lines.push('', 'Violation query (read-only; this command never executes a write):')
  lines.push(`  ${r.violationSql}`)
  lines.push('', 'After-write command (run AFTER you apply your change externally):')
  lines.push(`  ${r.afterWriteCommand}`)
  lines.push(
    '',
    'Note: default verdict requires 0 violations; add --allow-preexisting --baseline <N> to tolerate pre-existing ones.'
  )
  return lines.join('\n')
}

function formatConstraintAfterWriteTable(
  r: ConstraintAfterWriteResult,
  artifactPath?: string
): string {
  const lines = [
    `Scenario:    ${r.scenario}`,
    `Mode:        after-write`,
    `Check:       ${r.check}`,
    `Table:       ${r.table}`,
    `Status:      ${r.status}`,
  ]
  if (r.assertion)
    lines.push(
      `Violations:  ${r.assertion.violations} (threshold <= ${r.assertion.threshold}) -> ${r.assertion.passed ? 'PASS' : 'FAIL'}`
    )
  if (r.blockedReason) lines.push(`Reason:      ${r.blockedReason}`)
  lines.push(`Summary:     ${r.artifact.summary}`)
  lines.push(`Artifact id: ${r.artifact.id}`)
  if (artifactPath) lines.push(`Artifact:    ${artifactPath}`)
  lines.push('', `Next: dbcli verification show ${r.artifact.id}`)
  return lines.join('\n')
}

function buildConstraintPreflightJson(r: ConstraintPreflightResult): unknown {
  return {
    scenario: r.scenario,
    mode: r.mode,
    status: r.status,
    check: r.check,
    table: r.table,
    violationSql: r.violationSql,
    ...(r.baseline !== undefined ? { baseline: r.baseline } : {}),
    guards: r.guards.map((g) => ({
      name: g.name,
      status: g.status,
      ...(g.reason ? { reason: g.reason } : {}),
    })),
    afterWriteCommand: r.afterWriteCommand,
  }
}

function buildConstraintAfterWriteJson(
  r: ConstraintAfterWriteResult,
  artifactPath?: string
): unknown {
  return {
    scenario: r.scenario,
    mode: r.mode,
    status: r.status,
    check: r.check,
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

// --- Scenario definitions -------------------------------------------------

const safeBackfillScenario: VerifyScenarioDefinition<
  SafeBackfillInput,
  SafeBackfillRunners,
  PreflightResult,
  AfterWriteResult
> = {
  name: 'safe-backfill',
  description:
    'Preflight or after-write verification for a safe backfill; never executes the UPDATE',
  subjectKind: 'table',
  configureOptions(command) {
    return command
      .requiredOption('--table <table>', 'Target table name')
      .requiredOption(
        '--query <sql>',
        'Proposed backfill UPDATE statement (analyzed, never executed)'
      )
      .requiredOption('--verify-query <sql>', 'Read-only SELECT used by the final assertion')
      .requiredOption('--expect <expr>', 'Assertion expression, e.g. "rows == 0"')
      .option(
        '--after-write',
        'Run the read-back assertion and write a verification artifact',
        false
      )
      .option('--format <format>', 'Output format: table (default) or json', 'table')
      .option('--subject-name <name>', 'Optional artifact subject name (default: table)')
      .option('--summary <text>', 'Optional artifact summary override (after-write mode)')
  },
  normalize(options) {
    return normalizeSafeBackfillInput({
      table: options.table,
      query: options.query,
      verifyQuery: options.verifyQuery,
      expect: options.expect,
      afterWrite: options.afterWrite === true,
      format: options.format,
      subjectName: options.subjectName,
      summary: options.summary,
    })
  },
  createRunners(context) {
    return buildRealRunners(context)
  },
  runPreflight(input, runners) {
    return runSafeBackfillPreflight(input, runners)
  },
  runAfterWrite(input, runners) {
    return runSafeBackfillAfterWrite(input, runners)
  },
  renderPreflight(result, format) {
    return format === 'json'
      ? JSON.stringify(buildPreflightJson(result), null, 2)
      : formatPreflightTable(result)
  },
  artifactOf(result) {
    return result.artifact
  },
  afterWriteJson(result, artifactPath) {
    return buildAfterWriteJson(result, artifactPath)
  },
  renderAfterWriteTable(result, artifactPath) {
    return formatAfterWriteTable(result, artifactPath)
  },
  isPreflightReady(result) {
    return result.status === 'ready'
  },
  isAfterWriteVerified(result, artifactError) {
    return result.status === 'verified' && !artifactError
  },
}

const migrationScenario: VerifyScenarioDefinition<
  MigrationInput,
  MigrationRunners,
  MigrationPreflightResult,
  MigrationAfterWriteResult
> = {
  name: 'migration',
  description:
    'Preflight or after-write verification for an externally-applied migration; never executes DDL',
  subjectKind: 'migration',
  configureOptions(command) {
    return command
      .requiredOption('--table <table>', 'Table affected by the migration')
      .requiredOption('--ddl <sql>', 'Proposed ALTER TABLE DDL (analyzed, never executed)')
      .requiredOption(
        '--verify-query <sql>',
        'Read-only SELECT used by the post-migration assertion'
      )
      .requiredOption('--expect <expr>', 'Assertion expression, e.g. "value == 0"')
      .option(
        '--after-write',
        'Run the read-back assertion and write a verification artifact',
        false
      )
      .option('--format <format>', 'Output format: table (default) or json', 'table')
      .option('--subject-name <name>', 'Optional artifact subject name (default: table)')
      .option('--summary <text>', 'Optional artifact summary override (after-write mode)')
  },
  normalize(options) {
    return normalizeMigrationInput({
      table: options.table,
      ddl: options.ddl,
      verifyQuery: options.verifyQuery,
      expect: options.expect,
      afterWrite: options.afterWrite === true,
      format: options.format,
      subjectName: options.subjectName,
      summary: options.summary,
    })
  },
  createRunners(context) {
    return buildMigrationRunners(context)
  },
  runPreflight(input, runners) {
    return runMigrationPreflight(input, runners)
  },
  runAfterWrite(input, runners) {
    return runMigrationAfterWrite(input, runners)
  },
  renderPreflight(result, format) {
    return format === 'json'
      ? JSON.stringify(buildMigrationPreflightJson(result), null, 2)
      : formatMigrationPreflightTable(result)
  },
  artifactOf(result) {
    return result.artifact
  },
  afterWriteJson(result, artifactPath) {
    return buildMigrationAfterWriteJson(result, artifactPath)
  },
  renderAfterWriteTable(result, artifactPath) {
    return formatMigrationAfterWriteTable(result, artifactPath)
  },
  isPreflightReady(result) {
    return result.status === 'ready'
  },
  isAfterWriteVerified(result, artifactError) {
    return result.status === 'verified' && !artifactError
  },
}

const rollbackScenario: VerifyScenarioDefinition<
  RollbackInput,
  RollbackRunners,
  RollbackPreflightResult,
  RollbackAfterWriteResult
> = {
  name: 'rollback',
  description:
    'Preflight or after-write verification for an externally-applied rollback (--kind ddl|dml); never executes the statement',
  subjectKind: 'rollback',
  configureOptions(command) {
    return command
      .requiredOption('--kind <kind>', 'Rollback statement kind: ddl (ALTER TABLE) or dml (UPDATE)')
      .requiredOption('--table <table>', 'Table affected by the rollback')
      .requiredOption(
        '--statement <sql>',
        'Proposed reverting statement (analyzed, never executed)'
      )
      .requiredOption(
        '--verify-query <sql>',
        'Read-only SELECT used by the post-rollback assertion'
      )
      .requiredOption('--expect <expr>', 'Assertion expression, e.g. "value == 0"')
      .option(
        '--after-write',
        'Run the read-back assertion and write a verification artifact',
        false
      )
      .option('--format <format>', 'Output format: table (default) or json', 'table')
      .option('--subject-name <name>', 'Optional artifact subject name (default: table)')
      .option('--summary <text>', 'Optional artifact summary override (after-write mode)')
  },
  normalize(options) {
    return normalizeRollbackInput({
      kind: options.kind,
      table: options.table,
      statement: options.statement,
      verifyQuery: options.verifyQuery,
      expect: options.expect,
      afterWrite: options.afterWrite === true,
      format: options.format,
      subjectName: options.subjectName,
      summary: options.summary,
    })
  },
  createRunners(context, input) {
    return buildRollbackRunners(context, input)
  },
  runPreflight(input, runners) {
    return runRollbackPreflight(input, runners)
  },
  runAfterWrite(input, runners) {
    return runRollbackAfterWrite(input, runners)
  },
  renderPreflight(result, format) {
    return format === 'json'
      ? JSON.stringify(buildRollbackPreflightJson(result), null, 2)
      : formatRollbackPreflightTable(result)
  },
  artifactOf(result) {
    return result.artifact
  },
  afterWriteJson(result, artifactPath) {
    return buildRollbackAfterWriteJson(result, artifactPath)
  },
  renderAfterWriteTable(result, artifactPath) {
    return formatRollbackAfterWriteTable(result, artifactPath)
  },
  isPreflightReady(result) {
    return result.status === 'ready'
  },
  isAfterWriteVerified(result, artifactError) {
    return result.status === 'verified' && !artifactError
  },
}

const constraintScenario: VerifyScenarioDefinition<
  ConstraintInput,
  ConstraintRunners,
  ConstraintPreflightResult,
  ConstraintAfterWriteResult
> = {
  name: 'constraint',
  description:
    'Preflight or after-write verification that a data-integrity invariant holds across your change (--check fk|not-null|unique|custom); never executes a write',
  subjectKind: 'table',
  configureOptions(command) {
    return command
      .requiredOption('--table <table>', 'Table the invariant is checked on')
      .requiredOption('--check <kind>', 'Constraint kind: fk | not-null | unique | custom')
      .option(
        '--column <name>',
        'Column to check (repeatable for not-null/unique; the child FK column for fk)',
        (val: string, prev: string[] = []) => [...prev, val]
      )
      .option('--references <table.column>', 'Referenced <table>.<column> (required for --check fk)')
      .option('--violation-query <sql>', 'Read-only SELECT counting violations (required for --check custom)')
      .option('--allow-preexisting', 'Tolerate pre-existing violations: verified when count <= --baseline', false)
      .option('--baseline <n>', 'Baseline violation count measured at preflight (use with --allow-preexisting)')
      .option('--after-write', 'Re-run the violation count and write a verification artifact', false)
      .option('--format <format>', 'Output format: table (default) or json', 'table')
      .option('--subject-name <name>', 'Optional artifact subject name (default: table)')
      .option('--summary <text>', 'Optional artifact summary override (after-write mode)')
  },
  normalize(options) {
    return normalizeConstraintInput({
      table: options.table,
      check: options.check,
      column: options.column,
      references: options.references,
      violationQuery: options.violationQuery,
      allowPreexisting: options.allowPreexisting === true,
      baseline: options.baseline,
      afterWrite: options.afterWrite === true,
      format: options.format,
      subjectName: options.subjectName,
      summary: options.summary,
    })
  },
  createRunners(context, input) {
    return buildConstraintRunners(context, input)
  },
  runPreflight(input, runners) {
    return runConstraintPreflight(input, runners)
  },
  runAfterWrite(input, runners) {
    return runConstraintAfterWrite(input, runners)
  },
  renderPreflight(result, format) {
    return format === 'json'
      ? JSON.stringify(buildConstraintPreflightJson(result), null, 2)
      : formatConstraintPreflightTable(result)
  },
  artifactOf(result) {
    return result.artifact
  },
  afterWriteJson(result, artifactPath) {
    return buildConstraintAfterWriteJson(result, artifactPath)
  },
  renderAfterWriteTable(result, artifactPath) {
    return formatConstraintAfterWriteTable(result, artifactPath)
  },
  isPreflightReady(result) {
    return result.status === 'ready'
  },
  isAfterWriteVerified(result, artifactError) {
    return result.status === 'verified' && !artifactError
  },
}

/** All built-in verify scenarios, in CLI registration order. */
export const BUILTIN_VERIFY_SCENARIOS: AnyVerifyScenario[] = [
  safeBackfillScenario,
  migrationScenario,
  rollbackScenario,
  constraintScenario,
]

// --- Generic command lifecycle -------------------------------------------

/**
 * The shared verify command lifecycle. Preserves the exact execution order and
 * exit-code rules both scenarios used before the registry: normalize (fail closed
 * before any DB connection) -> resolve config -> require SQL connection -> connect
 * once -> build runners -> run preflight/after-write -> render -> persist artifact
 * (after-write) -> disconnect in finally -> map state to exit code.
 */
async function executeScenario<
  Input extends VerifyScenarioInputBase,
  Runners,
  Preflight,
  AfterWrite,
>(
  def: VerifyScenarioDefinition<Input, Runners, Preflight, AfterWrite>,
  options: Record<string, unknown>,
  command: Command
): Promise<void> {
  let input: Input
  try {
    input = def.normalize(options)
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
      requireSqlConnection(config.connection as ConnectionOptions, def.name)
    )
    await adapter.connect()

    const runners = def.createRunners(
      { adapter, config, options: options as { config?: string }, targetTable: input.table },
      input
    )

    if (!input.afterWrite) {
      let result: Preflight
      try {
        result = await def.runPreflight(input, runners)
      } finally {
        await adapter.disconnect()
      }
      console.log(def.renderPreflight(result, input.format))
      process.exit(def.isPreflightReady(result) ? 0 : 1)
    }

    // After-write mode.
    let result: AfterWrite
    try {
      result = await def.runAfterWrite(input, runners)
    } finally {
      await adapter.disconnect()
    }

    let artifactPath: string | undefined
    let artifactError: string | undefined
    try {
      artifactPath = await writeVerificationArtifact(process.cwd(), def.artifactOf(result))
    } catch (e) {
      artifactError = (e as Error).message
    }

    if (input.format === 'json') {
      console.log(
        JSON.stringify(
          {
            ...(def.afterWriteJson(result, artifactPath) as object),
            ...(artifactError ? { artifactError } : {}),
          },
          null,
          2
        )
      )
    } else {
      console.log(def.renderAfterWriteTable(result, artifactPath))
      if (artifactError) console.error(`Failed to write verification artifact: ${artifactError}`)
    }

    // Verified exits 0 only when the artifact also persisted; any other state exits 1.
    process.exit(def.isAfterWriteVerified(result, artifactError) ? 0 : 1)
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message)
      if (error instanceof ConnectionError)
        error.hints.forEach((h) => console.error(`   Hint: ${h}`))
    }
    process.exit(1)
  }
}

/** Wire one scenario definition onto the parent verify command. */
function registerScenario<Input extends VerifyScenarioInputBase, Runners, Preflight, AfterWrite>(
  parent: Command,
  def: VerifyScenarioDefinition<Input, Runners, Preflight, AfterWrite>
): void {
  const command = parent.command(def.name).description(def.description)
  def.configureOptions(command)
  command.action((options: Record<string, unknown>, cmd: Command) =>
    executeScenario(def, options, cmd)
  )
}

export const verifyCommand = new Command('verify').description(
  'Run verification scenarios (preflight or after-write). Never executes writes.'
)

for (const scenario of BUILTIN_VERIFY_SCENARIOS) {
  registerScenario(verifyCommand, scenario)
}
