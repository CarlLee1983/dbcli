/**
 * Reading evidence receipts the current builder did not write.
 *
 * As with packs, every legacy input is a frozen file produced by the shipped
 * code — see `tests/fixtures/evidence-legacy/README.md`.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildEvidenceReceipt,
  classifyEvidenceReceiptArtifact,
  EVIDENCE_RECEIPT_VERSION,
  EvidenceReceiptLegacyFormatError,
  EvidenceReceiptValidationError,
  parseEvidenceReceipt,
} from '@/core/evidence-receipt'

const FIXTURES = join(import.meta.dir, '../../../fixtures/evidence-legacy')

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>

const CONTEXT = {
  engine: 'postgres',
  connectionName: 'primary',
  environment: 'staging',
  schemaFingerprint: `sha256:${'a'.repeat(64)}`,
  semanticFingerprint: null,
}

const buildCurrent = () =>
  buildEvidenceReceipt(
    {
      command: 'dbcli assert --table <redacted> --query <redacted>',
      context: CONTEXT,
      auditRef: 'aud_0001',
      verificationArtifactRef: null,
      verdict: { pass: false, checks: [{ pass: true }, { pass: false }, { pass: true }] },
    },
    { now: () => new Date('2026-08-29T00:00:00.000Z'), idFactory: () => 'evr_current_0001' }
  )

describe('evidence receipt format version', () => {
  test('the current builder writes version 2', () => {
    expect(EVIDENCE_RECEIPT_VERSION).toBe(2)
    expect(buildCurrent().version).toBe(2)
  })

  test('a round trip through the parser preserves a current receipt', () => {
    const built = buildCurrent()
    expect(parseEvidenceReceipt(JSON.parse(JSON.stringify(built)))).toEqual(built)
  })
})

describe('classifying legacy evidence receipts', () => {
  test.each([['legacy-v1-receipt-assert.json'], ['legacy-v1-receipt-verify.json']])(
    '%s is recognised as the pre-3.0.0 hashed-observation format',
    (name) => {
      expect(classifyEvidenceReceiptArtifact(fixture(name))).toEqual({
        format: 'legacy',
        formatVersion: 1,
        legacyFormat: 'v1-observation-fingerprint',
        integrity: 'legacy-command-hash-verified',
        producedBy: 'dbcli 2.1.0 or earlier',
      })
    }
  )

  test.each([['v3-mislabeled-receipt-assert.json'], ['v3-mislabeled-receipt-verify.json']])(
    '%s is recognised as the v3.0.0 layout mislabelled version 1',
    (name) => {
      expect(classifyEvidenceReceiptArtifact(fixture(name))).toEqual({
        format: 'legacy',
        formatVersion: 1,
        legacyFormat: 'v1-untagged-v3',
        integrity: 'legacy-command-hash-verified',
        producedBy: 'dbcli 3.0.0',
      })
    }
  )

  test('the two version-1 layouts are never given the same classification', () => {
    expect(classifyEvidenceReceiptArtifact(fixture('legacy-v1-receipt-assert.json'))).not.toEqual(
      classifyEvidenceReceiptArtifact(fixture('v3-mislabeled-receipt-assert.json'))
    )
  })

  test('a tampered legacy command hash is reported as a mismatch', () => {
    const tampered = fixture('legacy-v1-receipt-assert.json')
    ;(tampered.provenance as Record<string, unknown>).commandHash = `sha256:${'f'.repeat(64)}`
    expect(classifyEvidenceReceiptArtifact(tampered)).toMatchObject({
      integrity: 'legacy-command-hash-mismatch',
    })
  })

  test('a legacy receipt with no usable provenance is unverifiable, not verified', () => {
    const stripped = fixture('legacy-v1-receipt-assert.json')
    delete stripped.provenance
    expect(classifyEvidenceReceiptArtifact(stripped)).toMatchObject({
      integrity: 'legacy-unverifiable',
    })
  })
})

describe('unsupported evidence receipts fail closed', () => {
  test('an unknown version is unsupported', () => {
    expect(
      classifyEvidenceReceiptArtifact({
        ...fixture('v3-mislabeled-receipt-assert.json'),
        version: 5,
      })
    ).toEqual({ format: 'unsupported', reason: 'unknown-version', formatVersion: 5 })
  })

  test('version 2 over a hashed observation is a version/structure mismatch', () => {
    expect(
      classifyEvidenceReceiptArtifact({ ...fixture('legacy-v1-receipt-assert.json'), version: 2 })
    ).toEqual({ format: 'unsupported', reason: 'version-structure-mismatch', formatVersion: 2 })
  })

  test('a non-object is unsupported', () => {
    expect(classifyEvidenceReceiptArtifact(42)).toEqual({
      format: 'unsupported',
      reason: 'not-an-object',
      formatVersion: null,
    })
  })
})

describe('the parser refuses legacy receipts by name', () => {
  test.each([
    ['legacy-v1-receipt-assert.json', 'v1-observation-fingerprint'],
    ['legacy-v1-receipt-verify.json', 'v1-observation-fingerprint'],
    ['v3-mislabeled-receipt-assert.json', 'v1-untagged-v3'],
    ['v3-mislabeled-receipt-verify.json', 'v1-untagged-v3'],
  ])('%s is refused as legacy rather than as malformed', (name, legacyFormat) => {
    let thrown: unknown
    try {
      parseEvidenceReceipt(fixture(name))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(EvidenceReceiptLegacyFormatError)
    const error = thrown as EvidenceReceiptLegacyFormatError
    expect(error.message).toContain(legacyFormat)
    expect(error.message).toContain('cannot be migrated')
    expect(error.classification).toMatchObject({ format: 'legacy', legacyFormat })
  })

  test('an unknown version throws a plain validation error naming the version', () => {
    expect(() =>
      parseEvidenceReceipt({ ...fixture('v3-mislabeled-receipt-assert.json'), version: 7 })
    ).toThrow(
      new EvidenceReceiptValidationError('evidence receipt format version 7 is not supported')
    )
  })
})
