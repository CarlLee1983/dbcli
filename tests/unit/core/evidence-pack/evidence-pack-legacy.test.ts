/**
 * Reading evidence packs the current builder did not write.
 *
 * Every legacy input here is a **frozen file** under
 * `tests/fixtures/evidence-legacy/`, produced by the code that actually shipped
 * (see that directory's README). Building them with today's builder would only
 * prove the builder agrees with itself, which is the failure mode that let two
 * incompatible layouts both ship as `version: 1`.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildEvidencePack,
  classifyEvidencePackArtifact,
  EVIDENCE_PACK_VERSION,
  EvidencePackLegacyFormatError,
  EvidencePackValidationError,
  parseEvidencePack,
  type EvidenceClaimsInput,
  type EvidenceReference,
} from '@/core/evidence-pack'

const FIXTURES = join(import.meta.dir, '../../../fixtures/evidence-legacy')

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>

const CLAIMS: EvidenceClaimsInput = {
  subject: { kind: 'table', name: 'orders snapshot' },
  claims: [
    { id: 'claim-b', text: 'The backfill completed for the reviewed window.' },
    { id: 'claim-a', text: 'The reviewed window matches the change request.' },
  ],
}

const REFERENCES: EvidenceReference[] = [
  {
    kind: 'verification-artifact',
    id: 'ver_0001',
    createdAt: '2026-08-09T12:00:00.000Z',
    status: 'verified',
    subjectKind: 'table',
  },
  {
    kind: 'audit',
    id: 'aud_0001',
    createdAt: '2026-08-09T12:00:01.000Z',
    connectionName: 'primary',
    command: 'verify',
    success: true,
  },
]

describe('evidence pack format version', () => {
  test('the current builder writes version 2', () => {
    expect(EVIDENCE_PACK_VERSION).toBe(2)
    expect(buildEvidencePack(CLAIMS, REFERENCES).version).toBe(2)
  })

  // The whole point of the bump: v3.0.0 and the current builder produce
  // different bytes for identical input, so they must not share a version.
  test('a current pack does not reproduce the v3.0.0 digest for identical content', () => {
    const built = buildEvidencePack(CLAIMS, REFERENCES)
    const mislabeled = fixture('v3-mislabeled-pack.json')
    expect(built.integrity.digest).not.toBe(
      (mislabeled.integrity as Record<string, unknown>).digest
    )
  })

  test('equivalent content produces the same digest and the same id', () => {
    const first = buildEvidencePack(CLAIMS, REFERENCES)
    const second = buildEvidencePack(
      { subject: CLAIMS.subject, claims: [...CLAIMS.claims].reverse() },
      [...REFERENCES].reverse()
    )
    expect(second.integrity.digest).toBe(first.integrity.digest)
    expect(second.id).toBe(first.id)
    expect(first.id).toBe(`evp_${first.integrity.digest.slice(0, 32)}`)
  })

  test('a round trip through the parser preserves a current pack', () => {
    const built = buildEvidencePack(CLAIMS, REFERENCES)
    expect(parseEvidencePack(JSON.parse(JSON.stringify(built)))).toEqual(built)
  })
})

describe('classifying legacy evidence packs', () => {
  test('a v2.1.0 pack is recognised as v1-coverage and its own digest verifies', () => {
    expect(classifyEvidencePackArtifact(fixture('legacy-v1-pack.json'))).toEqual({
      format: 'legacy',
      formatVersion: 1,
      legacyFormat: 'v1-coverage',
      integrity: 'legacy-verified',
      producedBy: 'dbcli 2.1.0 or earlier',
    })
  })

  test('a v3.0.0 pack mislabelled version 1 is recognised as a distinct legacy format', () => {
    expect(classifyEvidencePackArtifact(fixture('v3-mislabeled-pack.json'))).toEqual({
      format: 'legacy',
      formatVersion: 1,
      legacyFormat: 'v1-untagged-v3',
      integrity: 'legacy-verified',
      producedBy: 'dbcli 3.0.0',
    })
  })

  // Both files say `version: 1`. Telling them apart is the requirement.
  test('the two version-1 layouts are never given the same classification', () => {
    const a = classifyEvidencePackArtifact(fixture('legacy-v1-pack.json'))
    const b = classifyEvidencePackArtifact(fixture('v3-mislabeled-pack.json'))
    expect(a).not.toEqual(b)
  })

  test('a tampered legacy digest reports a mismatch, not a verified read', () => {
    const tampered = fixture('legacy-v1-pack.json')
    tampered.integrity = { algorithm: 'sha256', digest: 'f'.repeat(64) }
    const classification = classifyEvidencePackArtifact(tampered)
    expect(classification.format).toBe('legacy')
    expect(classification).toMatchObject({ integrity: 'legacy-digest-mismatch' })
  })

  test('an unknown field inside a legacy pack makes it unverifiable rather than verified', () => {
    const extended = fixture('legacy-v1-pack.json')
    const claims = extended.claims as Array<Record<string, unknown>>
    claims[0]!.note = 'added later'
    expect(classifyEvidencePackArtifact(extended)).toMatchObject({
      integrity: 'legacy-unverifiable',
    })
  })
})

describe('unsupported evidence packs fail closed', () => {
  test('an unknown version is unsupported, never optimistically parsed', () => {
    expect(
      classifyEvidencePackArtifact({ ...fixture('v3-mislabeled-pack.json'), version: 99 })
    ).toEqual({
      format: 'unsupported',
      reason: 'unknown-version',
      formatVersion: 99,
    })
  })

  test('a missing version is unsupported', () => {
    const { version: _version, ...rest } = fixture('v3-mislabeled-pack.json')
    expect(classifyEvidencePackArtifact(rest)).toEqual({
      format: 'unsupported',
      reason: 'unknown-version',
      formatVersion: null,
    })
  })

  // A current version number over an old layout is a relabelled artifact, and
  // saying so is more useful than "unknown field".
  test('version 2 over the v1 coverage layout is a version/structure mismatch', () => {
    expect(classifyEvidencePackArtifact({ ...fixture('legacy-v1-pack.json'), version: 2 })).toEqual(
      {
        format: 'unsupported',
        reason: 'version-structure-mismatch',
        formatVersion: 2,
      }
    )
  })

  test('a non-object is unsupported', () => {
    expect(classifyEvidencePackArtifact('not a pack')).toEqual({
      format: 'unsupported',
      reason: 'not-an-object',
      formatVersion: null,
    })
  })
})

describe('the parser refuses legacy packs by name', () => {
  test.each([
    ['legacy-v1-pack.json', 'v1-coverage'],
    ['v3-mislabeled-pack.json', 'v1-untagged-v3'],
  ])('%s is refused as legacy, not as a digest mismatch', (name, legacyFormat) => {
    let thrown: unknown
    try {
      parseEvidencePack(fixture(name))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(EvidencePackLegacyFormatError)
    const error = thrown as EvidencePackLegacyFormatError
    expect(error.message).toContain(legacyFormat)
    expect(error.message).not.toContain('digest mismatch')
    expect(error.classification).toMatchObject({ format: 'legacy', legacyFormat })
  })

  test('an unknown version throws a plain validation error naming the version', () => {
    expect(() => parseEvidencePack({ ...fixture('v3-mislabeled-pack.json'), version: 7 })).toThrow(
      new EvidencePackValidationError('evidence pack format version 7 is not supported')
    )
  })

  test('a tampered current pack still reports a digest mismatch', () => {
    const built = JSON.parse(JSON.stringify(buildEvidencePack(CLAIMS, REFERENCES)))
    built.integrity.digest = 'a'.repeat(64)
    expect(() => parseEvidencePack(built)).toThrow(/digest mismatch/)
  })
})
