import { describe, test, expect } from 'bun:test'
import { esStrategy } from '@/core/saved-queries/strategies/elasticsearch'
import { SavedQueryError } from '@/core/saved-queries/types'

const meta = (extra: Record<string, unknown> = {}) => ({
  name: 't',
  key: '@t',
  engine: ['elasticsearch'] as const,
  index: 'events-*',
  params: [],
  tags: [],
  ...extra,
})

describe('esStrategy.validateBody', () => {
  test('accepts plain match_all', () => {
    expect(() =>
      esStrategy.validateBody('{ "query": { "match_all": {} } }', meta(), '/tmp/t.sql')
    ).not.toThrow()
  })

  test('rejects non-JSON body', () => {
    expect(() => esStrategy.validateBody('not json', meta(), '/tmp/t.sql')).toThrow(SavedQueryError)
  })

  test('rejects array body', () => {
    expect(() => esStrategy.validateBody('[]', meta(), '/tmp/t.sql')).toThrow(/object/)
  })

  test('rejects script_fields', () => {
    const body = '{ "script_fields": { "x": { "script": "doc.value" } } }'
    expect(() => esStrategy.validateBody(body, meta(), '/tmp/t.sql')).toThrow(/script/i)
  })

  test('rejects nested script in query', () => {
    const body = '{ "query": { "script": { "source": "1==1" } } }'
    expect(() => esStrategy.validateBody(body, meta(), '/tmp/t.sql')).toThrow(/script/i)
  })
})

import { substituteEsParams } from '@/core/saved-queries/strategies/elasticsearch'

describe('substituteEsParams', () => {
  test('int outside string -> bare number', () => {
    const out = substituteEsParams('{ "term": { "id": :id } }', { id: 42 }, [
      { name: 'id', type: 'int', required: true },
    ])
    expect(out).toBe('{ "term": { "id": 42 } }')
  })

  test('string outside string -> JSON-quoted', () => {
    const out = substituteEsParams('{ "term": { "name": :name } }', { name: 'Alice' }, [
      { name: 'name', type: 'string', required: true },
    ])
    expect(out).toBe('{ "term": { "name": "Alice" } }')
  })

  test('string inside string literal -> escaped inner', () => {
    const out = substituteEsParams('{ "term": { "key": "user-:id" } }', { id: 42 }, [
      { name: 'id', type: 'int', required: true },
    ])
    expect(out).toBe('{ "term": { "key": "user-42" } }')
  })

  test('string with quote inside string literal -> JSON-escaped', () => {
    const out = substituteEsParams('{ "k": "hello :name" }', { name: 'A"B' }, [
      { name: 'name', type: 'string', required: true },
    ])
    expect(out).toBe('{ "k": "hello A\\"B" }')
  })

  test('bool -> bare', () => {
    const out = substituteEsParams('{ "active": :on }', { on: true }, [
      { name: 'on', type: 'bool', required: true },
    ])
    expect(out).toBe('{ "active": true }')
  })

  test('null value -> bare null', () => {
    const out = substituteEsParams('{ "x": :y }', { y: null }, [
      { name: 'y', type: 'string', required: false },
    ])
    expect(out).toBe('{ "x": null }')
  })
})

import { substituteEsIndex } from '@/core/saved-queries/strategies/elasticsearch'

describe('substituteEsIndex', () => {
  test('replaces :param with raw value', () => {
    expect(substituteEsIndex('events-:date', { date: '2026-05-08' })).toBe('events-2026-05-08')
  })

  test('handles literal index', () => {
    expect(substituteEsIndex('events-*', {})).toBe('events-*')
  })

  test('multiple params', () => {
    expect(substituteEsIndex(':env-events-:date', { env: 'prod', date: '2026-05-08' })).toBe(
      'prod-events-2026-05-08'
    )
  })
})

import { applyEsSizeGuard } from '@/core/saved-queries/strategies/elasticsearch'

describe('applyEsSizeGuard', () => {
  test('injects size: 1000 when missing', () => {
    const { body, warnings } = applyEsSizeGuard({ query: { match_all: {} } }, false)
    expect((body as { size: number }).size).toBe(1000)
    expect(warnings).toEqual([])
  })

  test('keeps size when within cap', () => {
    const { body, warnings } = applyEsSizeGuard({ query: { match_all: {} }, size: 50 }, false)
    expect((body as { size: number }).size).toBe(50)
    expect(warnings).toEqual([])
  })

  test('caps size at 1000 with warning', () => {
    const { body, warnings } = applyEsSizeGuard({ query: { match_all: {} }, size: 5000 }, false)
    expect((body as { size: number }).size).toBe(1000)
    expect(warnings.join(' ')).toMatch(/size/i)
  })

  test('aggs without size -> size: 0', () => {
    const { body } = applyEsSizeGuard({ aggs: { x: { terms: { field: 'k' } } } }, false)
    expect((body as { size: number }).size).toBe(0)
  })

  test('noLimit skips mutation', () => {
    const original = { query: { match_all: {} }, size: 5000 }
    const { body, warnings } = applyEsSizeGuard(original, true)
    expect((body as { size: number }).size).toBe(5000)
    expect(warnings).toEqual([])
  })

  test('from + size >= 10000 emits search_after hint', () => {
    const { warnings } = applyEsSizeGuard({ query: { match_all: {} }, from: 9500, size: 500 }, false)
    expect(warnings.join(' ')).toMatch(/search_after|max_result_window/i)
  })
})
