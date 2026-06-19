import type {
  VerificationStatus,
  VerificationSubject,
  VerificationEvidenceRef,
  VerificationArtifact,
} from '@/core/verification'
import { buildVerificationArtifact } from '@/core/verification'
import type { QueryRiskOperation } from '@/types/query-risk'

export type VerifyMode = 'preflight' | 'after-write'
export type GuardName = 'blacklist' | 'schema' | 'plan' | 'verify-query-readonly'
export type GuardStatus = 'passed' | 'failed'

export interface GuardResult {
  name: GuardName
  status: GuardStatus
  reason?: string
}

/** Result of one injected guard runner. `reason` is a bounded human-readable note on failure. */
export interface GuardOutcome {
  ok: boolean
  reason?: string
}

/**
 * Result of the injected assertion runner.
 * - ran=false means the evaluator could not produce a trustworthy verdict (-> indeterminate).
 * - pass is only meaningful when ran=true.
 */
export interface AssertionOutcome {
  ran: boolean
  pass?: boolean
  reason?: string
  auditRef?: string | null
}

export interface SafeBackfillInput {
  table: string
  query: string
  verifyQuery: string
  expect: string
  afterWrite: boolean
  format: 'table' | 'json'
  subjectName?: string
  summary?: string
}

const ALLOWED_FORMATS = ['table', 'json'] as const

/** Thrown for malformed CLI input, before any guard runs or DB connection opens. */
export class VerifyInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerifyInputError'
    Object.setPrototypeOf(this, VerifyInputError.prototype)
  }
}

function requireNonEmpty(value: unknown, flag: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VerifyInputError(`${flag} is required and must be a non-empty string`)
  }
  return value.trim()
}

/** Validate and normalize raw CLI options into a typed SafeBackfillInput. */
export function normalizeSafeBackfillInput(raw: Record<string, unknown>): SafeBackfillInput {
  const table = requireNonEmpty(raw.table, '--table')
  const query = requireNonEmpty(raw.query, '--query')
  const verifyQuery = requireNonEmpty(raw.verifyQuery, '--verify-query')
  const expect = requireNonEmpty(raw.expect, '--expect')

  const format = (raw.format as string | undefined) ?? 'table'
  if (!(ALLOWED_FORMATS as readonly string[]).includes(format)) {
    throw new VerifyInputError(
      `Invalid --format '${format}'. Allowed: ${ALLOWED_FORMATS.join(', ')}`
    )
  }

  const subjectNameRaw = raw.subjectName as string | undefined
  const summaryRaw = raw.summary as string | undefined

  return {
    table,
    query,
    verifyQuery,
    expect,
    afterWrite: raw.afterWrite === true,
    format: format as 'table' | 'json',
    ...(subjectNameRaw && subjectNameRaw.trim().length > 0
      ? { subjectName: subjectNameRaw.trim() }
      : {}),
    ...(summaryRaw && summaryRaw.trim().length > 0 ? { summary: summaryRaw.trim() } : {}),
  }
}

const READ_ONLY_OPERATIONS: readonly QueryRiskOperation[] = [
  'SELECT',
  'SHOW',
  'DESCRIBE',
  'EXPLAIN',
]

export function isReadOnlyOperation(op: QueryRiskOperation): boolean {
  return READ_ONLY_OPERATIONS.includes(op)
}

export function isUpdateOperation(op: QueryRiskOperation): boolean {
  return op === 'UPDATE'
}

/** Render the exact `--after-write` command an agent should run after the real backfill write. */
export function buildAfterWriteCommand(input: SafeBackfillInput): string {
  const parts = [
    'dbcli verify safe-backfill',
    `--table ${input.table}`,
    `--query "${input.query}"`,
    `--verify-query "${input.verifyQuery}"`,
    `--expect "${input.expect}"`,
  ]
  if (input.subjectName) parts.push(`--subject-name ${input.subjectName}`)
  parts.push('--after-write')
  return parts.join(' ')
}

/** Build the v1 artifact subject for a safe-backfill result. Defaults name to the table. */
export function buildSafeBackfillSubject(input: SafeBackfillInput): VerificationSubject {
  return {
    kind: 'backfill',
    name: input.subjectName ?? input.table,
    command: 'verify safe-backfill',
  }
}

export interface SafeBackfillRunners {
  blacklistGuard: (table: string) => Promise<GuardOutcome>
  schemaGuard: (table: string) => Promise<GuardOutcome>
  planGuard: (query: string) => Promise<GuardOutcome>
  verifyReadonlyGuard: (verifyQuery: string) => Promise<GuardOutcome>
  runAssertion: (input: SafeBackfillInput) => Promise<AssertionOutcome>
}

export interface PreflightResult {
  scenario: 'safe-backfill'
  mode: 'preflight'
  status: 'ready' | 'blocked'
  table: string
  guards: GuardResult[]
  afterWriteCommand: string
}

/**
 * Run the four read-only guards in order, stopping at the first failure.
 * The returned array contains only the guards that actually ran, so callers can
 * see exactly which guard blocked the scenario.
 */
async function runGuards(
  input: SafeBackfillInput,
  runners: SafeBackfillRunners
): Promise<GuardResult[]> {
  const sequence: Array<[GuardName, () => Promise<GuardOutcome>]> = [
    ['blacklist', () => runners.blacklistGuard(input.table)],
    ['schema', () => runners.schemaGuard(input.table)],
    ['plan', () => runners.planGuard(input.query)],
    ['verify-query-readonly', () => runners.verifyReadonlyGuard(input.verifyQuery)],
  ]
  const results: GuardResult[] = []
  for (const [name, run] of sequence) {
    const outcome = await run()
    results.push({
      name,
      status: outcome.ok ? 'passed' : 'failed',
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    })
    if (!outcome.ok) break
  }
  return results
}

function allGuardsPassed(guards: GuardResult[]): boolean {
  return guards.length === 4 && guards.every((g) => g.status === 'passed')
}

export async function runSafeBackfillPreflight(
  input: SafeBackfillInput,
  runners: SafeBackfillRunners
): Promise<PreflightResult> {
  const guards = await runGuards(input, runners)
  return {
    scenario: 'safe-backfill',
    mode: 'preflight',
    status: allGuardsPassed(guards) ? 'ready' : 'blocked',
    table: input.table,
    guards,
    afterWriteCommand: buildAfterWriteCommand(input),
  }
}

export interface AfterWriteResult {
  scenario: 'safe-backfill'
  mode: 'after-write'
  status: VerificationStatus
  table: string
  guards: GuardResult[]
  assertion?: { expect: string; passed: boolean }
  artifact: VerificationArtifact
  blockedReason?: string
}

const TASK_PACK_EVIDENCE: VerificationEvidenceRef = {
  kind: 'task-pack-plan',
  taskName: 'safe-backfill-verify',
  note: 'Preflight guards ran before read-back verification.',
}

function defaultSummary(status: VerificationStatus, table: string): string {
  switch (status) {
    case 'verified':
      return `Read-back assertion verified the backfill outcome on ${table}.`
    case 'not_verified':
      return `Read-back assertion did not match the expected outcome on ${table}.`
    case 'blocked':
      return `Safe-backfill verification was blocked before the read-back assertion on ${table}.`
    default:
      return `Safe-backfill verification could not produce a trustworthy verdict on ${table}.`
  }
}

export async function runSafeBackfillAfterWrite(
  input: SafeBackfillInput,
  runners: SafeBackfillRunners,
  clock: { now?: () => Date; idFactory?: () => string } = {}
): Promise<AfterWriteResult> {
  const subject = buildSafeBackfillSubject(input)
  const guards = await runGuards(input, runners)

  // Blocked: a required guard failed. Persist a bounded artifact with no assert evidence.
  if (!allGuardsPassed(guards)) {
    const failed = guards.find((g) => g.status === 'failed')
    const blockedReason =
      failed?.reason ?? 'A required guard failed before the read-back assertion.'
    const artifact = buildVerificationArtifact({
      status: 'blocked',
      subject,
      summary: input.summary ?? defaultSummary('blocked', input.table),
      evidence: [TASK_PACK_EVIDENCE],
      blockedReason,
      now: clock.now,
      idFactory: clock.idFactory,
    })
    return {
      scenario: 'safe-backfill',
      mode: 'after-write',
      status: 'blocked',
      table: input.table,
      guards,
      artifact,
      blockedReason,
    }
  }

  // Guards passed: run the read-back assertion and map its verdict.
  const outcome = await runners.runAssertion(input)
  const status: VerificationStatus = !outcome.ran
    ? 'indeterminate'
    : outcome.pass
      ? 'verified'
      : 'not_verified'

  const assertEvidence: VerificationEvidenceRef = {
    kind: 'assert',
    command: `assert "${input.verifyQuery}" --expect "${input.expect}"`,
    exitCode: status === 'verified' ? 0 : 1,
    ...(outcome.auditRef ? { auditRef: outcome.auditRef } : {}),
    ...(status === 'indeterminate' && outcome.reason ? { note: outcome.reason } : {}),
  }

  const artifact = buildVerificationArtifact({
    status,
    subject,
    summary: input.summary ?? defaultSummary(status, input.table),
    evidence: [TASK_PACK_EVIDENCE, assertEvidence],
    ...(status === 'indeterminate' && outcome.reason ? { blockedReason: outcome.reason } : {}),
    now: clock.now,
    idFactory: clock.idFactory,
  })

  return {
    scenario: 'safe-backfill',
    mode: 'after-write',
    status,
    table: input.table,
    guards,
    ...(outcome.ran ? { assertion: { expect: input.expect, passed: outcome.pass === true } } : {}),
    artifact,
  }
}
