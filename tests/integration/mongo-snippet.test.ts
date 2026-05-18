import { describe, test, expect } from 'bun:test'
import { mongoStrategy } from '@/core/saved-queries/strategies/mongodb'
import type { SavedQuery } from '@/core/saved-queries/types'

const findSnippet = (body: string): SavedQuery => ({
  meta: {
    key: '@find-users',
    name: 'find-users',
    engine: ['mongodb'],
    target: 'users',
    operation: 'find',
    params: [{ name: 'status', type: 'string', required: true }],
    tags: [],
  } as any,
  sqlBody: body,
  file: '/tmp/find-users.mongodb.sql',
  source: 'shared',
})

const aggSnippet = (body: string): SavedQuery => ({
  meta: {
    key: '@top-by-city',
    name: 'top-by-city',
    engine: ['mongodb'],
    target: 'orders',
    operation: 'aggregate',
    params: [
      { name: 'status', type: 'string', required: true },
      { name: 'limit', type: 'int', required: false, default: 5 },
    ],
    tags: [],
  } as any,
  sqlBody: body,
  file: '/tmp/top-by-city.mongodb.sql',
  source: 'shared',
})

describe('mongo snippet end-to-end (no driver)', () => {
  test('find body is rendered to JSON object with collection hint', () => {
    const prep = mongoStrategy.prepare(
      findSnippet('{ "status": {{status}} }'),
      { status: 'active' },
      { engine: 'mongodb', noLimit: false }
    )
    expect(prep.execHints).toEqual({ collection: 'users', mongoOperation: 'find' })
    expect(JSON.parse(prep.driver.sql)).toEqual({ status: 'active' })
  })

  test('aggregate body uses default param', () => {
    const prep = mongoStrategy.prepare(
      aggSnippet('[ { "$match": { "status": {{status}} } }, { "$limit": {{limit}} } ]'),
      { status: 'open' },
      { engine: 'mongodb', noLimit: false }
    )
    expect(JSON.parse(prep.driver.sql)).toEqual([
      { $match: { status: 'open' } },
      { $limit: 5 },
    ])
    expect(prep.execHints?.mongoOperation).toBe('aggregate')
  })
})
