/**
 * MongoDB export branch.
 *
 * Verifies:
 *   - json / jsonl / csv format output (jsonl is the default for mongo)
 *   - blacklisted table → exit 1, no driver call
 *   - blacklisted columns redacted from each emitted document
 *   - SQL-shaped query strings are rejected for mongo connections
 *   - --collection is required
 *   - CSV emits a stderr warning when nested fields exist
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { AdapterFactory } from '@/adapters'

const baseMongoConnection = {
  system: 'mongodb' as const,
  uri: 'mongodb://localhost:27017/testdb',
  host: '',
  port: 27017,
  user: '',
  password: '',
  database: 'testdb',
}

function makeMockAdapter(
  rows: Record<string, unknown>[],
  executeError?: Error,
  disconnectError?: Error
) {
  const state = {
    connectCalled: false,
    executeCalled: false,
    lastLimit: null as number | null | undefined,
  }
  return {
    state,
    async connect() {
      state.connectCalled = true
    },
    async disconnect() {
      if (disconnectError) throw disconnectError
    },
    async execute(_q: string, _params: unknown[], opts?: { limit?: number }) {
      state.executeCalled = true
      state.lastLimit = opts?.limit ?? null
      if (executeError) throw executeError
      return { rows, affectedRows: rows.length }
    },
  }
}

describe('MongoDB export', () => {
  let configSpy: any
  let adapterSpy: any
  let logSpy: any
  let errSpy: any
  let exitSpy: any
  let stdout: string[]
  let stderr: string[]

  beforeEach(() => {
    stdout = []
    stderr = []
    logSpy = spyOn(console, 'log').mockImplementation((msg: any) => {
      stdout.push(String(msg))
    })
    errSpy = spyOn(console, 'error').mockImplementation((msg: any) => {
      stderr.push(String(msg))
    })
    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`)
    }) as any)
  })

  afterEach(() => {
    configSpy?.mockRestore()
    adapterSpy?.mockRestore()
    logSpy.mockRestore()
    errSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('jsonl is the default format and emits one doc per line', async () => {
    const adapter = makeMockAdapter([
      { _id: '1', name: 'Alice' },
      { _id: '2', name: 'Bob' },
    ])
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await exportCommand('{}', { format: 'jsonl', collection: 'users' } as any)

    expect(adapter.state.executeCalled).toBe(true)
    const out = stdout.join('\n')
    const lines = out.split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!)).toEqual({ _id: '1', name: 'Alice' })
    expect(JSON.parse(lines[1]!)).toEqual({ _id: '2', name: 'Bob' })
  })

  test('--format json emits a JSON array', async () => {
    const adapter = makeMockAdapter([{ _id: '1', name: 'Alice' }])
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await exportCommand('{}', { format: 'json', collection: 'users' } as any)

    const parsed = JSON.parse(stdout.join('\n'))
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].name).toBe('Alice')
  })

  test('--format csv emits headers + rows and warns on nested values', async () => {
    const adapter = makeMockAdapter([
      { _id: '1', name: 'Alice', meta: { age: 30 } },
      { _id: '2', name: 'Bob', meta: { age: 25 } },
    ])
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await exportCommand('{}', { format: 'csv', collection: 'users' } as any)

    const csv = stdout.join('\n')
    expect(csv.split('\n')[0]).toContain('_id')
    expect(csv).toContain('Alice')
    expect(csv).toContain('"{""age"":30}"')
    expect(stderr.join('\n')).toMatch(/nest|nested|JSON/i)
  })

  test('blacklisted table rejects export and never connects', async () => {
    const adapter = makeMockAdapter([])
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: ['secrets'], columns: {} },
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await expect(
      exportCommand('{}', { format: 'jsonl', collection: 'secrets' } as any)
    ).rejects.toThrow('secrets')

    expect(adapter.state.connectCalled).toBe(false)
  })

  test('blacklisted columns redacted from emitted documents', async () => {
    const adapter = makeMockAdapter([{ _id: '1', name: 'Alice', password: 'shouldNotAppear' }])
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: [], columns: { users: ['password'] } },
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await exportCommand('{}', { format: 'jsonl', collection: 'users' } as any)

    const out = stdout.join('\n')
    expect(out).not.toContain('shouldNotAppear')
    expect(out).toContain('[REDACTED]')
    expect(out).toContain('Alice')
  })

  test('SQL-shaped query string is rejected on mongo connection', async () => {
    const adapter = makeMockAdapter([])
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await expect(
      exportCommand('SELECT * FROM users', {
        format: 'jsonl',
        collection: 'users',
      } as any)
    ).rejects.toThrow(/JSON|filter|MongoDB/i)

    expect(adapter.state.executeCalled).toBe(false)
  })

  test('missing --collection rejects with a helpful error', async () => {
    const adapter = makeMockAdapter([])
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await expect(exportCommand('{}', { format: 'jsonl' } as any)).rejects.toThrow(
      /--collection|collection/i
    )

    expect(adapter.state.executeCalled).toBe(false)
  })

  test('--limit forwarded to mongo adapter execute', async () => {
    const adapter = makeMockAdapter([{ _id: '1', name: 'Alice' }])
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await exportCommand('{}', { format: 'jsonl', collection: 'users', limit: 7 } as any)

    expect(adapter.state.lastLimit).toBe(7)
  })

  test('does not print the auto-limit warning before an adapter failure', async () => {
    const adapter = makeMockAdapter([], new Error('mongo export failed'))
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'query-only',
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await expect(
      exportCommand('{}', { format: 'jsonl', collection: 'users' } as any)
    ).rejects.toThrow('mongo export failed')

    expect(stderr.join('\n')).not.toContain('auto-limiting')
  })

  test('does not print the auto-limit warning before a disconnect failure', async () => {
    const adapter = makeMockAdapter(
      [{ id: 1, nested: { value: true } }],
      undefined,
      new Error('mongo export disconnect failed')
    )
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'query-only',
    } as any)

    const { exportCommand } = await import('@/commands/export')
    await expect(
      exportCommand('{}', { format: 'csv', collection: 'users' } as any)
    ).rejects.toThrow('mongo export disconnect failed')

    expect(stdout).toEqual([])
    expect(stderr).toEqual([])
  })
})
