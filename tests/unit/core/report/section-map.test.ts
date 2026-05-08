import { describe, test, expect } from 'bun:test'
import { intentsForSection, sectionForIntent } from '@/core/report/section-map'

describe('intentsForSection', () => {
  test('health returns safety + cluster-health intents', () => {
    expect(intentsForSection('health')).toEqual([
      'safety.connections',
      'safety.locks',
      'monitor.cluster-health',
    ])
  })

  test('capacity returns size + memory', () => {
    expect(intentsForSection('capacity')).toEqual(['capacity.size', 'capacity.memory'])
  })

  test('perf returns slow-query + index-usage + cache-hit', () => {
    expect(intentsForSection('perf')).toEqual([
      'perf.slow-query',
      'perf.index-usage',
      'perf.cache-hit',
    ])
  })
})

describe('sectionForIntent', () => {
  test('maps each known intent back to its section', () => {
    expect(sectionForIntent('safety.connections')).toBe('health')
    expect(sectionForIntent('monitor.cluster-health')).toBe('health')
    expect(sectionForIntent('capacity.memory')).toBe('capacity')
    expect(sectionForIntent('perf.cache-hit')).toBe('perf')
  })

  test('returns null for unknown intent', () => {
    expect(sectionForIntent('mystery.metric')).toBeNull()
    expect(sectionForIntent(undefined)).toBeNull()
  })
})
