import { describe, expect, test } from 'bun:test'
import { parseOlderThanDays, computeCutoffMs } from '@/core/verification'

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
