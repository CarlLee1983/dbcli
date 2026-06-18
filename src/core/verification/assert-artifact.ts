import type { VerificationSubject, VerificationSubjectKind } from './types'

/** Runtime list of allowed subject kinds — mirrors VerificationSubjectKind in types.ts. */
export const VERIFICATION_SUBJECT_KINDS = [
  'recovery',
  'task-pack',
  'assertion',
  'migration',
  'backfill',
  'manual',
] as const satisfies readonly VerificationSubjectKind[]

export function isVerificationSubjectKind(value: unknown): value is VerificationSubjectKind {
  return (
    typeof value === 'string' &&
    (VERIFICATION_SUBJECT_KINDS as readonly string[]).includes(value)
  )
}

/** Thrown for malformed / unknown --verification-subject input, before any DB work. */
export class AssertArtifactError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssertArtifactError'
    Object.setPrototypeOf(this, AssertArtifactError.prototype)
  }
}

/**
 * Parse `<kind>:<name>` into a VerificationSubject. Splits on the first colon so
 * names may themselves contain colons. Rejects unknown kinds and empty parts.
 */
export function parseVerificationSubject(raw: string): VerificationSubject {
  const idx = raw.indexOf(':')
  if (idx === -1) {
    throw new AssertArtifactError(
      `--verification-subject must be "<kind>:<name>" (got '${raw}')`
    )
  }
  const kind = raw.slice(0, idx).trim()
  const name = raw.slice(idx + 1).trim()
  if (kind.length === 0 || name.length === 0) {
    throw new AssertArtifactError(
      `--verification-subject must be "<kind>:<name>" with non-empty parts (got '${raw}')`
    )
  }
  if (!isVerificationSubjectKind(kind)) {
    throw new AssertArtifactError(
      `Unknown verification subject kind '${kind}'. Allowed: ${VERIFICATION_SUBJECT_KINDS.join(', ')}`
    )
  }
  return { kind, name }
}
