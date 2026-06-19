import { describe, test, expect } from 'bun:test'
import {
  summarizeVerificationArtifacts,
  toLatestOnlySummary,
  type ReadVerificationArtifactsResult,
  type VerificationArtifactRecord,
} from '@/core/verification'

function record(
  id: string,
  createdAt: string,
  status: 'verified' | 'not_verified' | 'blocked' | 'indeterminate',
  subject: { kind: 'backfill' | 'migration'; name?: string }
): VerificationArtifactRecord {
  return {
    path: `/tmp/.dbcli/verification/verification-${id}.json`,
    filename: `verification-${id}.json`,
    artifact: {
      schemaVersion: 1,
      id,
      createdAt,
      status,
      subject: { ...subject, command: 'verify migration' },
      summary: `summary ${id}`,
      evidence: [{ kind: 'assert', exitCode: status === 'verified' ? 0 : 1 }],
    },
  }
}

function read(
  artifacts: VerificationArtifactRecord[],
  invalid: number = 0
): ReadVerificationArtifactsResult {
  return {
    storageDir: '/tmp/.dbcli/verification',
    artifacts,
    invalid: Array.from({ length: invalid }, (_, i) => ({
      path: `/tmp/bad-${i}.json`,
      filename: `bad-${i}.json`,
      error: 'invalid',
    })),
  }
}

describe('toLatestOnlySummary', () => {
  test('no artifacts -> latest null, zeroed counts, no subjects key', () => {
    const summary = summarizeVerificationArtifacts(read([]))
    const latestOnly = toLatestOnlySummary(summary)
    expect(latestOnly.latest).toBeNull()
    expect(latestOnly.counts.total).toBe(0)
    expect('subjects' in latestOnly).toBe(false)
  })

  test('one artifact -> latest is that artifact', () => {
    const summary = summarizeVerificationArtifacts(
      read([record('a', '2026-06-20T01:00:00.000Z', 'verified', { kind: 'migration', name: 'users' })])
    )
    const latestOnly = toLatestOnlySummary(summary)
    expect(latestOnly.latest?.id).toBe('a')
    expect(latestOnly.counts.verified).toBe(1)
  })

  test('multiple subjects -> latest is newest across all (reader order is latest-first)', () => {
    const summary = summarizeVerificationArtifacts(
      read([
        record('newest', '2026-06-20T03:00:00.000Z', 'not_verified', { kind: 'migration', name: 'b' }),
        record('mid', '2026-06-20T02:00:00.000Z', 'verified', { kind: 'backfill', name: 'a' }),
      ])
    )
    expect(toLatestOnlySummary(summary).latest?.id).toBe('newest')
  })

  test('status filter narrows latest + counts', () => {
    const summary = summarizeVerificationArtifacts(
      read([
        record('nv', '2026-06-20T03:00:00.000Z', 'not_verified', { kind: 'migration', name: 'b' }),
        record('ok', '2026-06-20T02:00:00.000Z', 'verified', { kind: 'migration', name: 'a' }),
      ]),
      { status: 'verified' }
    )
    const latestOnly = toLatestOnlySummary(summary)
    expect(latestOnly.latest?.id).toBe('ok')
    expect(latestOnly.counts.total).toBe(1)
  })

  test('malformed files stay out of latest but are counted as invalid', () => {
    const summary = summarizeVerificationArtifacts(read([], 2))
    const latestOnly = toLatestOnlySummary(summary)
    expect(latestOnly.latest).toBeNull()
    expect(latestOnly.counts.invalid).toBe(2)
  })
})
