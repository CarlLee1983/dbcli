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

  test('a statement that claims to read and does not is admin-only', () => {
    const deleting = 'WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone'
    // Judged by the tier of the keyword found, this was laundered twice: by a
    // harmless leading write, and by the exceptions needed to rank `INTO`.
    expect(checkPermission(deleting, 'read-write', 'postgresql').allowed).toBe(false)
    expect(checkPermission(deleting, 'data-admin', 'postgresql').allowed).toBe(false)
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

describe('no ordering of keywords launders a hidden write', () => {
  test('a harmless leading write does not launder a stricter one', () => {
    // Taking the leftmost keyword let read-write run a DELETE by putting an
    // INSERT in front of it.
    const smuggled =
      'WITH a AS (INSERT INTO t VALUES (1) RETURNING *), b AS (DELETE FROM users RETURNING *) SELECT 1'
    expect(checkPermission(smuggled, 'read-write', 'postgresql').allowed).toBe(false)
    expect(checkPermission(smuggled, 'data-admin', 'postgresql').allowed).toBe(false)
    expect(checkPermission(smuggled, 'admin', 'postgresql').allowed).toBe(true)
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

/**
 * Two textual exceptions — rewriting `INSERT INTO` to drop the `INTO`, and
 * treating a keyword followed by whitespace and `(` as a function call —
 * combined to erase the write entirely: stripping a quoted identifier leaves
 * `INSERT` next to `(`.
 */
describe('a hidden write cannot be spelled away', () => {
  const hidden = [
    ['a quoted target table', `WITH x AS (INSERT INTO "users" (name) VALUES ('evil') RETURNING *) SELECT * FROM x`, 'postgresql'],
    ['a backtick target table', 'WITH x AS (INSERT INTO `users` (name) VALUES (1) RETURNING *) SELECT * FROM x', 'mysql'],
    ['no space before the column list', `WITH x AS (INSERT INTO "users"(name) VALUES ('e') RETURNING *) SELECT * FROM x`, 'postgresql'],
    ['an alias that spells a verb', 'SELECT 1 AS insert INTO evil_copy FROM users', 'postgresql'],
  ] as const

  for (const [description, sql, dialect] of hidden) {
    test(`query-only refuses ${description}`, () => {
      expect(checkPermission(sql, 'query-only', dialect).allowed).toBe(false)
    })

    test(`read-write refuses ${description}`, () => {
      expect(checkPermission(sql, 'read-write', dialect).allowed).toBe(false)
    })
  }
})

describe('the refusal says what actually happened', () => {
  const sql = 'WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x'

  for (const permission of ['query-only', 'read-write', 'data-admin'] as const) {
    test(`${permission} names the hidden write and the tier that would allow it`, () => {
      const { allowed, reason } = checkPermission(sql, permission, 'postgresql')
      expect(allowed).toBe(false)
      // The keyword that was found, so the user can see what triggered it.
      expect(reason).toMatch(/INSERT/)
      // The tier that actually allows it — earlier messages pointed at tiers
      // that refuse the statement too.
      expect(reason).toMatch(/admin/)
      expect(reason).not.toMatch(/requires read-write/)
      expect(reason).not.toMatch(/requires data-admin or admin/)
      // It is recognised; telling the user to report it as unrecognised is wrong.
      expect(reason).not.toMatch(/Unrecognised|open an issue/i)
    })
  }

  test('a genuinely unrecognised statement still reads as unrecognised', () => {
    const { allowed, reason } = checkPermission('VACUUM FULL users', 'query-only', 'postgresql')
    expect(allowed).toBe(false)
    expect(reason).toMatch(/Unrecognised/i)
  })
})
