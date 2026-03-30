/**
 * QueryExecutor integration tests with blacklist column filtering
 */

import { describe, it, expect } from 'bun:test'
import { QueryExecutor } from '@/core/query-executor'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import type { DatabaseAdapter } from '@/adapters/types'
import type { DbcliConfig } from '@/types'

// Mock database adapter
function createMockAdapter(rows: Record<string, any>[]): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>(_sql: string, _params?: any[]) => ({
      rows: rows as T[],
      affectedRows: rows.length
    }),
    listTables: async () => [],
    getTableSchema: async () => ({ name: '', columns: [], rowCount: 0, primaryKey: null, foreignKeys: [] }),
    testConnection: async () => true,
    getServerVersion: async () => 'test'
  }
}

const baseConfig: DbcliConfig = {
  connection: { system: 'postgresql', host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'db' },
  permission: 'admin'
}

function makeConfig(blacklist?: any): any {
  return { ...baseConfig, blacklist }
}

function makeValidator(blacklist?: any, overrideEnv?: string): BlacklistValidator {
  const manager = new BlacklistManager(makeConfig(blacklist), overrideEnv)
  return new BlacklistValidator(manager)
}

describe('QueryExecutor with blacklist column filtering', () => {
  const mockRows = [
    { id: 1, name: 'Alice', email: 'alice@example.com', password: 'hash123', api_key: 'key_abc' },
    { id: 2, name: 'Bob', email: 'bob@example.com', password: 'hash456', api_key: 'key_def' }
  ]

  it('returns all columns when no blacklist configured', async () => {
    const adapter = createMockAdapter(mockRows)
    const executor = new QueryExecutor(adapter, 'admin')
    const result = await executor.execute('SELECT * FROM users')

    expect(result.columnNames).toContain('password')
    expect(result.columnNames).toContain('api_key')
    expect(result.rows[0]).toHaveProperty('password')
    expect(result.metadata?.securityNotification).toBeUndefined()
  })

  it('filters blacklisted columns from SELECT results', async () => {
    const adapter = createMockAdapter(mockRows)
    const validator = makeValidator({ tables: [], columns: { users: ['password', 'api_key'] } })
    const executor = new QueryExecutor(adapter, 'admin', validator)

    const result = await executor.execute('SELECT * FROM users')

    expect(result.columnNames).not.toContain('password')
    expect(result.columnNames).not.toContain('api_key')
    expect(result.columnNames).toContain('id')
    expect(result.columnNames).toContain('name')
    expect(result.rows[0]).not.toHaveProperty('password')
    expect(result.rows[0]).not.toHaveProperty('api_key')
  })

  it('adds security notification when columns are filtered', async () => {
    const adapter = createMockAdapter(mockRows)
    const validator = makeValidator({ tables: [], columns: { users: ['password', 'api_key'] } })
    const executor = new QueryExecutor(adapter, 'admin', validator)

    const result = await executor.execute('SELECT * FROM users')

    expect(result.metadata?.securityNotification).toBeDefined()
    expect(result.metadata?.securityNotification).toContain('2')
  })

  it('preserves non-blacklisted column data', async () => {
    const adapter = createMockAdapter(mockRows)
    const validator = makeValidator({ tables: [], columns: { users: ['password', 'api_key'] } })
    const executor = new QueryExecutor(adapter, 'admin', validator)

    const result = await executor.execute('SELECT * FROM users')

    expect(result.rows[0]).toHaveProperty('id', 1)
    expect(result.rows[0]).toHaveProperty('name', 'Alice')
    expect(result.rows[0]).toHaveProperty('email', 'alice@example.com')
  })

  it('throws BlacklistError when querying blacklisted table', async () => {
    const adapter = createMockAdapter(mockRows)
    const validator = makeValidator({ tables: ['users'], columns: {} })
    const executor = new QueryExecutor(adapter, 'admin', validator)

    await expect(executor.execute('SELECT * FROM users')).rejects.toThrow(BlacklistError)
  })

  it('still enforces permission check even with blacklist validator', async () => {
    const adapter = createMockAdapter(mockRows)
    const validator = makeValidator({ tables: [], columns: {} })
    const executorQueryOnly = new QueryExecutor(adapter, 'query-only', validator)

    // INSERT should be blocked by permission (not blacklist)
    await expect(executorQueryOnly.execute('INSERT INTO users VALUES (1)')).rejects.toThrow()
  })

  it('does not filter columns from non-blacklisted tables', async () => {
    const adapter = createMockAdapter(mockRows)
    // Only blacklist columns for 'orders', not 'users'
    const validator = makeValidator({ tables: [], columns: { orders: ['total'] } })
    const executor = new QueryExecutor(adapter, 'admin', validator)

    const result = await executor.execute('SELECT * FROM users')

    expect(result.columnNames).toContain('password')
    expect(result.metadata?.securityNotification).toBeUndefined()
  })
})
