import { describe, expect, test } from 'bun:test'
import { buildElasticsearchDmlPlan } from '@/core/elasticsearch/dml-plan'

describe('buildElasticsearchDmlPlan', () => {
  test('insert intent records document body', () => {
    const intent = buildElasticsearchDmlPlan({
      operation: 'insert',
      target: 'products',
      data: { name: 'Widget' },
    })
    expect(intent).toEqual({
      operation: 'insert',
      target: 'products',
      data: { name: 'Widget' },
    })
  })

  test('update intent parses JSON where', () => {
    const intent = buildElasticsearchDmlPlan({
      operation: 'update',
      target: 'products',
      set: { stock: 0 },
      rawWhere: '{"_id":"abc"}',
    })
    if (intent.operation !== 'update') throw new Error('type guard')
    expect(intent.where).toEqual({ _id: 'abc' })
  })

  test('delete intent falls back to key=value where', () => {
    const intent = buildElasticsearchDmlPlan({
      operation: 'delete',
      target: 'products',
      rawWhere: '_id=abc',
    })
    if (intent.operation !== 'delete') throw new Error('type guard')
    expect(intent.where).toEqual({ _id: 'abc' })
  })

  test('rejects empty index', () => {
    expect(() =>
      buildElasticsearchDmlPlan({
        operation: 'insert',
        target: '',
        data: { name: 'x' },
      })
    ).toThrow(/index/i)
  })

  test('throws when rawWhere is neither JSON nor key=value', () => {
    expect(() =>
      buildElasticsearchDmlPlan({
        operation: 'delete',
        target: 'products',
        rawWhere: 'this is not parseable',
      })
    ).toThrow(/JSON object or simple key=value/i)
  })
})
