// tests/core/repl/repl-engine.test.ts
import { describe, test, expect, mock } from 'bun:test'
import { ReplEngine } from '../../../src/core/repl/repl-engine'
import type { ReplContext } from '../../../src/core/repl/types'
import type { DatabaseAdapter } from '../../../src/adapters/types'
import type { DbcliConfig } from '../../../src/types'

// Mock adapter
function createMockAdapter(): DatabaseAdapter {
  return {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    execute: mock(() => Promise.resolve([{ id: 1, name: 'Alice' }])),
    listTables: mock(() => Promise.resolve([])),
    getTableSchema: mock(() => Promise.resolve({ name: 'users', columns: [] })),
    testConnection: mock(() => Promise.resolve(true)),
    getServerVersion: mock(() => Promise.resolve('15.0')),
  }
}

const mockContext: ReplContext = {
  configPath: '.dbcli',
  permission: 'admin',
  system: 'postgresql',
  tableNames: ['users'],
  columnsByTable: { users: ['id', 'name'] },
}

describe('ReplEngine', () => {
  test('constructs with default state', () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const state = engine.getState()
    expect(state.format).toBe('table')
    expect(state.timing).toBe(false)
    expect(state.connected).toBe(true)
  })

  test('processInput handles empty input', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('')
    expect(result.action).toBe('continue')
    expect(result.output).toBeUndefined()
  })

  test('processInput handles meta quit', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('.quit')
    expect(result.action).toBe('quit')
  })

  test('processInput handles meta clear', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('.clear')
    expect(result.action).toBe('clear')
  })

  test('processInput handles SQL execution', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('SELECT * FROM users;')
    expect(result.action).toBe('continue')
    expect(result.output).toBeDefined()
    expect(adapter.execute).toHaveBeenCalled()
  })

  test('processInput accumulates multiline SQL', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')

    const r1 = await engine.processInput('SELECT *')
    expect(r1.action).toBe('multiline')

    const r2 = await engine.processInput('FROM users;')
    expect(r2.action).toBe('continue')
    expect(adapter.execute).toHaveBeenCalled()
  })

  test('processInput handles SQL error without crashing', async () => {
    const adapter = createMockAdapter()
    ;(adapter.execute as any).mockImplementation(() => {
      throw new Error('relation "foo" does not exist')
    })
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('SELECT * FROM foo;')
    expect(result.action).toBe('continue')
    expect(result.output).toContain('relation "foo" does not exist')
  })

  test('processInput handles permission error', async () => {
    const ctx: ReplContext = { ...mockContext, permission: 'query-only' }
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, ctx, '/tmp/test_history')
    const result = await engine.processInput('DELETE FROM users WHERE id = 1;')
    expect(result.action).toBe('continue')
    expect(result.output).toBeDefined()
  })

  test('state updates from meta commands persist', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    await engine.processInput('.format json')
    expect(engine.getState().format).toBe('json')

    await engine.processInput('.timing on')
    expect(engine.getState().timing).toBe(true)
  })

  test('isMultiline returns true during multiline input', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    expect(engine.isMultiline()).toBe(false)

    await engine.processInput('SELECT *')
    expect(engine.isMultiline()).toBe(true)
  })

  test('attempts reconnection on connection error', async () => {
    const adapter = createMockAdapter()
    let callCount = 0
    ;(adapter.execute as any).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const err = new Error('connection terminated')
        ;(err as any).code = 'ECONNRESET'
        throw err
      }
      return Promise.resolve([{ id: 1 }])
    })
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('SELECT 1;')
    expect(result.action).toBe('continue')
    expect(adapter.connect).toHaveBeenCalledTimes(1) // reconnect call
    expect(result.output).toBeDefined()
  })

  // Issue 1 fix: test that INSERT INTO a blacklisted table is blocked
  test('blocks INSERT INTO blacklisted table', async () => {
    const adapter = createMockAdapter()
    const config: DbcliConfig = {
      connection: { system: 'postgresql' as const, host: 'localhost', port: 5432, user: 'test', password: '', database: 'test' },
      permission: 'admin' as const,
      blacklist: { tables: ['secrets'], columns: {} },
      metadata: { version: '1.0' },
    }
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history', config)
    const result = await engine.processInput("INSERT INTO secrets (key) VALUES ('x');")
    expect(result.action).toBe('continue')
    expect(result.output).toContain('secrets')
    expect(adapter.execute).not.toHaveBeenCalled()
  })
})
