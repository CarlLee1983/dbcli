/**
 * Issue #23 — the blacklist used to decide on the *first* table only, so a
 * sensitive table brought in by JOIN / comma / UNION was neither blocked nor
 * masked. These tests pin the enforcement, not the parser.
 */

import { describe, it, expect } from 'bun:test'
import { QueryExecutor } from '@/core/query-executor'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import type { DatabaseAdapter } from '@/adapters/types'
import type { DbcliConfig } from '@/types'

function createMockAdapter(rows: Record<string, unknown>[]): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>() => ({
      rows: rows as T[],
      affectedRows: rows.length,
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
  } as unknown as DatabaseAdapter
}

const baseConfig: DbcliConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'u',
    password: 'p',
    database: 'db',
  },
  permission: 'admin',
}

function makeValidator(blacklist: unknown, overrideEnv?: string): BlacklistValidator {
  const manager = new BlacklistManager(
    { ...baseConfig, blacklist } as DbcliConfig,
    overrideEnv as string | undefined
  )
  return new BlacklistValidator(manager)
}

const joinedRows = [{ id: 1, total: 10, password_hash: 'hash123' }]

describe('table blocking across every table reference', () => {
  const validator = () => makeValidator({ tables: ['users'], columns: {} })

  const blocked = [
    ['JOIN', 'SELECT * FROM orders o JOIN users u ON u.id = o.user_id'],
    ['comma', 'SELECT * FROM orders, users'],
    ['UNION', 'SELECT id FROM orders UNION ALL SELECT id FROM users'],
    ['subquery', 'SELECT * FROM orders WHERE user_id IN (SELECT id FROM users)'],
    ['CTE body', 'WITH s AS (SELECT * FROM users) SELECT * FROM s'],
  ] as const

  for (const [label, sql] of blocked) {
    it(`blocks a blacklisted table reached through ${label}`, async () => {
      const executor = new QueryExecutor(createMockAdapter(joinedRows), 'admin', validator())
      await expect(executor.execute(sql)).rejects.toThrow(BlacklistError)
    })
  }

  it('still allows a query that touches no blacklisted table', async () => {
    const executor = new QueryExecutor(createMockAdapter(joinedRows), 'admin', validator())
    const result = await executor.execute('SELECT * FROM orders o JOIN items i ON i.id = o.item_id')
    expect(result.rowCount).toBe(1)
  })
})

describe('column masking across every table reference', () => {
  const validator = () => makeValidator({ tables: [], columns: { users: ['password_hash'] } })

  it('masks a blacklisted column of a JOINed table', async () => {
    const executor = new QueryExecutor(createMockAdapter(joinedRows), 'admin', validator())
    const result = await executor.execute(
      'SELECT o.id, o.total, u.password_hash FROM orders o JOIN users u ON u.id = o.user_id'
    )

    expect(result.columnNames).not.toContain('password_hash')
    expect(result.rows[0]).not.toHaveProperty('password_hash')
    expect(result.rows[0]).toHaveProperty('total')
    expect(result.metadata?.securityNotification).toBeDefined()
  })

  it('masks a blacklisted column reached through a UNION branch', async () => {
    const executor = new QueryExecutor(createMockAdapter(joinedRows), 'admin', validator())
    const result = await executor.execute(
      'SELECT id, total, NULL AS password_hash FROM orders UNION ALL SELECT id, 0, password_hash FROM users'
    )

    expect(result.columnNames).not.toContain('password_hash')
  })

  it('leaves the column alone when its table is not referenced', async () => {
    const executor = new QueryExecutor(createMockAdapter(joinedRows), 'admin', validator())
    const result = await executor.execute('SELECT * FROM orders')

    expect(result.columnNames).toContain('password_hash')
  })
})
