import { VerifyInputError, requireNonEmpty, normalizeFormat } from './scenario'
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
  redactSqlForEvidence,
  shellQuote,
  renderAfterWriteCommand,
  runGuardSequence,
  allGuardsPassed,
  mapAssertionToStatus,
} from './scenario'

export type ConstraintCheck = 'fk' | 'not-null' | 'unique' | 'custom'
export const ALLOWED_CONSTRAINT_CHECKS = ['fk', 'not-null', 'unique', 'custom'] as const

export interface ConstraintInput {
  table: string
  check: ConstraintCheck
  columns: string[]
  references?: { table: string; column: string }
  violationQuery?: string
  allowPreexisting: boolean
  baseline: number
  afterWrite: boolean
  format: 'table' | 'json'
  subjectName?: string
  summary?: string
}

export function normalizeConstraintCheck(raw: unknown): ConstraintCheck {
  const check = (raw as string | undefined) ?? ''
  if (!(ALLOWED_CONSTRAINT_CHECKS as readonly string[]).includes(check)) {
    throw new VerifyInputError(
      `Invalid --check '${check}'. Allowed: ${ALLOWED_CONSTRAINT_CHECKS.join(', ')}`
    )
  }
  return check as ConstraintCheck
}

function toColumns(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.map((c) => requireNonEmpty(c, '--column'))
}

function parseReferences(raw: unknown): { table: string; column: string } {
  const ref = requireNonEmpty(raw, '--references')
  const parts = ref.split('.').map((p) => p.trim())
  if (parts.length < 2 || parts.some((p) => p.length === 0)) {
    throw new VerifyInputError(`--references must be '<table>.<column>' (got '${ref}')`)
  }
  const column = parts.pop() as string
  const table = parts.join('.')
  return { table, column }
}

function parseBaseline(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new VerifyInputError(`--baseline must be a non-negative integer (got '${String(raw)}')`)
  }
  return n
}

export function normalizeConstraintInput(raw: Record<string, unknown>): ConstraintInput {
  const check = normalizeConstraintCheck(raw.check)
  const table = requireNonEmpty(raw.table, '--table')
  const format = normalizeFormat(raw.format)
  const columns = toColumns(raw.column)
  const violationQueryRaw = raw.violationQuery as string | undefined
  const hasViolationQuery =
    typeof violationQueryRaw === 'string' && violationQueryRaw.trim().length > 0

  let references: { table: string; column: string } | undefined
  if (check === 'fk') {
    if (columns.length !== 1) {
      throw new VerifyInputError('--check fk requires exactly one --column (the child FK column).')
    }
    references = parseReferences(raw.references)
    if (hasViolationQuery) {
      throw new VerifyInputError('--violation-query is only valid with --check custom.')
    }
  } else if (check === 'not-null' || check === 'unique') {
    if (columns.length < 1) {
      throw new VerifyInputError(`--check ${check} requires at least one --column.`)
    }
    if (raw.references !== undefined) {
      throw new VerifyInputError('--references is only valid with --check fk.')
    }
    if (hasViolationQuery) {
      throw new VerifyInputError('--violation-query is only valid with --check custom.')
    }
  } else {
    // custom
    if (!hasViolationQuery) {
      throw new VerifyInputError('--check custom requires --violation-query.')
    }
    if (columns.length > 0) {
      throw new VerifyInputError('--column is not valid with --check custom.')
    }
    if (raw.references !== undefined) {
      throw new VerifyInputError('--references is only valid with --check fk.')
    }
  }

  const subjectNameRaw = raw.subjectName as string | undefined
  const summaryRaw = raw.summary as string | undefined

  return {
    table,
    check,
    columns,
    ...(references ? { references } : {}),
    ...(check === 'custom' ? { violationQuery: (violationQueryRaw as string).trim() } : {}),
    allowPreexisting: raw.allowPreexisting === true,
    baseline: parseBaseline(raw.baseline),
    afterWrite: raw.afterWrite === true,
    format,
    ...(subjectNameRaw && subjectNameRaw.trim().length > 0
      ? { subjectName: subjectNameRaw.trim() }
      : {}),
    ...(summaryRaw && summaryRaw.trim().length > 0 ? { summary: summaryRaw.trim() } : {}),
  }
}

export type ConstraintGuardName = 'blacklist' | 'schema' | 'violation-query-readonly'

export interface ViolationCountOutcome {
  ran: boolean
  count?: number
  reason?: string
  auditRef?: string | null
}

export interface ConstraintRunners {
  violationSql: string
  blacklistGuard: () => Promise<GuardOutcome>
  schemaGuard: () => Promise<GuardOutcome>
  violationReadonlyGuard: () => Promise<GuardOutcome>
  runViolationCount: () => Promise<ViolationCountOutcome>
}

export interface ConstraintPreflightResult {
  scenario: 'constraint'
  mode: 'preflight'
  status: 'ready' | 'blocked'
  check: ConstraintCheck
  table: string
  violationSql: string
  baseline?: number
  guards: GuardResult<ConstraintGuardName>[]
  afterWriteCommand: string
}

export interface ConstraintAfterWriteResult {
  scenario: 'constraint'
  mode: 'after-write'
  status: VerificationStatus
  check: ConstraintCheck
  table: string
  guards: GuardResult<ConstraintGuardName>[]
  assertion?: { violations: number; threshold: number; passed: boolean }
  artifact: VerificationArtifact
  blockedReason?: string
}

export function buildConstraintSubject(input: ConstraintInput): VerificationSubject {
  return {
    kind: 'table',
    name: input.subjectName ?? input.table,
    command: 'verify constraint',
  }
}

export function buildConstraintAfterWriteCommand(
  input: ConstraintInput,
  baseline?: number
): string {
  const flags = [`--check ${input.check}`, `--table ${shellQuote(input.table)}`]
  if (input.check === 'fk') {
    flags.push(`--column ${shellQuote(input.columns[0] as string)}`)
    flags.push(
      `--references ${shellQuote(`${input.references!.table}.${input.references!.column}`)}`
    )
  } else if (input.check === 'custom') {
    flags.push(`--violation-query ${shellQuote(input.violationQuery as string)}`)
  } else {
    for (const c of input.columns) flags.push(`--column ${shellQuote(c)}`)
  }
  if (input.subjectName) flags.push(`--subject-name ${shellQuote(input.subjectName)}`)
  if (input.summary) flags.push(`--summary ${shellQuote(input.summary)}`)
  if (input.format !== 'table') flags.push(`--format ${input.format}`)
  if (baseline !== undefined && baseline > 0) {
    flags.push('--allow-preexisting', `--baseline ${baseline}`)
  }
  return renderAfterWriteCommand('constraint', flags)
}

async function runConstraintGuards(
  runners: ConstraintRunners
): Promise<GuardResult<ConstraintGuardName>[]> {
  return runGuardSequence<ConstraintGuardName>([
    ['blacklist', () => runners.blacklistGuard()],
    ['schema', () => runners.schemaGuard()],
    ['violation-query-readonly', () => runners.violationReadonlyGuard()],
  ])
}

const CONSTRAINT_TASK_PACK_EVIDENCE: VerificationEvidenceRef = {
  kind: 'task-pack-plan',
  taskName: 'constraint-verify',
  note: 'Preflight guards ran before the read-only violation count.',
}

function constraintDefaultSummary(
  status: VerificationStatus,
  check: ConstraintCheck,
  table: string
): string {
  switch (status) {
    case 'verified':
      return `Constraint '${check}' holds on ${table} (violation count within threshold).`
    case 'not_verified':
      return `Constraint '${check}' is violated on ${table} (violation count exceeds threshold).`
    case 'blocked':
      return `Constraint '${check}' verification was blocked before the violation count on ${table}.`
    default:
      return `Constraint '${check}' verification could not produce a trustworthy verdict on ${table}.`
  }
}

export async function runConstraintPreflight(
  input: ConstraintInput,
  runners: ConstraintRunners
): Promise<ConstraintPreflightResult> {
  const guards = await runConstraintGuards(runners)
  const ready = allGuardsPassed(guards, 3)
  let baseline: number | undefined
  if (ready) {
    const outcome = await runners.runViolationCount()
    if (outcome.ran && typeof outcome.count === 'number') baseline = outcome.count
  }
  return {
    scenario: 'constraint',
    mode: 'preflight',
    status: ready ? 'ready' : 'blocked',
    check: input.check,
    table: input.table,
    violationSql: runners.violationSql,
    ...(baseline !== undefined ? { baseline } : {}),
    guards,
    afterWriteCommand: buildConstraintAfterWriteCommand(input, baseline),
  }
}

export async function runConstraintAfterWrite(
  input: ConstraintInput,
  runners: ConstraintRunners,
  clock: { now?: () => Date; idFactory?: () => string } = {}
): Promise<ConstraintAfterWriteResult> {
  const subject = buildConstraintSubject(input)
  const guards = await runConstraintGuards(runners)

  if (!allGuardsPassed(guards, 3)) {
    const failed = guards.find((g) => g.status === 'failed')
    const blockedReason = failed?.reason ?? 'A required guard failed before the violation count.'
    const artifact = buildVerificationArtifact({
      status: 'blocked',
      subject,
      summary: input.summary ?? constraintDefaultSummary('blocked', input.check, input.table),
      evidence: [CONSTRAINT_TASK_PACK_EVIDENCE],
      blockedReason,
      now: clock.now,
      idFactory: clock.idFactory,
    })
    return {
      scenario: 'constraint',
      mode: 'after-write',
      status: 'blocked',
      check: input.check,
      table: input.table,
      guards,
      artifact,
      blockedReason,
    }
  }

  const outcome = await runners.runViolationCount()
  const threshold = input.allowPreexisting ? input.baseline : 0
  const assertionOutcome: AssertionOutcome =
    outcome.ran && typeof outcome.count === 'number'
      ? { ran: true, pass: outcome.count <= threshold, auditRef: outcome.auditRef }
      : { ran: false, reason: outcome.reason, auditRef: outcome.auditRef }
  const status = mapAssertionToStatus(assertionOutcome)

  const evidence: VerificationEvidenceRef = {
    kind: 'assert',
    command: `constraint:${input.check} <${redactSqlForEvidence(runners.violationSql)}> threshold <=${threshold}`,
    exitCode: status === 'verified' ? 0 : 1,
    ...(outcome.auditRef ? { auditRef: outcome.auditRef } : {}),
    ...(status === 'indeterminate' && outcome.reason ? { note: outcome.reason } : {}),
  }

  const artifact = buildVerificationArtifact({
    status,
    subject,
    summary: input.summary ?? constraintDefaultSummary(status, input.check, input.table),
    evidence: [CONSTRAINT_TASK_PACK_EVIDENCE, evidence],
    ...(status === 'indeterminate' && outcome.reason ? { blockedReason: outcome.reason } : {}),
    now: clock.now,
    idFactory: clock.idFactory,
  })

  return {
    scenario: 'constraint',
    mode: 'after-write',
    status,
    check: input.check,
    table: input.table,
    guards,
    ...(outcome.ran && typeof outcome.count === 'number'
      ? { assertion: { violations: outcome.count, threshold, passed: status === 'verified' } }
      : {}),
    artifact,
  }
}
