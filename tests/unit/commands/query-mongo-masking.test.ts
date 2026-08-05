import { describe, test, expect } from 'bun:test'
import { maskMongoRows, maskMongoRowsForCollections } from '@/core/mongo/field-masker'
import { findMongoCollectionScopes } from '@/core/mongo/collection-references'

// End-to-end coverage lives in tests/integration/mongo-blacklist-nested.test.ts.
// This test pins the import contract so future refactors do not silently drop masking.
describe('query.ts mongo masking contract', () => {
  test('maskMongoRows is the function callers must use', () => {
    expect(typeof maskMongoRows).toBe('function')
  })

  // A `$lookup` embeds documents from another collection, and those fields
  // carry that collection's rules — not the named one's (issue #23).
  test('maskMongoRowsForCollections applies the rules of every collection', () => {
    const rows = [{ _id: 1, note: 'n', sec: { uid: 1, token: 'SUPERSECRET' } }]
    const masked = maskMongoRowsForCollections(rows, ['orders', 'secrets'], {
      tables: [],
      columns: { orders: ['note'], secrets: ['sec.token'] },
    })

    expect(JSON.stringify(masked)).not.toContain('SUPERSECRET')
    expect(JSON.stringify(masked)).not.toContain('"n"')
    // The input is not mutated.
    expect(rows[0]?.sec).toEqual({ uid: 1, token: 'SUPERSECRET' })
  })

  // The rule is written for the source collection's own field name, but the
  // documents arrive nested under the `$lookup`'s `as`.
  test('re-anchors a looked-up collection rule under its embedding path', () => {
    const scopes = findMongoCollectionScopes([
      { $lookup: { from: 'secrets', localField: 'uid', foreignField: 'uid', as: 'sec' } },
    ])
    expect(scopes).toEqual([{ collection: 'secrets', prefix: 'sec' }])

    const masked = maskMongoRowsForCollections(
      [{ _id: 1, sec: { uid: 1, token: 'SUPERSECRET' } }],
      ['orders', ...scopes],
      { tables: [], columns: { secrets: ['token'] } }
    )

    expect(JSON.stringify(masked)).not.toContain('SUPERSECRET')
  })

  test('masks a collection reached through a $facet branch', () => {
    const scopes = findMongoCollectionScopes([
      { $facet: { fb: [{ $lookup: { from: 'secrets', as: 'sec' } }] } },
    ])
    const masked = maskMongoRowsForCollections(
      [{ fb: [{ _id: 1, sec: [{ token: 'SUPERSECRET' }] }] }],
      ['orders', ...scopes],
      { tables: [], columns: { secrets: ['token'] } }
    )

    expect(JSON.stringify(masked)).not.toContain('SUPERSECRET')
  })

  // `$unionWith` merges documents in place, so no prefix applies.
  test('leaves a $unionWith source unprefixed', () => {
    expect(findMongoCollectionScopes([{ $unionWith: { coll: 'secrets' } }])).toEqual([
      { collection: 'secrets' },
    ])
  })
})
