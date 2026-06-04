// tests/unit/proxy/analyze.test.ts
import { describe, it, expect } from 'bun:test'
import { percentile, fingerprintSql } from '@/proxy/analyze'

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
