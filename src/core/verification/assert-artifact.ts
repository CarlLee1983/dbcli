import type {
  VerificationSubject,
  VerificationSubjectKind,
  VerificationArtifact,
  VerificationEvidenceRef,
} from './types'
import type { AssertVerdict } from '@/core/result-snapshot/types'
import { redactArgv } from '@/utils/redaction'
import { buildVerificationArtifact } from './artifact'

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
    typeof value === 'string' && (VERIFICATION_SUBJECT_KINDS as readonly string[]).includes(value)
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
    throw new AssertArtifactError(`--verification-subject must be "<kind>:<name>" (got '${raw}')`)
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

export interface BuildAssertArtifactInput {
  verdict: AssertVerdict
  subject: VerificationSubject
  /** Explicit summary; when omitted a bounded default is derived from the verdict. */
  summary?: string
  /** Raw argv for redacted command evidence (typically process.argv). */
  argv: string[]
  /** Audit entry id from writeAuditEntry; null/undefined when audit is off or failed. */
  auditRef?: string | null
  now?: () => Date
  idFactory?: () => string
}

function defaultSummary(pass: boolean): string {
  return pass
    ? 'Assertion verified the expected state.'
    : 'Assertion did not verify the expected state.'
}

/**
 * Map an AssertVerdict to a v1 VerificationArtifact. Status and evidence exitCode
 * follow assertion truth (verdict.pass), never the process exit code, so a
 * --no-fail failure still records not_verified / exitCode 1.
 */
export function buildAssertVerificationArtifact(
  input: BuildAssertArtifactInput
): VerificationArtifact {
  const pass = input.verdict.pass
  const evidence: VerificationEvidenceRef = {
    kind: 'assert',
    command: redactArgv(input.argv),
    exitCode: pass ? 0 : 1,
    ...(input.auditRef ? { auditRef: input.auditRef } : {}),
  }
  return buildVerificationArtifact({
    status: pass ? 'verified' : 'not_verified',
    subject: input.subject,
    summary: input.summary?.trim() || defaultSummary(pass),
    evidence: [evidence],
    now: input.now,
    idFactory: input.idFactory,
  })
}
