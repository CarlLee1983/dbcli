// tests/unit/core/guide/missing-index/analyzer.test.ts
import { test, expect } from 'bun:test'
import { analyzeMissingIndex } from '@/core/guide/missing-index/analyzer'
import type { MissingIndexDeps, QueryAnalysis, EnrichedPlanFacts } from '@/core/guide/missing-index/types'

const analysis: QueryAnalysis = {
  parsed: true,
  tables: [
    { table: 'betting_logs', alias: 'b', equalityColumns: ['user_id'], rangeColumns: ['settled_at'], joinColumns: ['user_id'], orderColumns: [], functionalColumns: [{ column: 'settled_at', expr: 'DATE' }] },
  ],
}

function deps(over: Partial<MissingIndexDeps> = {}): MissingIndexDeps {
  return {
    system: 'mysql',
    parseSelect: () => ({ type: 'select' }),
    extract: () => analysis,
    getExistingIndexes: async () => [],
    enrich: async () => new Map<string, EnrichedPlanFacts>([['betting_logs', { accessType: 'ALL', key: null, rows: 50000 }]]),
    ...over,
  }
}

test('happy path produces a scored candidate + functional warning', async () => {
  const report = await analyzeMissingIndex('SELECT ...', deps(), {})
  expect(report.candidates).toHaveLength(1)
  expect(report.candidates[0].confidence).toBe('high')
  expect(report.candidates[0].columns).toEqual(['user_id', 'settled_at'])
  expect(report.warnings.find((w) => w.rule === 'functional-expression')).toBeDefined()
})

test('parse failure → fallback: no candidates, parser-limit warning', async () => {
  const report = await analyzeMissingIndex(
    'GARBAGE',
    deps({
      parseSelect: () => {
        throw new Error('parse failed')
      },
    }),
    {}
  )
  expect(report.candidates).toEqual([])
  expect(report.warnings[0].rule).toBe('parser-limit')
})

test('--min-confidence filters out lower-confidence candidates', async () => {
  const report = await analyzeMissingIndex(
    'SELECT ...',
    deps({ enrich: async () => new Map() }), // no facts → low confidence
    { minConfidence: 'medium' }
  )
  expect(report.candidates).toEqual([])
})

test('query field carries the original SQL', async () => {
  const report = await analyzeMissingIndex('SELECT x FROM t', deps(), {})
  expect(report.query).toBe('SELECT x FROM t')
})
