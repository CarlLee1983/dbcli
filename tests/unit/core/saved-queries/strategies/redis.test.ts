import { describe, test, expect } from 'bun:test'
import { redisStrategy } from '@/core/saved-queries/strategies/redis'
import { SavedQueryError } from '@/core/saved-queries/types'

const meta = () => ({
  name: 't',
  key: '@t',
  engine: ['redis'] as const,
  params: [],
  tags: [],
})

describe('redisStrategy.validateBody', () => {
  test('accepts GET', () => {
    expect(() => redisStrategy.validateBody('GET key', meta(), '/tmp/t')).not.toThrow()
  })

  test('accepts HGETALL with key pattern', () => {
    expect(() => redisStrategy.validateBody('HGETALL user:42', meta(), '/tmp/t')).not.toThrow()
  })

  test('accepts SCAN', () => {
    expect(() =>
      redisStrategy.validateBody('SCAN 0 MATCH user:*', meta(), '/tmp/t')
    ).not.toThrow()
  })

  test('rejects KEYS *', () => {
    expect(() => redisStrategy.validateBody('KEYS *', meta(), '/tmp/t')).toThrow(SavedQueryError)
  })

  test('rejects FLUSHDB', () => {
    expect(() => redisStrategy.validateBody('FLUSHDB', meta(), '/tmp/t')).toThrow(SavedQueryError)
  })

  test('rejects EVAL', () => {
    expect(() =>
      redisStrategy.validateBody('EVAL "return 1" 0', meta(), '/tmp/t')
    ).toThrow(SavedQueryError)
  })

  test('rejects SET (write command)', () => {
    expect(() => redisStrategy.validateBody('SET k v', meta(), '/tmp/t')).toThrow(SavedQueryError)
  })

  test('rejects multi-line body', () => {
    expect(() =>
      redisStrategy.validateBody('GET a\nGET b', meta(), '/tmp/t')
    ).toThrow(/multi/i)
  })

  test('rejects empty body', () => {
    expect(() => redisStrategy.validateBody('   ', meta(), '/tmp/t')).toThrow(/empty/i)
  })
})

import { substituteRedisParams } from '@/core/saved-queries/strategies/redis'

describe('substituteRedisParams', () => {
  test('replaces :int into key pattern', () => {
    const { command, warnings } = substituteRedisParams(
      'HGETALL user::id',
      { id: 42 },
      [{ name: 'id', type: 'int', required: true }]
    )
    expect(command).toBe('HGETALL user:42')
    expect(warnings).toEqual([])
  })

  test('replaces :string with foot-gun warning when adjacent to non-whitespace', () => {
    const { command, warnings } = substituteRedisParams(
      'HGETALL user::name',
      { name: 'alice' },
      [{ name: 'name', type: 'string', required: true }]
    )
    expect(command).toBe('HGETALL user:alice')
    expect(warnings.join(' ')).toMatch(/whitespace|quote/i)
  })

  test('no warning when :string is whitespace-isolated', () => {
    const { warnings } = substituteRedisParams(
      'GET :key',
      { key: 'foo' },
      [{ name: 'key', type: 'string', required: true }]
    )
    expect(warnings).toEqual([])
  })
})
