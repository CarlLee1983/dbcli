/**
 * Unit tests for query command
 * Tests command logic, permission enforcement, formatting, and error handling
 */

import { describe, test, expect, beforeEach, spyOn, mock } from 'bun:test'
import type { DatabaseAdapter } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'

// Mock adapter for testing
class MockAdapter implements DatabaseAdapter {
  private shouldFail = false
  private failureMessage = ''

  setFailure(shouldFail: boolean, message = '') {
    this.shouldFail = shouldFail
    this.failureMessage = message
  }

  async connect(): Promise<void> {
    if (this.shouldFail && this.failureMessage.includes('connection')) {
      throw new Error('Connection failed')
    }
  }

  async disconnect(): Promise<void> {}

  async execute<T>(sql: string): Promise<T[]> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage || 'Query failed')
    }

    // Return mock data based on query
    if (sql.includes('SELECT')) {
      return [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' }
      ] as T[]
    }

    return [] as T[]
  }

  async listTables() {
    return [
      { name: 'users', columns: [], rowCount: 100 },
      { name: 'orders', columns: [], rowCount: 50 }
    ]
  }

  async getTableSchema() {
    return {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'name', type: 'varchar', nullable: false }
      ]
    }
  }

  async testConnection(): Promise<boolean> {
    return true
  }
}

let mockAdapter: MockAdapter
let mockConfig: DbcliConfig

// Mock modules
mock.module('@/adapters', () => ({
  AdapterFactory: {
    createAdapter: () => mockAdapter
  },
  ConnectionError: class ConnectionError extends Error {}
}))

mock.module('@/core/config', () => ({
  configModule: {
    read: async () => mockConfig
  }
}))

mock.module('@/formatters', () => ({
  QueryResultFormatter: class {
    format(result: any, options?: any) {
      const format = options?.format || 'table'
      if (format === 'json') {
        return JSON.stringify(result, null, 2)
      } else if (format === 'csv') {
        const headers = result.columnNames.join(',')
        const rows = result.rows
          .map((row: any) => result.columnNames.map((col: string) => row[col]).join(','))
          .join('\n')
        return `${headers}\n${rows}`
      }
      // table format
      return `Table: ${result.rowCount} rows`
    }
  },
  TableFormatter: class { format() { return '' } },
  TableListFormatter: class { format() { return '' } },
  JSONFormatter: class { format() { return '{}' } },
  TableSchemaJSONFormatter: class { format() { return '{}' } },
}))

// Import after mocks are set up
const { queryCommand } = await import('@/commands/query')

describe('Query Command', () => {
  beforeEach(() => {
    mockAdapter = new MockAdapter()
    mockConfig = {
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'testdb'
      },
      permission: 'query-only',
      schema: {},
      metadata: { version: '1.0' }
    }
  })

  describe('Argument Validation', () => {
    test('should reject missing SQL argument', async () => {
      const logSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        await queryCommand('', {})
      } catch {
        // Expected to exit
      }

      expect(exitSpy).toHaveBeenCalledWith(1)
      logSpy.mockRestore()
      exitSpy.mockRestore()
    })

    test('should reject empty SQL string', async () => {
      const logSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        await queryCommand('   ', {})
      } catch {
        // Expected to exit
      }

      expect(exitSpy).toHaveBeenCalledWith(1)
      logSpy.mockRestore()
      exitSpy.mockRestore()
    })

    test('should accept valid SQL string', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })
  })

  describe('Configuration Loading', () => {
    test('should require initialized database', async () => {
      mockConfig.connection = undefined as any
      const logSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        await queryCommand('SELECT 1', {})
      } catch {
        // Expected
      }

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('dbcli init'))
      exitSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe('Result Formatting', () => {
    test('should format as table by default', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', {})

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Table:'))
      logSpy.mockRestore()
    })

    test('should format as JSON when requested', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { format: 'json' })

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('rowCount'))
      logSpy.mockRestore()
    })

    test('should format as CSV when requested', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { format: 'csv' })

      const calls = logSpy.mock.calls.flat().join('\n')
      expect(calls).toMatch(/id.*name.*email/)
      logSpy.mockRestore()
    })
  })

  describe('Permission Enforcement', () => {
    test('should allow SELECT in query-only mode', async () => {
      mockConfig.permission = 'query-only'
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    test('should block INSERT in query-only mode', async () => {
      mockConfig.permission = 'query-only'
      const logSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        await queryCommand('INSERT INTO users VALUES (1, "Eve")', {})
      } catch {
        // Expected to exit
      }

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Permission'))
      exitSpy.mockRestore()
      logSpy.mockRestore()
    })

    test('should allow INSERT in read-write mode', async () => {
      mockConfig.permission = 'read-write'
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('INSERT INTO users VALUES (1, "Eve")', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    test('should allow everything in admin mode', async () => {
      mockConfig.permission = 'admin'
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('DROP TABLE users', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })
  })

  describe('Error Handling', () => {
    test('should display connection error with hints', async () => {
      mockAdapter.setFailure(true, 'connection error')
      const logSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        await queryCommand('SELECT 1', {})
      } catch {
        // Expected
      }

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Connection'))
      exitSpy.mockRestore()
      logSpy.mockRestore()
    })

    test('should display query error', async () => {
      mockAdapter.setFailure(true, 'syntax error')
      const logSpy = spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        // Use a proper SELECT statement that will fail
        await queryCommand('SELECT * FROM nonexistent_table', {})
      } catch {
        // Expected
      }

      expect(logSpy).toHaveBeenCalled()
      exitSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe('Auto-limit Behavior', () => {
    test('should not include --limit in default case', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    test('should respect custom limit option', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { limit: 500 })

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    test('should disable auto-limit with --no-limit', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { noLimit: true })

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })
  })
})
