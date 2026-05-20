/**
 * Redis parity-pack integration tests (v1.21.0) — drives a real Bun.RedisClient
 * against the docker-compose.test.yml redis service, exercising the query-path
 * size guard and blacklist enforcement end-to-end.
 *
 * To skip: set SKIP_INTEGRATION_TESTS=true, or simply run without a reachable Redis.
 */
import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'bun:test'
import { AdapterFactory } from 'src/adapters'
import { RedisAdapter } from 'src/adapters/redis-adapter'
import { BlacklistRejection } from 'src/adapters/redis/types'
import type { ConnectionOptions, QueryableAdapter } from 'src/adapters/types'
import { shouldSkipTests } from './helpers'

const options: ConnectionOptions = {
  system: 'redis',
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  user: '',
  password: process.env.REDIS_PASSWORD || '',
  database: process.env.REDIS_DB || '0',
  timeout: 2000,
}

let SKIP = false

async function withRaw(fn: (a: RedisAdapter) => Promise<void>): Promise<void> {
  const a = new RedisAdapter(options)
  await a.connect()
  try {
    await fn(a)
  } finally {
    await a.disconnect()
  }
}

describe('Redis parity pack — query path [v1.21.0]', () => {
  beforeAll(async () => {
    SKIP = await shouldSkipTests(options)
    if (SKIP) console.log('⏭ Redis not reachable — skipping parity integration tests')
  })

  beforeEach(async () => {
    if (SKIP) return
    await withRaw(async (a) => {
      await a.execute('FLUSHDB')
      await a.execute('SET safe:k v')
      await a.execute('MSET secrets:a 1 secrets:b 2')
      const hashArgs: string[] = []
      for (let i = 0; i < 1500; i++) hashArgs.push(`f${i}`, `v${i}`)
      await a.execute(`HSET bighash ${hashArgs.join(' ')}`)
      const listArgs = Array.from({ length: 2000 }, (_, i) => String(i)).join(' ')
      await a.execute(`RPUSH list ${listArgs}`)
    })
  })

  afterAll(async () => {
    if (SKIP) return
    await withRaw(async (a) => {
      await a.execute('FLUSHDB')
    })
  })

  function blacklisted(): QueryableAdapter {
    return AdapterFactory.createRedisAdapter(options, ['secrets:*'])
  }

  test('GET on safe key returns value with no warnings', async () => {
    if (SKIP) return
    const a = blacklisted()
    await a.connect()
    try {
      const r = await a.execute<{ value: string }>('GET safe:k')
      expect(r.rows[0]?.value).toBe('v')
      expect(r.warnings).toBeUndefined()
    } finally {
      await a.disconnect()
    }
  })

  test('GET on blacklisted key throws BlacklistRejection', async () => {
    if (SKIP) return
    const a = blacklisted()
    await a.connect()
    try {
      await expect(a.execute('GET secrets:a')).rejects.toBeInstanceOf(BlacklistRejection)
    } finally {
      await a.disconnect()
    }
  })

  test('MGET touching a blacklisted key is rejected entirely', async () => {
    if (SKIP) return
    const a = blacklisted()
    await a.connect()
    try {
      await expect(a.execute('MGET safe:k secrets:a')).rejects.toBeInstanceOf(BlacklistRejection)
    } finally {
      await a.disconnect()
    }
  })

  test('KEYS pattern overlapping blacklist is rejected', async () => {
    if (SKIP) return
    const a = blacklisted()
    await a.connect()
    try {
      await expect(a.execute('KEYS secrets:*')).rejects.toBeInstanceOf(BlacklistRejection)
    } finally {
      await a.disconnect()
    }
  })

  test('listCollections filters blacklisted keys', async () => {
    if (SKIP) return
    const a = blacklisted() as unknown as RedisAdapter
    await a.connect()
    try {
      const cols = await a.listCollections()
      const names = cols.map((c) => c.name)
      expect(names).toContain('safe:k')
      expect(names.some((n) => n.startsWith('secrets:'))).toBe(false)
    } finally {
      await a.disconnect()
    }
  })

  test('HGETALL on a 1500-field hash truncates to 1000 with warning', async () => {
    if (SKIP) return
    await withRaw(async (a) => {
      const r = await a.execute<Record<string, unknown>>('HGETALL bighash')
      const row = r.rows[0] as Record<string, unknown>
      expect(Object.keys(row).length).toBe(1000)
      expect(r.warnings?.some((w) => w.code === 'REDIS_SIZE_TRUNCATE')).toBe(true)
    })
  })

  test('LRANGE 0 -1 on a 2000-element list is rewritten + capped at 1000', async () => {
    if (SKIP) return
    await withRaw(async (a) => {
      const r = await a.execute('LRANGE list 0 -1')
      expect(r.rows.length).toBe(1000)
      expect(r.warnings?.some((w) => w.code === 'REDIS_SIZE_REWRITE')).toBe(true)
    })
  })

  test('--no-limit returns the full 1500-field hash', async () => {
    if (SKIP) return
    await withRaw(async (a) => {
      const r = await a.execute<Record<string, unknown>>('HGETALL bighash', undefined, {
        noLimit: true,
      })
      const row = r.rows[0] as Record<string, unknown>
      expect(Object.keys(row).length).toBe(1500)
      expect(r.warnings).toBeUndefined()
    })
  })
})
