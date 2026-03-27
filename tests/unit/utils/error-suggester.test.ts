/**
 * Unit tests for error suggester utility
 */

import { test, expect, describe, beforeEach } from 'bun:test'
import { suggestTableName } from '../../../src/utils/error-suggester'
import type { DatabaseAdapter, TableSchema } from '../../../src/adapters/types'

/**
 * Mock database adapter for testing
 */
class MockDatabaseAdapter implements DatabaseAdapter {
  private tables: TableSchema[] = []
  private shouldFail = false

  setTables(tables: TableSchema[]): void {
    this.tables = tables
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail
  }

  async listTables(): Promise<TableSchema[]> {
    if (this.shouldFail) {
      throw new Error('Failed to list tables')
    }
    return this.tables
  }

  async connect(): Promise<void> {
    // Not needed for this test
  }

  async disconnect(): Promise<void> {
    // Not needed for this test
  }

  async execute(): Promise<any[]> {
    // Not needed for this test
    return []
  }

  async getTableSchema(): Promise<TableSchema> {
    // Not needed for this test
    return { name: '', columns: [] }
  }

  async testConnection(): Promise<boolean> {
    // Not needed for this test
    return true
  }
}

describe('suggestTableName', () => {
  let adapter: MockDatabaseAdapter

  beforeEach(() => {
    adapter = new MockDatabaseAdapter()
  })

  test('extracts table name from PostgreSQL relation error', async () => {
    adapter.setTables([
      { name: 'users', columns: [] },
      { name: 'orders', columns: [] }
    ])

    const error = 'ERROR: relation "usrs" does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toContain('users')
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  test('extracts table name from MySQL table error', async () => {
    adapter.setTables([
      { name: 'users', columns: [] },
      { name: 'orders', columns: [] }
    ])

    const error = 'Table `usrs` does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toContain('users')
  })

  test('extracts table name with single quotes', async () => {
    adapter.setTables([
      { name: 'users', columns: [] },
      { name: 'orders', columns: [] }
    ])

    const error = "ERROR: relation 'usrs' does not exist"
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toContain('users')
  })

  test('extracts table name with double quotes from MySQL', async () => {
    adapter.setTables([
      { name: 'users', columns: [] }
    ])

    const error = 'Error: Table "usrs" not found'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toContain('users')
  })

  test('returns single closest match for typo', async () => {
    adapter.setTables([
      { name: 'users', columns: [] },
      { name: 'orders', columns: [] },
      { name: 'products', columns: [] }
    ])

    const error = 'relation "usrs" does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toEqual(['users'])
  })

  test('returns multiple matches sorted by distance', async () => {
    adapter.setTables([
      { name: 'users', columns: [] },
      { name: 'user_roles', columns: [] },
      { name: 'user_audit', columns: [] },
      { name: 'orders', columns: [] }
    ])

    const error = 'relation "user" does not exist'
    const result = await suggestTableName(error, adapter)

    // All three user* tables should have distance < 3
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions[0]).toMatch(/user/)
  })

  test('limits suggestions to 3 closest matches', async () => {
    adapter.setTables([
      { name: 'user', columns: [] },
      { name: 'users', columns: [] },
      { name: 'user_old', columns: [] },
      { name: 'user_roles', columns: [] },
      { name: 'user_audit', columns: [] }
    ])

    const error = 'relation "usr" does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions.length).toBeLessThanOrEqual(3)
  })

  test('filters by distance threshold (< 3)', async () => {
    adapter.setTables([
      { name: 'users', columns: [] }, // distance 1
      { name: 'orders', columns: [] }, // distance > 3
      { name: 'products', columns: [] } // distance > 3
    ])

    const error = 'relation "usrs" does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toContain('users')
    expect(result.suggestions).not.toContain('orders')
    expect(result.suggestions).not.toContain('products')
  })

  test('returns empty suggestions when no matches found', async () => {
    adapter.setTables([
      { name: 'alpha', columns: [] },
      { name: 'beta', columns: [] },
      { name: 'gamma', columns: [] }
    ])

    const error = 'relation "xyz" does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions.length).toBe(0)
    // But should still list all tables
    expect(result.tables).toContain('alpha')
  })

  test('returns all available tables in result', async () => {
    const tables = [
      { name: 'users', columns: [] },
      { name: 'orders', columns: [] },
      { name: 'products', columns: [] }
    ]
    adapter.setTables(tables)

    const error = 'relation "usrs" does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.tables).toEqual(['users', 'orders', 'products'])
  })

  test('handles extraction failure gracefully', async () => {
    adapter.setTables([
      { name: 'users', columns: [] },
      { name: 'orders', columns: [] }
    ])

    const error = 'Some other error without table reference'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toEqual([])
    expect(result.tables).toContain('users')
  })

  test('handles empty table list', async () => {
    adapter.setTables([])

    const error = 'relation "usrs" does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toEqual([])
    expect(result.tables).toEqual([])
  })

  test('handles adapter failure gracefully', async () => {
    adapter.setShouldFail(true)

    const error = 'relation "usrs" does not exist'
    const result = await suggestTableName(error, adapter)

    // Should not throw, should return empty suggestions
    expect(result.suggestions).toEqual([])
    expect(result.tables).toEqual([])
  })

  test('case-insensitive distance calculation', async () => {
    adapter.setTables([
      { name: 'Users', columns: [] },
      { name: 'ORDERS', columns: [] }
    ])

    const error = 'relation "users" does not exist'
    const result = await suggestTableName(error, adapter)

    // Should suggest 'Users' despite case difference
    expect(result.suggestions).toContain('Users')
  })

  test('suggestions are sorted by distance ascending', async () => {
    adapter.setTables([
      { name: 'user', columns: [] }, // distance 1 from 'usr'
      { name: 'users', columns: [] }, // distance 2 from 'usr'
      { name: 'usr_old', columns: [] } // distance 4 from 'usr'
    ])

    const error = 'relation "usr" does not exist'
    const result = await suggestTableName(error, adapter)

    // First suggestion should be closest (user with distance 1)
    if (result.suggestions.length > 0) {
      expect(result.suggestions[0]).toBe('user')
    }
  })

  test('handles special characters in table names', async () => {
    adapter.setTables([
      { name: 'user_roles', columns: [] },
      { name: 'user-audit', columns: [] }
    ])

    const error = 'relation "usr_role" does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  test('handles numbers in table names', async () => {
    adapter.setTables([
      { name: 'table1', columns: [] },
      { name: 'table2', columns: [] },
      { name: 'table3', columns: [] }
    ])

    const error = 'relation "tabel1" does not exist'
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toContain('table1')
  })

  test('handles very long table names', async () => {
    const longName = 'a'.repeat(100)
    adapter.setTables([
      { name: longName, columns: [] }
    ])

    const error = `relation "${longName}" does not exist`
    const result = await suggestTableName(error, adapter)

    expect(result.suggestions).toEqual([longName])
  })

  test('ignores case in error message parsing', async () => {
    adapter.setTables([
      { name: 'users', columns: [] }
    ])

    const error = 'RELATION "usrs" DOES NOT EXIST'
    const result = await suggestTableName(error, adapter)

    // Should still extract table name despite uppercase
    expect(result.suggestions).toContain('users')
  })
})
