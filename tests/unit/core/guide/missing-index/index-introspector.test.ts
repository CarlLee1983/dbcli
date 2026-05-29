// tests/unit/core/guide/missing-index/index-introspector.test.ts
import { test, expect } from 'bun:test'
import { makeIndexIntrospector } from '@/core/guide/missing-index/index-introspector'
import type { DatabaseAdapter, TableSchema } from '@/adapters/types'

function fakeAdapter(map: Record<string, TableSchema['indexes']>): DatabaseAdapter {
  return {
    getTableSchema: async (t: string) =>
      ({ name: t, columns: [], indexes: map[t] ?? [] }) as TableSchema,
  } as unknown as DatabaseAdapter
}

test('returns existing indexes for a table', async () => {
  const adapter = fakeAdapter({
    betting_logs: [{ name: 'idx_user', columns: ['user_id'], unique: false }],
  })
  const introspect = makeIndexIntrospector(adapter)
  const out = await introspect('betting_logs')
  expect(out).toEqual([{ name: 'idx_user', columns: ['user_id'], unique: false }])
})

test('returns [] when adapter throws (graceful degradation)', async () => {
  const adapter = {
    getTableSchema: async () => {
      throw new Error('no such table')
    },
  } as unknown as DatabaseAdapter
  const introspect = makeIndexIntrospector(adapter)
  expect(await introspect('ghost')).toEqual([])
})

test('returns [] when table has no indexes field', async () => {
  const adapter = {
    getTableSchema: async () => ({ name: 't', columns: [] }),
  } as unknown as DatabaseAdapter
  const introspect = makeIndexIntrospector(adapter)
  expect(await introspect('t')).toEqual([])
})
