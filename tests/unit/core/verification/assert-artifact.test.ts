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

import { buildAssertVerificationArtifact } from '@/core/verification/assert-artifact'
import type { AssertVerdict } from '@/core/result-snapshot/types'

const FIXED_NOW = () => new Date('2026-06-19T00:00:00.000Z')
const ID = () => 'ver_test_0000'
const SUBJECT = { kind: 'backfill', name: 'safe-backfill-verify' } as const

function verdict(pass: boolean): AssertVerdict {
  return {
    pass,
    checks: [{ name: 'expect', pass, expected: '0', actual: pass ? '0' : '3' }],
  }
}

describe('buildAssertVerificationArtifact', () => {
  test('maps a passing verdict to verified', () => {
    const a = buildAssertVerificationArtifact({
      verdict: verdict(true),
      subject: SUBJECT,
      argv: ['bun', 'cli.ts', 'assert', 'SELECT 1', '--expect', 'value == 0'],
      now: FIXED_NOW,
      idFactory: ID,
    })
    expect(a.status).toBe('verified')
    expect(a.schemaVersion).toBe(1)
    expect(a.subject).toEqual(SUBJECT)
    expect(a.summary).toBe('Assertion verified the expected state.')
    expect(a.evidence[0]!.kind).toBe('assert')
    expect(a.evidence[0]!.exitCode).toBe(0)
    expect(a.evidence[0]!.command).toContain('assert')
  })

  test('maps a failing verdict to not_verified with exitCode 1', () => {
    const a = buildAssertVerificationArtifact({
      verdict: verdict(false),
      subject: SUBJECT,
      argv: ['bun', 'cli.ts', 'assert', 'SELECT 1', '--expect', 'value == 0'],
      now: FIXED_NOW,
      idFactory: ID,
    })
    expect(a.status).toBe('not_verified')
    expect(a.summary).toBe('Assertion did not verify the expected state.')
    expect(a.evidence[0]!.exitCode).toBe(1)
  })

  test('uses assertion truth, not --no-fail process behavior (exitCode is 1 on fail)', () => {
    // The helper never sees --no-fail; it derives exitCode purely from verdict.pass.
    const a = buildAssertVerificationArtifact({
      verdict: verdict(false),
      subject: SUBJECT,
      argv: ['bun', 'cli.ts', 'assert', 'SELECT 1', '--expect', 'value == 0', '--no-fail'],
      now: FIXED_NOW,
      idFactory: ID,
    })
    expect(a.status).toBe('not_verified')
    expect(a.evidence[0]!.exitCode).toBe(1)
  })

  test('honors an explicit summary', () => {
    const a = buildAssertVerificationArtifact({
      verdict: verdict(true),
      subject: SUBJECT,
      summary: 'Backfill read-back assertion matched expected state.',
      argv: ['bun', 'cli.ts', 'assert', 'SELECT 1'],
      now: FIXED_NOW,
      idFactory: ID,
    })
    expect(a.summary).toBe('Backfill read-back assertion matched expected state.')
  })

  test('includes auditRef when supplied and omits it when null', () => {
    const withRef = buildAssertVerificationArtifact({
      verdict: verdict(true),
      subject: SUBJECT,
      argv: ['bun', 'cli.ts', 'assert', 'SELECT 1'],
      auditRef: 'audit-123',
      now: FIXED_NOW,
      idFactory: ID,
    })
    expect(withRef.evidence[0]!.auditRef).toBe('audit-123')

    const noRef = buildAssertVerificationArtifact({
      verdict: verdict(true),
      subject: SUBJECT,
      argv: ['bun', 'cli.ts', 'assert', 'SELECT 1'],
      auditRef: null,
      now: FIXED_NOW,
      idFactory: ID,
    })
    expect('auditRef' in noRef.evidence[0]!).toBe(false)
  })
})
