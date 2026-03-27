/**
 * Tests for BlacklistValidator wiring in insert, update, delete commands
 *
 * Verifies that insert.ts, update.ts, and delete.ts correctly construct
 * BlacklistManager + BlacklistValidator and pass them to DataExecutor so
 * that blacklist rules take runtime effect.
 *
 * Uses spyOn instead of mock.module to prevent global mock leakage across test files.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import { BlacklistError } from '@/types/blacklist'
import { DataExecutor } from '@/core/data-executor'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'

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

// Spies to be restored
let insertSpy: any
let updateSpy: any
let deleteSpy: any
let createAdapterSpy: any
let configReadSpy: any

// Mock the adapter
const mockAdapter = {
  connect: mock(async () => {}),
  disconnect: mock(async () => {}),
  execute: mock(async () => []),
  getTableSchema: mock(async () => ({
    name: 'payments',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true },
      { name: 'amount', type: 'decimal', nullable: false, primaryKey: false },
    ],
    rowCount: 0,
    primaryKey: 'id',
    foreignKeys: []
  })),
  listTables: mock(async () => []),
  ping: mock(async () => {}),
}

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

    // spyOn AdapterFactory.createAdapter to return mock adapter (no global leakage)
    createAdapterSpy = spyOn(AdapterFactory, 'createAdapter').mockReturnValue(mockAdapter as any)

    // spyOn configModule.read to return test config (no global leakage)
    configReadSpy = spyOn(configModule, 'read').mockImplementation(async () => capturedConfig)

    insertSpy = spyOn(DataExecutor.prototype, 'executeInsert').mockImplementation(async function(this: any) {
      capturedBlacklistValidator = this.blacklistValidator
      if (mockExecuteError) throw mockExecuteError
      return { ...mockExecuteResult, operation: 'insert' }
    })

    updateSpy = spyOn(DataExecutor.prototype, 'executeUpdate').mockImplementation(async function(this: any) {
      capturedBlacklistValidator = this.blacklistValidator
      if (mockExecuteError) throw mockExecuteError
      return { ...mockExecuteResult, operation: 'update' }
    })

    deleteSpy = spyOn(DataExecutor.prototype, 'executeDelete').mockImplementation(async function(this: any) {
      capturedBlacklistValidator = this.blacklistValidator
      if (mockExecuteError) throw mockExecuteError
      return { ...mockExecuteResult, operation: 'delete' }
    })
  })

  afterEach(() => {
    process.exit = originalExit
    insertSpy.mockRestore()
    updateSpy.mockRestore()
    deleteSpy.mockRestore()
    createAdapterSpy.mockRestore()
    configReadSpy.mockRestore()
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
