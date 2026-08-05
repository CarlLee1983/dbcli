/**
 * `$lookup.from` and `$unionWith.coll` are the MongoDB spelling of the JOIN in
 * issue #23: the command names one collection and the pipeline reaches another.
 */

import { describe, it, expect } from 'bun:test'
import {
  findMongoCollectionReferences,
  findMongoCollectionScopes,
} from '@/core/mongo/collection-references'

describe('findMongoCollectionReferences', () => {
  it('finds a $lookup source', () => {
    expect(
      findMongoCollectionReferences([
        { $lookup: { from: 'secrets', localField: 'uid', foreignField: 'uid', as: 'sec' } },
      ])
    ).toEqual(['secrets'])
  })

  it('finds a $unionWith source in both spellings', () => {
    expect(findMongoCollectionReferences([{ $unionWith: 'secrets' }])).toEqual(['secrets'])
    expect(findMongoCollectionReferences([{ $unionWith: { coll: 'secrets' } }])).toEqual([
      'secrets',
    ])
  })

  it('finds a $graphLookup source', () => {
    expect(
      findMongoCollectionReferences([{ $graphLookup: { from: 'secrets', as: 'tree' } }])
    ).toEqual(['secrets'])
  })

  it('finds a collection named inside a nested sub-pipeline', () => {
    const refs = findMongoCollectionReferences([
      {
        $lookup: {
          from: 'orders',
          pipeline: [{ $unionWith: { coll: 'secrets' } }],
          as: 'o',
        },
      },
    ])
    expect(refs).toContain('orders')
    expect(refs).toContain('secrets')
  })

  it('finds a collection inside a $facet branch', () => {
    expect(
      findMongoCollectionReferences([
        { $facet: { a: [{ $lookup: { from: 'secrets', as: 'x' } }] } },
      ])
    ).toEqual(['secrets'])
  })

  it('finds $out and $merge targets in every shape', () => {
    expect(findMongoCollectionReferences([{ $out: 'dump' }])).toEqual(['dump'])
    expect(findMongoCollectionReferences([{ $out: { db: 'd', coll: 'dump' } }])).toEqual(['dump'])
    expect(findMongoCollectionReferences([{ $merge: { into: 'dump' } }])).toEqual(['dump'])
    expect(
      findMongoCollectionReferences([{ $merge: { into: { db: 'd', coll: 'dump' } } }])
    ).toEqual(['dump'])
  })

  it('accumulates the embedding prefix through $facet and nested pipelines', () => {
    // The documents land at `fb.<as>` and `outer.<as>`, not at `<as>` — a
    // prefix that ignores the nesting points the rules at a path the documents
    // never occupy, so nothing is masked.
    expect(
      findMongoCollectionScopes([{ $facet: { fb: [{ $lookup: { from: 'secrets', as: 'sec' } }] } }])
    ).toEqual([{ collection: 'secrets', prefix: 'fb.sec' }])

    expect(
      findMongoCollectionScopes([
        {
          $lookup: {
            from: 'orders',
            as: 'outer',
            pipeline: [{ $lookup: { from: 'secrets', as: 'sec' } }],
          },
        },
      ])
    ).toEqual([
      { collection: 'orders', prefix: 'outer' },
      { collection: 'secrets', prefix: 'outer.sec' },
    ])
  })

  it('records one scope per occurrence, not per collection', () => {
    // The same collection joined twice arrives under two different `as` names;
    // recording only the first left the second unmasked.
    expect(
      findMongoCollectionScopes([
        { $lookup: { from: 'secrets', as: 'first' } },
        { $lookup: { from: 'secrets', as: 'second' } },
      ])
    ).toEqual([
      { collection: 'secrets', prefix: 'first' },
      { collection: 'secrets', prefix: 'second' },
    ])
  })

  it('returns nothing for a pipeline that names no other collection', () => {
    expect(findMongoCollectionReferences([{ $match: { a: 1 } }, { $limit: 10 }])).toEqual([])
    expect(findMongoCollectionReferences({ a: 1 })).toEqual([])
  })
})
