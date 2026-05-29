import { test, expect } from 'bun:test'
import type {
  ExplainRow,
  ExplainAnnotation,
  ExplainPlan,
  ExplainOptions,
  AnnotationSeverity,
  AnnotationRule,
} from '@/core/explain/types'

test('ExplainRow accepts minimal MySQL shape', () => {
  const row: ExplainRow = {
    driving: 'betting_logs',
    accessType: 'ALL',
    key: null,
    rows: 1500000,
    extra: ['Using where'],
    annotations: [],
  }
  expect(row.driving).toBe('betting_logs')
})

test('ExplainRow accepts PG-only fields', () => {
  const row: ExplainRow = {
    queryLabel: 'live-summary',
    driving: 'orders',
    accessType: 'Seq Scan',
    key: null,
    rows: 50000,
    extra: [],
    cost: { startup: 0, total: 12345.6 },
    annotations: [],
  }
  expect(row.cost?.total).toBe(12345.6)
})

test('ExplainAnnotation has expected shape', () => {
  const ann: ExplainAnnotation = {
    severity: 'red',
    rule: 'full-scan',
    message: 'Full table scan on betting_logs (1.5M rows)',
  }
  expect(ann.severity).toBe('red')
})

test('ExplainPlan wraps rows + raw payload', () => {
  const plan: ExplainPlan = {
    rows: [],
    system: 'mariadb',
    rawSql: 'SELECT 1',
    queryLabel: undefined,
    raw: { driverEcho: 'mock' },
  }
  expect(plan.system).toBe('mariadb')
})

test('AnnotationSeverity union', () => {
  const _s: AnnotationSeverity = 'yellow'
  expect(_s).toBe('yellow')
})

test('AnnotationRule union', () => {
  const _r: AnnotationRule = 'temp-table'
  expect(_r).toBe('temp-table')
})

test('ExplainOptions accepts analyze flag', () => {
  const opts: ExplainOptions = { analyze: true }
  expect(opts.analyze).toBe(true)
})
