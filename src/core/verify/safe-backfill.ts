import type {
  VerificationStatus,
  VerificationSubject,
  VerificationEvidenceRef,
  VerificationArtifact,
} from '@/core/verification'
import { buildVerificationArtifact } from '@/core/verification'
import type { QueryRiskOperation } from '@/types/query-risk'
import {
  type GuardOutcome,
  type GuardResult,
  type AssertionOutcome,
  requireNonEmpty,
  normalizeFormat,
  redactSqlForEvidence,
  shellQuote,
  renderAfterWriteCommand,
  tableRefsMatch,
  runGuardSequence,
  allGuardsPassed,
  mapAssertionToStatus,
} from './scenario'

export type GuardName = 'blacklist' | 'schema' | 'plan' | 'verify-query-readonly'

export { normalizeTableName, redactSqlForEvidence, VerifyInputError } from './scenario'
export type { GuardOutcome, AssertionOutcome, GuardStatus } from './scenario'

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

/** Validate and normalize raw CLI options into a typed SafeBackfillInput. */
export function normalizeSafeBackfillInput(raw: Record<string, unknown>): SafeBackfillInput {
  const table = requireNonEmpty(raw.table, '--table')
  const query = requireNonEmpty(raw.query, '--query')
  const verifyQuery = requireNonEmpty(raw.verifyQuery, '--verify-query')
  const expect = requireNonEmpty(raw.expect, '--expect')
  const format = normalizeFormat(raw.format)

  const subjectNameRaw = raw.subjectName as string | undefined
  const summaryRaw = raw.summary as string | undefined

  return {
    table,
    query,
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

/**
 * Data-modifying / DDL keywords used as a defence-in-depth check for the
 * verify-query. We strip single-quoted string literals first so a value like
 * `note = 'delete me'` does not trip the guard. This catches data-modifying
 * CTEs (e.g. `WITH d AS (DELETE ... RETURNING *) SELECT ...`) which classify as
 * SELECT but still execute writes on PostgreSQL.
 */
const WRITE_OR_DDL_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|RENAME)\b/i

function stripSingleQuotedLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, ' ')
}

/**
 * A verify-query is safe to execute only when it is a plain SELECT.
 * EXPLAIN/SHOW/DESCRIBE are read-ish but `EXPLAIN ANALYZE <write>` actually runs
 * the write on PostgreSQL, so they are rejected outright. As a second line of
 * defence we also reject any SELECT whose body contains write/DDL keywords
 * (data-modifying CTEs).
 */
export function isPlainSelectVerifyQuery(op: QueryRiskOperation, sql: string): boolean {
  if (op !== 'SELECT') return false
  return !WRITE_OR_DDL_KEYWORDS.test(stripSingleQuotedLiterals(sql))
}

/**
 * Extract the (possibly schema-qualified) UPDATE target from a raw statement.
 * Reads the target straight from the SQL — the risk analyzer strips schema
 * prefixes, so its extracted tables cannot be used for a schema-aware check.
 */
export function extractUpdateTargetTable(sql: string): string | null {
  const match = sql.match(
    /\bUPDATE\s+(?:ONLY\s+)?((?:[`"[]?[\w]+[`"\]]?\.){0,2}[`"[]?[\w]+[`"\]]?)/i
  )
  return match?.[1] ?? null
}

/**
 * The backfill is only safe when the `--query` UPDATE target matches the declared
 * `--table`, compared schema-aware so `UPDATE public.users` cannot pass as
 * `--table audit.users`.
 */
export function updateTargetMatchesTable(query: string, table: string): boolean {
  const target = extractUpdateTargetTable(query)
  if (!target) return false
  return tableRefsMatch(target, table)
}

/** Render the exact `--after-write` command an agent should run after the real backfill write. */
export function buildAfterWriteCommand(input: SafeBackfillInput): string {
  const flags = [
    `--table ${shellQuote(input.table)}`,
    `--query ${shellQuote(input.query)}`,
    `--verify-query ${shellQuote(input.verifyQuery)}`,
    `--expect ${shellQuote(input.expect)}`,
  ]
  if (input.subjectName) flags.push(`--subject-name ${shellQuote(input.subjectName)}`)
  if (input.summary) flags.push(`--summary ${shellQuote(input.summary)}`)
  if (input.format !== 'table') flags.push(`--format ${input.format}`)
  return renderAfterWriteCommand('safe-backfill', flags)
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
  /** The proposed backfill UPDATE the agent must run themselves; never executed here. */
  plannedUpdate: string
  guards: GuardResult<GuardName>[]
  afterWriteCommand: string
}

async function runGuards(
  input: SafeBackfillInput,
  runners: SafeBackfillRunners
): Promise<GuardResult<GuardName>[]> {
  return runGuardSequence<GuardName>([
    ['blacklist', () => runners.blacklistGuard(input.table)],
    ['schema', () => runners.schemaGuard(input.table)],
    ['plan', () => runners.planGuard(input.query)],
    ['verify-query-readonly', () => runners.verifyReadonlyGuard(input.verifyQuery)],
  ])
}

export async function runSafeBackfillPreflight(
  input: SafeBackfillInput,
  runners: SafeBackfillRunners
): Promise<PreflightResult> {
  const guards = await runGuards(input, runners)
  return {
    scenario: 'safe-backfill',
    mode: 'preflight',
    status: allGuardsPassed(guards, 4) ? 'ready' : 'blocked',
    table: input.table,
    plannedUpdate: input.query,
    guards,
    afterWriteCommand: buildAfterWriteCommand(input),
  }
}

export interface AfterWriteResult {
  scenario: 'safe-backfill'
  mode: 'after-write'
  status: VerificationStatus
  table: string
  guards: GuardResult<GuardName>[]
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
  if (!allGuardsPassed(guards, 4)) {
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
  const status = mapAssertionToStatus(outcome)

  const assertEvidence: VerificationEvidenceRef = {
    kind: 'assert',
    // Persist only bounded, literal-free labels — never the raw verify SQL or
    // raw --expect (both can carry sensitive literal values).
    command: `assert <${redactSqlForEvidence(input.verifyQuery)}> --expect <${redactSqlForEvidence(input.expect)}>`,
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
