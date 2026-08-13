/**
 * QueryExecutor auto-LIMIT scope tests
 * Verifies LIMIT injection only happens for SELECT, not for SHOW/DESCRIBE/EXPLAIN.
 */

import { describe, it, expect, spyOn } from 'bun:test'
import { QueryExecutor } from '@/core/query-executor'
import type { DatabaseAdapter } from '@/adapters/types'

function makeSpyAdapter(rows: Record<string, unknown>[] = []): {
  adapter: DatabaseAdapter
  lastSql: () => string
} {
  let captured = ''
  const adapter: DatabaseAdapter = {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>(sql: string) => {
      captured = sql
      return { rows: rows as T[], affectedRows: rows.length }
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
  return { adapter, lastSql: () => captured }
}

describe('QueryExecutor auto-LIMIT scope', () => {
  it('injects LIMIT for plain SELECT in query-only mode', async () => {
    const { adapter, lastSql } = makeSpyAdapter()
    const exec = new QueryExecutor(adapter, 'query-only')
    await exec.execute('SELECT * FROM users', { detectTruncation: true })
    expect(lastSql()).toMatch(/LIMIT\s+1001/i)
  })

  it('does NOT inject LIMIT for SHOW INDEX in query-only mode', async () => {
    const { adapter, lastSql } = makeSpyAdapter()
    const exec = new QueryExecutor(adapter, 'query-only')
    await exec.execute('SHOW INDEX FROM betting_logs')
    expect(lastSql()).toBe('SHOW INDEX FROM betting_logs')
  })

  it('does NOT inject LIMIT for DESCRIBE in query-only mode', async () => {
    const { adapter, lastSql } = makeSpyAdapter()
    const exec = new QueryExecutor(adapter, 'query-only')
    await exec.execute('DESCRIBE users')
    expect(lastSql()).toBe('DESCRIBE users')
  })

  it('does NOT inject LIMIT for EXPLAIN SELECT in query-only mode', async () => {
    const { adapter, lastSql } = makeSpyAdapter()
    const exec = new QueryExecutor(adapter, 'query-only')
    await exec.execute('EXPLAIN SELECT * FROM users')
    expect(lastSql()).toBe('EXPLAIN SELECT * FROM users')
  })

  it('does NOT inject LIMIT for ANALYZE SELECT in query-only mode', async () => {
    const { adapter, lastSql } = makeSpyAdapter()
    const exec = new QueryExecutor(adapter, 'query-only')
    await exec.execute('ANALYZE SELECT * FROM users')
    expect(lastSql()).toBe('ANALYZE SELECT * FROM users')
  })

  it('preserves existing LIMIT and does not add another', async () => {
    const { adapter, lastSql } = makeSpyAdapter()
    const exec = new QueryExecutor(adapter, 'query-only')
    await exec.execute('SELECT * FROM users LIMIT 50')
    expect(lastSql()).toBe('SELECT * FROM users LIMIT 50')
  })

  it('does not mistake quoted identifiers, strings, or comments for a LIMIT clause', async () => {
    for (const sql of [
      'SELECT "limit" FROM users',
      'SELECT `limit` FROM users',
      "SELECT 'LIMIT 50' AS note FROM users",
      'SELECT * FROM users /* LIMIT 50 */',
    ]) {
      const { adapter, lastSql } = makeSpyAdapter()
      const exec = new QueryExecutor(adapter, 'query-only')
      await exec.execute(sql, { detectTruncation: true })
      expect(lastSql()).toMatch(/LIMIT\s+1001$/i)
    }
  })

  it('preserves a parameterized user-authored LIMIT', async () => {
    for (const sql of [
      'SELECT * FROM users LIMIT ?',
      'SELECT * FROM users LIMIT $1',
      'SELECT * FROM users LIMIT :max_rows',
      'SELECT * FROM users LIMIT ALL',
    ]) {
      const { adapter, lastSql } = makeSpyAdapter()
      const exec = new QueryExecutor(adapter, 'query-only')
      await exec.execute(sql, { detectTruncation: true })
      expect(lastSql()).toBe(sql)
    }
  })

  for (const [label, sourceRows, truncated, visibleRows] of [
    ['N-1', 1, false, 1],
    ['N', 2, false, 2],
    ['N+1', 3, true, 2],
    ['more than N+1', 4, true, 2],
  ] as const) {
    it(`reports truthful applied-limit metadata for ${label} rows`, async () => {
      const rows = Array.from({ length: sourceRows }, (_, id) => ({ id }))
      const { adapter, lastSql } = makeSpyAdapter(rows)
      const exec = new QueryExecutor(adapter, 'query-only')

      const result = await exec.execute('SELECT * FROM users', {
        limitValue: 2,
        detectTruncation: true,
      })

      expect(lastSql()).toMatch(/LIMIT\s+3/i)
      expect(result.rows).toHaveLength(visibleRows)
      expect(result.rowCount).toBe(visibleRows)
      expect(result.appliedLimit).toEqual({ truncated, limitApplied: 2 })
      expect(result.metadata?.affectedRows).toBe(visibleRows)
    })
  }

  it('keeps QueryExecutor callers outside dbcli query on the previous limit contract', async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const { adapter, lastSql } = makeSpyAdapter(rows)
    const exec = new QueryExecutor(adapter, 'query-only')

    const result = await exec.execute('SELECT * FROM users', { limitValue: 2 })

    expect(lastSql()).toBe('SELECT * FROM users LIMIT 2')
    expect(result.appliedLimit).toBeUndefined()
    expect(result.rows).toEqual(rows)
  })

  // audit 的寫入點自 #41 起只在命令層，而命令層記的 rows_affected 取自
  // result.rowCount。所以「不要把 N+1 的探測列數算進去」這條保證，在執行器
  // 這一側要守的就是回傳的列數本身。
  it('reports the visible SQL row count, not the N+1 lookahead', async () => {
    const { adapter } = makeSpyAdapter([{ id: 1 }, { id: 2 }, { id: 3 }])
    const exec = new QueryExecutor(adapter, 'query-only')

    const result = await exec.execute('SELECT * FROM users', {
      limitValue: 2,
      detectTruncation: true,
    })

    expect(result.rowCount).toBe(2)
    expect(result.metadata?.affectedRows).toBe(2)
  })

  it('applies an explicit CLI limit outside query-only mode', async () => {
    const { adapter, lastSql } = makeSpyAdapter([{ id: 1 }, { id: 2 }])
    const exec = new QueryExecutor(adapter, 'admin')

    const result = await exec.execute('SELECT * FROM users;', {
      limitValue: 1,
      detectTruncation: true,
    })

    expect(lastSql()).toBe('SELECT * FROM users LIMIT 2')
    expect(result.rows).toEqual([{ id: 1 }])
    expect(result.appliedLimit).toEqual({ truncated: true, limitApplied: 1 })
  })

  it('omits applied-limit metadata for --no-limit', async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const { adapter, lastSql } = makeSpyAdapter(rows)
    const exec = new QueryExecutor(adapter, 'query-only')

    const result = await exec.execute('SELECT * FROM users', {
      autoLimit: false,
      detectTruncation: true,
    })

    expect(lastSql()).toBe('SELECT * FROM users')
    expect(result.rows).toEqual(rows)
    expect(result.appliedLimit).toBeUndefined()
  })

  it('omits applied-limit metadata for a user-authored LIMIT', async () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const { adapter, lastSql } = makeSpyAdapter(rows)
    const exec = new QueryExecutor(adapter, 'query-only')

    const result = await exec.execute('SELECT * FROM users LIMIT 2', {
      detectTruncation: true,
    })

    expect(lastSql()).toBe('SELECT * FROM users LIMIT 2')
    expect(result.rows).toEqual(rows)
    expect(result.appliedLimit).toBeUndefined()
  })

  it('does not print the auto-limit warning before an adapter failure', async () => {
    const { adapter } = makeSpyAdapter()
    adapter.execute = async () => {
      throw new Error('adapter exploded')
    }
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const exec = new QueryExecutor(adapter, 'query-only')
      await expect(exec.execute('SELECT * FROM users')).rejects.toThrow('adapter exploded')
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('suppresses success diagnostics in recovery mode', async () => {
    const { adapter } = makeSpyAdapter()
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const exec = new QueryExecutor(adapter, 'query-only', undefined, undefined, {
        recovery: true,
      })
      await exec.execute('SELECT * FROM users')
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
