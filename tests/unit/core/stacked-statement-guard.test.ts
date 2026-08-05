/**
 * Regression guard: permission classification reads only the first keyword of a
 * statement, while the PostgreSQL adapter forwards raw SQL through the simple
 * query protocol, which executes every semicolon-separated statement. A stacked
 * statement therefore classified as SELECT and ran a trailing write under
 * `permission: query-only`.
 */

import { describe, test, expect } from 'bun:test'
import { QueryExecutor } from '@/core/query-executor'
import {
  checkPermission,
  containsMultipleStatements,
  findWriteKeyword,
} from '@/core/permission-guard'
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

/**
 * PostgreSQL identifiers may contain `$` after the first character, so `a$q$`
 * is one identifier — not `a` followed by a dollar-quoted string. Reading it as
 * a quote let everything up to the next `$q$` disappear from the guard while
 * the server still executed it.
 */
describe('a $ inside an identifier does not open a dollar-quoted string', () => {
  const payload = 'SELECT 1 AS a$q$ LIMIT 1; DELETE FROM users; SELECT 1 AS b$q$'

  test('the statement is still seen as stacked under PostgreSQL', () => {
    expect(containsMultipleStatements(payload, 'postgresql')).toBe(true)
    expect(checkPermission(payload, 'query-only', 'postgresql').allowed).toBe(false)
  })

  test('nothing reaches the adapter', async () => {
    const { adapter, calls } = makeSpyAdapter()
    const executor = new QueryExecutor(adapter, 'query-only', undefined, undefined, {
      dialect: 'postgresql',
    })
    await expect(executor.execute(payload)).rejects.toThrow(/multiple statements/i)
    expect(calls()).toEqual([])
  })

  test('a genuine dollar-quoted string is still a string', () => {
    expect(containsMultipleStatements('SELECT $q$a;b$q$ AS v', 'postgresql')).toBe(false)
    expect(containsMultipleStatements('SELECT $$a;b$$ AS v', 'postgresql')).toBe(false)
    // A dollar-quote may follow an operator or an open paren, not only whitespace.
    expect(containsMultipleStatements('SELECT ($$a;b$$) AS v', 'postgresql')).toBe(false)
  })

  test('a write hidden the same way is still found in a snippet', () => {
    const body =
      'WITH t AS (SELECT 1 AS a$q$), d AS (DELETE FROM users RETURNING 1 AS b$q$) SELECT * FROM d'
    expect(findWriteKeyword(body, ['postgresql'])).toBe('DELETE')
  })
})

describe('PostgreSQL block comments nest', () => {
  test('a nested comment containing a semicolon is one statement', () => {
    expect(
      containsMultipleStatements('SELECT 1 /* outer /* inner */ ; still comment */ FROM t', 'postgresql')
    ).toBe(false)
  })
})

/**
 * PostgreSQL identifiers are not ASCII-only: its lexer accepts any high byte as
 * an identifier character, so `café$q$` and `名前$q$` are single identifiers.
 * An ASCII-only token-boundary test reopened the bypass above for them.
 */
describe('a non-ASCII identifier is still an identifier', () => {
  const payloads = [
    'SELECT 1 AS café$q$ LIMIT 1; DELETE FROM users; SELECT 1 AS b$q$',
    'SELECT 1 AS 名前$q$ LIMIT 1; DROP TABLE users; SELECT 1 AS b$q$',
  ]

  for (const payload of payloads) {
    test(`refuses ${payload.slice(0, 28)}…`, async () => {
      expect(containsMultipleStatements(payload, 'postgresql')).toBe(true)

      const { adapter, calls } = makeSpyAdapter()
      const executor = new QueryExecutor(adapter, 'query-only', undefined, undefined, {
        dialect: 'postgresql',
      })
      await expect(executor.execute(payload)).rejects.toThrow(/multiple statements/i)
      expect(calls()).toEqual([])
    })
  }

  test('a write hidden behind a non-ASCII identifier is still found in a snippet', () => {
    const body =
      'WITH t AS (SELECT 1 AS café$q$), d AS (DELETE FROM users RETURNING 1 AS b$q$) SELECT * FROM d'
    expect(findWriteKeyword(body, ['postgresql'])).toBe('DELETE')
  })

  test('a dollar-quote still opens after a non-identifier character', () => {
    expect(containsMultipleStatements('SELECT ($$a;b$$) AS v', 'postgresql')).toBe(false)
    expect(containsMultipleStatements('SELECT $$a;b$$ AS v', 'postgresql')).toBe(false)
  })
})
