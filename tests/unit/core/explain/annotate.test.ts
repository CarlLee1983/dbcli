import { test, expect } from 'bun:test'
import { annotateRows, ANNOTATION_THRESHOLDS } from '@/core/explain/annotate'
import type { ExplainRow } from '@/core/explain/types'

const base = (overrides: Partial<ExplainRow>): ExplainRow => ({
  driving: 't',
  accessType: 'ref',
  key: 'idx',
  rows: 100,
  extra: [],
  annotations: [],
  ...overrides,
})

test('full-scan: MySQL type=ALL → red', () => {
  const [row] = annotateRows([base({ accessType: 'ALL', key: null, rows: 1500000 })], 'mariadb')
  const ann = row!.annotations.find((a) => a.rule === 'full-scan')
  expect(ann?.severity).toBe('red')
  expect(ann?.message.toLowerCase()).toContain('full')
})

test('full-scan: MySQL key=null but type=ref → still flagged (key-null branch)', () => {
  const [row] = annotateRows([base({ accessType: 'ref', key: null })], 'mariadb')
  expect(row!.annotations.some((a) => a.rule === 'full-scan')).toBe(true)
})

test('full-scan: PG Seq Scan → red', () => {
  const [row] = annotateRows([base({ accessType: 'Seq Scan', key: null })], 'postgresql')
  expect(row!.annotations.find((a) => a.rule === 'full-scan')?.severity).toBe('red')
})

test('temp-table: MySQL Extra Using temporary → yellow', () => {
  const [row] = annotateRows([base({ extra: ['Using temporary'] })], 'mariadb')
  expect(row!.annotations.find((a) => a.rule === 'temp-table')?.severity).toBe('yellow')
})

test('filesort: MySQL Extra Using filesort → yellow', () => {
  const [row] = annotateRows([base({ extra: ['Using filesort'] })], 'mariadb')
  expect(row!.annotations.find((a) => a.rule === 'filesort')?.severity).toBe('yellow')
})

test('filesort: PG Sort Method: external merge → yellow', () => {
  const [row] = annotateRows([base({ extra: ['Sort Method: external merge'] })], 'postgresql')
  expect(row!.annotations.find((a) => a.rule === 'filesort')?.severity).toBe('yellow')
})

test('cost-estimate-skew: actualRows > rows * 10 → gray', () => {
  const [row] = annotateRows([base({ rows: 100, actualRows: 5000 })], 'postgresql')
  expect(row!.annotations.find((a) => a.rule === 'cost-estimate-skew')?.severity).toBe('gray')
})

test('cost-estimate-skew: skipped when actualRows undefined', () => {
  const [row] = annotateRows([base({ rows: 100 })], 'mariadb')
  expect(row!.annotations.some((a) => a.rule === 'cost-estimate-skew')).toBe(false)
})

test('nested-loop-large: PG Nested Loop with rows over threshold → yellow', () => {
  const [row] = annotateRows(
    [base({ accessType: 'Nested Loop', rows: ANNOTATION_THRESHOLDS.NESTED_LOOP_ROWS + 1 })],
    'postgresql'
  )
  expect(row!.annotations.find((a) => a.rule === 'nested-loop-large')?.severity).toBe('yellow')
})

test('clean row: no annotations', () => {
  const [row] = annotateRows([base({ accessType: 'ref', key: 'idx_x', rows: 50 })], 'mariadb')
  expect(row!.annotations).toEqual([])
})

test('multiple annotations on the same row', () => {
  const [row] = annotateRows(
    [
      base({
        accessType: 'ALL',
        key: null,
        rows: 1000000,
        extra: ['Using temporary', 'Using filesort'],
      }),
    ],
    'mariadb'
  )
  const rules = row!.annotations.map((a) => a.rule).sort()
  expect(rules).toEqual(['filesort', 'full-scan', 'temp-table'])
})
