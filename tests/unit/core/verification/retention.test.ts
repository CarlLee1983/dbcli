import { describe, expect, test } from 'bun:test'
import { parseOlderThanDays, computeCutoffMs, selectPrunePlan } from '@/core/verification'
import type {
  ReadVerificationArtifactsResult,
  VerificationArtifactRecord,
  PruneCriteria,
} from '@/core/verification'

describe('parseOlderThanDays', () => {
  test('accepts positive whole-day durations', () => {
    expect(parseOlderThanDays('1d')).toBe(1)
    expect(parseOlderThanDays('7d')).toBe(7)
    expect(parseOlderThanDays('30d')).toBe(30)
    expect(parseOlderThanDays('365d')).toBe(365)
  })

  test('rejects non-day, zero, fractional, and bare values', () => {
    for (const bad of ['0d', '1h', '1.5d', '30', 'forever', '', '-5d', 'd', '10D']) {
      expect(() => parseOlderThanDays(bad)).toThrow()
    }
  })
})

describe('computeCutoffMs', () => {
  test('subtracts whole days in milliseconds', () => {
    const now = Date.parse('2026-06-19T00:00:00.000Z')
    const cutoff = computeCutoffMs(now, 30)
    expect(new Date(cutoff).toISOString()).toBe('2026-05-20T00:00:00.000Z')
  })
})

function rec(
  id: string,
  createdAt: string,
  over: { status?: string; subject?: { kind: string; name?: string } } = {}
): VerificationArtifactRecord {
  return {
    path: `/repo/.dbcli/verification/verification-${id}.json`,
    filename: `verification-${id}.json`,
    artifact: {
      schemaVersion: 1,
      id,
      createdAt,
      status: (over.status as VerificationArtifactRecord['artifact']['status']) ?? 'verified',
      subject: (over.subject as VerificationArtifactRecord['artifact']['subject']) ?? {
        kind: 'backfill',
        name: 'safe-backfill-verify',
      },
      summary: 'ok',
      evidence: [{ kind: 'assert', exitCode: 0 }],
    },
  }
}

/** Latest-first, like the reader guarantees. */
function read(
  artifacts: VerificationArtifactRecord[],
  invalid: ReadVerificationArtifactsResult['invalid'] = []
): ReadVerificationArtifactsResult {
  return { storageDir: '/repo/.dbcli/verification', artifacts, invalid }
}

const baseCriteria: PruneCriteria = { olderThanDays: 30, keepLatest: 0, includeInvalid: false }
const cutoff = Date.parse('2026-05-20T00:00:00.000Z')

describe('selectPrunePlan', () => {
  test('keep-latest protects the newest N; older remainder are candidates', () => {
    const plan = selectPrunePlan(
      read([
        rec('new', '2026-06-19T00:00:00.000Z'),
        rec('mid', '2026-01-02T00:00:00.000Z'),
        rec('old', '2026-01-01T00:00:00.000Z'),
      ]),
      { ...baseCriteria, keepLatest: 1 },
      cutoff,
      new Map()
    )
    expect(plan.protected.map((p) => p.id)).toEqual(['new'])
    expect(plan.protected[0]!.reason).toBe('keep-latest')
    expect(plan.candidates.map((c) => c.id)).toEqual(['mid', 'old'])
    expect(plan.candidates.every((c) => c.invalid === false)).toBe(true)
  })

  test('keep-latest 0 protects nothing; only artifacts older than cutoff are candidates', () => {
    const plan = selectPrunePlan(
      read([
        rec('new', '2026-06-19T00:00:00.000Z'),
        rec('old', '2026-01-01T00:00:00.000Z'),
      ]),
      baseCriteria,
      cutoff,
      new Map()
    )
    expect(plan.protected).toEqual([])
    expect(plan.candidates.map((c) => c.id)).toEqual(['old'])
  })

  test('status filter applies only to candidates', () => {
    const plan = selectPrunePlan(
      read([
        rec('a', '2026-01-02T00:00:00.000Z', { status: 'verified' }),
        rec('b', '2026-01-01T00:00:00.000Z', { status: 'not_verified' }),
      ]),
      { ...baseCriteria, status: 'verified' },
      cutoff,
      new Map()
    )
    expect(plan.candidates.map((c) => c.id)).toEqual(['a'])
  })

  test('subject filter matches kind and optional name', () => {
    const plan = selectPrunePlan(
      read([
        rec('a', '2026-01-02T00:00:00.000Z', { subject: { kind: 'backfill', name: 'one' } }),
        rec('b', '2026-01-01T00:00:00.000Z', { subject: { kind: 'migration', name: 'two' } }),
      ]),
      { ...baseCriteria, subject: { kind: 'migration' } },
      cutoff,
      new Map()
    )
    expect(plan.candidates.map((c) => c.id)).toEqual(['b'])
  })

  test('invalid records are excluded by default and selected (by mtime) only with includeInvalid', () => {
    const invalid = [
      { path: '/repo/.dbcli/verification/verification-broken.json', filename: 'verification-broken.json', error: 'bad json' },
    ]
    const mtimes = new Map<string, number>([
      ['/repo/.dbcli/verification/verification-broken.json', Date.parse('2026-01-01T00:00:00.000Z')],
    ])

    const off = selectPrunePlan(read([], invalid), baseCriteria, cutoff, mtimes)
    expect(off.candidates).toEqual([])

    const on = selectPrunePlan(read([], invalid), { ...baseCriteria, includeInvalid: true }, cutoff, mtimes)
    expect(on.candidates).toHaveLength(1)
    expect(on.candidates[0]!.invalid).toBe(true)
    expect(on.candidates[0]!.id).toBeNull()
    expect(on.candidates[0]!.filename).toBe('verification-broken.json')
  })

  test('includeInvalid keeps recent invalid files (mtime newer than cutoff) untouched', () => {
    const invalid = [
      { path: '/repo/.dbcli/verification/verification-recent.json', filename: 'verification-recent.json', error: 'bad json' },
    ]
    const mtimes = new Map<string, number>([
      ['/repo/.dbcli/verification/verification-recent.json', Date.parse('2026-06-18T00:00:00.000Z')],
    ])
    const plan = selectPrunePlan(read([], invalid), { ...baseCriteria, includeInvalid: true }, cutoff, mtimes)
    expect(plan.candidates).toEqual([])
  })

  test('invalid records with no mtime entry are excluded even with includeInvalid', () => {
    const invalid = [
      { path: '/repo/.dbcli/verification/verification-nomtime.json', filename: 'verification-nomtime.json', error: 'bad json' },
    ]
    const plan = selectPrunePlan(read([], invalid), { ...baseCriteria, includeInvalid: true }, cutoff, new Map())
    expect(plan.candidates).toEqual([])
  })
})
