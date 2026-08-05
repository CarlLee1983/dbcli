/**
 * The read-only proof — reject a statement whose leading keyword reads but
 * whose body writes — existed only behind `if (multiConnection)`. A single
 * connection was judged by `checkPermission`, which classifies on the first
 * keyword alone, so `dbcli query` executed data-modifying CTEs, `SELECT … INTO`
 * and `EXPLAIN ANALYZE <write>` under `permission: query-only`.
 */

import { describe, test, expect } from 'bun:test'
import { checkPermission } from '@/core/permission-guard'
import { QueryExecutor } from '@/core/query-executor'
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

const WRITES_BEHIND_A_READ = [
  ['a CTE that deletes', 'WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone'],
  ['a CTE that updates', 'WITH b AS (UPDATE users SET n = n + 1 RETURNING *) SELECT * FROM b'],
  ['a CTE that inserts', 'WITH a AS (INSERT INTO users (n) VALUES (1) RETURNING *) SELECT * FROM a'],
  ['SELECT … INTO', 'SELECT * INTO evil_copy FROM users'],
  ['EXPLAIN ANALYZE of a delete', 'EXPLAIN ANALYZE DELETE FROM users'],
  ['EXPLAIN ANALYZE of an insert', 'EXPLAIN ANALYZE INSERT INTO users (a) VALUES (1)'],
] as const

describe('a single connection proves statements read-only too', () => {
  for (const [description, sql] of WRITES_BEHIND_A_READ) {
    test(`query-only refuses ${description}`, () => {
      expect(checkPermission(sql, 'query-only', 'postgresql').allowed).toBe(false)
    })

    test(`nothing reaches the adapter for ${description}`, async () => {
      const { adapter, calls } = makeSpyAdapter()
      const executor = new QueryExecutor(adapter, 'query-only', undefined, undefined, {
        dialect: 'postgresql',
      })
      await expect(executor.execute(sql)).rejects.toThrow()
      expect(calls()).toEqual([])
    })
  }

  test('the permission tier of the hidden write still applies', () => {
    const deleting = 'WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone'
    // DELETE needs data-admin, so read-write is not enough and admin is.
    expect(checkPermission(deleting, 'read-write', 'postgresql').allowed).toBe(false)
    expect(checkPermission(deleting, 'data-admin', 'postgresql').allowed).toBe(true)
    expect(checkPermission(deleting, 'admin', 'postgresql').allowed).toBe(true)
  })

  test('ordinary reads are unaffected', () => {
    for (const sql of [
      'SELECT * FROM users',
      'WITH recent AS (SELECT * FROM users) SELECT * FROM recent',
      'SELECT create_date, update_count FROM audit_log',
      "SELECT * FROM audit WHERE action = 'DELETE'",
      'SELECT * FROM users FOR UPDATE',
      'EXPLAIN SELECT * FROM users',
      'SHOW TABLES',
    ]) {
      expect(checkPermission(sql, 'query-only', 'postgresql').allowed).toBe(true)
    }
  })
})

describe('the escalated tier is the strictest write present', () => {
  test('a harmless leading write does not launder a stricter one', () => {
    // Taking the leftmost keyword let read-write run a DELETE by putting an
    // INSERT in front of it.
    const smuggled =
      'WITH a AS (INSERT INTO t VALUES (1) RETURNING *), b AS (DELETE FROM users RETURNING *) SELECT 1'
    expect(checkPermission(smuggled, 'read-write', 'postgresql').allowed).toBe(false)
    expect(checkPermission(smuggled, 'data-admin', 'postgresql').allowed).toBe(true)
  })

  test('a leading write does not launder a table creation', () => {
    const smuggled =
      'WITH a AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * INTO evil_copy FROM users'
    expect(checkPermission(smuggled, 'read-write', 'postgresql').allowed).toBe(false)
    expect(checkPermission(smuggled, 'data-admin', 'postgresql').allowed).toBe(false)
    expect(checkPermission(smuggled, 'admin', 'postgresql').allowed).toBe(true)
  })
})

describe('a function is not a statement', () => {
  const reads = [
    ["SELECT replace(name, 'a', 'b') FROM users", 'postgresql'],
    ['SELECT TRUNCATE(1.234, 2) AS t', 'mysql'],
    ["SELECT INSERT('abcd', 2, 1, 'X') AS s", 'mysql'],
    ["SELECT regexp_replace(name, 'a', 'b') FROM users", 'postgresql'],
    ['SELECT replace (name, 1, 2) FROM users', 'postgresql'],
  ] as const

  for (const [sql, dialect] of reads) {
    test(`query-only allows ${sql}`, () => {
      expect(checkPermission(sql, 'query-only', dialect).allowed).toBe(true)
    })
  }

  test('the statement forms are still writes', () => {
    expect(checkPermission('INSERT INTO t (a) VALUES (1)', 'query-only', 'postgresql').allowed).toBe(
      false
    )
    expect(checkPermission("REPLACE INTO t VALUES (1)", 'query-only', 'mysql').allowed).toBe(false)
    expect(checkPermission('TRUNCATE TABLE users', 'query-only', 'postgresql').allowed).toBe(false)
  })
})

describe('DESCRIBE is EXPLAIN on MySQL and MariaDB', () => {
  test('DESCRIBE ANALYZE of a write is refused', () => {
    expect(checkPermission('DESCRIBE ANALYZE DELETE FROM users', 'query-only', 'mysql').allowed).toBe(
      false
    )
  })

  test('a plain DESCRIBE is still a read', () => {
    expect(checkPermission('DESCRIBE users', 'query-only', 'mysql').allowed).toBe(true)
  })
})
