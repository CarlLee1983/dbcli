/**
 * MySQL/MariaDB EXPLAIN adapter — produces ExplainRow[] from raw EXPLAIN payload.
 */
import { test, expect } from 'bun:test'
import { runMysqlExplain } from '@/adapters/explain/mysql-mariadb'
import type { DatabaseAdapter } from '@/adapters/types'

function adapterReturning(rows: Record<string, unknown>[]): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>() => ({ rows: rows as T[], affectedRows: 0 }),
    listTables: async () => [],
    getTableSchema: async () => ({
      name: '',
      columns: [],
      rowCount: 0,
      primaryKey: undefined,
      foreignKeys: [],
    }),
    testConnection: async () => true,
    getServerVersion: async () => '10.11.6-MariaDB',
  }
}

test('runMysqlExplain: vanilla EXPLAIN payload normalizes one row', async () => {
  const adapter = adapterReturning([
    {
      id: 1,
      select_type: 'SIMPLE',
      table: 'betting_logs',
      type: 'ALL',
      possible_keys: null,
      key: null,
      key_len: null,
      ref: null,
      rows: 1500000,
      filtered: 100.0,
      Extra: 'Using where',
    },
  ])
  const plan = await runMysqlExplain(adapter, 'SELECT * FROM betting_logs WHERE x=1', {})
  expect(plan.rows).toHaveLength(1)
  expect(plan.rows[0]?.driving).toBe('betting_logs')
  expect(plan.rows[0]?.accessType).toBe('ALL')
  expect(plan.rows[0]?.key).toBeNull()
  expect(plan.rows[0]?.rows).toBe(1500000)
  expect(plan.rows[0]?.filtered).toBe(100.0)
  expect(plan.rows[0]?.extra).toEqual(['Using where'])
  expect(plan.system).toBe('mariadb')
  expect(plan.rows[0]?.annotations).toEqual([])
})

test('runMysqlExplain: --analyze issues ANALYZE SELECT instead of EXPLAIN', async () => {
  let capturedSql = ''
  const adapter: DatabaseAdapter = {
    ...adapterReturning([]),
    execute: async <T = Record<string, unknown>>(sql: string) => {
      capturedSql = sql
      return { rows: [] as T[], affectedRows: 0 }
    },
  }
  await runMysqlExplain(adapter, 'SELECT 1', { analyze: true })
  expect(capturedSql).toMatch(/^ANALYZE\s+SELECT\s+1$/i)
})

test('runMysqlExplain: vanilla mode prefixes with EXPLAIN', async () => {
  let capturedSql = ''
  const adapter: DatabaseAdapter = {
    ...adapterReturning([]),
    execute: async <T = Record<string, unknown>>(sql: string) => {
      capturedSql = sql
      return { rows: [] as T[], affectedRows: 0 }
    },
  }
  await runMysqlExplain(adapter, 'SELECT * FROM users', {})
  expect(capturedSql).toBe('EXPLAIN SELECT * FROM users')
})

test('runMysqlExplain: extra splits on semicolons + trims', async () => {
  const adapter = adapterReturning([
    {
      id: 1,
      table: 'orders',
      type: 'index',
      key: 'idx_status',
      rows: 100,
      filtered: 50,
      Extra: 'Using where; Using index; Using filesort',
    },
  ])
  const plan = await runMysqlExplain(adapter, 'SELECT 1', {})
  expect(plan.rows[0]?.extra).toEqual(['Using where', 'Using index', 'Using filesort'])
})

test('runMysqlExplain: missing/empty Extra → empty array', async () => {
  const adapter = adapterReturning([
    { id: 1, table: 'users', type: 'const', key: 'PRIMARY', rows: 1, filtered: 100, Extra: '' },
  ])
  const plan = await runMysqlExplain(adapter, 'SELECT 1', {})
  expect(plan.rows[0]?.extra).toEqual([])
})

test('runMysqlExplain: stores raw payload', async () => {
  const raw = [{ id: 1, table: 't', type: 'ALL', key: null, rows: 1, filtered: 100, Extra: null }]
  const adapter = adapterReturning(raw)
  const plan = await runMysqlExplain(adapter, 'SELECT 1', {})
  expect(plan.raw).toEqual(raw)
})

test('runMysqlExplain: explicit system=mysql', async () => {
  const adapter = adapterReturning([])
  const plan = await runMysqlExplain(adapter, 'SELECT 1', {}, 'mysql')
  expect(plan.system).toBe('mysql')
})
