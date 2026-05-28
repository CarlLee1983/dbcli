import { test, expect } from 'bun:test'
import { formatExplain } from '@/formatters/explain'
import type { ExplainPlan } from '@/core/explain/types'

const samplePlan: ExplainPlan = {
  system: 'mariadb',
  rawSql: 'SELECT 1',
  raw: null,
  rows: [
    {
      driving: 't',
      accessType: 'ALL',
      key: null,
      rows: 10,
      filtered: 100,
      extra: [],
      annotations: [],
    },
  ],
}

test('formatExplain: json → JSON.stringify, top-level array', () => {
  const out = formatExplain([samplePlan], 'json')
  const parsed = JSON.parse(out)
  expect(Array.isArray(parsed)).toBe(true)
  expect(parsed[0].system).toBe('mariadb')
})

test('formatExplain: markdown → contains header pipe', () => {
  const out = formatExplain([samplePlan], 'markdown')
  expect(out).toContain('| driving |')
})

test('formatExplain: table → contains driving column name', () => {
  const out = formatExplain([samplePlan], 'table')
  expect(out.toLowerCase()).toContain('driving')
})

test('formatExplain: unknown format throws', () => {
  expect(() => formatExplain([samplePlan], 'xml' as never)).toThrow(/unknown .* format/i)
})
