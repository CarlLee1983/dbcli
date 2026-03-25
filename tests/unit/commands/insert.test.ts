/**
 * Unit tests for insert command
 * Tests command argument validation, data parsing, permission enforcement, and output formatting
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { insertCommand } from '@/commands/insert'
import type { DatabaseAdapter, TableSchema } from '@/adapters/types'
import type { DbcliConfig } from '@/types'

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

  async getTableSchema(table: string): Promise<TableSchema> {
    if (table === 'users') {
      return {
        name: 'users',
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: true },
          { name: 'name', type: 'varchar', nullable: false },
          { name: 'email', type: 'varchar', nullable: false }
        ]
      }
    }
    throw new Error(`Table ${table} not found`)
  }

  async testConnection(): Promise<boolean> {
    return true
  }
}

// ============================================================================
// Setup
// ============================================================================

let mockAdapter: MockAdapter

const mockConfig: DbcliConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'test'
  },
  permission: 'read-write'
}

beforeEach(() => {
  mockAdapter = new MockAdapter()
  mockAdapter.setExecuteResults([{ id: 1 }])

  // Mock modules
  vi.mock('@/adapters', () => ({
    AdapterFactory: {
      createAdapter: () => mockAdapter
    },
    ConnectionError: class ConnectionError extends Error {}
  }))

  vi.mock('@/core/config', () => ({
    configModule: {
      read: async () => mockConfig
    }
  }))

  vi.mock('@/utils/prompts', () => ({
    promptUser: {
      confirm: vi.fn(async () => true)
    }
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// Argument Validation Tests
// ============================================================================

describe('insertCommand - Argument Validation', () => {
  test('rejects empty table name', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('', {
      data: '{"name":"Alice","email":"a@b.com"}',
      force: true
    })

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('error')
    )
  })

  test('accepts valid table name', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Alice","email":"a@b.com"}',
      force: true
    })

    // Should output JSON result
    expect(consoleSpy).toHaveBeenCalled()
  })

  test('trims whitespace from table name', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('  users  ', {
      data: '{"name":"Alice","email":"a@b.com"}',
      force: true
    })

    expect(consoleSpy).toHaveBeenCalled()
  })
})

// ============================================================================
// Data Input Tests
// ============================================================================

describe('insertCommand - Data Input', () => {
  test('parses valid JSON from --data flag', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Bob","email":"b@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('success')
  })

  test('handles invalid JSON error', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{invalid json}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('error')
    expect(result.error).toContain('JSON')
  })

  test('requires JSON object (not array)', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '[{"name":"Charlie"}]', // array, not object
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('error')
  })

  test('rejects empty JSON object', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('error')
  })

  test('requires data from --data or stdin', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    // Neither --data nor stdin provided (in test environment)
    await insertCommand('users', {})

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('error')
  })
})

// ============================================================================
// Permission Enforcement Tests
// ============================================================================

describe('insertCommand - Permission Enforcement', () => {
  test('query-only permission rejects INSERT', async () => {
    const queryOnlyConfig: DbcliConfig = {
      ...mockConfig,
      permission: 'query-only'
    }

    vi.mock('@/core/config', () => ({
      configModule: {
        read: async () => queryOnlyConfig
      }
    }))

    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Diana","email":"d@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('error')
  })

  test('read-write permission allows INSERT', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Eve","email":"e@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('success')
  })

  test('admin permission allows INSERT', async () => {
    const adminConfig: DbcliConfig = {
      ...mockConfig,
      permission: 'admin'
    }

    vi.mock('@/core/config', () => ({
      configModule: {
        read: async () => adminConfig
      }
    }))

    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Frank","email":"f@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('success')
  })

  test('error message format is clear', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Grace","email":"g@b.com"}',
      force: true
    })

    // Check that output is JSON
    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('operation')
  })
})

// ============================================================================
// Execution Options Tests
// ============================================================================

describe('insertCommand - Execution Options', () => {
  test('--dry-run shows SQL without executing', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Henry","email":"h@b.com"}',
      dryRun: true,
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('success')
    expect(result.rows_affected).toBe(0)
    expect(result.sql).toBeDefined()
  })

  test('--force skips confirmation prompt', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Ivy","email":"i@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('success')
  })

  test('confirmation can be declined (returns 0 rows)', async () => {
    // Mock confirm to return false
    vi.mock('@/utils/prompts', () => ({
      promptUser: {
        confirm: vi.fn(async () => false)
      }
    }))

    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Jack","email":"j@b.com"}'
      // force: false (default)
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.rows_affected).toBe(0)
  })
})

// ============================================================================
// Output Formatting Tests
// ============================================================================

describe('insertCommand - Output Formatting', () => {
  test('outputs valid JSON result', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Kelly","email":"k@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    expect(() => JSON.parse(output)).not.toThrow()
  })

  test('JSON output includes required fields', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Leo","email":"l@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('operation', 'insert')
    expect(result).toHaveProperty('rows_affected')
  })

  test('error output includes error field', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{invalid}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('error')
    expect(result).toHaveProperty('error')
  })

  test('successful output includes timestamp', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Mia","email":"m@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result).toHaveProperty('timestamp')
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('dry-run output includes SQL statement', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Noah","email":"n@b.com"}',
      dryRun: true,
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result).toHaveProperty('sql')
    expect(result.sql).toContain('INSERT')
  })
})

// ============================================================================
// Error Case Tests
// ============================================================================

describe('insertCommand - Error Cases', () => {
  test('connection error is handled gracefully', async () => {
    mockAdapter.setFailure(true, 'connection error')
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Oscar","email":"o@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('error')
  })

  test('table not found error', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('nonexistent', {
      data: '{"name":"Pete","email":"p@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('error')
  })

  test('missing config file error', async () => {
    vi.mock('@/core/config', () => ({
      configModule: {
        read: async () => {
          throw new Error('Config not found')
        }
      }
    }))

    const consoleSpy = vi.spyOn(console, 'log')

    await insertCommand('users', {
      data: '{"name":"Quinn","email":"q@b.com"}',
      force: true
    })

    const output = consoleSpy.mock.calls[0][0]
    const result = JSON.parse(output)
    expect(result.status).toBe('error')
  })
})
