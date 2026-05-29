// tests/unit/core/assert/evaluator.test.ts
import { describe, it, expect } from 'bun:test'
import { evaluateExpect, compareVs, AssertShapeError } from '@/core/assert/evaluator'
import type { QueryResult } from '@/types/query'

function qr(rows: Record<string, unknown>[], columnNames: string[]): QueryResult<Record<string, unknown>> {
  return { rows, rowCount: rows.length, columnNames }
}

describe('evaluateExpect', () => {
  it('evaluates rows condition', () => {
    const c = evaluateExpect({ kind: 'rows', op: '>', value: 0 }, qr([{ id: 1 }], ['id']))
    expect(c.pass).toBe(true)
    expect(c.actual).toBe('1')
  })

  it('evaluates scalar value condition on a 1x1 result', () => {
    const c = evaluateExpect({ kind: 'value', op: '==', value: 5000 }, qr([{ total: 5000 }], ['total']))
    expect(c.pass).toBe(true)
  })

  it('throws AssertShapeError when value query has multiple columns', () => {
    expect(() => evaluateExpect({ kind: 'value', op: '==', value: 1 }, qr([{ a: 1, b: 2 }], ['a', 'b']))).toThrow(AssertShapeError)
  })

  it('evaluates col not-null (fails when nulls present)', () => {
    const c = evaluateExpect({ kind: 'col', column: 'email', pred: { type: 'notNull' } }, qr([{ email: 'a' }, { email: null }], ['email']))
    expect(c.pass).toBe(false)
  })

  it('evaluates col unique', () => {
    const dup = evaluateExpect({ kind: 'col', column: 'id', pred: { type: 'unique' } }, qr([{ id: 1 }, { id: 1 }], ['id']))
    expect(dup.pass).toBe(false)
  })

  it('evaluates col between', () => {
    const c = evaluateExpect({ kind: 'col', column: 'n', pred: { type: 'between', low: 0, high: 10 } }, qr([{ n: 5 }, { n: 11 }], ['n']))
    expect(c.pass).toBe(false)
  })
})

describe('compareVs', () => {
  it('compares row counts', () => {
    const c = compareVs(qr([{ id: 1 }], ['id']), qr([{ id: 9 }], ['id']), 'rows')
    expect(c.pass).toBe(true)
  })

  it('compares scalar values', () => {
    const c = compareVs(qr([{ s: 100 }], ['s']), qr([{ s: 100 }], ['s']), 'value')
    expect(c.pass).toBe(true)
  })
})
