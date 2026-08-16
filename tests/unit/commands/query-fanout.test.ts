import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { DatabaseAdapter, ExecutionResult, SqlConnectionOptions } from '@/adapters/types'
import { queryCommand } from '@/commands/query'
import { configModule } from '@/core/config'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueryableAdapter } from '@/adapters/types'

class FanOutAdapter implements DatabaseAdapter {
  connected = 0
  disconnected = 0

  constructor(
    private readonly value: string,
    private readonly executeGate?: Promise<void>,
    private readonly failure?: Error,
    private readonly rows?: Record<string, unknown>[],
    private readonly connectFailure?: Error
  ) {}

  async connect(): Promise<void> {
    this.connected++
    if (this.connectFailure) throw this.connectFailure
  }

  async disconnect(): Promise<void> {
    this.disconnected++
  }

  async execute<T>(): Promise<ExecutionResult<T>> {
    if (this.executeGate) await this.executeGate
    if (this.failure) throw this.failure
    const rows = this.rows ?? [{ connection: this.value }]
    return { rows: rows as T[], affectedRows: rows.length }
  }

  async listTables() {
    return []
  }
  async getTableSchema() {
    return { name: 'result', columns: [] }
  }
  async testConnection() {
    return true
  }
  async getServerVersion() {
    return 'test'
  }
}

function sqlConfig(name: string) {
  return {
    connection: {
      system: 'postgresql' as const,
      host: name,
      port: 5432,
      user: 'test',
      password: 'test',
      database: name,
    },
    permission: 'query-only' as const,
    schema: {},
    metadata: { version: '2.0' },
    blacklist: { tables: [], columns: {} },
    audit: { enabled: false, rotation: { max_bytes: 1024, max_entries: 10 } },
  }
}

describe('query command fan-out', () => {
  // Declared against the real functions rather than as a bare
  // `ReturnType<typeof spyOn>`, which erases every parameter and return type and
  // left the mock implementations below inferring `any` for their arguments.
  let configReadSpy: Mock<typeof configModule.read>
  let createAdapterSpy: Mock<typeof AdapterFactory.createSqlAdapter>
  let createMongoAdapterSpy: Mock<typeof AdapterFactory.createMongoDBAdapter>
  let createRedisAdapterSpy: Mock<typeof AdapterFactory.createRedisAdapter>
  let createElasticsearchAdapterSpy: Mock<typeof AdapterFactory.createElasticsearchAdapter>
  let logSpy: Mock<typeof console.log>
  let errorSpy: Mock<typeof console.error>
  let originalExitCode: number | string | null | undefined

  beforeEach(() => {
    originalExitCode = process.exitCode
    process.exitCode = undefined
    configReadSpy = spyOn(configModule, 'read').mockImplementation(
      async (_path, name) => sqlConfig(name ?? 'default') as never
    )
    createAdapterSpy = spyOn(AdapterFactory, 'createSqlAdapter')
    createMongoAdapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter')
    createRedisAdapterSpy = spyOn(AdapterFactory, 'createRedisAdapter')
    createElasticsearchAdapterSpy = spyOn(AdapterFactory, 'createElasticsearchAdapter')
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    configReadSpy.mockRestore()
    createAdapterSpy.mockRestore()
    createMongoAdapterSpy.mockRestore()
    createRedisAdapterSpy.mockRestore()
    createElasticsearchAdapterSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('runs two explicit connections concurrently and presents successes in selector order', async () => {
    let releasePrimary!: () => void
    const primaryGate = new Promise<void>((resolve) => {
      releasePrimary = resolve
    })
    const adapters = {
      primary: new FanOutAdapter('primary', primaryGate),
      staging: new FanOutAdapter('staging'),
    }
    createAdapterSpy.mockImplementation((options: SqlConnectionOptions) => {
      const name = options.host as keyof typeof adapters
      const adapter = adapters[name]
      if (name === 'staging') releasePrimary()
      return adapter
    })

    await queryCommand('SELECT 1', {
      format: 'json',
      connectionSelector: 'primary, staging',
    } as never)

    expect(configReadSpy.mock.calls.map((call) => call[1])).toEqual(['primary', 'staging'])
    const output = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      results: Array<{ connection: string; status: string; rows: unknown[] }>
    }
    expect(output.results.map(({ connection, status }) => ({ connection, status }))).toEqual([
      { connection: 'primary', status: 'ok' },
      { connection: 'staging', status: 'ok' },
    ])
    expect(output.results[0]?.rows).toEqual([{ connection: 'primary' }])
    expect(output.results[1]?.rows).toEqual([{ connection: 'staging' }])
    expect(output.results[0]).toMatchObject({
      metadata: { truncated: false, limit_applied: 1000 },
    })
    expect(process.exitCode).toBe(0)
    expect(adapters.primary.disconnected).toBe(1)
    expect(adapters.staging.disconnected).toBe(1)
  })

  test('preserves a successful sibling and returns exit 2 for partial failure', async () => {
    const timeout = Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })
    const adapters = {
      primary: new FanOutAdapter('primary'),
      broken: new FanOutAdapter('broken', undefined, timeout),
    }
    createAdapterSpy.mockImplementation(
      (options: SqlConnectionOptions) => adapters[options.host as keyof typeof adapters]
    )

    await queryCommand('SELECT 1', {
      format: 'json',
      connectionSelector: 'primary,broken',
    } as never)

    const output = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      results: Array<Record<string, unknown>>
    }
    expect(output.results).toHaveLength(2)
    expect(output.results[0]).toMatchObject({ connection: 'primary', status: 'ok' })
    expect(output.results[1]).toEqual({
      connection: 'broken',
      status: 'error',
      error: { code: 'ETIMEDOUT', message: 'Connection timed out', hints: [] },
    })
    expect(process.exitCode).toBe(2)
    expect(adapters.primary.disconnected).toBe(1)
    expect(adapters.broken.disconnected).toBe(1)
  })

  test('returns every bounded error and exit 1 when all connections fail', async () => {
    createAdapterSpy.mockImplementation(
      (options: SqlConnectionOptions) =>
        new FanOutAdapter(String(options.host), undefined, new Error(`${options.host} failed`))
    )

    await queryCommand('SELECT 1', {
      format: 'json',
      connectionSelector: 'one,two',
    } as never)

    const output = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      results: Array<{ connection: string; status: string; error: { message: string } }>
    }
    expect(output.results.map(({ connection, status }) => ({ connection, status }))).toEqual([
      { connection: 'one', status: 'error' },
      { connection: 'two', status: 'error' },
    ])
    expect(output.results.map((outcome) => outcome.error.message)).toEqual([
      'one failed',
      'two failed',
    ])
    expect(process.exitCode).toBe(1)
  })

  test('rejects SQL mutation for admin connections before creating any adapter', async () => {
    configReadSpy.mockImplementation(
      async (_path, name) =>
        ({
          ...sqlConfig(name ?? 'default'),
          permission: 'admin',
        }) as never
    )

    for (const query of [
      'DELETE FROM users',
      'WITH removed AS (DELETE FROM users RETURNING id) SELECT * FROM removed',
      'EXPLAIN ANALYZE UPDATE users SET active = false',
      'SHOW TABLES; DELETE FROM users',
      'SELECT * INTO copied_users FROM users',
      String.raw`SELECT 'x\'; DELETE FROM users; SELECT 'y'`,
    ]) {
      await expect(
        queryCommand(query, { connectionSelector: 'primary,staging' } as never)
      ).rejects.toThrow(/read-only|query-only|requires read-write/i)
    }
    expect(createAdapterSpy).not.toHaveBeenCalled()
  })

  test('rejects MySQL and MariaDB dollar-identifier statement smuggling before adapters', async () => {
    for (const [system, query] of [
      ['mysql', 'SELECT 1 AS $x$; DELETE FROM users; SELECT 1 AS $x$'],
      ['mariadb', 'SELECT 1 AS $x$; DELETE FROM users; SELECT 1 AS $x$'],
      ['mysql', "SELECT secret INTO OUTFILE '/tmp/dbcli-leak' FROM users"],
      ['mariadb', "SELECT secret INTO OUTFILE '/tmp/dbcli-leak' FROM users"],
      ['mysql', String.raw`SELECT 'x\'; DELETE FROM users; SELECT 'y'`],
      ['mariadb', String.raw`SELECT 'x\'; DELETE FROM users; SELECT 'y'`],
      ['mysql', 'SELECT 1--\u00a0x; DELETE FROM users'],
      ['mariadb', 'SELECT 1--\ufeffx; DELETE FROM users'],
      ['mysql', "SELECT secret /*!50000INTO OUTFILE '/tmp/dbcli-leak' */ FROM users"],
      ['mariadb', "SELECT secret /*M!100100INTO OUTFILE '/tmp/dbcli-leak' */ FROM users"],
    ] as const) {
      configReadSpy.mockImplementation(
        async (_path, name) =>
          ({
            ...sqlConfig(name ?? 'default'),
            connection: {
              ...sqlConfig(name ?? 'default').connection,
              system,
              port: 3306,
            },
            permission: 'admin',
          }) as never
      )

      await expect(
        queryCommand(query, { connectionSelector: 'primary,staging' } as never)
      ).rejects.toThrow(/read-only/i)
    }
    expect(createAdapterSpy).not.toHaveBeenCalled()
  })

  test('attempts disconnect and preserves ordered partial results when connect fails', async () => {
    const adapters = {
      primary: new FanOutAdapter('primary'),
      broken: new FanOutAdapter(
        'broken',
        undefined,
        undefined,
        undefined,
        Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' })
      ),
    }
    createAdapterSpy.mockImplementation(
      (options: SqlConnectionOptions) => adapters[options.host as keyof typeof adapters]
    )

    await queryCommand('SELECT 1', {
      format: 'json',
      connectionSelector: 'primary,broken',
    } as never)

    const output = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      results: Array<{ connection: string; status: string; error?: { message: string } }>
    }
    expect(output.results.map(({ connection, status }) => ({ connection, status }))).toEqual([
      { connection: 'primary', status: 'ok' },
      { connection: 'broken', status: 'error' },
    ])
    expect(output.results[1]?.error?.message).toBe('connect refused')
    expect(process.exitCode).toBe(2)
    expect(adapters.primary.disconnected).toBe(1)
    expect(adapters.broken.disconnected).toBe(1)
  })

  test('attempts every disconnect and exits 1 when every connect fails', async () => {
    const adapters = {
      one: new FanOutAdapter('one', undefined, undefined, undefined, new Error('one refused')),
      two: new FanOutAdapter('two', undefined, undefined, undefined, new Error('two refused')),
    }
    createAdapterSpy.mockImplementation(
      (options: SqlConnectionOptions) => adapters[options.host as keyof typeof adapters]
    )

    await queryCommand('SELECT 1', {
      format: 'json',
      connectionSelector: 'one,two',
    } as never)

    expect(process.exitCode).toBe(1)
    expect(adapters.one.disconnected).toBe(1)
    expect(adapters.two.disconnected).toBe(1)
  })

  test('rejects MongoDB output pipelines before creating any adapter', async () => {
    configReadSpy.mockImplementation(
      async () =>
        ({
          connection: {
            system: 'mongodb',
            host: 'localhost',
            port: 27017,
            user: '',
            password: '',
            database: 'db',
          },
          permission: 'admin',
          schema: {},
          metadata: { version: '2.0' },
          blacklist: { tables: [], columns: {} },
        }) as never
    )

    for (const pipeline of ['[{"$out":"archive"}]', '[{"$merge":"archive"}]']) {
      await expect(
        queryCommand(pipeline, {
          collection: 'users',
          connectionSelector: 'primary,staging',
        } as never)
      ).rejects.toThrow(/\$out|\$merge/)
    }
    expect(createMongoAdapterSpy).not.toHaveBeenCalled()
  })

  test('rejects Redis, recovery, and heterogeneous output before connecting', async () => {
    configReadSpy.mockImplementation(async (_path, name) =>
      name === 'cache'
        ? ({
            connection: {
              system: 'redis',
              host: 'localhost',
              port: 6379,
              user: '',
              password: '',
              database: '0',
            },
            permission: 'query-only',
            schema: {},
            metadata: { version: '2.0' },
            blacklist: { tables: [], columns: {} },
          } as never)
        : (sqlConfig(name ?? 'default') as never)
    )

    await expect(
      queryCommand('SELECT 1', { connectionSelector: 'primary,cache' } as never)
    ).rejects.toThrow(/Redis.*multiple/i)
    await expect(
      queryCommand('SELECT 1', {
        connectionSelector: 'primary,staging',
        recovery: true,
      } as never)
    ).rejects.toThrow(/recovery.*multiple/i)
    logSpy.mockClear()
    await expect(
      queryCommand('SELECT 1', {
        connectionSelector: 'primary,,staging',
        recovery: true,
      } as never)
    ).rejects.toThrow(/empty/i)
    expect(logSpy).not.toHaveBeenCalled()
    await expect(
      queryCommand('SELECT 1', {
        connectionSelector: 'primary,staging',
        format: 'csv',
      } as never)
    ).rejects.toThrow(/only.*table.*json/i)
    expect(createAdapterSpy).not.toHaveBeenCalled()
    expect(createRedisAdapterSpy).not.toHaveBeenCalled()
  })

  test('writes one audit file per explicit connection and never a comma-list file', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'dbcli-query-fanout-audit-'))
    configReadSpy.mockImplementation(
      async (_path, name) =>
        ({
          ...sqlConfig(name ?? 'default'),
          audit: { enabled: true, rotation: { max_bytes: 1024 * 1024, max_entries: 100 } },
        }) as never
    )
    createAdapterSpy.mockImplementation((options: SqlConnectionOptions) =>
      options.host === 'staging'
        ? new FanOutAdapter(
            String(options.host),
            undefined,
            undefined,
            undefined,
            new Error('staging refused')
          )
        : new FanOutAdapter(String(options.host))
    )

    try {
      await queryCommand('SELECT 1', {
        config: workDir,
        format: 'json',
        connectionSelector: 'primary,staging',
      } as never)

      const auditDir = join(workDir, '.dbcli', 'audit')
      expect(await Bun.file(join(auditDir, 'primary.jsonl')).exists()).toBe(true)
      expect(await Bun.file(join(auditDir, 'staging.jsonl')).exists()).toBe(true)
      expect(await Bun.file(join(auditDir, 'primary,staging.jsonl')).exists()).toBe(false)
      const primaryEntries = (await Bun.file(join(auditDir, 'primary.jsonl')).text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { success: boolean })
      const stagingEntries = (await Bun.file(join(auditDir, 'staging.jsonl')).text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { success: boolean })
      expect(primaryEntries).toHaveLength(1)
      expect(stagingEntries).toHaveLength(1)
      expect(primaryEntries[0]?.success).toBe(true)
      expect(stagingEntries[0]?.success).toBe(false)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  })

  test('a single explicit name preserves the existing single-result JSON bytes', async () => {
    createAdapterSpy.mockImplementation(() => new FanOutAdapter('same-result'))

    await queryCommand('SELECT 1', { format: 'json' })
    const defaultOutput = String(logSpy.mock.calls[0]?.[0])
    logSpy.mockClear()

    await queryCommand('SELECT 1', {
      format: 'json',
      connectionSelector: 'primary',
    } as never)
    expect(String(logSpy.mock.calls[0]?.[0])).toBe(defaultOutput)
    expect(defaultOutput).not.toContain('"results"')
  })

  test('applies blacklist filtering independently to every successful result', async () => {
    configReadSpy.mockImplementation(
      async (_path, name) =>
        ({
          ...sqlConfig(name ?? 'default'),
          blacklist:
            name === 'primary'
              ? { tables: [], columns: { users: ['secret'] } }
              : { tables: [], columns: {} },
        }) as never
    )
    createAdapterSpy.mockImplementation(
      (options: SqlConnectionOptions) =>
        new FanOutAdapter(String(options.host), undefined, undefined, [
          { id: 1, secret: `${options.host}-secret` },
        ])
    )

    await queryCommand('SELECT * FROM users', {
      format: 'json',
      connectionSelector: 'primary,staging',
    } as never)

    const output = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      results: Array<{ rows: Record<string, unknown>[]; columnNames: string[] }>
    }
    expect(output.results[0]?.rows).toEqual([{ id: 1 }])
    expect(output.results[0]?.columnNames).toEqual(['id'])
    expect(output.results[1]?.rows).toEqual([{ id: 1, secret: 'staging-secret' }])
    expect(output.results[1]?.columnNames).toEqual(['id', 'secret'])
  })

  test('keeps MongoDB security notices scoped inside one valid JSON document', async () => {
    configReadSpy.mockImplementation(
      async () =>
        ({
          connection: {
            system: 'mongodb',
            host: 'localhost',
            port: 27017,
            user: '',
            password: '',
            database: 'db',
          },
          permission: 'query-only',
          schema: {},
          metadata: { version: '2.0' },
          blacklist: { tables: [], columns: { users: ['secret'] } },
          audit: { enabled: false, rotation: { max_bytes: 1024, max_entries: 10 } },
        }) as never
    )
    createMongoAdapterSpy.mockImplementation(
      // The double implements `DatabaseAdapter`; the mongo factory promises the
      // wider `QueryableAdapter`. Fan-out only ever calls the narrow half, and
      // stubbing the other four methods would say nothing about this test.
      () =>
        new FanOutAdapter('mongo', undefined, undefined, [
          { id: 1, secret: 'hidden' },
        ]) as unknown as QueryableAdapter
    )

    await queryCommand('{}', {
      collection: 'users',
      format: 'json',
      connectionSelector: 'primary,staging',
    } as never)

    const stdout = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    const output = JSON.parse(stdout) as {
      results: Array<{
        rows: Record<string, unknown>[]
        metadata: { securityNotification: string }
      }>
    }
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(output.results).toHaveLength(2)
    expect(output.results[0]?.rows).toEqual([{ id: 1, secret: '[REDACTED]' }])
    expect(output.results[0]?.metadata.securityNotification).toContain('redacted')
    expect(output.results[1]?.metadata.securityNotification).toContain('redacted')
  })

  test('keeps Elasticsearch security notices scoped inside one valid JSON document', async () => {
    configReadSpy.mockImplementation(
      async () =>
        ({
          connection: {
            system: 'elasticsearch',
            host: 'localhost',
            port: 9200,
            user: '',
            password: '',
            database: '',
          },
          permission: 'query-only',
          schema: {},
          metadata: { version: '2.0' },
          blacklist: { tables: [], columns: { users: ['secret'] } },
          audit: { enabled: false, rotation: { max_bytes: 1024, max_entries: 10 } },
        }) as never
    )
    createElasticsearchAdapterSpy.mockImplementation(
      () =>
        new FanOutAdapter('elasticsearch', undefined, undefined, [
          { id: 1, secret: 'hidden' },
        ]) as unknown as QueryableAdapter
    )

    await queryCommand('{}', {
      index: 'users',
      format: 'json',
      connectionSelector: 'primary,staging',
    } as never)

    const stdout = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    const output = JSON.parse(stdout) as {
      results: Array<{
        rows: Record<string, unknown>[]
        metadata: { securityNotification: string }
      }>
    }
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(output.results).toHaveLength(2)
    expect(output.results[0]?.rows).toEqual([{ id: 1 }])
    expect(output.results[0]?.metadata.securityNotification).toContain('omitted')
    expect(output.results[1]?.metadata.securityNotification).toContain('omitted')
  })
})
