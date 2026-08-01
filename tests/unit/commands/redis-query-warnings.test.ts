/**
 * Redis size-guard warnings must reach the caller.
 *
 * The Redis adapter already computes exactly the fact issue #4 is about — the
 * reply was trimmed — but the `query` branch dropped `result.warnings` on the
 * floor, so a 1000-entry HGETALL looked complete. `dbcli q` printed them; the
 * docs promised them. This pins both the stderr diagnostic and the same
 * `truncated` / `limit_applied` metadata every other engine reports.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { AdapterFactory } from '@/adapters'
import { queryCommand } from '@/commands/query'
import type { RedisWarning } from '@/adapters/types'

const redisConfig = {
  connection: {
    system: 'redis' as const,
    host: '127.0.0.1',
    port: 6379,
    user: '',
    password: '',
    database: '0',
  },
  permission: 'query-only' as const,
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} },
}

function adapterReturning(rows: Record<string, unknown>[], warnings?: RedisWarning[]) {
  return {
    async connect() {},
    async disconnect() {},
    async execute() {
      return { rows, affectedRows: rows.length, ...(warnings ? { warnings } : {}) }
    },
  }
}

describe('Redis query surfaces size-guard warnings', () => {
  let configSpy: any
  let adapterSpy: any
  let logSpy: any
  let errSpy: any
  let stdout: string[]
  let stderr: string[]

  beforeEach(() => {
    stdout = []
    stderr = []
    logSpy = spyOn(console, 'log').mockImplementation((m: any) => {
      stdout.push(String(m))
    })
    errSpy = spyOn(console, 'error').mockImplementation((m: any) => {
      stderr.push(String(m))
    })
    configSpy = spyOn(configModule, 'read').mockResolvedValue(redisConfig as any)
  })

  afterEach(() => {
    configSpy?.mockRestore()
    adapterSpy?.mockRestore()
    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  test('a truncated reply reports truncation in the JSON metadata', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ value: i }))
    adapterSpy = spyOn(AdapterFactory, 'createRedisAdapter').mockReturnValue(
      adapterReturning(rows, [
        { code: 'REDIS_SIZE_TRUNCATE', command: 'HGETALL', kept: 1000, droppedAtLeast: 412 },
      ]) as any
    )

    await queryCommand('HGETALL bighash', { format: 'json' } as any)

    const payload = JSON.parse(stdout.join('\n'))
    expect(payload.metadata.truncated).toBe(true)
    expect(payload.metadata.limit_applied).toBe(1000)
  })

  test('a truncated reply says so in the table footer', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ value: i }))
    adapterSpy = spyOn(AdapterFactory, 'createRedisAdapter').mockReturnValue(
      adapterReturning(rows, [
        { code: 'REDIS_SIZE_TRUNCATE', command: 'HGETALL', kept: 1000, droppedAtLeast: 412 },
      ]) as any
    )

    await queryCommand('HGETALL bighash', { format: 'table' } as any)

    expect(stdout.join('\n')).toContain('truncated; limit 1000')
  })

  test('rewrite and blacklist warnings are reported on stderr', async () => {
    adapterSpy = spyOn(AdapterFactory, 'createRedisAdapter').mockReturnValue(
      adapterReturning(
        [{ value: 'ok' }],
        [
          {
            code: 'REDIS_SIZE_REWRITE',
            command: 'LRANGE',
            original: ['LRANGE', 'k', '0', '-1'],
            rewritten: ['LRANGE', 'k', '0', '999'],
          },
          { code: 'REDIS_BLACKLIST_FILTERED', count: 3 },
        ]
      ) as any
    )

    await queryCommand('LRANGE k 0 -1', { format: 'json' } as any)

    const errors = stderr.join('\n')
    expect(errors).toContain('REDIS_SIZE_REWRITE')
    expect(errors).toContain('REDIS_BLACKLIST_FILTERED')
  })

  test('an untruncated reply reports no truncation', async () => {
    adapterSpy = spyOn(AdapterFactory, 'createRedisAdapter').mockReturnValue(
      adapterReturning([{ value: 'ok' }]) as any
    )

    await queryCommand('GET k', { format: 'json' } as any)

    const payload = JSON.parse(stdout.join('\n'))
    expect(payload.metadata?.truncated).toBeUndefined()
  })

  test('--recovery keeps stderr clean', async () => {
    adapterSpy = spyOn(AdapterFactory, 'createRedisAdapter').mockReturnValue(
      adapterReturning([{ value: 'ok' }], [{ code: 'REDIS_BLACKLIST_FILTERED', count: 1 }]) as any
    )

    await queryCommand('GET k', { format: 'json', recovery: true } as any)

    expect(stderr.join('\n')).toBe('')
  })
})
