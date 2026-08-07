import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GUIDE_SLOW_QUERY_SYSTEMS,
  assertValidSlowQueryThreshold,
  attachSlowQueryAdvisory,
  buildSlowQueryAdvisory,
  parseSlowQueryThreshold,
  slowQueryThresholdFor,
} from '@/core/slow-query-advisory'
import { intentsForGoal } from '@/core/guide/goal-map'

const SELECT_RESULT = {
  rows: [{ id: 1 }],
  rowCount: 1,
  columnNames: ['id'],
  metadata: { statement: 'SELECT' as const },
}

describe('slow query advisory', () => {
  test('emits only at or above the configured threshold', () => {
    expect(buildSlowQueryAdvisory(999, {})).toBeUndefined()
    expect(buildSlowQueryAdvisory(1000, {})).toMatchObject({
      code: 'SLOW_QUERY',
      executionTimeMs: 1000,
      thresholdMs: 1000,
    })
  })

  test('preserves result data and attaches only the advisory metadata', () => {
    const result = attachSlowQueryAdvisory(
      { ...SELECT_RESULT, executionTimeMs: 1250 },
      { slowMs: 1000 }
    )

    expect(result.rows).toEqual([{ id: 1 }])
    expect(result.metadata?.statement).toBe('SELECT')
    expect(result.metadata?.performanceAdvisory).toMatchObject({
      code: 'SLOW_QUERY',
      executionTimeMs: 1250,
      thresholdMs: 1000,
    })
  })

  test('returns the original result untouched when no advisory applies', () => {
    const result = { ...SELECT_RESULT, executionTimeMs: 5000 }

    expect(attachSlowQueryAdvisory(result, { slowMs: 0 })).toBe(result)
    expect(attachSlowQueryAdvisory(result, { recovery: true })).toBe(result)
    expect(
      attachSlowQueryAdvisory({ ...SELECT_RESULT, executionTimeMs: 1 }, {})
    ).not.toHaveProperty('metadata.performanceAdvisory')
  })

  describe('threshold resolution', () => {
    test('defaults to 1000ms and honours an explicit override', () => {
      expect(slowQueryThresholdFor({})).toBe(1000)
      expect(slowQueryThresholdFor({ slowMs: 250 })).toBe(250)
      expect(slowQueryThresholdFor({ slowMs: 0 })).toBe(0)
    })

    test('recovery mode disables the hint regardless of the requested threshold', () => {
      expect(slowQueryThresholdFor({ recovery: true })).toBe(0)
      expect(slowQueryThresholdFor({ slowMs: 250, recovery: true })).toBe(0)
    })

    test('rejects invalid option values', () => {
      for (const value of ['-1', '1.5', 'NaN', '']) {
        expect(() => parseSlowQueryThreshold(value)).toThrow('non-negative integer')
      }
      expect(() => assertValidSlowQueryThreshold(-1)).toThrow('non-negative integer')
      expect(() => assertValidSlowQueryThreshold(1.5)).toThrow('non-negative integer')
      expect(() => assertValidSlowQueryThreshold(undefined)).not.toThrow()
    })
  })

  describe('engine-aware recommendation', () => {
    test('refers to guide slow-query only where that goal has diagnostic coverage', () => {
      for (const system of ['postgresql', 'mysql', 'mariadb', 'redis']) {
        expect(buildSlowQueryAdvisory(2000, { system })?.recommendation).toContain(
          'dbcli guide slow-query'
        )
      }

      for (const system of ['mongodb', 'elasticsearch']) {
        const advisory = buildSlowQueryAdvisory(2000, { system })
        expect(advisory?.code).toBe('SLOW_QUERY')
        expect(advisory?.recommendation).not.toContain('dbcli guide slow-query')
      }
    })

    test('never promises additional diagnostics on any engine', () => {
      for (const system of [...GUIDE_SLOW_QUERY_SYSTEMS, 'mongodb', 'elasticsearch', undefined]) {
        expect(buildSlowQueryAdvisory(2000, { system })?.recommendation).toContain(
          'no additional database diagnostics'
        )
      }
    })

    /**
     * The coverage list is static so the query path stays free of I/O. This test
     * is what keeps it honest: it re-derives coverage from the shipped snippets.
     */
    test('the static coverage list matches the shipped guide slow-query snippets', () => {
      const intents = new Set(intentsForGoal('slow-query'))
      const dir = join(import.meta.dir, '../../../assets/snippets/diag')
      const engines = new Set<string>()

      for (const file of readdirSync(dir)) {
        const source = readFileSync(join(dir, file), 'utf8')
        const intent = source.match(/^--\s*intent:\s*(\S+)/m)?.[1]
        const engine = source.match(/^--\s*engine:\s*(\S+)/m)?.[1]
        if (!intent || !engine || !intents.has(intent)) continue
        engines.add(engine === 'postgres' ? 'postgresql' : engine)
      }

      // mariadb shares the mysql snippet set.
      engines.add('mariadb')
      expect([...engines].sort()).toEqual([...GUIDE_SLOW_QUERY_SYSTEMS].sort())
    })
  })
})
