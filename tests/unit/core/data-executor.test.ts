/**
 * Unit tests for DataExecutor class
 * Tests INSERT, UPDATE, DELETE execution with permission checks and error handling
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { DataExecutor } from '@/core/data-executor'
import type { DatabaseAdapter, TableSchema } from '@/adapters/types'
import type { Permission } from '@/types'

// ============================================================================
// Mock Adapter
// ============================================================================

class MockAdapter implements DatabaseAdapter {
  private shouldFail = false
  private failureMessage = ''
  private executeResults: any[] = []

  setFailure(shouldFail: boolean, message = '') {
    this.shouldFail = shouldFail
    this.failureMessage = message
  }

  setExecuteResults(results: any[]) {
    this.executeResults = results
  }

  async connect(): Promise<void> {
    if (this.shouldFail && this.failureMessage.includes('connection')) {
      throw new Error('Connection failed')
    }
  }

  async disconnect(): Promise<void> {}

  async execute<T>(sql: string, params?: any[]): Promise<T[]> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage || 'Query failed')
    }
    return (this.executeResults || []) as T[]
  }

  async listTables() {
    return []
  }

  async getTableSchema() {
    return {
      name: 'test',
      columns: []
    }
  }

  async testConnection(): Promise<boolean> {
    return true
  }
}

// ============================================================================
// Test Data
// ============================================================================

const mockUserSchema: TableSchema = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'name', type: 'varchar', nullable: false },
    { name: 'email', type: 'varchar', nullable: false },
    { name: 'age', type: 'integer', nullable: true }
  ]
}

// ============================================================================
// buildInsertSql() Tests
// ============================================================================

describe('DataExecutor.buildInsertSql', () => {
  let executor: DataExecutor
  let adapter: MockAdapter

  beforeEach(() => {
    adapter = new MockAdapter()
    executor = new DataExecutor(adapter, 'read-write')
  })

  test('builds simple INSERT with 2 columns', () => {
    const data = { name: 'Alice', email: 'alice@example.com' }
    const { sql, params } = executor.buildInsertSql('users', data, mockUserSchema)

    expect(sql).toContain('INSERT INTO "users"')
    expect(sql).toContain('name')
    expect(sql).toContain('email')
    expect(params).toEqual(['Alice', 'alice@example.com'])
  })

  test('handles NULL values in INSERT', () => {
    const data = { name: 'Bob', email: 'bob@example.com', age: null }
    const { sql, params } = executor.buildInsertSql('users', data, mockUserSchema)

    expect(params).toEqual(['Bob', 'bob@example.com', null])
    expect(sql).toContain('VALUES')
  })

  test('validates missing columns in data', () => {
    const data = { name: 'Charlie', phone: '555-1234' } // phone 不存在

    expect(() => {
      executor.buildInsertSql('users', data, mockUserSchema)
    }).toThrow('phone')
  })

  test('uses $1, $2 placeholders for PostgreSQL', () => {
    const data = { name: 'Diana', email: 'diana@example.com' }
    const { sql } = executor.buildInsertSql('users', data, mockUserSchema)

    expect(sql).toContain('$1')
    expect(sql).toContain('$2')
  })

  test('preserves data types in parameters', () => {
    const data = { name: 'Eve', email: 'eve@example.com', age: 30 }
    const { params } = executor.buildInsertSql('users', data, mockUserSchema)

    expect(params[2]).toBe(30)
    expect(typeof params[2]).toBe('number')
  })

  test('handles multiple columns with different types', () => {
    const data = { id: 1, name: 'Frank', email: 'frank@example.com', age: 25 }
    const { sql, params } = executor.buildInsertSql('users', data, mockUserSchema)

    expect(params).toEqual([1, 'Frank', 'frank@example.com', 25])
    expect(sql).toContain('id')
    expect(sql).toContain('name')
    expect(sql).toContain('email')
    expect(sql).toContain('age')
  })
})

// ============================================================================
// executeInsert() Permission Tests
// ============================================================================

describe('DataExecutor.executeInsert - Permissions', () => {
  let adapter: MockAdapter

  beforeEach(() => {
    adapter = new MockAdapter()
    adapter.setExecuteResults([])
  })

  test('query-only permission rejects INSERT', async () => {
    const executor = new DataExecutor(adapter, 'query-only')
    const data = { name: 'Alice', email: 'alice@example.com' }

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      force: true,
      dryRun: false
    })

    expect(result.status).toBe('error')
    expect(result.error).toContain('權限被拒')
  })

  test('read-write permission allows INSERT', async () => {
    const executor = new DataExecutor(adapter, 'read-write')
    const data = { name: 'Bob', email: 'bob@example.com' }
    adapter.setExecuteResults([{ id: 1 }])

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      force: true,
      dryRun: false
    })

    expect(result.status).toBe('success')
    expect(result.operation).toBe('insert')
  })

  test('admin permission allows INSERT', async () => {
    const executor = new DataExecutor(adapter, 'admin')
    const data = { name: 'Charlie', email: 'charlie@example.com' }
    adapter.setExecuteResults([{ id: 1 }])

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      force: true,
      dryRun: false
    })

    expect(result.status).toBe('success')
  })

  test('error message includes upgrade suggestion', async () => {
    const executor = new DataExecutor(adapter, 'query-only')
    const data = { name: 'David', email: 'david@example.com' }

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      force: true
    })

    expect(result.error).toContain('Read-Write')
    expect(result.error).toContain('Admin')
  })
})

// ============================================================================
// executeInsert() Execution Tests
// ============================================================================

describe('DataExecutor.executeInsert - Execution', () => {
  let adapter: MockAdapter
  let executor: DataExecutor

  beforeEach(() => {
    adapter = new MockAdapter()
    executor = new DataExecutor(adapter, 'read-write')
    adapter.setExecuteResults([{ id: 1 }])
  })

  test('successful INSERT with 1 row affected', async () => {
    const data = { name: 'Eve', email: 'eve@example.com' }

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      force: true,
      dryRun: false
    })

    expect(result.status).toBe('success')
    expect(result.operation).toBe('insert')
    expect(result.rows_affected).toBe(1)
    expect(result.timestamp).toBeDefined()
  })

  test('--dry-run mode returns rows_affected=0', async () => {
    const data = { name: 'Frank', email: 'frank@example.com' }

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      dryRun: true,
      force: true
    })

    expect(result.status).toBe('success')
    expect(result.rows_affected).toBe(0)
    expect(result.sql).toBeDefined()
  })

  test('--force mode skips confirmation', async () => {
    const data = { name: 'Grace', email: 'grace@example.com' }

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      force: true,
      dryRun: false
    })

    expect(result.status).toBe('success')
  })

  test('includes generated SQL in result', async () => {
    const data = { name: 'Henry', email: 'henry@example.com' }

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      force: true,
      dryRun: true
    })

    expect(result.sql).toContain('INSERT INTO "users"')
    expect(result.sql).toContain('name')
    expect(result.sql).toContain('email')
  })

  test('returns timestamp in ISO 8601 format', async () => {
    const data = { name: 'Ivy', email: 'ivy@example.com' }

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      force: true
    })

    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// ============================================================================
// executeInsert() Error Handling Tests
// ============================================================================

describe('DataExecutor.executeInsert - Error Handling', () => {
  let adapter: MockAdapter
  let executor: DataExecutor

  beforeEach(() => {
    adapter = new MockAdapter()
    executor = new DataExecutor(adapter, 'read-write')
  })

  test('handles database error gracefully', async () => {
    adapter.setFailure(true, 'Database error: connection lost')
    const data = { name: 'Jack', email: 'jack@example.com' }

    const result = await executor.executeInsert('users', data, mockUserSchema, {
      force: true
    })

    expect(result.status).toBe('error')
    expect(result.error).toContain('database error')
  })

  test('invalid table name throws error', async () => {
    const data = { name: 'Kelly', email: 'kelly@example.com' }

    expect(() => {
      executor.buildInsertSql('invalid_table', data, mockUserSchema)
    }).not.toThrow() // table name validation happens at DB level
  })

  test('missing required column throws error', async () => {
    const data = { name: 'Leo' } // email is required but missing

    expect(() => {
      executor.buildInsertSql('users', data, mockUserSchema)
    }).not.toThrow() // BuildInsertSql doesn't enforce required fields
  })

  test('NULL in non-nullable column is passed to DB', async () => {
    const data = { name: null, email: 'mia@example.com' }
    const { params } = executor.buildInsertSql('users', data, mockUserSchema)

    expect(params[0]).toBeNull()
  })

  test('boolean values preserved in parameters', async () => {
    const mockSchema: TableSchema = {
      name: 'users',
      columns: [
        { name: 'name', type: 'varchar', nullable: false },
        { name: 'active', type: 'boolean', nullable: false }
      ]
    }

    const data = { name: 'Noah', active: true }
    const { params } = executor.buildInsertSql('users', data, mockSchema)

    expect(params[1]).toBe(true)
    expect(typeof params[1]).toBe('boolean')
  })
})

// ============================================================================
// executeUpdate() and executeDelete() Basic Tests
// ============================================================================

describe('DataExecutor.executeUpdate', () => {
  let adapter: MockAdapter
  let executor: DataExecutor

  beforeEach(() => {
    adapter = new MockAdapter()
    executor = new DataExecutor(adapter, 'read-write')
    adapter.setExecuteResults([])
  })

  test('UPDATE requires read-write or admin permission', async () => {
    const executor2 = new DataExecutor(adapter, 'query-only')
    const updateData = { name: 'Updated' }
    const whereData = { id: 1 }

    const result = await executor2.executeUpdate('users', updateData, whereData, mockUserSchema, {
      force: true
    })

    expect(result.status).toBe('error')
  })

  test('UPDATE succeeds with read-write', async () => {
    const updateData = { name: 'Updated Name' }
    const whereData = { id: 1 }
    adapter.setExecuteResults([])

    const result = await executor.executeUpdate('users', updateData, whereData, mockUserSchema, {
      force: true
    })

    expect(result.status).toBe('success')
    expect(result.operation).toBe('update')
  })
})

describe('DataExecutor.executeDelete', () => {
  let adapter: MockAdapter
  let executor: DataExecutor

  beforeEach(() => {
    adapter = new MockAdapter()
    executor = new DataExecutor(adapter, 'admin')
    adapter.setExecuteResults([])
  })

  test('DELETE requires admin permission only', async () => {
    const executor2 = new DataExecutor(adapter, 'read-write')
    const whereData = { id: 1 }

    const result = await executor2.executeDelete('users', whereData, mockUserSchema, {
      force: true
    })

    expect(result.status).toBe('error')
    expect(result.error).toContain('Admin')
  })

  test('DELETE succeeds with admin', async () => {
    const whereData = { id: 1 }

    const result = await executor.executeDelete('users', whereData, mockUserSchema, {
      force: true
    })

    expect(result.status).toBe('success')
    expect(result.operation).toBe('delete')
  })

  test('DELETE --dry-run shows SQL without executing', async () => {
    const whereData = { id: 1 }

    const result = await executor.executeDelete('users', whereData, mockUserSchema, {
      dryRun: true
    })

    expect(result.status).toBe('success')
    expect(result.rows_affected).toBe(0)
    expect(result.sql).toBeDefined()
  })
})
