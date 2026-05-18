import { describe, test, expect } from 'bun:test'
import { mongoStrategy } from '@/core/saved-queries/strategies/mongodb'
import {
  SavedQueryError,
  type EngineTag,
  type SavedQueryMeta,
  type SavedQuery,
} from '@/core/saved-queries/types'

const meta = (extra: Partial<SavedQueryMeta> = {}): SavedQueryMeta => ({
  name: 't',
  key: '@t',
  engine: ['mongodb'] as EngineTag[],
  params: [],
  tags: [],
  ...extra,
})

const snippet = (body: string, m: SavedQueryMeta = meta()): SavedQuery => ({
  meta: m,
  sqlBody: body,
  file: '/tmp/t.mongodb.sql',
  source: 'shared',
})

describe('mongoStrategy.validateBody', () => {
  test('accepts find object', () => {
    expect(() =>
      mongoStrategy.validateBody(
        '{ "status": "active" }',
        meta({ operation: 'find', target: 'users' }),
        '/tmp/t.mongodb.sql'
      )
    ).not.toThrow()
  })

  test('accepts aggregate array', () => {
    expect(() =>
      mongoStrategy.validateBody(
        '[ { "$match": {} } ]',
        meta({ operation: 'aggregate', target: 'users' }),
        '/tmp/t.mongodb.sql'
      )
    ).not.toThrow()
  })

  test('rejects find with array body', () => {
    expect(() =>
      mongoStrategy.validateBody(
        '[]',
        meta({ operation: 'find', target: 'users' }),
        '/tmp/t.mongodb.sql'
      )
    ).toThrow(SavedQueryError)
  })

  test('rejects aggregate with object body', () => {
    expect(() =>
      mongoStrategy.validateBody(
        '{}',
        meta({ operation: 'aggregate', target: 'users' }),
        '/tmp/t.mongodb.sql'
      )
    ).toThrow(SavedQueryError)
  })

  test('rejects when operation is missing', () => {
    expect(() =>
      mongoStrategy.validateBody('{}', meta({ target: 'users' }), '/tmp/t.mongodb.sql')
    ).toThrow(/operation/)
  })
})

describe('mongoStrategy.prepare', () => {
  test('substitutes string params with JSON-encoded value', () => {
    const m = meta({
      operation: 'find',
      target: 'users',
      params: [{ name: 'city', type: 'string', required: true }],
    })
    const prep = mongoStrategy.prepare(
      snippet('{ "city": {{city}} }', m),
      { city: 'Tai"pei' },
      { engine: 'mongodb' as EngineTag, noLimit: false }
    )
    const body = JSON.parse(prep.driver.sql)
    expect(body).toEqual({ city: 'Tai"pei' })
    expect(prep.execHints?.collection).toBe('users')
    expect(prep.execHints?.mongoOperation).toBe('find')
  })

  test('substitutes number param without quotes', () => {
    const m = meta({
      operation: 'find',
      target: 'users',
      params: [{ name: 'limit', type: 'int', required: true }],
    })
    const prep = mongoStrategy.prepare(
      snippet('{ "n": {{limit}} }', m),
      { limit: 10 },
      { engine: 'mongodb' as EngineTag, noLimit: false }
    )
    expect(JSON.parse(prep.driver.sql)).toEqual({ n: 10 })
  })

  test('operator injection through string param is neutralized', () => {
    const m = meta({
      operation: 'find',
      target: 'users',
      params: [{ name: 'status', type: 'string', required: true }],
    })
    const prep = mongoStrategy.prepare(
      snippet('{ "status": {{status}} }', m),
      { status: '$ne:active' },
      { engine: 'mongodb' as EngineTag, noLimit: false }
    )
    expect(JSON.parse(prep.driver.sql)).toEqual({ status: '$ne:active' })
  })

  test('throws when target and collection both missing', () => {
    const m = meta({ operation: 'find' })
    expect(() =>
      mongoStrategy.prepare(snippet('{}', m), {}, {
        engine: 'mongodb' as EngineTag,
        noLimit: false,
      })
    ).toThrow(/collection/i)
  })

  test('throws when required param missing', () => {
    const m = meta({
      operation: 'find',
      target: 'users',
      params: [{ name: 'q', type: 'string', required: true }],
    })
    expect(() =>
      mongoStrategy.prepare(snippet('{ "q": {{q}} }', m), {}, {
        engine: 'mongodb' as EngineTag,
        noLimit: false,
      })
    ).toThrow(SavedQueryError)
  })
})
