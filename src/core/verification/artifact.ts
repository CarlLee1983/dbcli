import { randomBytes } from 'node:crypto'
import {
  VERIFICATION_ARTIFACT_SCHEMA_VERSION,
  type VerificationArtifact,
  type VerificationEvidenceRef,
  type VerificationStatus,
  type VerificationSubject,
} from './types'
import { isVerificationStatus } from './status'

/** Max length for any single bounded text field (command / note / blockedReason). */
export const VERIFICATION_TEXT_FIELD_CAP = 2_000

/** Max number of evidence refs kept on an artifact (last slot reserved for a truncation marker). */
export const VERIFICATION_EVIDENCE_CAP = 20

const TRUNCATION_SUFFIX = '… [truncated]'

export interface BuildVerificationArtifactInput {
  status: VerificationStatus
  subject: VerificationSubject
  summary: string
  evidence: VerificationEvidenceRef[]
  blockedReason?: string
  now?: () => Date
  idFactory?: () => string
}

/**
 * Internal, non-cryptographic id: `ver_<base36-ms>_<8 hex>`.
 * The hex suffix prevents same-millisecond collisions in tight loops.
 */
export function generateArtifactId(now: Date = new Date()): string {
  return `ver_${now.getTime().toString(36)}_${randomBytes(4).toString('hex')}`
}

function boundText(value: string, cap: number = VERIFICATION_TEXT_FIELD_CAP): string {
  if (value.length <= cap) return value
  return value.slice(0, cap - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
}

function boundEvidenceRef(ref: VerificationEvidenceRef): VerificationEvidenceRef {
  const out: VerificationEvidenceRef = { ...ref }
  if (out.command !== undefined) out.command = boundText(out.command)
  if (out.note !== undefined) out.note = boundText(out.note)
  return out
}

function boundEvidence(evidence: VerificationEvidenceRef[]): VerificationEvidenceRef[] {
  const bounded = evidence.map(boundEvidenceRef)
  if (bounded.length <= VERIFICATION_EVIDENCE_CAP) return bounded
  const kept = bounded.slice(0, VERIFICATION_EVIDENCE_CAP - 1)
  kept.push({
    kind: 'manual',
    note: `Evidence truncated: kept ${VERIFICATION_EVIDENCE_CAP - 1} of ${evidence.length} refs.`,
  })
  return kept
}

export function buildVerificationArtifact(
  input: BuildVerificationArtifactInput
): VerificationArtifact {
  if (!isVerificationStatus(input.status)) {
    throw new Error(
      `Invalid verification artifact: status '${String(input.status)}' is not allowed`
    )
  }
  const summary = input.summary.trim()
  if (summary.length === 0) {
    throw new Error('Invalid verification artifact: summary must be a non-empty string')
  }
  if (input.evidence.length === 0) {
    throw new Error('Invalid verification artifact: evidence must not be empty')
  }

  const createdAt = (input.now?.() ?? new Date()).toISOString()
  const id = input.idFactory?.() ?? generateArtifactId(input.now?.())

  const artifact: VerificationArtifact = {
    schemaVersion: VERIFICATION_ARTIFACT_SCHEMA_VERSION,
    id,
    createdAt,
    status: input.status,
    subject: input.subject,
    summary,
    evidence: boundEvidence(input.evidence),
  }
  if (input.blockedReason !== undefined) {
    artifact.blockedReason = boundText(input.blockedReason)
  }
  return artifact
}
