import type { VerificationStatus } from '@/core/verification'
import { redactSensitive, redactSql } from '@/utils/redaction'

export type VerifyMode = 'preflight' | 'after-write'
export type GuardStatus = 'passed' | 'failed'

/** Result of one injected guard runner. `reason` is a bounded note on failure. */
export interface GuardOutcome {
  ok: boolean
  reason?: string
}

export interface GuardResult<Name extends string = string> {
  name: Name
  status: GuardStatus
  reason?: string
}

/**
 * Result of an injected assertion runner.
 * - ran=false means no trustworthy verdict (-> indeterminate).
 * - pass is only meaningful when ran=true.
 */
export interface AssertionOutcome {
  ran: boolean
  pass?: boolean
  reason?: string
  auditRef?: string | null
}

export const REASON_CAP = 200

/** Cap a human-readable reason so artifacts never carry unbounded text. */
export function boundedReason(message: string, cap: number = REASON_CAP): string {
  return message.length <= cap ? message : `${message.slice(0, cap - 1)}…`
}

/** Redact credentials and filesystem paths from user-controlled artifact labels. */
export function redactArtifactText(text: string, maxLen = REASON_CAP): string {
  const hasCredential =
    redactSensitive(text) !== text ||
    /\b(password|token|api[-_ ]?key|secret|auth(?:orization)?|credential|pass|pwd|sid|bearer|basic)\b/i.test(
      text
    )
  const hasPath =
    /(?:^|[^a-z0-9._-])(?:file:|~[\\/]|\.{1,2}[\\/]|[a-z]:[\\/]|\\\\|[\\/](?![\\/])(?=\S))/i.test(
      text
    )
  if (hasCredential || hasPath) return '<redacted>'

  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLen ? collapsed : `${collapsed.slice(0, maxLen - 1)}…`
}

/** Thrown for malformed CLI input, before any guard runs or DB connection opens. */
export class VerifyInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerifyInputError'
    Object.setPrototypeOf(this, VerifyInputError.prototype)
  }
}

export function requireNonEmpty(value: unknown, flag: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VerifyInputError(`${flag} is required and must be a non-empty string`)
  }
  return value.trim()
}

export const ALLOWED_FORMATS = ['table', 'json'] as const

export function normalizeFormat(raw: unknown): 'table' | 'json' {
  const format = (raw as string | undefined) ?? 'table'
  if (!(ALLOWED_FORMATS as readonly string[]).includes(format)) {
    throw new VerifyInputError(
      `Invalid --format '${format}'. Allowed: ${ALLOWED_FORMATS.join(', ')}`
    )
  }
  return format as 'table' | 'json'
}

/**
 * Produce a bounded, literal-free label for persisting a SQL/expression value in
 * an artifact. Reuses the shared SQL redactor (string, double-quoted, dollar-quoted,
 * and numeric literals + sensitive key/value patterns), collapses whitespace, caps length.
 */
export function redactSqlForEvidence(sql: string, maxLen = 100): string {
  const uncommented = redactSql(sql)
    .replace(/(?:--|#)[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return redactArtifactText(uncommented, maxLen)
}

/** POSIX shell single-quote escaping: wrap in '…', escape embedded quotes as '\''. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Render `dbcli verify <scenario> <flags...> --after-write`. */
export function renderAfterWriteCommand(scenario: string, flags: string[]): string {
  return [`dbcli verify ${scenario}`, ...flags, '--after-write'].join(' ')
}

function cleanSegment(segment: string): string {
  return segment
    .replace(/^[`"[]+|[`"\]]+$/g, '')
    .trim()
    .toLowerCase()
}

/** Normalize a table reference to its bare name: strip schema prefix, quotes, case. */
export function normalizeTableName(name: string): string {
  const trimmed = name.trim()
  const bare = trimmed.includes('.') ? (trimmed.split('.').pop() ?? trimmed) : trimmed
  return cleanSegment(bare)
}

function splitQualifiedTable(ref: string): { schema: string | null; name: string } {
  const parts = ref
    .trim()
    .split('.')
    .map(cleanSegment)
    .filter((p) => p.length > 0)
  const name = parts.length > 0 ? (parts[parts.length - 1] as string) : ''
  const schema = parts.length >= 2 ? (parts[parts.length - 2] as string) : null
  return { schema, name }
}

/**
 * Compare two table references schema-aware: bare names must match, and when BOTH
 * sides carry a schema, schemas must match too. If either side omits the schema we
 * fall back to a bare-name match.
 */
export function tableRefsMatch(a: string, b: string): boolean {
  const x = splitQualifiedTable(a)
  const y = splitQualifiedTable(b)
  if (!x.name || x.name !== y.name) return false
  if (x.schema && y.schema) return x.schema === y.schema
  return true
}

/** Run guards in order, stopping at the first failure unless explicitly disabled. */
export async function runGuardSequence<Name extends string>(
  specs: Array<[Name, () => Promise<GuardOutcome>]>,
  options: { stopOnFailure?: boolean } = {}
): Promise<GuardResult<Name>[]> {
  const results: GuardResult<Name>[] = []
  for (const [name, run] of specs) {
    const outcome = await run()
    results.push({
      name,
      status: outcome.ok ? 'passed' : 'failed',
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    })
    if (!outcome.ok && options.stopOnFailure !== false) break
  }
  return results
}

export function allGuardsPassed(guards: GuardResult[], expected: number): boolean {
  return guards.length === expected && guards.every((g) => g.status === 'passed')
}

export function mapAssertionToStatus(outcome: AssertionOutcome): VerificationStatus {
  if (!outcome.ran) return 'indeterminate'
  return outcome.pass ? 'verified' : 'not_verified'
}
