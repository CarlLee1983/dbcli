import { describe, test, expect, spyOn } from 'bun:test'
import { maskMongoRows, maskMongoRowsForCollections } from '@/core/mongo/field-masker'

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
    const rows = [
      {
        _id: 'x',
        orders: [
          { id: 1, card: '4111' },
          { id: 2, card: '5500' },
        ],
      },
    ]
    const out = maskMongoRows(rows, 'users', cfg({ users: ['orders.card'] }))
    expect(out).toEqual([
      {
        _id: 'x',
        orders: [
          { id: 1, card: '[REDACTED]' },
          { id: 2, card: '[REDACTED]' },
        ],
      },
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

  // Was 'rejected patterns (middle *) are ignored'. ADR-0019 Decision 1 makes
  // every segment a glob, so this rule now compiles and protects the value it
  // names.
  test('a mid-path wildcard masks the field it reaches', () => {
    const rows = [{ _id: 'x', a: { b: { c: 'v' } } }]
    const out = maskMongoRows(rows, 'users', cfg({ users: ['a.*.c'] }))
    expect(out).toEqual([{ _id: 'x', a: { b: { c: '[REDACTED]' } } }])
  })
})

// ADR-0019 Decision 3: a rule the matcher cannot compile stops the operation.
// It used to return the documents untouched while the CLI printed "Some fields
// may have been redacted" over the plaintext.
describe('an uncompilable rule refuses rather than passes documents through', () => {
  test('throws naming the entry and the reason', () => {
    const rows = [{ _id: 'x', password: 's3cret' }]
    expect(() => maskMongoRows(rows, 'users', cfg({ users: ['a..b'] }))).toThrow(/a\.\.b/)
  })

  test('throws even when another rule in the same list compiles', () => {
    const rows = [{ _id: 'x', password: 's3cret' }]
    expect(() => maskMongoRows(rows, 'users', cfg({ users: ['password', 'a..b'] }))).toThrow()
  })

  test('a collection with no rules is untouched, not refused', () => {
    const rows = [{ _id: 'x', password: 's3cret' }]
    expect(maskMongoRows(rows, 'orders', cfg({ users: ['a..b'] }))).toBe(rows)
  })
})

/**
 * A `$lookup`'s `as` name is chosen by the request, and the joined
 * collection's rules are re-anchored under it. Since ADR-0019 those rules are
 * globs, so an `as` holding a glob metacharacter was read as syntax rather
 * than as the field name it is — and `\` is the one that does not accidentally
 * match itself, so it silently disabled the rule.
 */
describe('a $lookup prefix is a literal field name, not a pattern', () => {
  const lookupRows = (prefix: string) => [{ _id: 1, [prefix]: { password: 'p1' } }]

  for (const prefix of ['\\x', '*x', '?x', '[x', 'plain']) {
    test(`masks beneath a prefix spelled ${JSON.stringify(prefix)}`, () => {
      const out = maskMongoRowsForCollections(
        lookupRows(prefix),
        [{ collection: 'users' }, { collection: 'secrets', prefix }],
        cfg({ secrets: ['password'] })
      )
      expect(out).toEqual([{ _id: 1, [prefix]: { password: '[REDACTED]' } }])
    })
  }

  test('a prefix does not match a different name that its metacharacters would', () => {
    // `*x` as a pattern would also cover `zzx`; as a name it covers only itself.
    const out = maskMongoRowsForCollections(
      [{ _id: 1, zzx: { password: 'p1' } }],
      [{ collection: 'users' }, { collection: 'secrets', prefix: '*x' }],
      cfg({ secrets: ['password'] })
    )
    expect(out).toEqual([{ _id: 1, zzx: { password: 'p1' } }])
  })
})
