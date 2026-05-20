import { test, expect } from 'bun:test'
import { RedisShellAdapter } from '@/adapters/redis-shell-adapter'
import type { RedisAdapter } from '@/adapters/redis-adapter'

test('RedisShellAdapter forwards listTables / execute to inner', async () => {
  const inner = {
    connect: async () => {},
    disconnect: async () => {},
    listCollections: async () => [{ name: 'a' }, { name: 'b' }],
    getTableSchema: async (n: string) => ({ name: n, columns: [] }),
    execute: async () => ({ rows: [{ value: 'OK' }], affectedRows: 1 }),
    testConnection: async () => true,
    getServerVersion: async () => '7.4.0',
  } as unknown as RedisAdapter
  const adapter = new RedisShellAdapter(inner)
  const tables = await adapter.listTables()
  expect(tables.map((t) => t.name)).toEqual(['a', 'b'])
  const r = await adapter.execute('GET k')
  expect(r.rows[0]).toEqual({ value: 'OK' })
})

test('RedisShellAdapter forwards noLimit option to inner.execute', async () => {
  let received: { noLimit?: boolean } | undefined
  const inner = {
    connect: async () => {},
    disconnect: async () => {},
    listCollections: async () => [],
    getTableSchema: async (n: string) => ({ name: n, columns: [] }),
    execute: async (_cmd: string, _params?: unknown[], opts?: { noLimit?: boolean }) => {
      received = opts
      return { rows: [], affectedRows: 0 }
    },
    testConnection: async () => true,
    getServerVersion: async () => '7.4.0',
  } as unknown as RedisAdapter
  const adapter = new RedisShellAdapter(inner)
  await adapter.execute('SCAN 0', undefined, { noLimit: true })
  expect(received).toEqual({ noLimit: true })
})
