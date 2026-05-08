import { describe, test, expect } from 'bun:test'
import { redisStrategy } from '@/core/saved-queries/strategies/redis'
import { SavedQueryError } from '@/core/saved-queries/types'

import type { EngineTag, SavedQueryMeta } from '@/core/saved-queries/types'

const meta = (): SavedQueryMeta => ({
  name: 't',
  key: '@t',
  engine: ['redis'] as EngineTag[],
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

import { applyRedisSizeGuard } from '@/core/saved-queries/strategies/redis'

describe('applyRedisSizeGuard', () => {
  test('LRANGE stop > 1000 -> override + warn', () => {
    const { command, warnings } = applyRedisSizeGuard('LRANGE k 0 5000', false)
    expect(command).toBe('LRANGE k 0 1000')
    expect(warnings.join(' ')).toMatch(/size|cap|exceed/i)
  })

  test('LRANGE stop = -1 -> override to 1000 + warn', () => {
    const { command, warnings } = applyRedisSizeGuard('LRANGE k 0 -1', false)
    expect(command).toBe('LRANGE k 0 1000')
    expect(warnings.length).toBeGreaterThan(0)
  })

  test('SCAN injects COUNT 1000 when missing', () => {
    const { command } = applyRedisSizeGuard('SCAN 0', false)
    expect(command).toBe('SCAN 0 COUNT 1000')
  })

  test('SCAN with explicit COUNT respected (within cap)', () => {
    const { command } = applyRedisSizeGuard('SCAN 0 COUNT 50', false)
    expect(command).toBe('SCAN 0 COUNT 50')
  })

  test('SCAN with COUNT > 1000 capped', () => {
    const { command, warnings } = applyRedisSizeGuard('SCAN 0 COUNT 5000', false)
    expect(command).toBe('SCAN 0 COUNT 1000')
    expect(warnings.length).toBeGreaterThan(0)
  })

  test('--no-limit skips guard', () => {
    const { command, warnings } = applyRedisSizeGuard('LRANGE k 0 -1', true)
    expect(command).toBe('LRANGE k 0 -1')
    expect(warnings).toEqual([])
  })

  test('GET unaffected', () => {
    const { command } = applyRedisSizeGuard('GET key', false)
    expect(command).toBe('GET key')
  })
})

import type { ParamSpec, SavedQuery } from '@/core/saved-queries/types'

const redisSnippet = (body: string, params: ParamSpec[] = []): SavedQuery => ({
  meta: { name: 't', key: '@t', engine: ['redis'], params, tags: [] },
  sqlBody: body,
  file: '/tmp/t.sql',
  source: 'shared',
})

describe('redisStrategy.prepare', () => {
  test('substitutes params, no size guard for HGETALL', () => {
    const snippet = redisSnippet('HGETALL user::id', [{ name: 'id', type: 'int', required: true }])
    const prepared = redisStrategy.prepare(
      snippet,
      { id: 42 },
      { engine: 'redis', noLimit: false }
    )
    expect(prepared.driver.sql).toBe('HGETALL user:42')
    expect(prepared.driver.values).toEqual([])
  })

  test('LRANGE 0 -1 capped to 1000', () => {
    const snippet = redisSnippet('LRANGE :key 0 -1', [
      { name: 'key', type: 'string', required: true },
    ])
    const prepared = redisStrategy.prepare(
      snippet,
      { key: 'mylist' },
      { engine: 'redis', noLimit: false }
    )
    expect(prepared.driver.sql).toBe('LRANGE mylist 0 1000')
    expect(prepared.warnings.length).toBeGreaterThan(0)
  })

  test('--no-limit preserves command', () => {
    const snippet = redisSnippet('LRANGE :key 0 -1', [
      { name: 'key', type: 'string', required: true },
    ])
    const prepared = redisStrategy.prepare(
      snippet,
      { key: 'mylist' },
      { engine: 'redis', noLimit: true }
    )
    expect(prepared.driver.sql).toBe('LRANGE mylist 0 -1')
  })
})
