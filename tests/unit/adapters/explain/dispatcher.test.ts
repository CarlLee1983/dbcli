import { test, expect } from 'bun:test'
import { runExplain } from '@/adapters/explain'
import type { DatabaseAdapter } from '@/adapters/types'

function stubAdapter(): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>() => ({
      rows: [
        {
          'QUERY PLAN': JSON.stringify([
            { Plan: { 'Node Type': 'Result', 'Plan Rows': 1, 'Startup Cost': 0, 'Total Cost': 0 } },
          ]),
        } as T,
      ],
      affectedRows: 0,
    }),
    listTables: async () => [],
    getTableSchema: async () => ({
      name: '',
      columns: [],
      rowCount: 0,
      primaryKey: undefined,
      foreignKeys: [],
    }),
    testConnection: async () => true,
    getServerVersion: async () => 'test',
  }
}

test('runExplain: postgresql → calls PG path', async () => {
  const plan = await runExplain('postgresql', stubAdapter(), 'SELECT 1', {})
  expect(plan.system).toBe('postgresql')
})

test('runExplain: mariadb → calls MySQL path with system=mariadb', async () => {
  const adapter: DatabaseAdapter = {
    ...stubAdapter(),
    execute: async <T = Record<string, unknown>>() => ({
      rows: [{ id: 1, table: 't', type: 'ALL', key: null, rows: 1, filtered: 100, Extra: '' } as T],
      affectedRows: 0,
    }),
  }
  const plan = await runExplain('mariadb', adapter, 'SELECT 1', {})
  expect(plan.system).toBe('mariadb')
})

test('runExplain: mysql → MySQL path with system=mysql', async () => {
  const adapter: DatabaseAdapter = {
    ...stubAdapter(),
    execute: async <T = Record<string, unknown>>() => ({
      rows: [{ id: 1, table: 't', type: 'ALL', key: null, rows: 1, filtered: 100, Extra: '' } as T],
      affectedRows: 0,
    }),
  }
  const plan = await runExplain('mysql', adapter, 'SELECT 1', {})
  expect(plan.system).toBe('mysql')
})

test('runExplain: unsupported system throws', async () => {
  await expect(runExplain('mongodb' as never, stubAdapter(), '{}', {})).rejects.toThrow(
    /EXPLAIN .* not supported/i
  )
})
