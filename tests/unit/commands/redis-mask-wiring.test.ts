import { test, expect } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { ConnectionOptions } from '@/adapters/types'
import { DbcliConfigSchema, DbcliConfigV2Schema } from '@/utils/validation'

test('createRedisAdapter accepts and forwards mask rules', () => {
  const opts = { system: 'redis', host: 'localhost', port: 6379 } as unknown as ConnectionOptions
  const adapter = AdapterFactory.createRedisAdapter(
    opts,
    [],
    [{ keyPattern: 'user:*', fields: ['pw'] }]
  )
  expect(typeof (adapter as unknown as { setMaskRules: unknown }).setMaskRules).toBe('function')
})

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
