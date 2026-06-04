// tests/unit/proxy/analyze.test.ts
import { describe, it, expect } from 'bun:test'
import { percentile, fingerprintSql, buildSummary } from '@/proxy/analyze'
import { completed, errored, sessionStarted } from './event-fixtures'

describe('percentile', () => {
  it('returns 0 for an empty set', () => {
    expect(percentile([], 95)).toBe(0)
  })
  it('returns the only value for a single-element set', () => {
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 99)).toBe(42)
  })
  it('uses nearest-rank (p50/p95/p99 of 1..100)', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    expect(percentile(vals, 50)).toBe(50)
    expect(percentile(vals, 95)).toBe(95)
    expect(percentile(vals, 99)).toBe(99)
  })
  it('does not mutate the input array', () => {
    const vals = [3, 1, 2]
    percentile(vals, 50)
    expect(vals).toEqual([3, 1, 2])
  })
})

describe('fingerprintSql', () => {
  it('replaces literals with ? and collapses whitespace', () => {
    expect(fingerprintSql('SELECT *  FROM users   WHERE id = 42')).toBe(
      'SELECT * FROM users WHERE id = ?'
    )
  })
  it('maps different literal values to the same fingerprint', () => {
    expect(fingerprintSql('SELECT * FROM t WHERE id = 1')).toBe(
      fingerprintSql('SELECT * FROM t WHERE id = 999')
    )
  })
})

describe('buildSummary', () => {
  it('counts queries, errors, sessions and error rate', () => {
    const events = [
      sessionStarted('pxy_1'),
      sessionStarted('pxy_2'),
      completed({ durationMs: 10 }),
      completed({ durationMs: 20 }),
      errored(),
    ]
    const s = buildSummary(events, 1000)
    expect(s.sessions).toBe(2)
    expect(s.queries).toBe(2)
    expect(s.errors).toBe(1)
    expect(s.errorRate).toBeCloseTo(1 / 3, 5)
  })

  it('returns errorRate 0 when there are no queries or errors', () => {
    expect(buildSummary([sessionStarted('pxy_1')], 1000).errorRate).toBe(0)
  })

  it('computes slowCount with the analyze threshold, not the event slow flag', () => {
    const events = [
      completed({ durationMs: 100, slow: true }), // under 500 -> not slow per analyze
      completed({ durationMs: 800, slow: false }), // over 500 -> slow per analyze
    ]
    expect(buildSummary(events, 500).slowCount).toBe(1)
  })

  it('sums bytes and computes latency percentiles over completed only', () => {
    const events = [
      completed({ durationMs: 10, requestBytes: 1, responseBytes: 2 }),
      completed({ durationMs: 30, requestBytes: 3, responseBytes: 4 }),
      errored({ durationMs: 9999 }), // must not affect latency
    ]
    const s = buildSummary(events, 1000)
    expect(s.bytes).toEqual({ request: 4, response: 6 })
    expect(s.latencyMs.max).toBe(30)
  })
})
