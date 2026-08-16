// tests/unit/core/assert/evaluator.test.ts
import { describe, it, expect } from 'bun:test'
import { evaluateExpect, compareVs, AssertShapeError } from '@/core/assert/evaluator'
import type { QueryResult } from '@/types/query'

function qr(
  rows: Record<string, unknown>[],
  columnNames: string[]
): QueryResult<Record<string, unknown>> {
  return { rows, rowCount: rows.length, columnNames }
}

describe('evaluateExpect', () => {
  it('evaluates rows condition', () => {
    const c = evaluateExpect({ kind: 'rows', op: '>', value: 0 }, qr([{ id: 1 }], ['id']))
    expect(c.pass).toBe(true)
    expect(c.actual).toBe('1')
  })

  it('evaluates scalar value condition on a 1x1 result', () => {
    const c = evaluateExpect(
      { kind: 'value', op: '==', value: 5000 },
      qr([{ total: 5000 }], ['total'])
    )
    expect(c.pass).toBe(true)
  })

  // PostgreSQL returns bigint, numeric, and int8 as JavaScript strings, so the
  // most ordinary assertion anyone writes — a count against a number — compared
  // a string to a number under `===` and always failed. Ordering operators
  // coerced and passed, which is why it stayed hidden: `value > 5` worked while
  // `value == 6` did not.
  it('compares a numeric string result against a numeric expectation', () => {
    const c = evaluateExpect({ kind: 'value', op: '==', value: 6 }, qr([{ n: '6' }], ['n']))
    expect(c.pass).toBe(true)
    expect(c.actual).toBe('6')
  })

  it('compares a zero count returned as a string', () => {
    const c = evaluateExpect({ kind: 'value', op: '==', value: 0 }, qr([{ n: '0' }], ['n']))
    expect(c.pass).toBe(true)
  })

  it('treats != on a numeric string the same way', () => {
    expect(
      evaluateExpect({ kind: 'value', op: '!=', value: 6 }, qr([{ n: '6' }], ['n'])).pass
    ).toBe(false)
    expect(
      evaluateExpect({ kind: 'value', op: '!=', value: 7 }, qr([{ n: '6' }], ['n'])).pass
    ).toBe(true)
  })

  it('compares a scaled numeric string by value, not by text', () => {
    const c = evaluateExpect({ kind: 'value', op: '==', value: 6 }, qr([{ n: '6.00' }], ['n']))
    expect(c.pass).toBe(true)
  })

  // A quoted expectation asks for a string comparison, so it must not be
  // coerced: '006' and 6 are equal as numbers and different as text.
  it('keeps a quoted expectation a string comparison', () => {
    expect(
      evaluateExpect({ kind: 'value', op: '==', value: '006' }, qr([{ n: '6' }], ['n'])).pass
    ).toBe(false)
    expect(
      evaluateExpect({ kind: 'value', op: '==', value: 'paid' }, qr([{ s: 'paid' }], ['s'])).pass
    ).toBe(true)
  })

  it('does not turn a non-numeric string into a numeric comparison', () => {
    const c = evaluateExpect({ kind: 'value', op: '==', value: 0 }, qr([{ s: 'paid' }], ['s']))
    expect(c.pass).toBe(false)
  })

  it('compares col predicates against numeric strings', () => {
    const c = evaluateExpect(
      { kind: 'col', column: 'amount', pred: { type: 'cmp', op: '==', value: 10 } },
      qr([{ amount: '10' }, { amount: '10.0' }], ['amount'])
    )
    expect(c.pass).toBe(true)
  })

  it('ranges a numeric-string column instead of calling every row out of range', () => {
    const c = evaluateExpect(
      { kind: 'col', column: 'amount', pred: { type: 'between', low: 0, high: 100 } },
      qr([{ amount: '10' }, { amount: '99.5' }], ['amount'])
    )
    expect(c.pass).toBe(true)
    expect(c.actual).toBe('0 out of range')
  })

  it('still reports a numeric-string column outside the range', () => {
    const c = evaluateExpect(
      { kind: 'col', column: 'amount', pred: { type: 'between', low: 0, high: 100 } },
      qr([{ amount: '101' }], ['amount'])
    )
    expect(c.pass).toBe(false)
  })

  it('throws AssertShapeError when value query has multiple columns', () => {
    expect(() =>
      evaluateExpect({ kind: 'value', op: '==', value: 1 }, qr([{ a: 1, b: 2 }], ['a', 'b']))
    ).toThrow(AssertShapeError)
  })

  it('evaluates col not-null (fails when nulls present)', () => {
    const c = evaluateExpect(
      { kind: 'col', column: 'email', pred: { type: 'notNull' } },
      qr([{ email: 'a' }, { email: null }], ['email'])
    )
    expect(c.pass).toBe(false)
  })

  it('evaluates col unique', () => {
    const dup = evaluateExpect(
      { kind: 'col', column: 'id', pred: { type: 'unique' } },
      qr([{ id: 1 }, { id: 1 }], ['id'])
    )
    expect(dup.pass).toBe(false)
  })

  it('evaluates col between', () => {
    const c = evaluateExpect(
      { kind: 'col', column: 'n', pred: { type: 'between', low: 0, high: 10 } },
      qr([{ n: 5 }, { n: 11 }], ['n'])
    )
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

  // Reconciling two engines, or a count against a literal, puts a string on one
  // side and a number on the other.
  it('reconciles the same number across a string and a number result', () => {
    const c = compareVs(qr([{ s: '100' }], ['s']), qr([{ s: 100 }], ['s']), 'value')
    expect(c.pass).toBe(true)
  })

  it('still separates genuinely different values', () => {
    const c = compareVs(qr([{ s: '100' }], ['s']), qr([{ s: 101 }], ['s']), 'value')
    expect(c.pass).toBe(false)
  })

  it('compares two non-numeric strings as text', () => {
    expect(compareVs(qr([{ s: 'paid' }], ['s']), qr([{ s: 'paid' }], ['s']), 'value').pass).toBe(
      true
    )
    expect(compareVs(qr([{ s: 'paid' }], ['s']), qr([{ s: 'pending' }], ['s']), 'value').pass).toBe(
      false
    )
  })
})
