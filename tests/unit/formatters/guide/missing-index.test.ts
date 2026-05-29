// tests/unit/formatters/guide/missing-index.test.ts
import { test, expect } from 'bun:test'
import { formatMissingIndex } from '@/formatters/guide'
import type { MissingIndexReport } from '@/core/guide/missing-index/types'

const report: MissingIndexReport = {
  query: 'SELECT b.id FROM betting_logs b WHERE b.user_id = 1',
  candidates: [
    {
      table: 'betting_logs',
      columns: ['user_id', 'settled_at'],
      reason: 'full scan; composite covers WHERE+JOIN',
      confidence: 'high',
      existingIndexCollision: null,
      estimatedRowsReduction: '546 → ~50',
    },
  ],
  warnings: [{ rule: 'functional-expression', column: 'settled_at', detail: 'DATE() defeats index' }],
}

test('json format is parseable and preserves shape', () => {
  const out = formatMissingIndex(report, 'json')
  const parsed = JSON.parse(out)
  expect(parsed.candidates[0].columns).toEqual(['user_id', 'settled_at'])
  expect(parsed.warnings[0].rule).toBe('functional-expression')
})

test('yaml format contains key fields', () => {
  const out = formatMissingIndex(report, 'yaml')
  expect(out).toContain('candidates:')
  expect(out).toContain('table: betting_logs')
  expect(out).toContain('confidence: high')
  expect(out).toContain('columns: [user_id, settled_at]')
})

test('markdown format renders a candidates table and warnings section', () => {
  const out = formatMissingIndex(report, 'markdown')
  expect(out).toContain('| betting_logs |')
  expect(out).toContain('high')
  expect(out).toContain('Warnings')
})

test('empty candidates renders gracefully in all formats', () => {
  const empty: MissingIndexReport = { query: 'x', candidates: [], warnings: [] }
  expect(() => formatMissingIndex(empty, 'yaml')).not.toThrow()
  expect(() => formatMissingIndex(empty, 'json')).not.toThrow()
  expect(() => formatMissingIndex(empty, 'markdown')).not.toThrow()
  expect(formatMissingIndex(empty, 'yaml')).toContain('candidates: []')
})
