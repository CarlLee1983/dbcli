/**
 * QueryExecutor auto-LIMIT scope tests
 * Verifies LIMIT injection only happens for SELECT, not for SHOW/DESCRIBE/EXPLAIN.
 */

import { describe, it, expect } from 'bun:test'
import { QueryExecutor } from '@/core/query-executor'
import type { DatabaseAdapter } from '@/adapters/types'

function makeSpyAdapter(): { adapter: DatabaseAdapter; lastSql: () => string } {
  let captured = ''
  const adapter: DatabaseAdapter = {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>(sql: string) => {
      captured = sql
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
  return { adapter, lastSql: () => captured }
}

describe('QueryExecutor auto-LIMIT scope', () => {
  it('injects LIMIT for plain SELECT in query-only mode', async () => {
    const { adapter, lastSql } = makeSpyAdapter()
    const exec = new QueryExecutor(adapter, 'query-only')
    await exec.execute('SELECT * FROM users')
    expect(lastSql()).toMatch(/LIMIT\s+1000/i)
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
})
