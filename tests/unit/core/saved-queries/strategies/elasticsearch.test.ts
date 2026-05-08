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
