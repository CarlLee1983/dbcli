// tests/core/repl/repl-engine.test.ts
import { afterEach, beforeEach, describe, test, expect, mock, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReplEngine } from '../../../src/core/repl/repl-engine'
import type { ReplContext } from '../../../src/core/repl/types'
import type { DatabaseAdapter } from '../../../src/adapters/types'
import type { DbcliConfig } from '../../../src/types'

// Mock adapter
function createMockAdapter(): DatabaseAdapter {
  return {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    execute: mock(() =>
      Promise.resolve({ rows: [{ id: 1, name: 'Alice' }], affectedRows: 0 })
    ) as unknown as import('@/adapters/types').DatabaseAdapter['execute'],
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
  commandNames: [],
}

describe('ReplEngine', () => {
  let tempDirectory: string
  let historyPath: string

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-repl-engine-test-'))
    historyPath = join(tempDirectory, 'history')
  })

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true })
  })

  test('constructs with default state', () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath)
    const state = engine.getState()
    expect(state.format).toBe('table')
    expect(state.timing).toBe(false)
    expect(state.connected).toBe(true)
  })

  test('processInput handles empty input', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath)
    const result = await engine.processInput('')
    expect(result.action).toBe('continue')
    expect(result.output).toBeUndefined()
  })

  test('processInput handles meta quit', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath)
    const result = await engine.processInput('.quit')
    expect(result.action).toBe('quit')
  })

  test('processInput handles meta clear', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath)
    const result = await engine.processInput('.clear')
    expect(result.action).toBe('clear')
  })

  test('processInput handles SQL execution', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath)
    const result = await engine.processInput('SELECT * FROM users;')
    expect(result.action).toBe('continue')
    expect(result.output).toBeDefined()
    expect(adapter.execute).toHaveBeenCalled()
  })

  test('processInput accumulates multiline SQL', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath)

    const r1 = await engine.processInput('SELECT *')
    expect(r1.action).toBe('multiline')

    const r2 = await engine.processInput('FROM users;')
    expect(r2.action).toBe('continue')
    expect(adapter.execute).toHaveBeenCalled()
  })

  test('a spawned subcommand is marked as coming from the shell', async () => {
    // The child gets no stdin, so anything needing an answer refuses. The
    // marker is what lets that refusal say something the operator — who is at
    // this very prompt — can act on (#84).
    const spawn = spyOn(Bun, 'spawn').mockImplementation(
      () =>
        ({
          stdout: new Response('').body,
          stderr: new Response('').body,
          exited: Promise.resolve(0),
        }) as never
    )
    try {
      const engine = new ReplEngine(
        createMockAdapter(),
        { ...mockContext, commandNames: ['schema'] },
        historyPath
      )
      await engine.processInput('schema users')

      const options = spawn.mock.calls[0]?.[1] as { env: Record<string, string> }
      expect(options.env.DBCLI_SHELL_SUBCOMMAND).toBe('1')
    } finally {
      spawn.mockRestore()
    }
  })

  test('processInput handles SQL error without crashing', async () => {
    const adapter = createMockAdapter()
    ;(adapter.execute as any).mockImplementation(() => {
      throw new Error('relation "foo" does not exist')
    })
    const engine = new ReplEngine(adapter, mockContext, historyPath)
    const result = await engine.processInput('SELECT * FROM foo;')
    expect(result.action).toBe('continue')
    expect(result.output).toContain('relation "foo" does not exist')
  })

  test('processInput handles permission error', async () => {
    const ctx: ReplContext = { ...mockContext, permission: 'query-only' }
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, ctx, historyPath)
    const result = await engine.processInput('DELETE FROM users WHERE id = 1;')
    expect(result.action).toBe('continue')
    expect(result.output).toBeDefined()
  })

  test('state updates from meta commands persist', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath)
    await engine.processInput('.format json')
    expect(engine.getState().format).toBe('json')

    await engine.processInput('.timing on')
    expect(engine.getState().timing).toBe(true)
  })

  test('isMultiline returns true during multiline input', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath)
    expect(engine.isMultiline()).toBe(false)

    await engine.processInput('SELECT *')
    expect(engine.isMultiline()).toBe(true)
  })

  test('cancelling multiline drops what was typed instead of prefixing the next statement', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath)

    await engine.processInput('SELECT *')
    engine.cancelMultiline()
    expect(engine.isMultiline()).toBe(false)

    await engine.processInput('SELECT 1;')

    const [sql] = (adapter.execute as unknown as { mock: { calls: string[][] } }).mock.calls[0]!
    expect(sql).toBe('SELECT 1;')
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
    const engine = new ReplEngine(adapter, mockContext, historyPath)
    const result = await engine.processInput('SELECT 1;')
    expect(result.action).toBe('continue')
    expect(adapter.connect).toHaveBeenCalledTimes(1) // reconnect call
    expect(result.output).toBeDefined()
  })

  // Issue 1 fix: test that INSERT INTO a blacklisted table is blocked
  test('blocks INSERT INTO blacklisted table', async () => {
    const adapter = createMockAdapter()
    const config: DbcliConfig = {
      connection: {
        system: 'postgresql' as const,
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: '',
        database: 'test',
      },
      permission: 'admin' as const,
      blacklist: { tables: ['secrets'], columns: {} },
      metadata: { version: '1.0' },
    }
    const engine = new ReplEngine(adapter, mockContext, historyPath, config)
    const result = await engine.processInput("INSERT INTO secrets (key) VALUES ('x');")
    expect(result.action).toBe('continue')
    expect(result.output).toContain('secrets')
    expect(adapter.execute).not.toHaveBeenCalled()
  })

  // Issue #23: the shell's own blacklist check also read only the first table,
  // so a JOIN / comma / UNION reached a blacklisted table unblocked.
  const blacklistConfig: DbcliConfig = {
    connection: {
      system: 'postgresql' as const,
      host: 'localhost',
      port: 5432,
      user: 'test',
      password: '',
      database: 'test',
    },
    permission: 'admin' as const,
    blacklist: { tables: ['secrets'], columns: {} },
    metadata: { version: '1.0' },
  }

  const joinedStatements: [string, string][] = [
    ['JOIN', 'SELECT * FROM users u JOIN secrets s ON s.user_id = u.id;'],
    ['comma', 'SELECT * FROM users, secrets;'],
    ['UNION', 'SELECT id FROM users UNION ALL SELECT id FROM secrets;'],
    ['subquery', 'SELECT * FROM users WHERE id IN (SELECT user_id FROM secrets);'],
  ]

  for (const [label, sql] of joinedStatements) {
    test(`blocks a blacklisted table reached through ${label}`, async () => {
      const adapter = createMockAdapter()
      const engine = new ReplEngine(adapter, mockContext, historyPath, blacklistConfig)
      const result = await engine.processInput(sql)

      expect(result.output).toContain('secrets')
      expect(adapter.execute).not.toHaveBeenCalled()
    })
  }

  // The shell formatted rows straight from the adapter, so `blacklist.columns`
  // was never consulted on this path at all.
  test('masks blacklisted columns in shell output', async () => {
    const adapter = createMockAdapter()
    adapter.execute = mock(() =>
      Promise.resolve({ rows: [{ id: 1, password_hash: 'SECRET' }], affectedRows: 1 })
    ) as unknown as DatabaseAdapter['execute']
    const config: DbcliConfig = {
      ...blacklistConfig,
      blacklist: { tables: [], columns: { users: ['password_hash'] } },
    }
    const engine = new ReplEngine(adapter, mockContext, historyPath, config)
    const result = await engine.processInput('SELECT id, password_hash FROM users;')

    expect(result.output).not.toContain('SECRET')
    expect(result.output).not.toContain('password_hash')
    expect(result.output).toContain('id')
  })

  test('still runs a statement that touches no blacklisted table', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, historyPath, blacklistConfig)
    await engine.processInput('SELECT * FROM users u JOIN orders o ON o.user_id = u.id;')

    expect(adapter.execute).toHaveBeenCalled()
  })
})
