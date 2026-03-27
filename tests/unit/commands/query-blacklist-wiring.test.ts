/**
 * Tests for BlacklistValidator wiring in queryCommand
 *
 * Verifies that query.ts correctly constructs and passes BlacklistManager +
 * BlacklistValidator to QueryExecutor so that blacklist rules take runtime effect.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import { BlacklistError } from '@/types/blacklist'
import { QueryExecutor } from '@/core/query-executor'

// Track what QueryExecutor was constructed with
let capturedBlacklistValidator: any = undefined
let capturedConfig: any = undefined
let mockExecuteResult: any = { rows: [], rowCount: 0, columnNames: [], columnTypes: [], executionTimeMs: 1, metadata: { statement: 'SELECT', affectedRows: 0 } }
let mockExecuteError: Error | null = null

// Spy to be restored
let executeSpy: any

// Mock the adapter
const mockAdapter = {
  connect: mock(async () => {}),
  disconnect: mock(async () => {}),
  execute: mock(async () => []),
  getTableSchema: mock(async () => ({ name: 'test', columns: [], rowCount: 0, primaryKey: null, foreignKeys: [] })),
  getTables: mock(async () => []),
  listTables: mock(async () => []),
  ping: mock(async () => {}),
}

// Mock AdapterFactory
mock.module('@/adapters', () => ({
  AdapterFactory: {
    createAdapter: mock(() => mockAdapter),
  },
  ConnectionError: class ConnectionError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ConnectionError'
    }
  },
}))

// Mock QueryResultFormatter
mock.module('@/formatters', () => ({
  QueryResultFormatter: class QueryResultFormatter {
    format() {
      return 'formatted output'
    }
  },
  TableFormatter: class { format() { return '' } },
  TableListFormatter: class { format() { return '' } },
  JSONFormatter: class { format() { return '{}' } },
  TableSchemaJSONFormatter: class { format() { return '{}' } },
}))

// Mock configModule
mock.module('@/core/config', () => ({
  configModule: {
    read: mock(async () => capturedConfig),
  },
}))

describe('queryCommand blacklist wiring', () => {
  let exitCode: number | null = null
  let originalExit: typeof process.exit

  beforeEach(() => {
    capturedBlacklistValidator = undefined
    mockExecuteError = null
    exitCode = null
    originalExit = process.exit

    // Capture process.exit calls
    process.exit = ((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${code})`)
    }) as any

    // Use spyOn instead of mock.module to avoid global pollution
    executeSpy = spyOn(QueryExecutor.prototype, 'execute').mockImplementation(async function(this: any) {
      capturedBlacklistValidator = this.blacklistValidator
      if (mockExecuteError) {
        throw mockExecuteError
      }
      return mockExecuteResult
    })
  })

  afterEach(() => {
    process.exit = originalExit
    executeSpy.mockRestore()
  })

  test('Test 1: queryCommand with blacklisted table throws/exits with blacklist error message', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'admin',
      blacklist: { tables: ['sensitive_logs'], columns: {} },
    }

    // Simulate BlacklistError being thrown by QueryExecutor when it checks the blacklist
    mockExecuteError = new BlacklistError('Table "sensitive_logs" is blacklisted for SELECT operations', 'sensitive_logs', 'SELECT')

    const { queryCommand } = await import('@/commands/query')

    try {
      await queryCommand('SELECT * FROM sensitive_logs', {})
    } catch (e: any) {
      // swallow exit error
    }

    // Should have called process.exit(1)
    expect(exitCode).toBe(1)
  })

  test('Test 2: queryCommand with empty blacklist config allows operation', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'admin',
      blacklist: { tables: [], columns: {} },
    }
    mockExecuteError = null
    mockExecuteResult = {
      rows: [{ id: 1 }],
      rowCount: 1,
      columnNames: ['id'],
      columnTypes: ['integer'],
      executionTimeMs: 5,
      metadata: { statement: 'SELECT', affectedRows: 1 },
    }

    const { queryCommand } = await import('@/commands/query')

    // Should NOT throw
    await queryCommand('SELECT * FROM sensitive_logs', {})

    // Should have exited cleanly (no exit called)
    expect(exitCode).toBeNull()
    // Validator should still be constructed (always)
    expect(capturedBlacklistValidator).toBeDefined()
  })

  test('Test 3: queryCommand with undefined blacklist config does NOT throw', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'admin',
      // No blacklist key
    }
    mockExecuteError = null
    mockExecuteResult = {
      rows: [],
      rowCount: 0,
      columnNames: [],
      columnTypes: [],
      executionTimeMs: 1,
      metadata: { statement: 'SELECT', affectedRows: 0 },
    }

    const { queryCommand } = await import('@/commands/query')

    // Should NOT throw even without blacklist config
    await queryCommand('SELECT * FROM any_table', {})

    // Should have exited cleanly (no exit called)
    expect(exitCode).toBeNull()
  })

  test('Test 4: queryCommand constructs validator and passes to QueryExecutor', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'admin',
      blacklist: { tables: [], columns: { users: ['password'] } },
    }
    mockExecuteError = null
    mockExecuteResult = {
      rows: [{ id: 1, name: 'Alice' }],
      rowCount: 1,
      columnNames: ['id', 'name'],
      columnTypes: ['integer', 'varchar'],
      executionTimeMs: 5,
      metadata: { statement: 'SELECT', affectedRows: 1 },
    }

    const { queryCommand } = await import('@/commands/query')

    await queryCommand('SELECT * FROM users', {})

    // Validator MUST be passed to QueryExecutor
    expect(capturedBlacklistValidator).toBeDefined()
    expect(capturedBlacklistValidator).not.toBeNull()
  })
})
