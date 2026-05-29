// tests/unit/core/assert/grammar.test.ts
import { describe, it, expect } from 'bun:test'
import { parseExpect, AssertExpressionError } from '@/core/assert/grammar'

describe('parseExpect', () => {
  it('parses a rows condition', () => {
    expect(parseExpect('rows > 0')).toEqual({ kind: 'rows', op: '>', value: 0 })
  })

  it('parses a numeric value condition', () => {
    expect(parseExpect('value == 5000')).toEqual({ kind: 'value', op: '==', value: 5000 })
  })

  it('parses a quoted string value condition', () => {
    expect(parseExpect('value == "done"')).toEqual({ kind: 'value', op: '==', value: 'done' })
  })

  it('parses col predicates', () => {
    expect(parseExpect('col:email not null')).toEqual({ kind: 'col', column: 'email', pred: { type: 'notNull' } })
    expect(parseExpect('col:id unique')).toEqual({ kind: 'col', column: 'id', pred: { type: 'unique' } })
    expect(parseExpect('col:amount between 0 and 100')).toEqual({
      kind: 'col', column: 'amount', pred: { type: 'between', low: 0, high: 100 },
    })
    expect(parseExpect('col:age >= 18')).toEqual({
      kind: 'col', column: 'age', pred: { type: 'cmp', op: '>=', value: 18 },
    })
  })

  it('throws AssertExpressionError on garbage', () => {
    expect(() => parseExpect('totally invalid')).toThrow(AssertExpressionError)
  })
})
