/**
 * The Verification Attestation: what one `make verify` run decided, in a file.
 *
 * Verification evidence used to exist in exactly one place — ForgePilot's
 * `.forgepilot/state.json`, on the machine that ran it, gitignored because a
 * committed result would dirty the worktree the next verification refuses to
 * run against, and because recording a result takes a commit that immediately
 * invalidates the result being recorded. The evidence was real and unreachable.
 * This document is the reachable half: one revision, one command, one outcome,
 * written by the run itself and read by anyone.
 *
 * ## What it will not say
 *
 * The schema is closed, and deliberately smaller than the obvious design. There
 * is no Work Item ID and no Story reference: `make verify` does not know either,
 * so both would arrive from the caller, and a producer that cannot check a field
 * records whatever it was handed. ForgePilot binds evidence to work by revision
 * already and can bind this the same way. ADR-0026 carries the reopening
 * condition.
 *
 * There is no repository name either, for the same reason one level quieter.
 * It was a hardcoded constant: validated, never observed, and therefore a
 * record of what the author typed rather than of where the run happened — the
 * exact thing this schema excludes `work_item` for. Deriving it from `git
 * remote get-url origin` would have been worse: a remote URL can carry
 * credentials, and R4 forbids exactly that. A commit SHA identifies its subject
 * without help, so the field is gone rather than fixed.
 *
 * There is no staleness either. The document states a revision; whether that
 * revision is still HEAD has a different answer every time it is asked, and an
 * artifact that answers it is wrong immediately after being written.
 *
 * ## What it is not
 *
 * Not an Evidence Receipt (`src/core/evidence-receipt/`) and not a Verification
 * Artifact (`src/core/verification/`). Those are product: they record dbcli
 * operations against a database, ship to users, and carry published schema
 * versions. This records a commit, is read by a reviewer or a CI job, and lives
 * in `scripts/` where nothing publishes it. Folding it into either would move a
 * shipped version for reasons no user can observe.
 */

import { createHash } from 'node:crypto'

/**
 * The artifact format version, which is not the package version.
 *
 * It moves when a field, its requiredness, or the meaning of a value changes.
 * DBCLI-019's per-step detail is the next thing expected to move it.
 */
export const ATTESTATION_SCHEMA_VERSION = 1

export type AttestationResult = 'PASS' | 'FAIL'

/** The bounded description of where a run happened. Never an environment dump. */
export interface AttestationEnvironment {
  readonly os: string
  readonly arch: string
  readonly bun: string
  /** Whether `CI` was set. The variable's value is never copied. */
  readonly ci: boolean
}

export interface Attestation {
  readonly schema_version: number
  readonly revision: string
  readonly dirty_worktree: boolean
  readonly command: string
  readonly result: AttestationResult
  /**
   * The verification run's own status, which is not `make`'s.
   *
   * `make` reports its own error code when a recipe fails; the number here is
   * the one the failing step produced, because that is what a reader debugging
   * the failure needs.
   */
  readonly exit_code: number
  readonly started_at: string
  readonly finished_at: string
  readonly duration_ms: number
  readonly environment: AttestationEnvironment
  readonly attestation_hash: string
}

export interface AttestationInput {
  readonly revision: string
  readonly dirtyWorktree: boolean
  readonly command: string
  readonly exitCode: number
  readonly startedAt: string
  readonly finishedAt: string
  readonly environment: AttestationEnvironment
}

/** Key order is part of the format: two serialisations of one run must match. */
const FIELDS = [
  'schema_version',
  'revision',
  'dirty_worktree',
  'command',
  'result',
  'exit_code',
  'started_at',
  'finished_at',
  'duration_ms',
  'environment',
  'attestation_hash',
] as const

const ENVIRONMENT_FIELDS = ['os', 'arch', 'bun', 'ci'] as const

const REVISION = /^[0-9a-f]{40}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,63}$/
const COMMAND = /^[a-z][a-z0-9 :-]{0,63}$/

/** One day. Long enough for any real gate, short enough to catch a bad clock. */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000

function refuse(field: string, reason: string): never {
  throw new Error(`${field} ${reason}`)
}

function requireMatch(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    refuse(field, `must match ${pattern.source}, got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Serialise an attestation to its canonical bytes.
 *
 * Fixed key order, two-space indentation, LF endings, one trailing newline.
 * `JSON.stringify` already emits LF and no locale-dependent numbers; the order
 * is the part that has to be stated, because object key order is a property of
 * how a value was built rather than of what it means.
 */
export function serialiseAttestation(attestation: Attestation): string {
  const ordered: Record<string, unknown> = {}
  for (const field of FIELDS) ordered[field] = attestation[field]
  return `${JSON.stringify(ordered, null, 2)}\n`
}

/** The canonical bytes an attestation's hash is taken over: itself, less the hash. */
function hashableBytes(attestation: Omit<Attestation, 'attestation_hash'>): string {
  const ordered: Record<string, unknown> = {}
  for (const field of FIELDS) {
    if (field === 'attestation_hash') continue
    ordered[field] = attestation[field]
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

function checkEnvironment(environment: AttestationEnvironment): AttestationEnvironment {
  const keys = Object.keys(environment)
  if (keys.length !== ENVIRONMENT_FIELDS.length) {
    refuse(
      'environment',
      `carries ${JSON.stringify(keys)}, not ${JSON.stringify([...ENVIRONMENT_FIELDS])}`
    )
  }

  for (const field of ['os', 'arch', 'bun'] as const) {
    requireMatch(environment[field], SAFE_TEXT, `environment.${field}`)
  }
  if (typeof environment.ci !== 'boolean') refuse('environment.ci', 'must be a boolean')

  return { os: environment.os, arch: environment.arch, bun: environment.bun, ci: environment.ci }
}

/**
 * Read the bounded environment description from a process's own facts.
 *
 * The whole of what this does with `env` is ask whether `CI` is set. That is
 * the point of it being a function over an argument rather than a read of
 * `process.env` somewhere in the writer: "no environment variable's value
 * reaches the document" stops being a promise a reviewer has to trust and
 * becomes something a test can hand a hostile environment to and check.
 *
 * The value of `CI` is never copied. Presence is what a reader needs, and a
 * copied value is one field's worth of harmless CI output today and an
 * arbitrary caller-supplied string tomorrow.
 */
export function readEnvironment(source: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly platform: string
  readonly arch: string
  readonly bun: string
}): AttestationEnvironment {
  return {
    os: source.platform,
    arch: source.arch,
    bun: source.bun,
    ci: source.env.CI !== undefined,
  }
}

/**
 * Build an attestation, refusing anything the repository cannot state.
 *
 * Validation is not defence against a hostile caller — the only caller is this
 * repository's own verification. It is defence against a plausible one: a
 * shortened revision, a clock that ran backwards, a version string carrying
 * something that is not a version. A document that records those is worse than
 * no document, because it will be believed.
 */
export function buildAttestation(input: AttestationInput): Attestation {
  const revision = requireMatch(input.revision, REVISION, 'revision')
  const command = requireMatch(input.command, COMMAND, 'command')
  const startedAt = requireMatch(input.startedAt, INSTANT, 'started_at')
  const finishedAt = requireMatch(input.finishedAt, INSTANT, 'finished_at')

  if (!Number.isInteger(input.exitCode) || input.exitCode < 0 || input.exitCode > 255) {
    refuse('exit_code', `must be an integer in 0..255, got ${JSON.stringify(input.exitCode)}`)
  }

  const duration = Date.parse(finishedAt) - Date.parse(startedAt)
  if (duration < 0) refuse('finished_at', `is before started_at, so the run has no duration`)

  // A verification that took longer than a day did not take longer than a day.
  // The realistic causes are a clock that jumped and arguments that shifted, and
  // both produce a document that is internally consistent and plainly absurd,
  // with nothing else in this file willing to say so. Refusing costs a record,
  // never a verdict.
  if (duration > MAX_DURATION_MS) {
    refuse('finished_at', `is ${duration}ms after started_at, longer than a verification can run`)
  }

  const body = {
    schema_version: ATTESTATION_SCHEMA_VERSION,
    revision,
    dirty_worktree: input.dirtyWorktree === true,
    command,
    result: (input.exitCode === 0 ? 'PASS' : 'FAIL') as AttestationResult,
    exit_code: input.exitCode,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: duration,
    environment: checkEnvironment(input.environment),
  }

  const digest = createHash('sha256').update(hashableBytes(body), 'utf8').digest('hex')

  return { ...body, attestation_hash: `sha256:${digest}` }
}

/**
 * Read an attestation, refusing anything this reader does not fully understand.
 *
 * An unknown `schema_version` is refused rather than read for the fields that
 * happen to be recognised: a later version may change what a field means, and a
 * reader that guesses produces a confident wrong answer about whether a commit
 * was verified.
 */
export function parseAttestation(text: string): Attestation {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (cause) {
    refuse('attestation', `is not JSON: ${(cause as Error).message}`)
  }

  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    refuse('attestation', 'is not a JSON object')
  }

  const record = document as Record<string, unknown>

  if (record.schema_version !== ATTESTATION_SCHEMA_VERSION) {
    refuse(
      'schema_version',
      `is ${JSON.stringify(record.schema_version)}; this reader knows ${ATTESTATION_SCHEMA_VERSION} only`
    )
  }

  for (const field of FIELDS) {
    if (!(field in record)) refuse(field, 'is missing')
  }
  for (const field of Object.keys(record)) {
    if (!(FIELDS as readonly string[]).includes(field)) {
      refuse(field, 'is not a field this attestation format defines')
    }
  }

  const environment = record.environment
  if (typeof environment !== 'object' || environment === null || Array.isArray(environment)) {
    refuse('environment', 'is not a JSON object')
  }

  // Types before values. `buildAttestation` narrows the strings by regex and
  // the number by range, but it reads `dirty_worktree` as `x === true` — so a
  // document saying `"yes"` used to rebuild as `false`, match its own hash, and
  // be handed back with the flag flipped. Every other reader of that file sees
  // a dirty worktree; this one saw a clean one, and said nothing.
  if (typeof record.dirty_worktree !== 'boolean') {
    refuse('dirty_worktree', `must be a boolean, got ${JSON.stringify(record.dirty_worktree)}`)
  }
  if (typeof record.exit_code !== 'number') {
    refuse('exit_code', `must be a number, got ${JSON.stringify(record.exit_code)}`)
  }

  const attestation = buildAttestation({
    revision: record.revision as string,
    dirtyWorktree: record.dirty_worktree as boolean,
    command: record.command as string,
    exitCode: record.exit_code as number,
    startedAt: record.started_at as string,
    finishedAt: record.finished_at as string,
    environment: environment as AttestationEnvironment,
  })

  // Rebuilding and comparing is the whole check: every derived field — the
  // result, the duration, the hash — has to follow from the stated ones.
  //
  // The two comparisons are not redundant. The hash catches an edit to a stated
  // field, because the rebuild then produces a different digest. The result and
  // duration comparison catches the opposite forgery: a derived field edited
  // while the legitimate hash is left in place, where the rebuilt digest still
  // matches. Without it the reader would silently hand back the corrected
  // values for a file that says something else.
  if (record.attestation_hash !== attestation.attestation_hash) {
    refuse(
      'attestation_hash',
      `does not match the content: expected ${attestation.attestation_hash}`
    )
  }
  if (record.result !== attestation.result || record.duration_ms !== attestation.duration_ms) {
    refuse('attestation', 'states a result or duration that its own fields do not produce')
  }

  return attestation
}
