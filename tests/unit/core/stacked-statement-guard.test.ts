/**
 * Regression guard: permission classification reads only the first keyword of a
 * statement, while the PostgreSQL adapter forwards raw SQL through the simple
 * query protocol, which executes every semicolon-separated statement. A stacked
 * statement therefore classified as SELECT and ran a trailing write under
 * `permission: query-only`.
 */

import { describe, test, expect } from 'bun:test'
import { QueryExecutor } from '@/core/query-executor'
import { checkPermission, containsMultipleStatements } from '@/core/permission-guard'
import type { DatabaseAdapter } from '@/adapters/types'

function makeSpyAdapter(): { adapter: DatabaseAdapter; calls: () => string[] } {
  const captured: string[] = []
  const adapter: DatabaseAdapter = {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>(sql: string) => {
      captured.push(sql)
      return { rows: [] as T[], affectedRows: 0 }
    },
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
  return { adapter, calls: () => captured }
}

describe('stacked statements are refused before reaching the adapter', () => {
  test('query-only rejects a SELECT that carries a trailing DELETE', async () => {
    const { adapter, calls } = makeSpyAdapter()
    const executor = new QueryExecutor(adapter, 'query-only')

    await expect(
      executor.execute('SELECT 1 LIMIT 1; DELETE FROM users')
    ).rejects.toThrow(/multiple statements|multi-statement/i)
    expect(calls()).toEqual([])
  })

  test('data-admin rejects a stacked DDL that its permission level forbids', async () => {
    const { adapter, calls } = makeSpyAdapter()
    const executor = new QueryExecutor(adapter, 'data-admin')

    await expect(
      executor.execute('SELECT 1 LIMIT 1; DROP TABLE users')
    ).rejects.toThrow(/multiple statements|multi-statement/i)
    expect(calls()).toEqual([])
  })

  test('a trailing semicolon is still a single statement', async () => {
    const { adapter, calls } = makeSpyAdapter()
    const executor = new QueryExecutor(adapter, 'query-only')

    await executor.execute('SELECT * FROM users;')
    expect(calls()).toHaveLength(1)
  })

  test('a semicolon inside a string literal is not a statement separator', async () => {
    const { adapter, calls } = makeSpyAdapter()
    const executor = new QueryExecutor(adapter, 'query-only')

    await executor.execute("SELECT * FROM users WHERE note = 'a;b'")
    expect(calls()).toHaveLength(1)
  })

  test('classification refuses to label a stacked statement as a plain SELECT', () => {
    const result = checkPermission('SELECT 1; DELETE FROM users', 'query-only')
    expect(result.allowed).toBe(false)
  })
})

/**
 * The first version of this guard stripped comments with a string-blind regex
 * before the dialect-aware pass, and treated "every dialect agrees" as the test
 * for a separator. Both were fail-open: a `--` inside a literal deleted the rest
 * of the string before it was examined, and `#` is a comment in MySQL but an
 * operator in PostgreSQL, so one `#` silenced the check for a Postgres query.
 */
describe('stacking cannot be hidden from the guard', () => {
  const stacked = [
    ['a dash-dash sequence inside a string literal', "SELECT 'x--' AS a LIMIT 1;\nDELETE FROM users;\n"],
    ['a block-comment opener inside a string literal', "SELECT 'a/*' AS a LIMIT 1; DELETE FROM users; SELECT '*/' AS b"],
    ['a # operator that only MySQL reads as a comment', "SELECT data #> '{a}' FROM t LIMIT 1; DELETE FROM users"],
  ] as const

  for (const [description, sql] of stacked) {
    test(`refuses ${description}`, async () => {
      const { adapter, calls } = makeSpyAdapter()
      const executor = new QueryExecutor(adapter, 'query-only', undefined, undefined, {
        dialect: 'postgresql',
      })

      await expect(executor.execute(sql)).rejects.toThrow(/multiple statements|multi-statement/i)
      expect(calls()).toEqual([])
    })
  }

  test('a dialect-specific literal is still not a separator', () => {
    // $$…$$ is a string in PostgreSQL; backticks quote an identifier in MySQL.
    expect(containsMultipleStatements('SELECT $$a;b$$ AS v', 'postgresql')).toBe(false)
    expect(containsMultipleStatements('SELECT 1 AS `a;DELETE`', 'mysql')).toBe(false)
  })

  test('an unknown dialect fails closed', () => {
    // With no dialect to judge by, any reading that sees a separator wins.
    expect(containsMultipleStatements('SELECT data #> \'{a}\' FROM t; DELETE FROM users')).toBe(true)
  })
})
