import type {
  VerificationStatus,
  VerificationSubject,
  VerificationEvidenceRef,
  VerificationArtifact,
} from '@/core/verification'
import { buildVerificationArtifact } from '@/core/verification'
import {
  type GuardOutcome,
  type GuardResult,
  type AssertionOutcome,
  VerifyInputError,
  requireNonEmpty,
  normalizeFormat,
  shellQuote,
  renderAfterWriteCommand,
  redactSqlForEvidence,
  runGuardSequence,
  allGuardsPassed,
  mapAssertionToStatus,
} from './scenario'

/** Which grammar the reverting `--statement` must satisfy. */
export type RollbackKind = 'ddl' | 'dml'

export const ALLOWED_ROLLBACK_KINDS = ['ddl', 'dml'] as const

/** Validate `--kind`; throws VerifyInputError before any guard or DB connection. */
export function normalizeRollbackKind(raw: unknown): RollbackKind {
  const kind = (raw as string | undefined) ?? ''
  if (!(ALLOWED_ROLLBACK_KINDS as readonly string[]).includes(kind)) {
    throw new VerifyInputError(
      `Invalid --kind '${kind}'. Allowed: ${ALLOWED_ROLLBACK_KINDS.join(', ')}`
    )
  }
  return kind as RollbackKind
}

export interface RollbackInput {
  table: string
  kind: RollbackKind
  /** The reverting statement (ALTER TABLE for ddl, UPDATE for dml); analyzed, never executed. */
  statement: string
  verifyQuery: string
  expect: string
  afterWrite: boolean
  format: 'table' | 'json'
  subjectName?: string
  summary?: string
}

/** Validate and normalize raw CLI options into a typed RollbackInput. */
export function normalizeRollbackInput(raw: Record<string, unknown>): RollbackInput {
  const kind = normalizeRollbackKind(raw.kind)
  const table = requireNonEmpty(raw.table, '--table')
  const statement = requireNonEmpty(raw.statement, '--statement')
  const verifyQuery = requireNonEmpty(raw.verifyQuery, '--verify-query')
  const expect = requireNonEmpty(raw.expect, '--expect')
  const format = normalizeFormat(raw.format)

  const subjectNameRaw = raw.subjectName as string | undefined
  const summaryRaw = raw.summary as string | undefined

  return {
    table,
    kind,
    statement,
    verifyQuery,
    expect,
    afterWrite: raw.afterWrite === true,
    format,
    ...(subjectNameRaw && subjectNameRaw.trim().length > 0
      ? { subjectName: subjectNameRaw.trim() }
      : {}),
    ...(summaryRaw && summaryRaw.trim().length > 0 ? { summary: summaryRaw.trim() } : {}),
  }
}

/**
 * Guard names. The statement guard is named after the grammar it enforces so
 * preflight output reads identically to the sibling scenarios: `ddl` for a schema
 * rollback (matching `verify migration`), `plan` for a data rollback (matching
 * `verify safe-backfill`).
 */
export type RollbackGuardName = 'blacklist' | 'schema' | 'ddl' | 'plan' | 'verify-query-readonly'

/** The guard whose name varies by kind. */
export function statementGuardName(kind: RollbackKind): RollbackGuardName {
  return kind === 'ddl' ? 'ddl' : 'plan'
}

export interface RollbackRunners {
  blacklistGuard: (table: string) => Promise<GuardOutcome>
  schemaGuard: (table: string) => Promise<GuardOutcome>
  /** Validates the reverting statement against the kind-specific grammar + target match. */
  statementGuard: (statement: string, table: string) => Promise<GuardOutcome>
  verifyReadonlyGuard: (verifyQuery: string) => Promise<GuardOutcome>
  runAssertion: (input: RollbackInput) => Promise<AssertionOutcome>
}

export interface RollbackPreflightResult {
  scenario: 'rollback'
  mode: 'preflight'
  status: 'ready' | 'blocked'
  kind: RollbackKind
  table: string
  /** The proposed reverting statement the agent applies externally; never executed here. */
  plannedStatement: string
  guards: GuardResult<RollbackGuardName>[]
  afterWriteCommand: string
}

export interface RollbackAfterWriteResult {
  scenario: 'rollback'
  mode: 'after-write'
  status: VerificationStatus
  kind: RollbackKind
  table: string
  guards: GuardResult<RollbackGuardName>[]
  assertion?: { expect: string; passed: boolean }
  artifact: VerificationArtifact
  blockedReason?: string
}

/**
 * Map the rollback kind to an existing artifact subject kind — a schema rollback is
 * a `migration`, a data rollback is a `backfill`. Provenance that it was a rollback
 * is carried by `subject.command`, so the artifact schema enum is left unchanged.
 */
export function buildRollbackSubject(input: RollbackInput): VerificationSubject {
  return {
    kind: input.kind === 'ddl' ? 'migration' : 'backfill',
    name: input.subjectName ?? input.table,
    command: 'verify rollback',
  }
}

export function buildRollbackAfterWriteCommand(input: RollbackInput): string {
  const flags = [
    `--kind ${input.kind}`,
    `--table ${shellQuote(input.table)}`,
    `--statement ${shellQuote(input.statement)}`,
    `--verify-query ${shellQuote(input.verifyQuery)}`,
    `--expect ${shellQuote(input.expect)}`,
  ]
  if (input.subjectName) flags.push(`--subject-name ${shellQuote(input.subjectName)}`)
  if (input.summary) flags.push(`--summary ${shellQuote(input.summary)}`)
  if (input.format !== 'table') flags.push(`--format ${input.format}`)
  return renderAfterWriteCommand('rollback', flags)
}

async function runRollbackGuards(
  input: RollbackInput,
  runners: RollbackRunners
): Promise<GuardResult<RollbackGuardName>[]> {
  return runGuardSequence<RollbackGuardName>([
    ['blacklist', () => runners.blacklistGuard(input.table)],
    ['schema', () => runners.schemaGuard(input.table)],
    [statementGuardName(input.kind), () => runners.statementGuard(input.statement, input.table)],
    ['verify-query-readonly', () => runners.verifyReadonlyGuard(input.verifyQuery)],
  ])
}

const ROLLBACK_TASK_PACK_EVIDENCE: VerificationEvidenceRef = {
  kind: 'task-pack-plan',
  taskName: 'rollback-review',
  note: 'Preflight guards ran before post-rollback read-back verification.',
}

function rollbackDefaultSummary(
  status: VerificationStatus,
  kind: RollbackKind,
  table: string
): string {
  const what = kind === 'ddl' ? 'schema rollback' : 'data rollback'
  switch (status) {
    case 'verified':
      return `Read-back assertion verified the ${what} outcome on ${table}.`
    case 'not_verified':
      return `Read-back assertion did not match the expected ${what} outcome on ${table}.`
    case 'blocked':
      return `Rollback verification was blocked before the read-back assertion on ${table}.`
    default:
      return `Rollback verification could not produce a trustworthy verdict on ${table}.`
  }
}

export async function runRollbackPreflight(
  input: RollbackInput,
  runners: RollbackRunners
): Promise<RollbackPreflightResult> {
  const guards = await runRollbackGuards(input, runners)
  return {
    scenario: 'rollback',
    mode: 'preflight',
    status: allGuardsPassed(guards, 4) ? 'ready' : 'blocked',
    kind: input.kind,
    table: input.table,
    plannedStatement: input.statement,
    guards,
    afterWriteCommand: buildRollbackAfterWriteCommand(input),
  }
}

export async function runRollbackAfterWrite(
  input: RollbackInput,
  runners: RollbackRunners,
  clock: { now?: () => Date; idFactory?: () => string } = {}
): Promise<RollbackAfterWriteResult> {
  const subject = buildRollbackSubject(input)
  const guards = await runRollbackGuards(input, runners)

  if (!allGuardsPassed(guards, 4)) {
    const failed = guards.find((g) => g.status === 'failed')
    const blockedReason =
      failed?.reason ?? 'A required guard failed before the read-back assertion.'
    const artifact = buildVerificationArtifact({
      status: 'blocked',
      subject,
      summary: input.summary ?? rollbackDefaultSummary('blocked', input.kind, input.table),
      evidence: [ROLLBACK_TASK_PACK_EVIDENCE],
      blockedReason,
      now: clock.now,
      idFactory: clock.idFactory,
    })
    return {
      scenario: 'rollback',
      mode: 'after-write',
      status: 'blocked',
      kind: input.kind,
      table: input.table,
      guards,
      artifact,
      blockedReason,
    }
  }

  const outcome = await runners.runAssertion(input)
  const status = mapAssertionToStatus(outcome)

  const assertEvidence: VerificationEvidenceRef = {
    kind: 'assert',
    command: `assert <${redactSqlForEvidence(input.verifyQuery)}> --expect <${redactSqlForEvidence(input.expect)}>`,
    exitCode: status === 'verified' ? 0 : 1,
    ...(outcome.auditRef ? { auditRef: outcome.auditRef } : {}),
    ...(status === 'indeterminate' && outcome.reason ? { note: outcome.reason } : {}),
  }

  const artifact = buildVerificationArtifact({
    status,
    subject,
    summary: input.summary ?? rollbackDefaultSummary(status, input.kind, input.table),
    evidence: [ROLLBACK_TASK_PACK_EVIDENCE, assertEvidence],
    ...(status === 'indeterminate' && outcome.reason ? { blockedReason: outcome.reason } : {}),
    now: clock.now,
    idFactory: clock.idFactory,
  })

  return {
    scenario: 'rollback',
    mode: 'after-write',
    status,
    kind: input.kind,
    table: input.table,
    guards,
    ...(outcome.ran ? { assertion: { expect: input.expect, passed: outcome.pass === true } } : {}),
    artifact,
  }
}
