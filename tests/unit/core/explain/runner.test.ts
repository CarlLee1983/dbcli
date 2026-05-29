import { test, expect } from 'bun:test'
import { runQueryExplain } from '@/core/explain/runner'
import type { DatabaseAdapter } from '@/adapters/types'

function mysqlAdapter(): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>() => ({
      rows: [
        {
          id: 1,
          table: 'orders',
          type: 'ALL',
          key: null,
          rows: 1_500_000,
          filtered: 100,
          Extra: 'Using where; Using filesort',
        } as T,
      ],
      affectedRows: 0,
    }),
    listTables: async () => [],
    getTableSchema: async () => ({ name: '', columns: [], rowCount: 0, primaryKey: undefined, foreignKeys: [] }),
    testConnection: async () => true,
    getServerVersion: async () => '10.11.6-MariaDB',
  }
}

test('runQueryExplain: ties adapter EXPLAIN + annotation', async () => {
  const plan = await runQueryExplain('mariadb', mysqlAdapter(), 'SELECT * FROM orders', {})
  expect(plan.rows[0]?.annotations.some((a) => a.rule === 'full-scan')).toBe(true)
  expect(plan.rows[0]?.annotations.some((a) => a.rule === 'filesort')).toBe(true)
})

test('runQueryExplain: queryLabel passes through when provided', async () => {
  const plan = await runQueryExplain('mariadb', mysqlAdapter(), 'SELECT 1', {}, 'lbl-1')
  expect(plan.queryLabel).toBe('lbl-1')
  expect(plan.rows[0]?.queryLabel).toBe('lbl-1')
})

test('runQueryExplain: no label → no queryLabel field', async () => {
  const plan = await runQueryExplain('mariadb', mysqlAdapter(), 'SELECT 1', {})
  expect(plan.queryLabel).toBeUndefined()
  expect(plan.rows[0]?.queryLabel).toBeUndefined()
})
