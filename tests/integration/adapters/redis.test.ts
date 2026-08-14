/**
 * Redis adapter integration tests — drives a real Bun.RedisClient against
 * the docker-compose.test.yml redis service.
 *
 * Connection via env vars (fallback to docker-compose.test.yml defaults):
 *   REDIS_HOST=localhost REDIS_PORT=6379 REDIS_DB=0
 *
 * To skip: Set SKIP_INTEGRATION_TESTS=true
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'bun:test'
import { RedisAdapter } from 'src/adapters/redis-adapter'
import { ConnectionError } from 'src/adapters'
import type { ConnectionOptions } from 'src/adapters/types'
import { shouldSkipTests, REDIS_HOST, REDIS_PORT } from '../helpers'

let SKIP_TESTS = false

const validOptions: ConnectionOptions = {
  system: 'redis',
  host: REDIS_HOST,
  port: REDIS_PORT,
  user: '',
  password: process.env.REDIS_PASSWORD || '',
  database: process.env.REDIS_DB || '0',
  timeout: 2000,
}

const unreachableOptions: ConnectionOptions = {
  system: 'redis',
  host: '127.0.0.1',
  port: 1,
  user: '',
  password: '',
  database: '0',
  timeout: 500,
}

describe('Redis Adapter Integration Tests', () => {
  beforeAll(async () => {
    SKIP_TESTS = await shouldSkipTests(validOptions)
    if (SKIP_TESTS) {
      console.log('⏭ Redis not reachable — skipping integration tests')
    }
  })

  beforeEach(async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      await adapter.execute('FLUSHDB')
    } finally {
      await adapter.disconnect()
    }
  })

  afterAll(async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      await adapter.execute('FLUSHDB')
    } finally {
      await adapter.disconnect()
    }
  })

  test('connect() succeeds and reports server version', async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      expect(await adapter.testConnection()).toBe(true)
      const version = await adapter.getServerVersion()
      expect(version).toMatch(/^\d+\.\d+/)
    } finally {
      await adapter.disconnect()
    }
  })

  test('connect() raises ConnectionError on unreachable host', async () => {
    const adapter = new RedisAdapter(unreachableOptions)
    let caught: unknown
    try {
      await adapter.connect()
    } catch (err) {
      caught = err
    } finally {
      await adapter.disconnect()
    }
    expect(caught).toBeInstanceOf(ConnectionError)
  })

  test('execute() round-trips SET and GET', async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      await adapter.execute('SET integration:greet "hello world"')
      const result = await adapter.execute<{ value: string }>('GET integration:greet')
      expect(result.rows[0]?.value).toBe('hello world')
    } finally {
      await adapter.disconnect()
    }
  })

  test('listCollections() lists keys via SCAN', async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      await adapter.execute('SET k:1 v1')
      await adapter.execute('SET k:2 v2')
      await adapter.execute('SET k:3 v3')
      const keys = await adapter.listCollections()
      const names = keys.map((k) => k.name).sort()
      expect(names).toContain('k:1')
      expect(names).toContain('k:2')
      expect(names).toContain('k:3')
    } finally {
      await adapter.disconnect()
    }
  })

  test('getTableSchema() inspects a string key', async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      await adapter.execute('SET integration:s hello')
      const schema = await adapter.getTableSchema('integration:s')
      expect(schema.name).toBe('integration:s')
      expect(schema.estimatedRowCount).toBe(5)
      const cols = Object.fromEntries(schema.columns.map((c) => [c.name, c.type]))
      expect(cols.type).toBe('string')
    } finally {
      await adapter.disconnect()
    }
  })

  test('getTableSchema() inspects a hash key with field sample', async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      await adapter.insert('integration:user:1', {
        __type: 'hash',
        fields: { name: 'Alice', email: 'a@example.com' },
      })
      const schema = await adapter.getTableSchema('integration:user:1')
      expect(schema.estimatedRowCount).toBe(2)
      const cols = Object.fromEntries(schema.columns.map((c) => [c.name, c.type]))
      expect(cols.type).toBe('hash')
      expect(String(cols.sample)).toContain('name')
    } finally {
      await adapter.disconnect()
    }
  })

  test('insert/update/delete round-trip on a hash', async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      await adapter.insert('integration:hash', {
        __type: 'hash',
        fields: { a: '1', b: '2' },
      })
      const before = await adapter.execute<Record<string, unknown>>('HGETALL integration:hash')
      expect(before.rows[0]).toEqual({ a: '1', b: '2' })

      await adapter.update('integration:hash', {}, { fields: { a: '10' } })
      const after = await adapter.execute<Record<string, unknown>>('HGETALL integration:hash')
      expect(after.rows[0]).toEqual({ a: '10', b: '2' })

      const deleted = await adapter.delete('integration:hash', { field: 'b' })
      expect(deleted.affectedRows).toBe(1)
      const final = await adapter.execute<Record<string, unknown>>('HGETALL integration:hash')
      expect(final.rows[0]).toEqual({ a: '10' })
    } finally {
      await adapter.disconnect()
    }
  })

  test('insert/update/delete round-trip on a list', async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      // Insert elements into a list
      await adapter.insert('integration:list', {
        __type: 'list',
        values: ['item1', 'item2'],
      })
      const before = await adapter.execute<{ value: string }>('LRANGE integration:list 0 -1')
      expect(before.rows.map((r) => r.value)).toEqual(['item1', 'item2'])

      // Update (append) to the list
      await adapter.update('integration:list', {}, { __type: 'list', values: ['item3'] })
      const after = await adapter.execute<{ value: string }>('LRANGE integration:list 0 -1')
      expect(after.rows.map((r) => r.value)).toEqual(['item1', 'item2', 'item3'])

      // Delete an element from the list
      const deleted = await adapter.delete('integration:list', { value: 'item2' })
      expect(deleted.affectedRows).toBe(1)
      const final = await adapter.execute<{ value: string }>('LRANGE integration:list 0 -1')
      expect(final.rows.map((r) => r.value)).toEqual(['item1', 'item3'])
    } finally {
      await adapter.disconnect()
    }
  })

  test('insert/update/delete round-trip on a set', async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      // Insert into a set
      await adapter.insert('integration:set', {
        __type: 'set',
        values: ['member1', 'member2'],
      })
      const before = await adapter.execute<{ value: string }>('SMEMBERS integration:set')
      const beforeValues = before.rows.map((r) => r.value).sort()
      expect(beforeValues).toEqual(['member1', 'member2'])

      // Update (add) to the set
      await adapter.update('integration:set', {}, { __type: 'set', values: ['member3'] })
      const after = await adapter.execute<{ value: string }>('SMEMBERS integration:set')
      expect(after.rows.map((r) => r.value)).toContain('member3')

      // Delete from the set
      const deleted = await adapter.delete('integration:set', { value: 'member1' })
      expect(deleted.affectedRows).toBe(1)
      const final = await adapter.execute<{ value: string }>('SMEMBERS integration:set')
      expect(final.rows.map((r) => r.value)).not.toContain('member1')
    } finally {
      await adapter.disconnect()
    }
  })

  test('insert/update/delete round-trip on a zset', async () => {
    if (SKIP_TESTS) return
    const adapter = new RedisAdapter(validOptions)
    await adapter.connect()
    try {
      // Insert into a sorted set
      await adapter.insert('integration:zset', {
        __type: 'zset',
        members: { m1: 10, m2: 20 },
      })
      const before = await adapter.execute<{ value: string }>('ZRANGE integration:zset 0 -1')
      expect(before.rows.map((r) => r.value)).toEqual(['m1', 'm2'])

      // Update (add/change score)
      await adapter.update('integration:zset', {}, { __type: 'zset', members: { m1: 30 } })
      const after = await adapter.execute<{ value: string }>('ZRANGE integration:zset 0 -1')
      expect(after.rows.map((r) => r.value)).toEqual(['m2', 'm1']) // m1 now has higher score

      // Delete from zset
      const deleted = await adapter.delete('integration:zset', { value: 'm2' })
      expect(deleted.affectedRows).toBe(1)
      const final = await adapter.execute<{ value: string }>('ZRANGE integration:zset 0 -1')
      expect(final.rows.map((r) => r.value)).toEqual(['m1'])
    } finally {
      await adapter.disconnect()
    }
  })
})
