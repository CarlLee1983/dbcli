import { test, expect } from 'bun:test'
import { DbcliConfigSchema, DbcliConfigV2Schema } from '@/utils/validation'

/**
 * This file used to open with an assertion that `createRedisAdapter` returns an
 * object with a `setMaskRules` method. That passed for the whole time
 * `dbcli query` was returning plaintext for a masked key: the factory could
 * forward rules, and six of eight call sites never gave it any.
 *
 * The behavioural assertion now lives in
 * `tests/unit/adapters/redis-mask-from-config.test.ts`, and the omission it
 * covered is unrepresentable since the factory started taking the config. What
 * stays here is the other half — that the schemas keep `redis.mask` at all.
 */

test('DbcliConfigSchema preserves redis.mask block', () => {
  const parsed = DbcliConfigSchema.parse({
    connection: { system: 'redis', host: 'localhost', port: 6379 },
    permission: 'query-only',
    redis: { mask: [{ keyPattern: 'user:*', fields: ['password'] }] },
  })
  expect(parsed.redis?.mask).toEqual([{ keyPattern: 'user:*', fields: ['password'] }])
})

test('DbcliConfigV2Schema preserves redis.mask block', () => {
  const parsed = DbcliConfigV2Schema.parse({
    version: 2,
    default: 'main',
    connections: {
      main: { system: 'redis', host: 'localhost', port: 6379, permission: 'query-only' },
    },
    redis: { mask: [{ keyPattern: 'secret:*' }] },
  })
  expect(parsed.redis?.mask).toEqual([{ keyPattern: 'secret:*' }])
})
