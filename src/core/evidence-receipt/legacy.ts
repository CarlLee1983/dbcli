/**
 * Reading evidence receipts that were not written by the current builder.
 *
 * The same drift that hit evidence packs hit receipts: v3.0.0 replaced
 * `observation: {kind, fingerprint}` with the observation stated plainly
 * (`{kind, checksPassed, checksTotal}` or `{kind, status}`) and left
 * `EVIDENCE_RECEIPT_VERSION` at 1. Two layouts, one version number.
 *
 * A receipt carries no digest over itself — only `provenance.commandHash` over
 * its own command string — so "verify a legacy receipt" means exactly that hash
 * and nothing more. It is reported as such rather than dressed up as integrity.
 */

import { createHash } from 'node:crypto'

/** The format the current builder writes. */
export const EVIDENCE_RECEIPT_CURRENT_VERSION = 2 as const

export const KNOWN_EVIDENCE_RECEIPT_VERSIONS = [1, 2] as const

export type EvidenceReceiptLegacyFormat =
  /** Shipped in v2.1.0 and earlier: `observation.fingerprint`. */
  | 'v1-observation-fingerprint'
  /** Written by v3.0.0: the current observation layout, mislabelled `version: 1`. */
  | 'v1-untagged-v3'

export type EvidenceReceiptLegacyIntegrity =
  /** `provenance.commandHash` reproduces over `provenance.command`. */
  | 'legacy-command-hash-verified'
  | 'legacy-command-hash-mismatch'
  /** No usable command provenance to check. */
  | 'legacy-unverifiable'

export type EvidenceReceiptUnsupportedReason =
  | 'not-an-object'
  | 'unknown-version'
  | 'version-structure-mismatch'

export type EvidenceReceiptClassification =
  | { format: 'current'; formatVersion: typeof EVIDENCE_RECEIPT_CURRENT_VERSION }
  | {
      format: 'legacy'
      formatVersion: 1
      legacyFormat: EvidenceReceiptLegacyFormat
      integrity: EvidenceReceiptLegacyIntegrity
      producedBy: string
    }
  | {
      format: 'unsupported'
      reason: EvidenceReceiptUnsupportedReason
      formatVersion: number | null
    }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether the observation is the pre-3.0.0 hashed one. */
function hasFingerprintObservation(raw: Record<string, unknown>): boolean {
  return isRecord(raw.observation) && typeof raw.observation.fingerprint === 'string'
}

function legacyIntegrity(raw: Record<string, unknown>): EvidenceReceiptLegacyIntegrity {
  if (!isRecord(raw.provenance)) return 'legacy-unverifiable'
  const { command, commandHash } = raw.provenance
  if (typeof command !== 'string' || typeof commandHash !== 'string') return 'legacy-unverifiable'
  const expected = `sha256:${createHash('sha256').update(command).digest('hex')}`
  return commandHash === expected ? 'legacy-command-hash-verified' : 'legacy-command-hash-mismatch'
}

/** Name the format before trusting anything about it. Total, side-effect free. */
export function classifyEvidenceReceiptArtifact(raw: unknown): EvidenceReceiptClassification {
  if (!isRecord(raw)) return { format: 'unsupported', reason: 'not-an-object', formatVersion: null }
  const version = raw.version
  if (typeof version !== 'number' || !KNOWN_EVIDENCE_RECEIPT_VERSIONS.includes(version as 1 | 2)) {
    return {
      format: 'unsupported',
      reason: 'unknown-version',
      formatVersion: typeof version === 'number' ? version : null,
    }
  }
  const fingerprinted = hasFingerprintObservation(raw)
  if (version === EVIDENCE_RECEIPT_CURRENT_VERSION) {
    if (fingerprinted) {
      return { format: 'unsupported', reason: 'version-structure-mismatch', formatVersion: version }
    }
    return { format: 'current', formatVersion: EVIDENCE_RECEIPT_CURRENT_VERSION }
  }
  return {
    format: 'legacy',
    formatVersion: 1,
    legacyFormat: fingerprinted ? 'v1-observation-fingerprint' : 'v1-untagged-v3',
    integrity: legacyIntegrity(raw),
    producedBy: fingerprinted ? 'dbcli 2.1.0 or earlier' : 'dbcli 3.0.0',
  }
}

export function describeEvidenceReceiptClassification(
  classification: EvidenceReceiptClassification
): string {
  if (classification.format === 'current') return 'evidence receipt uses the current format'
  if (classification.format === 'legacy') {
    return `evidence receipt uses legacy format ${classification.legacyFormat} written by ${classification.producedBy}; legacy receipts are readable but never current-valid and cannot be migrated`
  }
  if (classification.reason === 'not-an-object') return 'evidence receipt must be an object'
  if (classification.reason === 'version-structure-mismatch') {
    return `evidence receipt declares version ${classification.formatVersion} but its structure belongs to another format`
  }
  return `evidence receipt format version ${classification.formatVersion ?? 'missing'} is not supported`
}
