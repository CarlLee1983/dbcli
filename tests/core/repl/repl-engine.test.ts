// tests/core/repl/repl-engine.test.ts
import { afterEach, beforeEach, describe, test, expect, mock, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReplEngine } from '../../../src/core/repl/repl-engine'
import type { ReplContext } from '../../../src/core/repl/types'
import { ConnectionError, type DatabaseAdapter } from '../../../src/adapters/types'
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

  test('query-only SQL execution carries the native boundary through the shell', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(
      adapter,
      { ...mockContext, permission: 'query-only' },
      historyPath
    )

    await engine.processInput('SELECT 1;')

    expect((adapter.execute as any).mock.calls[0]?.[2]).toEqual({
      noLimit: false,
      sqlMode: 'native-read-only',
    })
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

  test('a line that reads as SQL but names a subcommand says how to reach it', async () => {
    // SQL wins the clash, so `delete users --where status=active` is a statement
    // waiting for its semicolon — which is correct and completely opaque to
    // whoever meant the subcommand. The hint is the only thing that tells them
    // the prefix exists; it does not change what the line is (#88).
    const engine = new ReplEngine(
      createMockAdapter(),
      { ...mockContext, commandNames: ['delete'] },
      historyPath
    )

    const result = await engine.processInput('delete users --where status=active')

    expect(result.action).toBe('multiline')
    expect(result.output ?? '').toContain('\\delete')
  })

  test('a SQL comment is not a flag', async () => {
    // `--` opens a comment as well as an option, so `DELETE FROM t --note`
    // matched the first two conditions and told the operator to use `\\delete`
    // for an ordinary statement.
    const engine = new ReplEngine(
      createMockAdapter(),
      { ...mockContext, commandNames: ['delete'] },
      historyPath
    )

    const result = await engine.processInput('DELETE FROM users --keep this comment')
    expect(result.action).toBe('multiline')
    expect(result.output).toBeUndefined()
  })

  test('an ordinary statement gets no hint', async () => {
    const engine = new ReplEngine(
      createMockAdapter(),
      { ...mockContext, commandNames: ['delete'] },
      historyPath
    )

    const result = await engine.processInput('DELETE FROM users')
    expect(result.action).toBe('multiline')
    expect(result.output).toBeUndefined()
  })

  describe('a half-typed statement does not take the shell hostage', () => {
    // The half of #88 that mattered more: a line misread as SQL opened multiline
    // mode, and everything after it — `.quit` included — went into the buffer.
    // The operator saw a shell that had stopped responding and could only end
    // the session from outside.
    test('.quit still quits while a statement is buffering', async () => {
      const engine = new ReplEngine(createMockAdapter(), mockContext, historyPath)

      expect((await engine.processInput('SELECT * FROM users')).action).toBe('multiline')
      expect(engine.isMultiline()).toBe(true)

      expect((await engine.processInput('.quit')).action).toBe('quit')
    })

    test('.exit does too', async () => {
      const engine = new ReplEngine(createMockAdapter(), mockContext, historyPath)
      await engine.processInput('SELECT * FROM users')
      expect((await engine.processInput('.exit')).action).toBe('quit')
    })

    test('.clear abandons the buffer rather than being appended to it', async () => {
      const engine = new ReplEngine(createMockAdapter(), mockContext, historyPath)
      await engine.processInput('SELECT * FROM users')

      expect((await engine.processInput('.clear')).action).toBe('clear')
      expect(engine.isMultiline()).toBe(false)
    })

    test('a meta name inside an open string literal stays part of the statement', async () => {
      // The escape has to know where it is. `MultilineBuffer` tracks quoting;
      // classifying the raw line does not, so a literal spanning lines had its
      // middle lifted out and the statement reached the server mutilated —
      // silent data corruption on an INSERT or UPDATE.
      const adapter = createMockAdapter()
      const engine = new ReplEngine(adapter, mockContext, historyPath)

      await engine.processInput("SELECT 'a")
      expect((await engine.processInput('.timing off')).action).toBe('multiline')
      await engine.processInput("b' AS t;")

      const sql = (adapter.execute as any).mock.calls[0][0] as string
      expect(sql).toContain('.timing off')
    })

    test('a line that merely looks like a meta command is still SQL', async () => {
      // `.5` is a fragment of a decimal literal, not a command. Only the names
      // the shell actually implements are lifted out of the buffer.
      const adapter = createMockAdapter()
      const engine = new ReplEngine(adapter, mockContext, historyPath)
      await engine.processInput('SELECT * FROM t WHERE x >')

      expect((await engine.processInput('.5;')).action).toBe('continue')
      expect(adapter.execute).toHaveBeenCalled()
      const sql = (adapter.execute as any).mock.calls[0][0] as string
      expect(sql).toContain('.5')
    })
  })

  test('a Redis shell executes a prefixed command without its prefix', async () => {
    // Redis accepts raw commands that are not dbcli subcommands, and that branch
    // used the unstripped line: the backslash reached the permission classifier,
    // which read `\\GET` as an unknown command and denied it at every tier.
    const adapter = createMockAdapter()
    const engine = new ReplEngine(
      adapter,
      { ...mockContext, system: 'redis', commandNames: [] },
      historyPath,
      { permission: 'admin' } as never
    )

    const result = await engine.processInput('\\GET foo')

    expect(result.output ?? '').not.toContain('Permission denied')
    expect(adapter.execute).toHaveBeenCalled()
    expect((adapter.execute as any).mock.calls[0][0]).toBe('GET foo')
  })

  test('a backslash-prefixed subcommand runs the subcommand, not SQL', async () => {
    // The clash this exists for: `delete users --where …` is SQL by decision, so
    // the subcommand needs a prefix that no statement can claim. Measured before
    // the fix: the line reached the command path carrying its backslash, and the
    // dispatcher answered "unknown command: \\delete" (#88).
    const spawn = spyOn(Bun, 'spawn').mockImplementation(
      () =>
        ({
          stdout: new Response('').body,
          stderr: new Response('').body,
          exited: Promise.resolve(0),
        }) as never
    )
    try {
      const adapter = createMockAdapter()
      const engine = new ReplEngine(
        adapter,
        { ...mockContext, commandNames: ['delete'] },
        historyPath
      )
      const result = await engine.processInput('\\delete users --where status=active')

      expect(result.action).toBe('continue')
      expect(result.output ?? '').not.toContain('Unknown command')
      // Nothing reached the adapter: this was never SQL.
      expect(adapter.execute).not.toHaveBeenCalled()
      const argv = spawn.mock.calls[0]?.[0] as string[]
      expect(argv).toContain('delete')
      expect(argv).not.toContain('\\delete')
    } finally {
      spawn.mockRestore()
    }
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

  test('a statement that executes writes an attempt row before it and an outcome row after', async () => {
    // Measured 2026-08-31 against a local MariaDB: an UPDATE typed at the
    // prompt changed a row and left nothing in the audit, while the same
    // statement through `dbcli query` wrote one. ADR-0016 Decision 2 takes the
    // Elasticsearch shell's pair — a row written only on the way back cannot
    // describe a statement that never came back.
    const rows: Array<{ phase: string; success: boolean; statement: string }> = []
    const engine = new ReplEngine(
      createMockAdapter(),
      mockContext,
      historyPath,
      null,
      null,
      async (row) => {
        rows.push({ phase: row.phase, success: row.success, statement: row.statement })
        return { success: true, rotated: false, id: 'a' }
      }
    )

    await engine.processInput("UPDATE users SET name = 'Bob' WHERE id = 1;")

    expect(rows.map((r) => r.phase)).toEqual(['attempt', 'outcome'])
    expect(rows[0]?.statement).toContain('UPDATE')
  })

  test('a statement that throws still writes an outcome row, marked failed', async () => {
    // The attempt row alone would say a statement was sent and never say what
    // came back — the same silence the whole record exists to remove.
    const rows: Array<{ phase: string; success: boolean }> = []
    const adapter = createMockAdapter()
    adapter.execute = mock(() =>
      Promise.reject(new Error('relation "users" does not exist'))
    ) as unknown as DatabaseAdapter['execute']
    const engine = new ReplEngine(adapter, mockContext, historyPath, null, null, async (row) => {
      rows.push({ phase: row.phase, success: row.success })
      return { success: true, rotated: false, id: 'a' }
    })

    await engine.processInput("UPDATE users SET name = 'Bob' WHERE id = 1;")

    expect(rows.map((r) => r.phase)).toEqual(['attempt', 'outcome'])
    expect(rows[1]?.success).toBe(false)
  })

  test('a failed reconnect closes its attempt row rather than leaving it open', async () => {
    // The connection-error branch returns without reaching the generic failure
    // path, so this is the one exit that could leave an attempt with no
    // outcome — a record saying a statement was sent and never saying what
    // happened to it.
    const rows: Array<{ phase: string; success: boolean }> = []
    const adapter = createMockAdapter()
    const lost = Object.assign(new Error('server closed the connection'), {
      code: 'ECONNRESET',
    })
    adapter.execute = mock(() => Promise.reject(lost)) as unknown as DatabaseAdapter['execute']
    adapter.connect = mock(() => Promise.reject(new Error('still down')))
    const engine = new ReplEngine(adapter, mockContext, historyPath, null, null, async (row) => {
      rows.push({ phase: row.phase, success: row.success })
      return { success: true, rotated: false, id: 'a' }
    })

    await engine.processInput("UPDATE users SET name = 'Bob' WHERE id = 1;")

    expect(rows.map((r) => r.phase)).toEqual(['attempt', 'outcome'])
    expect(rows[1]?.success).toBe(false)
  })

  test('a statement refused by permission writes one outcome row and no attempt', async () => {
    // ADR-0016: a refused statement was never attempted, so the pair collapses
    // to the half that happened. Measured before the fix, a read-write DELETE
    // left nothing at all — the permission check returns before the write gate,
    // which was the only thing on this path that recorded anything.
    const rows: Array<{ phase: string; success: boolean }> = []
    const ctx: ReplContext = { ...mockContext, permission: 'read-write' }
    const engine = new ReplEngine(
      createMockAdapter(),
      ctx,
      historyPath,
      null,
      null,
      async (row) => {
        rows.push({ phase: row.phase, success: row.success })
        return { success: true, rotated: false, id: 'a' }
      }
    )

    await engine.processInput('DELETE FROM users;')

    expect(rows.map((r) => r.phase)).toEqual(['outcome'])
    expect(rows[0]?.success).toBe(false)
  })

  test('a statement refused by the blacklist writes one outcome row', async () => {
    // The other pre-execution exit. A read of a protected table is exactly the
    // event a record is kept for, and it left nothing.
    const rows: Array<{ phase: string; success: boolean }> = []
    const config = {
      blacklist: { tables: ['users'], columns: {} },
    } as unknown as DbcliConfig
    const engine = new ReplEngine(
      createMockAdapter(),
      mockContext,
      historyPath,
      config,
      null,
      async (row) => {
        rows.push({ phase: row.phase, success: row.success })
        return { success: true, rotated: false, id: 'a' }
      }
    )

    await engine.processInput('SELECT * FROM users;')

    expect(rows.map((r) => r.phase)).toEqual(['outcome'])
    expect(rows[0]?.success).toBe(false)
  })

  test('a statement the write gate refuses writes one outcome row', async () => {
    // The gate keeps its own decision row (`recordGateDecision`), which answers
    // "was a full-table write confirmed or declined". That is a different
    // question from "what did this session do", and only ADR-0016's row
    // answers the second for every statement the same way.
    const rows: Array<{ phase: string; success: boolean }> = []
    const engine = new ReplEngine(
      createMockAdapter(),
      mockContext,
      historyPath,
      null,
      async () => false,
      async (row) => {
        rows.push({ phase: row.phase, success: row.success })
        return { success: true, rotated: false, id: 'a' }
      }
    )

    await engine.processInput("UPDATE users SET name = 'Bob';")

    expect(rows.map((r) => r.phase)).toEqual(['outcome'])
    expect(rows[0]?.success).toBe(false)
  })

  test('a refusal names the level that would have worked, not the one already held', async () => {
    // `required` was a hardcoded guess — 'admin' for UNKNOWN, 'read-write' for
    // everything else — so a read-write user deleting a table read
    // "Required: read-write (current: read-write)": a refusal stating its own
    // requirement was already met. DELETE is granted by data-admin
    // (permission-guard TIER_GRANTS), and that is what the line has to say.
    const ctx: ReplContext = { ...mockContext, permission: 'read-write' }
    const engine = new ReplEngine(createMockAdapter(), ctx, historyPath)
    const result = await engine.processInput('DELETE FROM users;')
    expect(result.output ?? '').toContain('data-admin')
    expect(result.output ?? '').not.toMatch(/Required: read-write/)
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

  test('reconnect retry re-establishes query-only mode before executing again', async () => {
    const adapter = createMockAdapter()
    let callCount = 0
    ;(adapter.execute as any).mockImplementation(() => {
      callCount++
      if (callCount === 1) throw Object.assign(new Error('lost'), { code: 'ECONNRESET' })
      return Promise.resolve({ rows: [{ ok: 1 }], affectedRows: 0 })
    })
    const engine = new ReplEngine(
      adapter,
      { ...mockContext, permission: 'query-only' },
      historyPath
    )

    await engine.processInput('SELECT 1;')

    expect((adapter.execute as any).mock.calls.map((call: unknown[]) => call[2])).toEqual([
      { noLimit: false, sqlMode: 'native-read-only' },
      { noLimit: false, sqlMode: 'native-read-only' },
    ])
  })

  test('reconnects after uncertain cleanup without retrying the completed target', async () => {
    const adapter = createMockAdapter()
    const cleanupError = new ConnectionError(
      'CONNECTION_LOST',
      'The query-only target completed, but transaction cleanup failed',
      [],
      undefined,
      false
    )
    let callCount = 0
    ;(adapter.execute as any).mockImplementation(() => {
      callCount++
      if (callCount === 1) throw cleanupError
      return Promise.resolve({ rows: [{ ok: 1 }], affectedRows: 0 })
    })
    const engine = new ReplEngine(
      adapter,
      { ...mockContext, permission: 'query-only', system: 'mysql' },
      historyPath
    )

    const failed = await engine.processInput('SELECT external_effect();')

    expect(adapter.connect).toHaveBeenCalledTimes(1)
    expect(adapter.execute).toHaveBeenCalledTimes(1)
    expect(failed.output).toContain('target completed')

    await engine.processInput('SELECT 1;')
    expect(adapter.execute).toHaveBeenCalledTimes(2)
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
