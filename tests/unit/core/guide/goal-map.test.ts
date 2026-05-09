import { describe, test, expect } from 'bun:test'
import { intentsForGoal, describeGoal, listGoals } from '@/core/guide/goal-map'

describe('intentsForGoal', () => {
  test('slow-query expands to perf + safety.locks in plan order', () => {
    expect(intentsForGoal('slow-query')).toEqual([
      'perf.slow-query',
      'safety.locks',
      'perf.cache-hit',
      'perf.index-usage',
    ])
  })

  test('capacity expands to size + memory', () => {
    expect(intentsForGoal('capacity')).toEqual(['capacity.size', 'capacity.memory'])
  })

  test('health expands to connections + locks + cluster-health', () => {
    expect(intentsForGoal('health')).toEqual([
      'safety.connections',
      'safety.locks',
      'monitor.cluster-health',
    ])
  })

  test('index-usage is a single intent', () => {
    expect(intentsForGoal('index-usage')).toEqual(['perf.index-usage'])
  })

  test('permissions has no intents (synthetic plan)', () => {
    expect(intentsForGoal('permissions')).toEqual([])
  })

  test('schema-overview has no intents (synthetic plan)', () => {
    expect(intentsForGoal('schema-overview')).toEqual([])
  })
})

describe('describeGoal', () => {
  test('returns a non-empty description for every allowed goal', () => {
    for (const id of listGoals()) {
      const d = describeGoal(id)
      expect(typeof d).toBe('string')
      expect(d.length).toBeGreaterThan(0)
    }
  })
})

describe('listGoals', () => {
  test('returns the locked tuple in declaration order', () => {
    expect(listGoals()).toEqual([
      'slow-query',
      'capacity',
      'health',
      'index-usage',
      'permissions',
      'schema-overview',
    ])
  })
})
