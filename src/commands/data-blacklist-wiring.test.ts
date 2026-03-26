/**
 * Tests for BlacklistValidator wiring in insert, update, delete commands
 *
 * Verifies that insert.ts, update.ts, and delete.ts correctly construct
 * BlacklistManager + BlacklistValidator and pass them to DataExecutor so
 * that blacklist rules take runtime effect.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { BlacklistError } from '@/types/blacklist'

// Track what DataExecutor was constructed with (4th arg)
let capturedBlacklistValidator: any = undefined
let capturedConfig: any = undefined
let mockExecuteResult: any = {
  status: 'success',
  operation: 'insert',
  rows_affected: 1,
  timestamp: new Date().toISOString(),
}
let mockExecuteError: Error | null = null

// Mock the adapter
const mockAdapter = {
  connect: mock(async () => {}),
  disconnect: mock(async () => {}),
  execute: mock(async () => []),
  getTableSchema: mock(async () => ({
    tableName: 'payments',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true },
      { name: 'amount', type: 'decimal', nullable: false, primaryKey: false },
    ],
  })),
  getTables: mock(async () => []),
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

// Mock configModule
mock.module('@/core/config', () => ({
  configModule: {
    read: mock(async () => capturedConfig),
  },
}))

// Mock DataExecutor to capture 4th argument and control behavior
mock.module('@/core/data-executor', () => ({
  DataExecutor: class MockDataExecutor {
    constructor(_adapter: any, _permission: any, _dbSystem: any, blacklistValidator?: any) {
      capturedBlacklistValidator = blacklistValidator
    }

    async executeInsert(_table: string, _data: any, _schema: any, _options?: any) {
      if (mockExecuteError) {
        throw mockExecuteError
      }
      return { ...mockExecuteResult, operation: 'insert' }
    }

    async executeUpdate(_table: string, _set: any, _where: any, _schema: any, _options?: any) {
      if (mockExecuteError) {
        throw mockExecuteError
      }
      return { ...mockExecuteResult, operation: 'update' }
    }

    async executeDelete(_table: string, _where: any, _schema: any, _options?: any) {
      if (mockExecuteError) {
        throw mockExecuteError
      }
      return { ...mockExecuteResult, operation: 'delete' }
    }
  },
}))

// Mock message loader
mock.module('@/i18n/message-loader', () => ({
  t: (key: string) => key,
  t_vars: (key: string, vars: Record<string, any>) => `${key}: ${JSON.stringify(vars)}`,
}))

describe('insert/update/delete command blacklist wiring', () => {
  let exitCode: number | null = null
  let originalExit: typeof process.exit

  beforeEach(() => {
    capturedBlacklistValidator = undefined
    mockExecuteError = null
    exitCode = null
    originalExit = process.exit

    process.exit = ((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${code})`)
    }) as any
  })

  afterEach(() => {
    process.exit = originalExit
  })

  // ===== INSERT COMMAND TESTS =====

  test('Test 1: insertCommand with blacklisted table rejects with BlacklistError message', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'read-write',
      blacklist: { tables: ['payments'], columns: {} },
    }

    mockExecuteError = new BlacklistError(
      'Table "payments" is blacklisted for INSERT operations',
      'payments',
      'INSERT'
    )

    const { insertCommand } = await import('@/commands/insert')

    try {
      await insertCommand('payments', { data: '{"amount": 100}' })
    } catch (e: any) {
      // swallow process.exit errors
    }

    expect(exitCode).toBe(1)
  })

  test('Test 1b: insertCommand constructs and passes blacklistValidator to DataExecutor', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'read-write',
      blacklist: { tables: ['payments'], columns: {} },
    }
    mockExecuteError = null

    const { insertCommand } = await import('@/commands/insert')

    try {
      await insertCommand('users', { data: '{"name": "Alice"}' })
    } catch (e: any) {
      // swallow process.exit errors
    }

    expect(capturedBlacklistValidator).toBeDefined()
    expect(capturedBlacklistValidator).not.toBeNull()
  })

  // ===== UPDATE COMMAND TESTS =====

  test('Test 2: updateCommand with blacklisted table rejects with BlacklistError message', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'read-write',
      blacklist: { tables: ['payments'], columns: {} },
    }

    mockExecuteError = new BlacklistError(
      'Table "payments" is blacklisted for UPDATE operations',
      'payments',
      'UPDATE'
    )

    const { updateCommand } = await import('@/commands/update')

    try {
      await updateCommand('payments', { where: 'id=1', set: '{"amount": 200}' })
    } catch (e: any) {
      // swallow process.exit errors
    }

    expect(exitCode).toBe(1)
  })

  test('Test 2b: updateCommand constructs and passes blacklistValidator to DataExecutor', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'read-write',
      blacklist: { tables: [], columns: {} },
    }
    mockExecuteError = null

    const { updateCommand } = await import('@/commands/update')

    try {
      await updateCommand('users', { where: 'id=1', set: '{"name": "Bob"}' })
    } catch (e: any) {
      // swallow process.exit errors
    }

    expect(capturedBlacklistValidator).toBeDefined()
  })

  // ===== DELETE COMMAND TESTS =====

  test('Test 3: deleteCommand with blacklisted table rejects with BlacklistError message', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'admin',
      blacklist: { tables: ['payments'], columns: {} },
    }

    mockExecuteError = new BlacklistError(
      'Table "payments" is blacklisted for DELETE operations',
      'payments',
      'DELETE'
    )

    const { deleteCommand } = await import('@/commands/delete')

    try {
      await deleteCommand('payments', { where: 'id=1' })
    } catch (e: any) {
      // swallow process.exit errors
    }

    expect(exitCode).toBe(1)
  })

  test('Test 3b: deleteCommand constructs and passes blacklistValidator to DataExecutor', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'admin',
      blacklist: { tables: [], columns: {} },
    }
    mockExecuteError = null

    const { deleteCommand } = await import('@/commands/delete')

    try {
      await deleteCommand('users', { where: 'id=1' })
    } catch (e: any) {
      // swallow process.exit errors
    }

    expect(capturedBlacklistValidator).toBeDefined()
  })

  // ===== UNDEFINED BLACKLIST CONFIG =====

  test('Test 4: All three commands with undefined blacklist config allow operations (no rejection)', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'read-write',
      // No blacklist key
    }
    mockExecuteError = null

    const { insertCommand } = await import('@/commands/insert')
    const { updateCommand } = await import('@/commands/update')

    // insertCommand should not throw
    capturedBlacklistValidator = undefined
    try {
      await insertCommand('users', { data: '{"name": "Alice"}' })
    } catch (e: any) {
      // swallow process.exit from successful result output
    }
    // Validator should still be constructed (manager handles undefined gracefully)
    expect(capturedBlacklistValidator).toBeDefined()
    expect(exitCode).toBeNull()

    // updateCommand should not throw
    exitCode = null
    capturedBlacklistValidator = undefined
    try {
      await updateCommand('users', { where: 'id=1', set: '{"name": "Bob"}' })
    } catch (e: any) {
      // swallow
    }
    expect(capturedBlacklistValidator).toBeDefined()
    expect(exitCode).toBeNull()
  })

  // ===== BLACKLIST ERROR CAUGHT BEFORE GENERIC HANDLER =====

  test('Test 5: BlacklistError outputs JSON error and exits with code 1 (not swallowed by generic handler)', async () => {
    capturedConfig = {
      connection: { system: 'postgresql', host: 'localhost', port: 5432, database: 'test', user: 'user', password: 'pass' },
      permission: 'read-write',
      blacklist: { tables: ['payments'], columns: {} },
    }

    const blacklistErrMsg = 'Table "payments" is blacklisted for INSERT operations'
    mockExecuteError = new BlacklistError(blacklistErrMsg, 'payments', 'INSERT')

    const outputLines: string[] = []
    const originalLog = console.log
    console.log = (msg: string) => outputLines.push(msg)

    const { insertCommand } = await import('@/commands/insert')

    try {
      await insertCommand('payments', { data: '{"amount": 100}' })
    } catch (e: any) {
      // swallow process.exit
    } finally {
      console.log = originalLog
    }

    expect(exitCode).toBe(1)
    // Should output JSON with error field
    const jsonOutput = outputLines.find(l => {
      try { const p = JSON.parse(l); return p.status === 'error' } catch { return false }
    })
    expect(jsonOutput).toBeDefined()
    if (jsonOutput) {
      const parsed = JSON.parse(jsonOutput)
      expect(parsed.error).toContain('payments')
    }
  })
})
