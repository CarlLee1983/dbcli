import { test, expect } from 'bun:test'
import { buildEsExportRows } from '@/commands/export'

function dslAdapter() {
  return {
    connect: async () => {},
    disconnect: async () => {},
    request: async () => ({}),
    execute: async () => ({
      rows: [{ _id: '1', name: 'a' }],
      rowCount: 1,
      columnNames: ['_id', 'name'],
      affectedRows: 1,
    }),
  }
}

test('DSL source uses adapter.execute with the index', async () => {
  const { rows, target } = await buildEsExportRows(
    '{"query":{"match_all":{}}}',
    { index: 'users', noLimit: false, limit: 1000 },
    dslAdapter() as never
  )
  expect(target).toBe('users')
  expect(rows).toEqual([{ _id: '1', name: 'a' }])
})

test('bare index source uses scroll', async () => {
  const batches = [
    { _scroll_id: 's1', hits: { hits: [{ _id: '1', _source: { a: 1 } }] } },
    { _scroll_id: 's2', hits: { hits: [] } },
  ]
  let i = 0
  const scrollAdapter = {
    connect: async () => {},
    disconnect: async () => {},
    request: async () => batches[Math.min(i++, batches.length - 1)],
    execute: async () => {
      throw new Error('should not call execute for bare index')
    },
  }
  const { rows, target } = await buildEsExportRows(
    'logs-2026',
    { noLimit: false, limit: 1000 },
    scrollAdapter as never
  )
  expect(target).toBe('logs-2026')
  expect(rows).toEqual([{ _id: '1', a: 1 }])
})
