import { boundedReason, tableRefsMatch } from './scenario'

/** Remove single- and double-quoted string literals so delimiters inside them don't trip checks. */
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, ' ').replace(/"(?:[^"]|"")*"/g, ' ')
}

/** True when the DDL is a single statement (a single trailing `;` is allowed). */
export function isSingleStatement(sql: string): boolean {
  const stripped = stripStringLiterals(sql).trim().replace(/;\s*$/, '')
  return !stripped.includes(';')
}

/** True when the trimmed statement begins with `ALTER TABLE` (case-insensitive). */
export function isAlterTableDdl(sql: string): boolean {
  return /^\s*ALTER\s+TABLE\b/i.test(stripStringLiterals(sql))
}

/** Matches the `ALTER TABLE [IF EXISTS] [ONLY]` prefix; the target begins right after. */
const ALTER_TABLE_PREFIX = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?/i

/** The most qualified target the MVP accepts: `catalog.schema.table`. */
const MAX_TARGET_PARTS = 3

interface Segment {
  /** Raw source text of the segment, quotes included. */
  text: string
  /** Index just past the segment in the source. */
  end: number
}

/**
 * Read one quote-delimited identifier segment where the quote character doubles
 * itself to escape (`""`, ` `` `). Returns null if the quote is never closed.
 */
function readDoubledQuoteSegment(sql: string, start: number, quote: string): Segment | null {
  let i = start + 1
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2 // doubled quote escapes itself
        continue
      }
      return { text: sql.slice(start, i + 1), end: i + 1 }
    }
    i += 1
  }
  return null // unterminated
}

/** Read a bracket-quoted identifier segment (`[name]`) where `]]` escapes a `]`. */
function readBracketSegment(sql: string, start: number): Segment | null {
  let i = start + 1
  while (i < sql.length) {
    if (sql[i] === ']') {
      if (sql[i + 1] === ']') {
        i += 2
        continue
      }
      return { text: sql.slice(start, i + 1), end: i + 1 }
    }
    i += 1
  }
  return null
}

/** Read a bare unquoted identifier: `[A-Za-z_][A-Za-z0-9_]*`. */
function readUnquotedSegment(sql: string, start: number): Segment | null {
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(start))
  if (!match) return null
  return { text: match[0], end: start + match[0].length }
}

function readSegment(sql: string, start: number): Segment | null {
  const c = sql[start]
  if (c === undefined) return null
  if (c === '"' || c === '`') return readDoubledQuoteSegment(sql, start, c)
  if (c === '[') return readBracketSegment(sql, start)
  return readUnquotedSegment(sql, start)
}

function skipSpaces(sql: string, i: number): number {
  while (i < sql.length && /\s/.test(sql[i] as string)) i += 1
  return i
}

/**
 * Extract the (possibly schema-qualified) ALTER TABLE target.
 *
 * Accepts a dotted sequence of up to three identifier segments after an
 * `ALTER TABLE [IF EXISTS] [ONLY]` prefix. Each segment may be unquoted
 * (`[A-Za-z_][A-Za-z0-9_]*`), double-quoted or backtick-quoted (with doubled-quote
 * escapes), or bracket-quoted (with `]]` escapes). Whitespace around dots is allowed.
 *
 * Returns the normalized dotted target (segments joined by `.`, original quoting
 * preserved) or null when the target cannot be fully parsed — partial or malformed
 * targets fail closed so the migration guard never blocks on a misleading name.
 */
export function extractAlterTableTarget(sql: string): string | null {
  const prefix = ALTER_TABLE_PREFIX.exec(sql)
  if (!prefix) return null

  const segments: string[] = []
  let i = prefix[0].length
  for (;;) {
    i = skipSpaces(sql, i)
    const segment = readSegment(sql, i)
    if (!segment) return null
    segments.push(segment.text)
    if (segments.length > MAX_TARGET_PARTS) return null
    i = segment.end

    // A target continues only across a single dot (whitespace around it is fine).
    const afterSpaces = skipSpaces(sql, i)
    if (sql[afterSpaces] === '.') {
      i = afterSpaces + 1
      continue
    }
    break
  }

  // The target must end at a clean boundary: end of input, whitespace, or a
  // trailing `;`. Anything else (e.g. a stray quote) means a malformed target.
  const next = sql[i]
  if (next !== undefined && next !== ';' && !/\s/.test(next)) return null

  return segments.join('.')
}

/** The migration is only safe when the DDL target matches --table, schema-aware. */
export function ddlTargetMatchesTable(ddl: string, table: string): boolean {
  const target = extractAlterTableTarget(ddl)
  if (!target) return false
  return tableRefsMatch(target, table)
}

/**
 * Decide whether the ALTER TABLE target is acceptable for `--table`, returning a
 * bounded reason that distinguishes an unparsable target from a clean mismatch so
 * the CLI block reason is actionable. Reasons carry only identifier names, never
 * the raw DDL body.
 */
export function classifyMigrationTarget(
  ddl: string,
  table: string
): { ok: true } | { ok: false; reason: string } {
  const target = extractAlterTableTarget(ddl)
  if (target === null) {
    return {
      ok: false,
      reason: boundedReason(
        '--ddl ALTER TABLE target could not be parsed under the supported identifier contract ' +
          '(simple or quoted names, up to catalog.schema.table).'
      ),
    }
  }
  if (!tableRefsMatch(target, table)) {
    return {
      ok: false,
      reason: boundedReason(`--ddl ALTER TABLE target '${target}' must match --table '${table}'.`),
    }
  }
  return { ok: true }
}

/**
 * Classify the proposed migration DDL for the MVP: single-statement ALTER TABLE only.
 * Never executes anything; returns a bounded reason on rejection.
 */
export function classifyMigrationDdl(sql: string): { ok: boolean; reason?: string } {
  if (!isSingleStatement(sql)) {
    return {
      ok: false,
      reason: boundedReason('--ddl must be a single statement (no `;`-separated statements).'),
    }
  }
  if (!isAlterTableDdl(sql)) {
    return {
      ok: false,
      reason: boundedReason(
        '--ddl must be an ALTER TABLE statement; the MVP blocks CREATE/DROP/INDEX and other DDL.'
      ),
    }
  }
  return { ok: true }
}

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
  requireNonEmpty,
  normalizeFormat,
  shellQuote,
  renderAfterWriteCommand,
  redactSqlForEvidence,
  runGuardSequence,
  allGuardsPassed,
  mapAssertionToStatus,
} from './scenario'

export interface MigrationInput {
  table: string
  ddl: string
  verifyQuery: string
  expect: string
  afterWrite: boolean
  format: 'table' | 'json'
  subjectName?: string
  summary?: string
}

export function normalizeMigrationInput(raw: Record<string, unknown>): MigrationInput {
  const table = requireNonEmpty(raw.table, '--table')
  const ddl = requireNonEmpty(raw.ddl, '--ddl')
  const verifyQuery = requireNonEmpty(raw.verifyQuery, '--verify-query')
  const expect = requireNonEmpty(raw.expect, '--expect')
  const format = normalizeFormat(raw.format)

  const subjectNameRaw = raw.subjectName as string | undefined
  const summaryRaw = raw.summary as string | undefined

  return {
    table,
    ddl,
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

export type MigrationGuardName = 'blacklist' | 'schema' | 'ddl' | 'verify-query-readonly'

export interface MigrationRunners {
  blacklistGuard: (table: string) => Promise<GuardOutcome>
  schemaGuard: (table: string) => Promise<GuardOutcome>
  ddlGuard: (ddl: string, table: string) => Promise<GuardOutcome>
  verifyReadonlyGuard: (verifyQuery: string) => Promise<GuardOutcome>
  runAssertion: (input: MigrationInput) => Promise<AssertionOutcome>
}

export interface MigrationPreflightResult {
  scenario: 'migration'
  mode: 'preflight'
  status: 'ready' | 'blocked'
  table: string
  /** The proposed migration DDL the agent applies externally; never executed here. */
  plannedDdl: string
  guards: GuardResult<MigrationGuardName>[]
  afterWriteCommand: string
}

export interface MigrationAfterWriteResult {
  scenario: 'migration'
  mode: 'after-write'
  status: VerificationStatus
  table: string
  guards: GuardResult<MigrationGuardName>[]
  assertion?: { expect: string; passed: boolean }
  artifact: VerificationArtifact
  blockedReason?: string
}

export function buildMigrationSubject(input: MigrationInput): VerificationSubject {
  return {
    kind: 'migration',
    name: input.subjectName ?? input.table,
    command: 'verify migration',
  }
}

export function buildMigrationAfterWriteCommand(input: MigrationInput): string {
  const flags = [
    `--table ${shellQuote(input.table)}`,
    `--ddl ${shellQuote(input.ddl)}`,
    `--verify-query ${shellQuote(input.verifyQuery)}`,
    `--expect ${shellQuote(input.expect)}`,
  ]
  if (input.subjectName) flags.push(`--subject-name ${shellQuote(input.subjectName)}`)
  if (input.summary) flags.push(`--summary ${shellQuote(input.summary)}`)
  if (input.format !== 'table') flags.push(`--format ${input.format}`)
  return renderAfterWriteCommand('migration', flags)
}

async function runMigrationGuards(
  input: MigrationInput,
  runners: MigrationRunners
): Promise<GuardResult<MigrationGuardName>[]> {
  return runGuardSequence<MigrationGuardName>([
    ['blacklist', () => runners.blacklistGuard(input.table)],
    ['schema', () => runners.schemaGuard(input.table)],
    ['ddl', () => runners.ddlGuard(input.ddl, input.table)],
    ['verify-query-readonly', () => runners.verifyReadonlyGuard(input.verifyQuery)],
  ])
}

const MIGRATION_TASK_PACK_EVIDENCE: VerificationEvidenceRef = {
  kind: 'task-pack-plan',
  taskName: 'migration-review',
  note: 'Preflight guards ran before post-migration read-back verification.',
}

function migrationDefaultSummary(status: VerificationStatus, table: string): string {
  switch (status) {
    case 'verified':
      return `Read-back assertion verified the migration outcome on ${table}.`
    case 'not_verified':
      return `Read-back assertion did not match the expected migration outcome on ${table}.`
    case 'blocked':
      return `Migration verification was blocked before the read-back assertion on ${table}.`
    default:
      return `Migration verification could not produce a trustworthy verdict on ${table}.`
  }
}

export async function runMigrationPreflight(
  input: MigrationInput,
  runners: MigrationRunners
): Promise<MigrationPreflightResult> {
  const guards = await runMigrationGuards(input, runners)
  return {
    scenario: 'migration',
    mode: 'preflight',
    status: allGuardsPassed(guards, 4) ? 'ready' : 'blocked',
    table: input.table,
    plannedDdl: input.ddl,
    guards,
    afterWriteCommand: buildMigrationAfterWriteCommand(input),
  }
}

export async function runMigrationAfterWrite(
  input: MigrationInput,
  runners: MigrationRunners,
  clock: { now?: () => Date; idFactory?: () => string } = {}
): Promise<MigrationAfterWriteResult> {
  const subject = buildMigrationSubject(input)
  const guards = await runMigrationGuards(input, runners)

  if (!allGuardsPassed(guards, 4)) {
    const failed = guards.find((g) => g.status === 'failed')
    const blockedReason =
      failed?.reason ?? 'A required guard failed before the read-back assertion.'
    const artifact = buildVerificationArtifact({
      status: 'blocked',
      subject,
      summary: input.summary ?? migrationDefaultSummary('blocked', input.table),
      evidence: [MIGRATION_TASK_PACK_EVIDENCE],
      blockedReason,
      now: clock.now,
      idFactory: clock.idFactory,
    })
    return {
      scenario: 'migration',
      mode: 'after-write',
      status: 'blocked',
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
    summary: input.summary ?? migrationDefaultSummary(status, input.table),
    evidence: [MIGRATION_TASK_PACK_EVIDENCE, assertEvidence],
    ...(status === 'indeterminate' && outcome.reason ? { blockedReason: outcome.reason } : {}),
    now: clock.now,
    idFactory: clock.idFactory,
  })

  return {
    scenario: 'migration',
    mode: 'after-write',
    status,
    table: input.table,
    guards,
    ...(outcome.ran ? { assertion: { expect: input.expect, passed: outcome.pass === true } } : {}),
    artifact,
  }
}
