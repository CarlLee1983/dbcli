/**
 * PostgreSQL EXPLAIN adapter — JSON plan tree → ExplainRow[].
 */
import { test, expect } from 'bun:test'
import { runPgExplain } from '@/adapters/explain/postgresql'
import type { DatabaseAdapter } from '@/adapters/types'

function adapterReturning(jsonPayload: unknown): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>() => ({
      rows: [{ 'QUERY PLAN': JSON.stringify(jsonPayload) } as T],
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
    getServerVersion: async () => '15.4',
  }
}

test('runPgExplain: single Seq Scan node', async () => {
  const tree = [
    {
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 'orders',
        'Plan Rows': 50000,
        'Startup Cost': 0,
        'Total Cost': 12345.6,
      },
    },
  ]
  const plan = await runPgExplain(adapterReturning(tree), 'SELECT * FROM orders', {})
  expect(plan.system).toBe('postgresql')
  expect(plan.rows).toHaveLength(1)
  expect(plan.rows[0]?.driving).toBe('orders')
  expect(plan.rows[0]?.accessType).toBe('Seq Scan')
  expect(plan.rows[0]?.key).toBeNull()
  expect(plan.rows[0]?.rows).toBe(50000)
  expect(plan.rows[0]?.cost?.total).toBe(12345.6)
})

test('runPgExplain: Index Scan extracts Index Name as key', async () => {
  const tree = [
    {
      Plan: {
        'Node Type': 'Index Scan',
        'Relation Name': 'users',
        'Index Name': 'users_pkey',
        'Plan Rows': 1,
        'Startup Cost': 0,
        'Total Cost': 8.3,
      },
    },
  ]
  const plan = await runPgExplain(adapterReturning(tree), 'SELECT * FROM users WHERE id=1', {})
  expect(plan.rows[0]?.key).toBe('users_pkey')
  expect(plan.rows[0]?.accessType).toBe('Index Scan')
})

test('runPgExplain: nested Plans recursively flattens', async () => {
  const tree = [
    {
      Plan: {
        'Node Type': 'Nested Loop',
        'Plan Rows': 500,
        'Startup Cost': 0,
        'Total Cost': 999.9,
        Plans: [
          {
            'Node Type': 'Seq Scan',
            'Relation Name': 'orders',
            'Plan Rows': 100,
            'Startup Cost': 0,
            'Total Cost': 50,
          },
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'users',
            'Index Name': 'users_pkey',
            'Plan Rows': 1,
            'Startup Cost': 0,
            'Total Cost': 8.3,
          },
        ],
      },
    },
  ]
  const plan = await runPgExplain(adapterReturning(tree), 'SELECT 1', {})
  expect(plan.rows).toHaveLength(3)
  expect(plan.rows.map((r) => r.accessType)).toEqual(['Nested Loop', 'Seq Scan', 'Index Scan'])
})

test('runPgExplain: --analyze appends ANALYZE option', async () => {
  let capturedSql = ''
  const adapter: DatabaseAdapter = {
    ...adapterReturning([{ Plan: { 'Node Type': 'Result', 'Plan Rows': 1, 'Startup Cost': 0, 'Total Cost': 0 } }]),
    execute: async <T = Record<string, unknown>>(sql: string) => {
      capturedSql = sql
      return {
        rows: [
          {
            'QUERY PLAN': JSON.stringify([
              { Plan: { 'Node Type': 'Result', 'Plan Rows': 1, 'Startup Cost': 0, 'Total Cost': 0 } },
            ]),
          } as T,
        ],
        affectedRows: 0,
      }
    },
  }
  await runPgExplain(adapter, 'SELECT 1', { analyze: true })
  expect(capturedSql).toMatch(/EXPLAIN\s*\(\s*ANALYZE,\s*BUFFERS,\s*FORMAT\s+JSON\s*\)\s+SELECT 1/i)
})

test('runPgExplain: vanilla mode omits ANALYZE', async () => {
  let capturedSql = ''
  const adapter: DatabaseAdapter = {
    ...adapterReturning([{ Plan: { 'Node Type': 'Result', 'Plan Rows': 1, 'Startup Cost': 0, 'Total Cost': 0 } }]),
    execute: async <T = Record<string, unknown>>(sql: string) => {
      capturedSql = sql
      return {
        rows: [
          {
            'QUERY PLAN': JSON.stringify([
              { Plan: { 'Node Type': 'Result', 'Plan Rows': 1, 'Startup Cost': 0, 'Total Cost': 0 } },
            ]),
          } as T,
        ],
        affectedRows: 0,
      }
    },
  }
  await runPgExplain(adapter, 'SELECT 1', {})
  expect(capturedSql).toMatch(/EXPLAIN\s*\(\s*FORMAT\s+JSON\s*\)\s+SELECT 1/i)
  expect(capturedSql).not.toMatch(/ANALYZE/i)
})

test('runPgExplain: Actual Rows surfaced as actualRows when present', async () => {
  const tree = [
    {
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 't',
        'Plan Rows': 10,
        'Actual Rows': 500,
        'Startup Cost': 0,
        'Total Cost': 1,
      },
    },
  ]
  const plan = await runPgExplain(adapterReturning(tree), 'SELECT 1', { analyze: true })
  expect(plan.rows[0]?.actualRows).toBe(500)
})
