import { describe, test, expect } from 'bun:test'
import { runDiagnostic } from '@/core/report/run-diagnostic'
import type { ResolvedSnippet } from '@/core/saved-queries'
import type { DatabaseAdapter, ExecutionResult, SqlExecutionMode } from '@/adapters/types'
import { BlacklistRejection } from '@/adapters/redis/types'

function snippet(meta: Partial<ResolvedSnippet['query']['meta']> = {}): ResolvedSnippet {
  return {
    query: {
      meta: {
        name: '@diag/db-size',
        key: '@diag/db-size',
        description: 'Database size',
        engine: ['postgres'],
        params: [],
        tags: [],
        intent: 'capacity.size',
        ...meta,
      },
      sqlBody: 'SELECT 1 AS one, 2 AS two',
      file: 'assets/db-size.postgres.sql',
      source: 'builtin',
    },
    hasLocalOverride: false,
  }
}

function adapterReturning<T>(result: ExecutionResult<T>): DatabaseAdapter {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    execute: async () => result as never,
    listTables: async () => [],
    getTableSchema: async () => ({ name: 't', columns: [] }),
    testConnection: async () => true,
    getServerVersion: async () => '16.4',
  }
}

describe('runDiagnostic', () => {
  test('uses the native boundary for query-only SQL diagnostics', async () => {
    let sqlMode: string | undefined
    const adapter: DatabaseAdapter = {
      ...adapterReturning({ rows: [], affectedRows: 0 }),
      execute: async <T>(
        _sql: string,
        _params?: (string | number | boolean | null)[],
        options?: { noLimit?: boolean; sqlMode?: SqlExecutionMode }
      ) => {
        sqlMode = options?.sqlMode
        return { rows: [{ one: 1 }] as T[], affectedRows: 0 }
      },
    }

    await runDiagnostic({
      snippet: snippet(),
      adapter,
      engine: 'postgres',
      permission: 'query-only',
      timeoutMs: 1000,
      maxRows: 10,
    })

    expect(sqlMode).toBe('native-read-only')
  })

  test('returns ok evidence with truncated rows + duration', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ i }))
    const adapter = adapterReturning({ rows, affectedRows: 0 })
    const ev = await runDiagnostic({
      snippet: snippet(),
      adapter,
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
    })
    expect(ev.status).toBe('ok')
    expect(ev.rowCount).toBe(100)
    expect(ev.rows.length).toBe(10)
    expect(ev.snippet).toBe('@diag/db-size')
    expect(ev.intent).toBe('capacity.size')
    expect(ev.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('returns no-data when adapter returns zero rows', async () => {
    const adapter = adapterReturning({
      rows: [] as Array<Record<string, unknown>>,
      affectedRows: 0,
    })
    const ev = await runDiagnostic({
      snippet: snippet(),
      adapter,
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
    })
    expect(ev.status).toBe('no-data')
    expect(ev.rowCount).toBe(0)
    expect(ev.rows).toEqual([])
  })

  test('returns error evidence when adapter.execute throws', async () => {
    const adapter: DatabaseAdapter = {
      ...adapterReturning({ rows: [], affectedRows: 0 }),
      execute: async () => {
        throw new Error('boom')
      },
    }
    const ev = await runDiagnostic({
      snippet: snippet(),
      adapter,
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
    })
    expect(ev.status).toBe('error')
    expect(ev.reason).toContain('boom')
    expect(ev.rows).toEqual([])
  })

  test('returns skipped when Redis refuses a protected key pattern', async () => {
    const adapter: DatabaseAdapter = {
      ...adapterReturning({ rows: [], affectedRows: 0 }),
      execute: async () => {
        throw new BlacklistRejection('protected', 'SCAN', null, 'secrets:*')
      },
    }
    const redisSnippet = snippet({ engine: ['redis'] })
    redisSnippet.query.sqlBody = 'SCAN 0 MATCH * COUNT 100'
    const ev = await runDiagnostic({
      snippet: redisSnippet,
      adapter,
      engine: 'redis',
      timeoutMs: 1000,
      maxRows: 10,
    })
    expect(ev.status).toBe('skipped')
    expect(ev.rows).toEqual([])
  })

  test('returns timeout evidence when execute exceeds timeoutMs', async () => {
    const adapter: DatabaseAdapter = {
      ...adapterReturning({ rows: [], affectedRows: 0 }),
      execute: () => new Promise(() => undefined),
    }
    const ev = await runDiagnostic({
      snippet: snippet(),
      adapter,
      engine: 'postgres',
      timeoutMs: 30,
      maxRows: 10,
    })
    expect(ev.status).toBe('timeout')
    expect(ev.reason).toContain('30ms')
  })

  test('returns skipped when prepareExecution rejects (engine mismatch)', async () => {
    const adapter = adapterReturning({ rows: [], affectedRows: 0 })
    const ev = await runDiagnostic({
      snippet: snippet({ engine: ['mysql'] }),
      adapter,
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
    })
    expect(ev.status).toBe('skipped')
    expect(ev.reason).toBeDefined()
  })
  /**
   * `dbcli report` embeds the returned rows in its output and loads
   * user-writable snippet directories, so evidence is a durable copy of
   * whatever the snippet selected. It ran with no blacklist at all.
   */
  test('masks blacklisted columns in the evidence rows', async () => {
    const { BlacklistManager } = await import('@/core/blacklist-manager')
    const { BlacklistValidator } = await import('@/core/blacklist-validator')
    const manager = new BlacklistManager({
      connection: {
        system: 'postgresql',
        host: 'h',
        port: 5432,
        user: 'u',
        password: '',
        database: 'd',
      },
      permission: 'query-only',
      blacklist: { tables: [], columns: { users: ['password_hash'] } },
    } as never)

    const users = snippet({ name: '@diag/users', key: '@diag/users' })
    const ev = await runDiagnostic({
      snippet: {
        ...users,
        query: { ...users.query, sqlBody: 'SELECT id, password_hash FROM users' },
      },
      adapter: adapterReturning({
        rows: [{ id: 1, password_hash: 'SECRET' }],
        affectedRows: 1,
      }),
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
      blacklistValidator: new BlacklistValidator(manager),
    })

    expect(JSON.stringify(ev.rows)).not.toContain('SECRET')
    expect(JSON.stringify(ev.rows)).not.toContain('password_hash')
  })

  test('refuses a snippet that reads a blacklisted table', async () => {
    const { BlacklistManager } = await import('@/core/blacklist-manager')
    const { BlacklistValidator } = await import('@/core/blacklist-validator')
    const manager = new BlacklistManager({
      connection: {
        system: 'postgresql',
        host: 'h',
        port: 5432,
        user: 'u',
        password: '',
        database: 'd',
      },
      permission: 'query-only',
      blacklist: { tables: ['secrets'], columns: {} },
    } as never)

    let executed = false
    const ev = await runDiagnostic({
      snippet: {
        ...snippet(),
        query: { ...snippet().query, sqlBody: 'SELECT * FROM secrets' },
      },
      adapter: {
        ...adapterReturning({ rows: [{ a: 1 }], affectedRows: 1 }),
        execute: async () => {
          executed = true
          return { rows: [{ a: 1 }], affectedRows: 1 } as never
        },
      },
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
      blacklistValidator: new BlacklistValidator(manager),
    })

    expect(executed).toBe(false)
    expect(ev.status).toBe('skipped')
    expect(ev.reason).toMatch(/secrets/)
  })

  test('refuses Redis evidence that reads a blacklisted key', async () => {
    const { BlacklistManager } = await import('@/core/blacklist-manager')
    const { BlacklistValidator } = await import('@/core/blacklist-validator')
    const manager = new BlacklistManager({
      connection: {
        system: 'redis',
        host: 'h',
        port: 6379,
        user: '',
        password: '',
        database: '0',
      },
      permission: 'query-only',
      blacklist: { tables: ['secrets:*'], columns: {} },
    } as never)
    const redis = snippet({
      name: '@diag/secret',
      key: '@diag/secret',
      engine: ['redis'],
    })
    let executed = false

    const ev = await runDiagnostic({
      snippet: {
        ...redis,
        query: { ...redis.query, sqlBody: 'GET secrets:api_key' },
      },
      adapter: {
        ...adapterReturning({ rows: [{ value: 'PLAINTEXT' }], affectedRows: 1 }),
        execute: async () => {
          executed = true
          return { rows: [{ value: 'PLAINTEXT' }], affectedRows: 1 } as never
        },
      },
      engine: 'redis',
      timeoutMs: 1000,
      maxRows: 10,
      blacklistValidator: new BlacklistValidator(manager),
    })

    expect(executed).toBe(false)
    expect(ev.status).toBe('skipped')
    expect(JSON.stringify(ev.rows)).not.toContain('PLAINTEXT')
    expect(JSON.stringify(ev)).not.toContain('secrets:api_key')
    expect(JSON.stringify(ev)).not.toContain('secrets:*')
  })
})
