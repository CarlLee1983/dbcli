import { describe, expect, test } from 'bun:test'
import { buildRedisDmlPlan } from '@/core/redis/dml-plan'

describe('buildRedisDmlPlan', () => {
  test('insert intent passes through data', () => {
    const intent = buildRedisDmlPlan({
      operation: 'insert',
      target: 'session:abc',
      data: { value: '1' },
    })
    expect(intent).toEqual({
      operation: 'insert',
      target: 'session:abc',
      data: { value: '1' },
    })
  })

  test('update intent normalizes set', () => {
    const intent = buildRedisDmlPlan({
      operation: 'update',
      target: 'user:42',
      set: { name: 'Alice' },
      rawWhere: '',
    })
    if (intent.operation !== 'update') throw new Error('type guard')
    expect(intent.target).toBe('user:42')
    expect(intent.set).toEqual({ name: 'Alice' })
    expect(intent.where).toBeNull()
    expect(intent.rawWhere).toBe('')
  })

  test('delete intent preserves wildcard target verbatim', () => {
    const intent = buildRedisDmlPlan({ operation: 'delete', target: '*', rawWhere: '' })
    if (intent.operation !== 'delete') throw new Error('type guard')
    expect(intent.target).toBe('*')
  })

  test('rejects empty target', () => {
    expect(() =>
      buildRedisDmlPlan({ operation: 'delete', target: '   ', rawWhere: '' })
    ).toThrow(/key/i)
  })
})
