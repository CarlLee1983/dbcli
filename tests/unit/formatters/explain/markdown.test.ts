import { test, expect } from 'bun:test'
import { formatExplainMarkdown } from '@/formatters/explain/markdown'
import type { ExplainPlan } from '@/core/explain/types'

const basePlan: ExplainPlan = {
  system: 'mariadb',
  rawSql: 'SELECT * FROM orders',
  raw: null,
  rows: [
    {
      driving: 'orders',
      accessType: 'ALL',
      key: null,
      rows: 1500000,
      filtered: 100,
      extra: ['Using where'],
      annotations: [{ severity: 'red', rule: 'full-scan', message: 'Full scan on orders' }],
    },
  ],
}

test('formatExplainMarkdown: single-query mode omits Query column', () => {
  const md = formatExplainMarkdown([basePlan])
  expect(md).toMatch(/\|\s*driving\s*\|/)
  expect(md).not.toMatch(/\|\s*Query\s*\|/)
  expect(md).toContain('orders')
  expect(md).toContain('ALL')
})

test('formatExplainMarkdown: bulk mode (multiple plans) adds Query column', () => {
  const md = formatExplainMarkdown([
    { ...basePlan, queryLabel: 'q1' },
    { ...basePlan, queryLabel: 'q2' },
  ])
  expect(md).toMatch(/\|\s*Query\s*\|/)
  expect(md).toContain('q1')
  expect(md).toContain('q2')
})

test('formatExplainMarkdown: red annotation renders with 🔴 prefix', () => {
  const md = formatExplainMarkdown([basePlan])
  expect(md).toContain('🔴')
  expect(md).toContain('full-scan')
})

test('formatExplainMarkdown: yellow annotation renders with 🟡', () => {
  const plan: ExplainPlan = {
    ...basePlan,
    rows: [
      {
        ...basePlan.rows[0]!,
        annotations: [{ severity: 'yellow', rule: 'filesort', message: 'Sorted on disk' }],
      },
    ],
  }
  const md = formatExplainMarkdown([plan])
  expect(md).toContain('🟡')
  expect(md).toContain('filesort')
})

test('formatExplainMarkdown: empty annotations render dash', () => {
  const plan: ExplainPlan = {
    ...basePlan,
    rows: [{ ...basePlan.rows[0]!, annotations: [] }],
  }
  const md = formatExplainMarkdown([plan])
  // The flags cell for the only row should contain '-'
  expect(md.split('\n').some((line) => line.match(/\|\s*-\s*\|$/))).toBe(true)
})

test('formatExplainMarkdown: null key renders as `null`', () => {
  const md = formatExplainMarkdown([basePlan])
  expect(md).toContain('null')
})
