/**
 * `--agent-output` for `query` and `q`: builds the Operation envelope and owns
 * the mapping from whatever went wrong to a stable error code.
 *
 * Both commands call in here at the CLI boundary only. Nothing in this module
 * prints; the caller turns the returned exit code into `process.exit`.
 */

import type { Command } from 'commander'
import { ConnectionError, DATABASE_SYSTEMS, type DatabaseSystem } from '@/adapters/types'
import { BlacklistRejection } from '@/adapters/redis/types'
import { classifyError } from '@/core/recovery/classify'
import type { RecoveryContext, RecoveryEnvelope } from '@/core/recovery/types'
import { PermissionError } from '@/core/permission-guard'
import { SavedQueryError } from '@/core/saved-queries/types'
import { BlacklistError } from '@/types/blacklist'
import { ConfigError } from '@/utils/errors'
import { mapCliError } from '@/utils/cli-error'
import { IS_TRANSPORT_FAILURE } from '@/utils/connection-error-message'
import { isCorrelationId } from '@/core/correlation-id'
import {
  EVIDENCE_ID,
  MAX_OPERATION_ENVELOPE_IDENTIFIER_LENGTH,
  OPERATION_ENVELOPE_SCHEMA_VERSION,
  type OperationEnvelope,
  type OperationEnvelopeContext,
  type OperationEnvelopeError,
  type OperationEnvelopeEvidenceReference,
  type OperationEnvelopeQueryCell,
  type OperationEnvelopeQueryData,
  type OperationEnvelopeQueryOperation,
  type OperationEnvelopeWarning,
} from '@/core/operation-envelope'
import { emitAgentOutputEnvelope } from '@/utils/agent-output'
import { t } from '@/i18n/message-loader'
import type { Permission } from '@/types'
import type { QueryResult } from '@/types/query'
import type { DbcliConfig } from '@/utils/validation'

const MAX_MESSAGE_LENGTH = 2_000

const EXIT_FAILED = 1
const EXIT_INVALID_INPUT = 2

/** `input`: the caller's own arguments. `execution`: everything after they were accepted. */
export type QueryAgentPhase = 'input' | 'execution'

/** The saved query would run on an engine this release does not wrap in an envelope. */
export class AgentOutputUnsupportedEngineError extends Error {
  constructor(engine: string) {
    super(`--agent-output does not cover saved queries on ${engine} connections yet.`)
    this.name = 'AgentOutputUnsupportedEngineError'
    Object.setPrototypeOf(this, AgentOutputUnsupportedEngineError.prototype)
  }
}

export function agentOutputRequested(command: Command | undefined): boolean {
  return command?.optsWithGlobals<Record<string, unknown>>().agentOutput === true
}

function correlationIdOf(command: Command | undefined): string | undefined {
  const value = command?.optsWithGlobals<Record<string, unknown>>().correlationId
  return isCorrelationId(value) ? value : undefined
}

function bound(message: string, fallback = 'The operation failed.'): string {
  const trimmed = message.trim()
  return (trimmed === '' ? fallback : trimmed).slice(0, MAX_MESSAGE_LENGTH)
}

function stripMarker(message: string): string {
  return message.replace(/^(?:\s|\u26A0|\u2139|\uFE0F)+/u, '')
}

function isDatabaseSystem(value: unknown): value is DatabaseSystem {
  return typeof value === 'string' && (DATABASE_SYSTEMS as readonly string[]).includes(value)
}

function connectionNameOf(config: DbcliConfig | undefined): string | undefined {
  return (config as { effectiveConnectionName?: string } | undefined)?.effectiveConnectionName
}

function contextFor(
  config: DbcliConfig | undefined,
  permission: Permission | undefined,
  correlationId: string | undefined
): OperationEnvelopeContext | null {
  const engine = config?.connection?.system
  if (config === undefined || !isDatabaseSystem(engine)) return null
  const name = connectionNameOf(config)
  return {
    engine,
    permission: permission ?? config.permission,
    connectionName: name ? name.slice(0, MAX_OPERATION_ENVELOPE_IDENTIFIER_LENGTH) : null,
    agentMode: process.env.DBCLI_AGENT_MODE === '1',
    ...(correlationId !== undefined && { correlationId }),
  }
}

/** Collapse a value into one JSON scalar, so rows keep a strict, flat shape. */
function toCell(value: unknown): OperationEnvelopeQueryCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  return JSON.stringify(value) ?? null
}

function toRow(row: unknown): Record<string, OperationEnvelopeQueryCell> {
  if (row === null || typeof row !== 'object' || Array.isArray(row) || row instanceof Uint8Array) {
    return { value: toCell(row) }
  }
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toCell(value)]))
}

const ROW_RETURNING_STATEMENTS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'])
const NON_SQL_ENGINES = new Set<string>(['mongodb', 'redis', 'elasticsearch'])

function rowsAffectedOf(
  result: QueryResult<Record<string, unknown>>,
  engine: string | undefined
): number | null {
  if (engine === undefined || NON_SQL_ENGINES.has(engine)) return null
  if (ROW_RETURNING_STATEMENTS.has(String(result.metadata?.statement))) return null
  const affected = result.metadata?.affectedRows
  return typeof affected === 'number' && Number.isInteger(affected) && affected >= 0 ? affected : 0
}

function toQueryData(
  result: QueryResult<Record<string, unknown>>,
  engine: string | undefined
): OperationEnvelopeQueryData {
  const rows = result.rows.map(toRow)
  return {
    columnNames: [...result.columnNames],
    rows,
    rowCount: rows.length,
    rowsAffected: rowsAffectedOf(result, engine),
    truncated: result.appliedLimit?.truncated ?? false,
    limitApplied: result.appliedLimit?.limitApplied ?? null,
  }
}

/** Executor diagnostics are prose; this is the one place that gives them codes. */
function warningFromDiagnostic(diagnostic: string): OperationEnvelopeWarning {
  const message = bound(stripMarker(diagnostic))
  if (/^Query-only mode: auto-limiting/.test(message)) {
    return {
      code: 'AUTO_LIMIT_APPLIED',
      message: bound(`${message}. Pass --limit <n> to choose the row limit.`),
    }
  }
  if (/^Warning: executing .* operation \(admin mode\)/.test(message)) {
    return { code: 'DANGEROUS_OPERATION', message }
  }
  return { code: 'QUERY_DIAGNOSTIC', message }
}

export interface QueryAgentWarningSources {
  diagnostics?: readonly string[]
  notices?: readonly string[]
  /** Warnings the caller already coded (saved-query warnings, size-guard cap). */
  extra?: readonly OperationEnvelopeWarning[]
}

function collectWarnings(
  result: QueryResult<Record<string, unknown>>,
  sources: QueryAgentWarningSources
): OperationEnvelopeWarning[] {
  const warnings: OperationEnvelopeWarning[] = []
  for (const diagnostic of sources.diagnostics ?? []) {
    warnings.push(warningFromDiagnostic(diagnostic))
  }
  const redactions = [result.metadata?.securityNotification, ...(sources.notices ?? [])].filter(
    (notice): notice is string => typeof notice === 'string' && notice.trim() !== ''
  )
  for (const notice of redactions) {
    warnings.push({ code: 'BLACKLIST_COLUMNS_REDACTED', message: bound(stripMarker(notice)) })
  }
  const advisory = result.metadata?.performanceAdvisory
  if (advisory) {
    warnings.push({
      code: 'SLOW_QUERY',
      message: bound(
        `Query took ${advisory.executionTimeMs}ms (threshold ${advisory.thresholdMs}ms). ${advisory.recommendation}`
      ),
    })
  }
  warnings.push(...(sources.extra ?? []))
  return warnings
}

function auditEvidence(auditId: string | null | undefined): OperationEnvelopeEvidenceReference[] {
  return auditId && EVIDENCE_ID.test(auditId) ? [{ kind: 'audit', id: auditId }] : []
}

export interface QueryAgentSuccessInput extends QueryAgentWarningSources {
  operation: OperationEnvelopeQueryOperation
  command: Command | undefined
  config: DbcliConfig
  effectivePermission?: Permission
  result: QueryResult<Record<string, unknown>>
  auditId?: string | null
}

/** Emit the success envelope and return the process exit code. */
export function emitQuerySuccess(input: QueryAgentSuccessInput): number {
  const envelope: OperationEnvelope = {
    schemaVersion: OPERATION_ENVELOPE_SCHEMA_VERSION,
    ok: true,
    operation: input.operation,
    status: 'succeeded',
    context: contextFor(input.config, input.effectivePermission, correlationIdOf(input.command)),
    data: toQueryData(input.result, input.config.connection?.system),
    warnings: collectWarnings(input.result, input),
    evidence: auditEvidence(input.auditId),
    recovery: null,
    error: null,
  }
  return emitAgentOutputEnvelope(envelope, 0)
}

interface ClassifiedFailure {
  error: OperationEnvelopeError
  recovery: RecoveryEnvelope | null
  exitCode: typeof EXIT_FAILED | typeof EXIT_INVALID_INPUT
}

/** Saved-query codes that mean the caller's call was wrong, not that the run failed. */
const SAVED_QUERY_INPUT_CODES = new Set<SavedQueryError['code']>([
  'NOT_FOUND',
  'AMBIGUOUS',
  'PARAM_MISSING',
  'PARAM_INVALID',
])

async function classifyFailure(
  error: unknown,
  phase: QueryAgentPhase,
  recoveryContext: RecoveryContext,
  config: DbcliConfig | undefined
): Promise<ClassifiedFailure> {
  const message = bound(mapCliError(error).message)

  if (phase === 'input') {
    return {
      error: { code: 'INVALID_QUERY_INPUT', message },
      recovery: null,
      exitCode: EXIT_INVALID_INPUT,
    }
  }
  if (error instanceof AgentOutputUnsupportedEngineError) {
    return {
      error: { code: 'UNSUPPORTED_AGENT_OUTPUT_OPERATION', message },
      recovery: null,
      exitCode: EXIT_INVALID_INPUT,
    }
  }
  if (error instanceof SavedQueryError) {
    return {
      error: { code: error.code, message },
      recovery: null,
      exitCode: SAVED_QUERY_INPUT_CODES.has(error.code) ? EXIT_INVALID_INPUT : EXIT_FAILED,
    }
  }

  const { WriteGateRefusal } = await import('./write-gate-prompt')
  if (error instanceof WriteGateRefusal) {
    return { error: { code: 'WRITE_GATE_REFUSED', message }, recovery: null, exitCode: EXIT_FAILED }
  }
  if (error instanceof PermissionError) {
    return { error: { code: 'PERMISSION_DENIED', message }, recovery: null, exitCode: EXIT_FAILED }
  }
  if (error instanceof BlacklistError || error instanceof BlacklistRejection) {
    // A Redis refusal names the key it matched; the stored message must not.
    const redisRedacted =
      config?.connection?.system === 'redis' ? bound(t('errors.redis_target_blacklisted')) : message
    const code =
      error instanceof BlacklistError
        ? classifyError(error, recoveryContext).error.code
        : 'BLACKLIST_TABLE'
    return {
      error: { code, message: redisRedacted },
      recovery: null,
      exitCode: EXIT_FAILED,
    }
  }
  if (error instanceof ConnectionError) {
    if (IS_TRANSPORT_FAILURE[error.code]) {
      const recovery = classifyError(error, recoveryContext)
      return {
        error: { code: recovery.error.code, message: recovery.error.message },
        recovery,
        exitCode: EXIT_FAILED,
      }
    }
    return {
      error: { code: error.code === 'UNKNOWN' ? 'DATABASE_ERROR' : error.code, message },
      recovery: null,
      exitCode: EXIT_FAILED,
    }
  }

  const { QuerySizeGuardRefusal } = await import('./query-size-guard')
  if (error instanceof QuerySizeGuardRefusal) {
    return {
      error: { code: 'QUERY_SIZE_GUARD_REFUSED', message },
      recovery: null,
      exitCode: EXIT_FAILED,
    }
  }
  if (error instanceof ConfigError || /Run "dbcli init" first/.test(message)) {
    return { error: { code: 'CONFIG_MISSING', message }, recovery: null, exitCode: EXIT_FAILED }
  }
  return { error: { code: 'QUERY_FAILED', message }, recovery: null, exitCode: EXIT_FAILED }
}

export interface QueryAgentFailureInput {
  operation: OperationEnvelopeQueryOperation
  command: Command | undefined
  error: unknown
  phase: QueryAgentPhase
  /** Present once the configuration was loaded. */
  config?: DbcliConfig | undefined
  effectivePermission?: Permission
  /** The saved-query name, for the recovery context. */
  snippet?: string
  auditId?: string | null
}

/** Emit the failure envelope and return the process exit code. */
export async function emitQueryFailure(input: QueryAgentFailureInput): Promise<number> {
  const system = input.config?.connection?.system
  const connectionName = connectionNameOf(input.config)
  const classified = await classifyFailure(
    input.error,
    input.phase,
    {
      operation: input.operation === 'query.execute' ? 'query' : 'q',
      system: isDatabaseSystem(system) ? system : null,
      ...(connectionName !== undefined && { connectionName }),
      ...(input.snippet !== undefined && { snippet: input.snippet }),
    },
    input.config
  )
  const envelope: OperationEnvelope = {
    schemaVersion: OPERATION_ENVELOPE_SCHEMA_VERSION,
    ok: false,
    operation: input.operation,
    status: 'failed',
    context: contextFor(input.config, input.effectivePermission, correlationIdOf(input.command)),
    data: null,
    warnings: [],
    evidence: auditEvidence(input.auditId),
    recovery: classified.recovery,
    error: classified.error,
  }
  return emitAgentOutputEnvelope(envelope, classified.exitCode)
}
