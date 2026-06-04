// tests/unit/proxy/analyze.test.ts
import { describe, it, expect } from 'bun:test'
import { percentile, fingerprintSql, buildSummary, buildByFingerprint, buildSlowest } from '@/proxy/analyze'
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

describe('buildByFingerprint', () => {
  it('groups by fingerprint and sorts by total duration desc', () => {
    const events = [
      completed({ sql: 'SELECT * FROM a WHERE id = 1', tables: ['a'], durationMs: 5 }),
      completed({ sql: 'SELECT * FROM a WHERE id = 2', tables: ['a'], durationMs: 7 }),
      completed({ sql: 'SELECT * FROM b WHERE id = 1', tables: ['b'], durationMs: 100 }),
    ]
    const stats = buildByFingerprint(events, 1000, 20)
    expect(stats).toHaveLength(2)
    expect(stats[0]!.fingerprint).toBe('SELECT * FROM b WHERE id = ?')
    const a = stats.find((s) => s.tables[0] === 'a')!
    expect(a.count).toBe(2)
    expect(a.durationMs.total).toBe(12)
  })

  it('keeps the slowest occurrence as the example and counts errors per fingerprint', () => {
    const events = [
      completed({ sql: 'SELECT * FROM a WHERE id = 1', durationMs: 5, queryId: 'q1' }),
      completed({ sql: 'SELECT * FROM a WHERE id = 2', durationMs: 50, queryId: 'q2' }),
      errored({ sql: 'SELECT * FROM a WHERE id = 9', tables: ['a'] }),
    ]
    const [a] = buildByFingerprint(events, 1000, 20)
    expect(a!.exampleQueryId).toBe('q2')
    expect(a!.exampleSql).toBe('SELECT * FROM a WHERE id = 2')
    expect(a!.errorCount).toBe(1)
  })

  it('attaches suggestedCommands only to top-N SELECT fingerprints', () => {
    const events = [
      completed({ sql: 'SELECT * FROM a WHERE id = 1', statement: 'SELECT', durationMs: 100 }),
      completed({
        sql: 'UPDATE b SET x = 1 WHERE id = 1',
        statement: 'UPDATE',
        tables: ['b'],
        durationMs: 200,
      }),
    ]
    const stats = buildByFingerprint(events, 1000, 20)
    const sel = stats.find((s) => s.statement === 'SELECT')!
    const upd = stats.find((s) => s.statement === 'UPDATE')!
    expect(sel.suggestedCommands).toEqual([
      'dbcli explain "SELECT * FROM a WHERE id = 1"',
      'dbcli guide missing-index-for "SELECT * FROM a WHERE id = 1"',
    ])
    expect(upd.suggestedCommands).toBeUndefined()
  })

  it('does not attach suggestedCommands beyond the top cutoff', () => {
    const events = [
      completed({ sql: 'SELECT * FROM a WHERE id = 1', durationMs: 100, tables: ['a'] }),
      completed({ sql: 'SELECT * FROM b WHERE id = 1', durationMs: 10, tables: ['b'] }),
    ]
    const stats = buildByFingerprint(events, 1000, 1) // top=1
    expect(stats[0]!.suggestedCommands).toBeDefined()
    expect(stats[1]!.suggestedCommands).toBeUndefined()
  })

  it('flags redacted when the example SQL has no substitutable literals', () => {
    const events = [completed({ sql: 'SELECT * FROM a WHERE id = ?', tables: ['a'] })]
    expect(buildByFingerprint(events, 1000, 20)[0]!.redacted).toBe(true)
  })

  it('escapes $ and backtick in suggestedCommands', () => {
    const stats = buildByFingerprint(
      [completed({ sql: 'SELECT `c$x` FROM `t` WHERE id = 1', durationMs: 100 })],
      1000,
      20
    )
    expect(stats[0]!.suggestedCommands).toEqual([
      'dbcli explain "SELECT \\`c\\$x\\` FROM \\`t\\` WHERE id = 1"',
      'dbcli guide missing-index-for "SELECT \\`c\\$x\\` FROM \\`t\\` WHERE id = 1"',
    ])
  })
})

describe('buildSlowest', () => {
  it('returns the top-N completed queries by duration desc', () => {
    const events = [
      completed({ durationMs: 10, queryId: 'a' }),
      completed({ durationMs: 90, queryId: 'b' }),
      completed({ durationMs: 50, queryId: 'c' }),
      errored({ durationMs: 999 }), // excluded
    ]
    const slow = buildSlowest(events, 2)
    expect(slow.map((q) => q.queryId)).toEqual(['b', 'c'])
    expect(slow[0]!.durationMs).toBe(90)
  })
})
