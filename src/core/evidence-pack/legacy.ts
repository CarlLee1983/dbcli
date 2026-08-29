/**
 * Reading evidence packs that were not written by the current builder.
 *
 * Two mutually incompatible pack layouts exist in the world and both declare
 * `version: 1`:
 *
 * - **v2.1.0 and earlier** — carries a `coverage` block, a random `evp_<uuid>`
 *   id, and a digest taken with a bare `JSON.stringify` over
 *   `{version,id,createdAt,subject,claims,coverage}`.
 * - **v3.0.0** — `coverage` removed, id derived from the digest, digest taken
 *   with sorted-key canonicalization over `{version,subject,claims}` only. The
 *   format broke; the version constant did not follow.
 *
 * Handing either of those to the current parser produced `digest mismatch`,
 * which reads as tampering. They are not tampered with; they are old. This
 * module tells them apart by structure before any digest is computed, so the
 * reader can say which format it is looking at.
 *
 * The two digest reimplementations below are **frozen**. They describe bytes
 * that already exist on disk somewhere, so editing them to be tidier changes
 * the answer for artifacts nobody can rewrite. Neither one may be refactored to
 * share code with the current `canonicalize`: sharing is exactly how the v1
 * digest silently changed the first time.
 */

import { createHash } from 'node:crypto'

/** The format the current builder writes. */
export const EVIDENCE_PACK_CURRENT_VERSION = 2 as const

/** Every artifact-format version this reader knows how to name. */
export const KNOWN_EVIDENCE_PACK_VERSIONS = [1, 2] as const

export type EvidencePackLegacyFormat =
  /** Shipped in v2.1.0 and earlier: `coverage` block, random id, unsorted digest. */
  | 'v1-coverage'
  /** Written by v3.0.0: the current layout, mislabelled `version: 1`. */
  | 'v1-untagged-v3'

export type EvidencePackLegacyIntegrity =
  /** The stored digest reproduces under that format's own algorithm. */
  | 'legacy-verified'
  /** The format is recognised and the digest does not reproduce. */
  | 'legacy-digest-mismatch'
  /** The format is recognised but too malformed to run its digest over. */
  | 'legacy-unverifiable'

export type EvidencePackUnsupportedReason =
  | 'not-an-object'
  | 'unknown-version'
  | 'version-structure-mismatch'

export type EvidencePackClassification =
  | { format: 'current'; formatVersion: typeof EVIDENCE_PACK_CURRENT_VERSION }
  | {
      format: 'legacy'
      formatVersion: 1
      legacyFormat: EvidencePackLegacyFormat
      integrity: EvidencePackLegacyIntegrity
      /** Written by, in human terms. Kept out of the machine fields on purpose. */
      producedBy: string
    }
  | { format: 'unsupported'; reason: EvidencePackUnsupportedReason; formatVersion: number | null }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Key order as the v2.1.0 build and parse paths happened to insert it.
 *
 * That order *was* the canonical form back then — there was no sorting — so it
 * is reproduced here literally rather than derived.
 */
const LEGACY_V1_REFERENCE_KEYS: Readonly<Record<string, readonly string[]>> = {
  'verification-artifact': ['kind', 'id', 'createdAt', 'status', 'subjectKind'],
  audit: ['kind', 'id', 'createdAt', 'connectionName', 'command', 'success', 'recoveryRef'],
  receipt: ['kind', 'id', 'createdAt', 'operation', 'outcome', 'digest', 'path'],
}

/**
 * Re-emit exactly the listed keys, in the listed order, refusing anything that
 * carries a key the old parser would have rejected. Silently dropping an
 * unknown field would compute the digest over less than the file contains.
 */
function pickInOrder(
  value: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> | null {
  if (Object.keys(value).some((key) => !keys.includes(key))) return null
  const picked: Record<string, unknown> = {}
  for (const key of keys) {
    if (value[key] !== undefined) picked[key] = value[key]
  }
  return picked
}

function compareLegacyReferences(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const [kindA, kindB] = [String(a.kind), String(b.kind)]
  return kindA === kindB ? String(a.id).localeCompare(String(b.id)) : kindA.localeCompare(kindB)
}

/**
 * The v2.1.0 digest, reproduced. Returns `null` when the artifact is too
 * malformed to run it over, which is reported as `legacy-unverifiable` rather
 * than as a mismatch — the reader does not know that it disagrees, only that it
 * cannot tell.
 */
export function legacyV1CoveragePackDigest(raw: Record<string, unknown>): string | null {
  if (!isRecord(raw.subject) || !Array.isArray(raw.claims) || !isRecord(raw.coverage)) return null
  const claims: unknown[] = []
  for (const claim of [...raw.claims].sort((a, b) =>
    String((a as Record<string, unknown>)?.id).localeCompare(
      String((b as Record<string, unknown>)?.id)
    )
  )) {
    if (!isRecord(claim) || !Array.isArray(claim.evidence)) return null
    if (Object.keys(claim).some((key) => !['id', 'text', 'evidence'].includes(key))) return null
    const evidence: unknown[] = []
    for (const reference of [...claim.evidence].sort((a, b) =>
      compareLegacyReferences(a as Record<string, unknown>, b as Record<string, unknown>)
    )) {
      if (!isRecord(reference)) return null
      const keys = LEGACY_V1_REFERENCE_KEYS[String(reference.kind)]
      if (!keys) return null
      const picked = pickInOrder(reference, keys)
      if (picked === null) return null
      evidence.push(picked)
    }
    claims.push({ id: claim.id, text: claim.text, evidence })
  }
  const subject =
    raw.subject.name === undefined
      ? { kind: raw.subject.kind }
      : { kind: raw.subject.kind, name: raw.subject.name }
  const base = {
    version: raw.version,
    id: raw.id,
    createdAt: raw.createdAt,
    subject,
    claims,
    coverage: {
      completeForDeclaredEvidence: raw.coverage.completeForDeclaredEvidence,
      gaps: raw.coverage.gaps,
    },
  }
  return createHash('sha256').update(JSON.stringify(base)).digest('hex')
}

/**
 * The v3.0.0 digest, reproduced. Structurally the current algorithm with
 * `version: 1` in the content — which is precisely why v3.0.0 packs cannot be
 * accepted as current ones: the version is inside the digest, so a v3 pack and
 * an otherwise identical v2 pack hash differently and neither can stand in for
 * the other.
 */
export function legacyUntaggedV3PackDigest(raw: Record<string, unknown>): string | null {
  if (!isRecord(raw.subject) || !Array.isArray(raw.claims)) return null
  const canonicalize = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalize(v)}`)
    return `{${entries.join(',')}}`
  }
  return createHash('sha256')
    .update(canonicalize({ version: 1, subject: raw.subject, claims: raw.claims }))
    .digest('hex')
}

function storedDigest(raw: Record<string, unknown>): string | null {
  if (!isRecord(raw.integrity)) return null
  const digest = raw.integrity.digest
  return typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest) ? digest : null
}

function legacyIntegrity(
  raw: Record<string, unknown>,
  compute: (value: Record<string, unknown>) => string | null
): EvidencePackLegacyIntegrity {
  const stored = storedDigest(raw)
  const computed = compute(raw)
  if (stored === null || computed === null) return 'legacy-unverifiable'
  return stored === computed ? 'legacy-verified' : 'legacy-digest-mismatch'
}

/**
 * Name the format before trusting anything about it.
 *
 * Deliberately total and side-effect free: every input lands in exactly one of
 * current / legacy / unsupported, and an unknown version is unsupported rather
 * than optimistically parsed.
 */
export function classifyEvidencePackArtifact(raw: unknown): EvidencePackClassification {
  if (!isRecord(raw)) return { format: 'unsupported', reason: 'not-an-object', formatVersion: null }
  const version = raw.version
  if (typeof version !== 'number' || !KNOWN_EVIDENCE_PACK_VERSIONS.includes(version as 1 | 2)) {
    return {
      format: 'unsupported',
      reason: 'unknown-version',
      formatVersion: typeof version === 'number' ? version : null,
    }
  }
  const hasCoverage = Object.hasOwn(raw, 'coverage')
  if (version === EVIDENCE_PACK_CURRENT_VERSION) {
    // A current version number over a layout only the old builder produced is
    // not a current pack with a stray field; it is a relabelled artifact.
    if (hasCoverage) {
      return { format: 'unsupported', reason: 'version-structure-mismatch', formatVersion: version }
    }
    return { format: 'current', formatVersion: EVIDENCE_PACK_CURRENT_VERSION }
  }
  return hasCoverage
    ? {
        format: 'legacy',
        formatVersion: 1,
        legacyFormat: 'v1-coverage',
        integrity: legacyIntegrity(raw, legacyV1CoveragePackDigest),
        producedBy: 'dbcli 2.1.0 or earlier',
      }
    : {
        format: 'legacy',
        formatVersion: 1,
        legacyFormat: 'v1-untagged-v3',
        integrity: legacyIntegrity(raw, legacyUntaggedV3PackDigest),
        producedBy: 'dbcli 3.0.0',
      }
}

export function describeEvidencePackClassification(
  classification: EvidencePackClassification
): string {
  if (classification.format === 'current') return 'evidence pack uses the current format'
  if (classification.format === 'legacy') {
    return `evidence pack uses legacy format ${classification.legacyFormat} written by ${classification.producedBy}; legacy packs are readable but never current-valid and cannot be migrated`
  }
  if (classification.reason === 'not-an-object') return 'evidence pack must be an object'
  if (classification.reason === 'version-structure-mismatch') {
    return `evidence pack declares version ${classification.formatVersion} but its structure belongs to another format`
  }
  return `evidence pack format version ${classification.formatVersion ?? 'missing'} is not supported`
}
