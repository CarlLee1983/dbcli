import { describe, test, expect, spyOn } from 'bun:test'
import { maskMongoRows } from '@/core/mongo/field-masker'

const cfg = (cols: Record<string, string[]>) => ({ tables: [], columns: cols })

describe('maskMongoRows', () => {
  test('top-level path replaced with [REDACTED]', () => {
    const rows = [{ _id: 'x', password: 's3cret', email: 'a@b' }]
    const out = maskMongoRows(rows, 'users', cfg({ users: ['password'] }))
    expect(out).toEqual([{ _id: 'x', password: '[REDACTED]', email: 'a@b' }])
  })

  test('nested path replaced', () => {
    const rows = [{ _id: 'x', profile: { email: 'a@b', name: 'A' } }]
    const out = maskMongoRows(rows, 'users', cfg({ users: ['profile.email'] }))
    expect(out).toEqual([{ _id: 'x', profile: { email: '[REDACTED]', name: 'A' } }])
  })

  test('suffix wildcard masks entire subtree', () => {
    const rows = [{ _id: 'x', profile: { tokens: { access: 'A', refresh: 'R' } } }]
    const out = maskMongoRows(rows, 'users', cfg({ users: ['profile.tokens.*'] }))
    expect(out).toEqual([{ _id: 'x', profile: { tokens: '[REDACTED]' } }])
  })

  test('array of objects recurses', () => {
    const rows = [{ _id: 'x', orders: [{ id: 1, card: '4111' }, { id: 2, card: '5500' }] }]
    const out = maskMongoRows(rows, 'users', cfg({ users: ['orders.card'] }))
    expect(out).toEqual([
      { _id: 'x', orders: [{ id: 1, card: '[REDACTED]' }, { id: 2, card: '[REDACTED]' }] },
    ])
  })

  test('array of scalars is not expanded by index', () => {
    const rows = [{ _id: 'x', tags: ['a', 'b'] }]
    const out = maskMongoRows(rows, 'users', cfg({ users: ['tags.0'] }))
    expect(out).toEqual([{ _id: 'x', tags: ['a', 'b'] }])
  })

  test('_id is never masked but warning is logged once', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    const rows = [{ _id: 'a' }, { _id: 'b' }]
    const out = maskMongoRows(rows, 'users', cfg({ users: ['_id'] }))
    expect(out).toEqual([{ _id: 'a' }, { _id: 'b' }])
    expect(spy.mock.calls.length).toBe(1)
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/_id/i)
    spy.mockRestore()
  })

  test('no blacklist for collection returns original rows by reference', () => {
    const rows = [{ _id: 'x', a: 1 }]
    const out = maskMongoRows(rows, 'orders', cfg({ users: ['password'] }))
    expect(out).toBe(rows)
  })

  test('rejected patterns (middle *) are ignored', () => {
    const rows = [{ _id: 'x', a: { b: { c: 'v' } } }]
    const out = maskMongoRows(rows, 'users', cfg({ users: ['a.*.c'] }))
    expect(out).toEqual([{ _id: 'x', a: { b: { c: 'v' } } }])
  })
})
