import { describe, expect, test } from 'bun:test'
import { buildMongoDmlPlan } from '@/core/mongo/dml-plan'

describe('buildMongoDmlPlan', () => {
  test('insert intent passes data through', () => {
    const intent = buildMongoDmlPlan({
      operation: 'insert',
      target: 'users',
      data: { name: 'Alice' },
    })
    expect(intent).toEqual({
      operation: 'insert',
      target: 'users',
      data: { name: 'Alice' },
    })
  })

  test('update intent parses JSON where', () => {
    const intent = buildMongoDmlPlan({
      operation: 'update',
      target: 'users',
      set: { status: 'inactive' },
      rawWhere: '{"_id":"abc"}',
    })
    expect(intent.operation).toBe('update')
    if (intent.operation !== 'update') throw new Error('type guard')
    expect(intent.set).toEqual({ status: 'inactive' })
    expect(intent.where).toEqual({ _id: 'abc' })
    expect(intent.rawWhere).toBe('{"_id":"abc"}')
  })

  test('update intent falls back to key=value where', () => {
    const intent = buildMongoDmlPlan({
      operation: 'update',
      target: 'users',
      set: { status: 'inactive' },
      rawWhere: 'id=42',
    })
    if (intent.operation !== 'update') throw new Error('type guard')
    expect(intent.where).toEqual({ id: 42 })
  })

  test('delete intent records empty filter as empty object', () => {
    const intent = buildMongoDmlPlan({
      operation: 'delete',
      target: 'users',
      rawWhere: '{}',
    })
    if (intent.operation !== 'delete') throw new Error('type guard')
    expect(intent.where).toEqual({})
    expect(intent.rawWhere).toBe('{}')
  })

  test('throws on rawWhere that is neither JSON nor key=value', () => {
    expect(() =>
      buildMongoDmlPlan({
        operation: 'delete',
        target: 'users',
        rawWhere: 'this is not parseable',
      })
    ).toThrow(/JSON object or simple key=value/i)
  })

  test('rejects empty target', () => {
    expect(() =>
      buildMongoDmlPlan({
        operation: 'insert',
        target: '',
        data: { name: 'Alice' },
      })
    ).toThrow(/collection/i)
  })
})
