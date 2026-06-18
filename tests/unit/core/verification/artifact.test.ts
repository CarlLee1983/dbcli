import { describe, expect, test } from 'bun:test'
import {
  buildVerificationArtifact,
  VERIFICATION_TEXT_FIELD_CAP,
  VERIFICATION_EVIDENCE_CAP,
  generateArtifactId,
} from '@/core/verification'
import type { VerificationEvidenceRef, VerificationSubject } from '@/core/verification'

const FIXED_NOW = () => new Date('2026-06-18T00:00:00.000Z')
const FIXED_ID = () => 'ver_fixed_001'

const subject: VerificationSubject = { kind: 'backfill', name: 'safe-backfill-verify' }
const assertEvidence: VerificationEvidenceRef = {
  kind: 'assert',
  command: 'dbcli assert "SELECT count(*) FROM orders WHERE status IS NULL" --expect "rows == 0"',
  taskName: 'safe-backfill-verify',
  step: 4,
  exitCode: 0,
}

describe('buildVerificationArtifact', () => {
  test('constructs a valid verified backfill artifact with assert evidence', () => {
    const artifact = buildVerificationArtifact({
      status: 'verified',
      subject,
      summary: '  Read-back assertion passed.  ',
      evidence: [assertEvidence],
      now: FIXED_NOW,
      idFactory: FIXED_ID,
    })
    expect(artifact.schemaVersion).toBe(1)
    expect(artifact.id).toBe('ver_fixed_001')
    expect(artifact.createdAt).toBe('2026-06-18T00:00:00.000Z')
    expect(artifact.status).toBe('verified')
    expect(artifact.subject).toEqual(subject)
    expect(artifact.summary).toBe('Read-back assertion passed.')
    expect(artifact.evidence[0]?.kind).toBe('assert')
    expect('blockedReason' in artifact).toBe(false)
  })

  test('constructs a blocked artifact carrying a blocked reason', () => {
    const artifact = buildVerificationArtifact({
      status: 'blocked',
      subject: { kind: 'recovery' },
      summary: 'Verify step was skipped.',
      evidence: [{ kind: 'recovery-verify', note: 'gated out' }],
      blockedReason: 'not allowlisted',
      now: FIXED_NOW,
      idFactory: FIXED_ID,
    })
    expect(artifact.status).toBe('blocked')
    expect(artifact.blockedReason).toBe('not allowlisted')
  })

  test('allows blocked status without a blocked reason', () => {
    const artifact = buildVerificationArtifact({
      status: 'blocked',
      subject: { kind: 'recovery' },
      summary: 'Blocked, reason unknown yet.',
      evidence: [{ kind: 'recovery-verify' }],
      now: FIXED_NOW,
      idFactory: FIXED_ID,
    })
    expect(artifact.status).toBe('blocked')
    expect('blockedReason' in artifact).toBe(false)
  })

  test('rejects an invalid status', () => {
    expect(() =>
      buildVerificationArtifact({
        status: 'passed' as never,
        subject,
        summary: 'x',
        evidence: [assertEvidence],
      })
    ).toThrow(/Invalid verification artifact: status/)
  })

  test('rejects an empty summary', () => {
    expect(() =>
      buildVerificationArtifact({
        status: 'verified',
        subject,
        summary: '   ',
        evidence: [assertEvidence],
      })
    ).toThrow(/Invalid verification artifact: summary/)
  })

  test('rejects empty evidence', () => {
    expect(() =>
      buildVerificationArtifact({
        status: 'verified',
        subject,
        summary: 'ok',
        evidence: [],
      })
    ).toThrow(/Invalid verification artifact: evidence/)
  })

  test('uses internal now and idFactory when not injected', () => {
    const artifact = buildVerificationArtifact({
      status: 'indeterminate',
      subject,
      summary: 'no injection',
      evidence: [assertEvidence],
    })
    expect(typeof artifact.id).toBe('string')
    expect(artifact.id.startsWith('ver_')).toBe(true)
    expect(Number.isNaN(Date.parse(artifact.createdAt))).toBe(false)
  })

  test('truncates overlong command and note fields', () => {
    const long = 'x'.repeat(VERIFICATION_TEXT_FIELD_CAP + 500)
    const artifact = buildVerificationArtifact({
      status: 'verified',
      subject,
      summary: 'bounded',
      evidence: [{ kind: 'assert', command: long, note: long }],
      now: FIXED_NOW,
      idFactory: FIXED_ID,
    })
    const ref = artifact.evidence[0]!
    expect(ref.command!.length).toBe(VERIFICATION_TEXT_FIELD_CAP)
    expect(ref.command!.endsWith('… [truncated]')).toBe(true)
    expect(ref.note!.length).toBe(VERIFICATION_TEXT_FIELD_CAP)
  })

  test('caps evidence count and appends a manual truncation marker', () => {
    const many: VerificationEvidenceRef[] = Array.from({ length: 50 }, (_, i) => ({
      kind: 'manual',
      note: `evidence ${i}`,
    }))
    const artifact = buildVerificationArtifact({
      status: 'verified',
      subject,
      summary: 'capped',
      evidence: many,
      now: FIXED_NOW,
      idFactory: FIXED_ID,
    })
    expect(artifact.evidence.length).toBe(VERIFICATION_EVIDENCE_CAP)
    const last = artifact.evidence[VERIFICATION_EVIDENCE_CAP - 1]!
    expect(last.kind).toBe('manual')
    expect(last.note).toContain('truncated')
    expect(last.note).toContain('50')
  })

  test('generateArtifactId yields a prefixed, mostly-unique id', () => {
    const a = generateArtifactId(new Date('2026-06-18T00:00:00.000Z'))
    const b = generateArtifactId(new Date('2026-06-18T00:00:00.000Z'))
    expect(a.startsWith('ver_')).toBe(true)
    expect(a).not.toBe(b)
  })
})
