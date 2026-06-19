import { describe, expect, test } from 'bun:test'
import { VERIFICATION_EVIDENCE_KINDS, isVerificationEvidenceKind } from '@/core/verification'

describe('VERIFICATION_EVIDENCE_KINDS', () => {
  test('lists exactly the v1 evidence kinds', () => {
    expect([...VERIFICATION_EVIDENCE_KINDS]).toEqual([
      'assert',
      'snapshot',
      'recovery-verify',
      'task-pack-plan',
      'manual',
    ])
  })
})

describe('isVerificationEvidenceKind', () => {
  test('accepts every known kind', () => {
    for (const kind of VERIFICATION_EVIDENCE_KINDS) {
      expect(isVerificationEvidenceKind(kind)).toBe(true)
    }
  })

  test('rejects unknown kinds and non-strings', () => {
    for (const bad of ['', 'unknown', 'Assert', 0, null, undefined, {}, ['assert']]) {
      expect(isVerificationEvidenceKind(bad)).toBe(false)
    }
  })
})
