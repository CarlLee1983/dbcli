import { describe, test, expect } from 'bun:test'
import {
  parseVerificationSubject,
  isVerificationSubjectKind,
  AssertArtifactError,
  VERIFICATION_SUBJECT_KINDS,
} from '@/core/verification/assert-artifact'

describe('parseVerificationSubject', () => {
  test('parses kind:name', () => {
    expect(parseVerificationSubject('backfill:safe-backfill-verify')).toEqual({
      kind: 'backfill',
      name: 'safe-backfill-verify',
    })
  })

  test('keeps colons inside the name (split on first colon only)', () => {
    expect(parseVerificationSubject('assertion:ledger:a-vs-b')).toEqual({
      kind: 'assertion',
      name: 'ledger:a-vs-b',
    })
  })

  test('rejects unknown kind', () => {
    expect(() => parseVerificationSubject('nope:x')).toThrow(AssertArtifactError)
  })

  test('rejects missing colon', () => {
    expect(() => parseVerificationSubject('backfill')).toThrow(AssertArtifactError)
  })

  test('rejects empty name', () => {
    expect(() => parseVerificationSubject('backfill:')).toThrow(AssertArtifactError)
  })

  test('rejects empty kind', () => {
    expect(() => parseVerificationSubject(':name')).toThrow(AssertArtifactError)
  })

  test('isVerificationSubjectKind matches the known set', () => {
    expect(isVerificationSubjectKind('backfill')).toBe(true)
    expect(isVerificationSubjectKind('nope')).toBe(false)
    expect(VERIFICATION_SUBJECT_KINDS).toContain('assertion')
  })
})
