// tests/unit/core/guide/missing-index/warnings.test.ts
import { test, expect } from 'bun:test'
import { collectWarnings } from '@/core/guide/missing-index/warnings'
import type { QueryAnalysis } from '@/core/guide/missing-index/types'

test('emits functional-expression warning per functional column', () => {
  const analysis: QueryAnalysis = {
    parsed: true,
    tables: [
      {
        table: 'betting_logs',
        equalityColumns: [],
        rangeColumns: [],
        joinColumns: [],
        orderColumns: [],
        functionalColumns: [{ column: 'settled_at', expr: 'DATE' }],
      },
    ],
  }
  const out = collectWarnings(analysis)
  expect(out.find((w) => w.rule === 'functional-expression')?.column).toBe('settled_at')
})

test('fallback (parsed=false) emits a single parser-limit warning', () => {
  const out = collectWarnings({ parsed: false, tables: [] })
  expect(out).toHaveLength(1)
  expect(out[0]!.rule).toBe('parser-limit')
})

test('clean analysis emits no warnings', () => {
  const out = collectWarnings({
    parsed: true,
    tables: [
      {
        table: 't',
        equalityColumns: ['a'],
        rangeColumns: [],
        joinColumns: [],
        orderColumns: [],
        functionalColumns: [],
      },
    ],
  })
  expect(out).toEqual([])
})
