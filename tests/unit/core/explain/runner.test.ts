import { test, expect } from 'bun:test'
import { runQueryExplain } from '@/core/explain/runner'
import type { DatabaseAdapter, SqlExecutionMode } from '@/adapters/types'

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

test('runQueryExplain: ties adapter EXPLAIN + annotation', async () => {
  const plan = await runQueryExplain('mariadb', mysqlAdapter(), 'SELECT * FROM orders', {})
  expect(plan.rows[0]?.annotations.some((a) => a.rule === 'full-scan')).toBe(true)
  expect(plan.rows[0]?.annotations.some((a) => a.rule === 'filesort')).toBe(true)
})

test('runQueryExplain: forwards native read-only mode to analyzed execution', async () => {
  const adapter = mysqlAdapter()
  let sqlMode: string | undefined
  const execute = adapter.execute
  adapter.execute = (async <T>(
    sql: string,
    params?: (string | number | boolean | null)[],
    options?: { noLimit?: boolean; sqlMode?: SqlExecutionMode }
  ) => {
    sqlMode = options?.sqlMode
    return execute<T>(sql, params, options)
  }) as DatabaseAdapter['execute']

  await runQueryExplain('mariadb', adapter, 'SELECT 1', {
    analyze: true,
    executionMode: 'native-read-only',
  })

  expect(sqlMode).toBe('native-read-only')
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

test.each([
  'UPDATE users SET active = false',
  'DELETE FROM users',
  'INSERT INTO users (id) VALUES (1)',
  'CREATE TABLE scratch (id integer)',
  'WITH changed AS (UPDATE users SET active = false RETURNING id) SELECT id FROM changed',
])('runQueryExplain: --analyze rejects write-capable SQL before adapter execution', async (sql) => {
  let executions = 0
  const adapter = mysqlAdapter()
  adapter.execute = async () => {
    executions++
    throw new Error('adapter must not execute')
  }

  await expect(runQueryExplain('postgresql', adapter, sql, { analyze: true })).rejects.toThrow(
    '--analyze requires a proven read-only SELECT'
  )
  expect(executions).toBe(0)
})

test.each([
  ['mysql', 'SELECT @session_value := 1'],
  ['mariadb', 'SELECT @session_value := 1'],
] as const)(
  'runQueryExplain: --analyze rejects session assignment before adapter execution (%s)',
  async (system, sql) => {
    let executions = 0
    const adapter = mysqlAdapter()
    adapter.execute = async () => {
      executions++
      throw new Error('adapter must not execute')
    }

    await expect(runQueryExplain(system, adapter, sql, { analyze: true })).rejects.toThrow(
      '--analyze requires a proven read-only SELECT'
    )
    expect(executions).toBe(0)
  }
)

test('runQueryExplain: --analyze preserves proven read-only SELECT execution', async () => {
  let executions = 0
  const adapter = mysqlAdapter()
  const execute = adapter.execute
  adapter.execute = async (...args) => {
    executions++
    return execute(...args)
  }

  await runQueryExplain('mariadb', adapter, 'SELECT 1', { analyze: true })
  expect(executions).toBe(1)
})
