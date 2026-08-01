import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import type { ExecutionResult, QueryableAdapter } from '@/adapters/types'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { QueryResultFormatter } from '@/formatters'
import { queryCommand } from '@/commands/query'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

class MockMongoAdapter implements QueryableAdapter {
  lastExecuteOptions:
    | { limit?: number; projection?: Record<string, 0 | 1> }
    | undefined
  rows: Record<string, unknown>[] = [{ _id: '1', name: 'Alice', city: 'Taipei' }]
  executeError?: Error
  disconnectError?: Error
  lastQuery?: string
  async connect() {}
  async disconnect() {
    if (this.disconnectError) throw this.disconnectError
  }
  async execute<T>(
    query: string,
    _params?: unknown[],
    options?: { limit?: number; projection?: Record<string, 0 | 1> }
  ): Promise<ExecutionResult<T>> {
    this.lastQuery = query
    this.lastExecuteOptions = options
    if (this.executeError) throw this.executeError
    const data = this.rows as T[]
    return { rows: data, affectedRows: data.length }
  }
  async listCollections() {
    return []
  }
  async testConnection() {
    return true
  }
  async getServerVersion() {
    return '6.0.1'
  }
  async insert() {
    return { rows: [], affectedRows: 1 }
  }
  async update() {
    return { rows: [], affectedRows: 1 }
  }
  async delete() {
    return { rows: [], affectedRows: 1 }
  }
}

const mongoConfig = {
  connection: {
    system: 'mongodb' as const,
    uri: 'mongodb://localhost:27017/testdb',
    host: '',
    port: 27017,
    user: '',
    password: '',
    database: 'testdb',
  },
  permission: 'query-only' as const,
  schema: {},
  metadata: { version: '1.0' },
}

let configReadSpy: any
let createMongoAdapterSpy: any
let formatterSpy: any
let mockAdapter: MockMongoAdapter

describe('Query Command - MongoDB', () => {
  beforeEach(() => {
    configReadSpy = spyOn(configModule, 'read').mockResolvedValue(mongoConfig as any)
    mockAdapter = new MockMongoAdapter()
    createMongoAdapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(
      mockAdapter
    )
    formatterSpy = spyOn(QueryResultFormatter.prototype, 'format').mockImplementation(
      () => '[{"_id":"1","name":"Alice"}]'
    )
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    createMongoAdapterSpy.mockRestore()
    formatterSpy.mockRestore()
  })

  test('requires --collection option for MongoDB connections', async () => {
    await expect(queryCommand('{"age": 18}', { format: 'json' })).rejects.toThrow('--collection')
  })

  test('rejects SQL-like statements with MongoDB error message', async () => {
    await expect(
      queryCommand('SELECT * FROM users', { collection: 'users', format: 'json' })
    ).rejects.toThrow(/MongoDB.*JSON/)
  })

  test('rejects invalid JSON query', async () => {
    await expect(
      queryCommand('{invalid json}', { collection: 'users', format: 'json' })
    ).rejects.toThrow('JSON')
  })

  test('executes find with JSON object filter', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await queryCommand('{"age": {"$gt": 18}}', { collection: 'users', format: 'json' })
    expect(createMongoAdapterSpy).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('executes aggregate with JSON array pipeline', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const pipeline = '[{"$match": {"status": "active"}}]'
    await queryCommand(pipeline, { collection: 'orders', format: 'json' })
    expect(createMongoAdapterSpy).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('executes a shell-hostile aggregation loaded from a file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dbcli-mongo-query-input-'))
    const path = join(directory, 'pipeline.json')
    const pipeline = `[{"$match":{"message":{"$regex":"user's event"}}}]`
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await Bun.write(path, pipeline)
      await queryCommand(undefined, { queryFile: path, collection: 'raw_logs', format: 'json' })
      expect(mockAdapter.lastQuery).toBe(pipeline)
    } finally {
      logSpy.mockRestore()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('pushes inclusion fields to Mongo and normalizes dotted output columns', async () => {
    mockAdapter.rows = [
      { _id: '1', name: 'Alice', profile: { email: 'alice@example.com', city: 'Taipei' } },
    ]
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})

    await queryCommand('{}', {
      collection: 'users',
      format: 'json',
      fields: 'profile.email,name',
    })

    expect(mockAdapter.lastExecuteOptions).toEqual({
      limit: 1001,
      projection: { 'profile.email': 1, name: 1, _id: 0 },
    })
    const formatted = formatterSpy.mock.calls[0]![0] as any
    expect(formatted.columnNames).toEqual(['profile.email', 'name'])
    expect(formatted.rows).toEqual([{ 'profile.email': 'alice@example.com', name: 'Alice' }])
    logSpy.mockRestore()
  })

  test('masks a blacklisted child before projecting its dotted parent', async () => {
    configReadSpy.mockResolvedValue({
      ...mongoConfig,
      blacklist: { tables: [], columns: { users: ['profile.email'] } },
    } as any)
    mockAdapter.rows = [
      { _id: '1', profile: { email: 'alice@example.com', city: 'Taipei' } },
    ]
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})

    await queryCommand('{}', {
      collection: 'users',
      format: 'json',
      fields: 'profile',
    })

    const formatted = formatterSpy.mock.calls[0]![0] as any
    expect(formatted.rows).toEqual([
      { profile: { email: '[REDACTED]', city: 'Taipei' } },
    ])
    logSpy.mockRestore()
  })

  test('pushes exclusion fields to Mongo and omits them from normalized rows', async () => {
    mockAdapter.rows = [{ _id: '1', name: 'Alice', city: 'Taipei' }]
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})

    await queryCommand('{}', {
      collection: 'users',
      format: 'json',
      fields: '-city',
    })

    expect(mockAdapter.lastExecuteOptions).toEqual({
      limit: 1001,
      projection: { city: 0 },
    })
    const formatted = formatterSpy.mock.calls[0]![0] as any
    expect(formatted.columnNames).toEqual(['_id', 'name'])
    expect(formatted.rows).toEqual([{ _id: '1', name: 'Alice' }])
    logSpy.mockRestore()
  })

  test('passes explicit --limit through to mongo adapter execute()', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    await queryCommand('{}', { collection: 'users', format: 'json', limit: 5 })
    expect(mockAdapter.lastExecuteOptions).toEqual({ limit: 6 })
    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  test('applies query-only auto-limit when no --limit/--no-limit given', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    await queryCommand('{}', { collection: 'users', format: 'json' })
    expect(mockAdapter.lastExecuteOptions?.limit).toBe(1001)
    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  test('--no-limit disables both explicit and auto-limit', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    await queryCommand('{}', { collection: 'users', format: 'json', noLimit: true })
    expect(mockAdapter.lastExecuteOptions).toBeUndefined()
    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  test('does not print the auto-limit warning before an adapter failure', async () => {
    mockAdapter.executeError = new Error('mongo execute failed')
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(queryCommand('{}', { collection: 'users', format: 'json' })).rejects.toThrow(
        'mongo execute failed'
      )
      expect(errSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
    }
  })

  test('does not print the auto-limit warning before a disconnect failure', async () => {
    mockAdapter.disconnectError = new Error('mongo disconnect failed')
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(queryCommand('{}', { collection: 'users', format: 'json' })).rejects.toThrow(
        'mongo disconnect failed'
      )
      expect(logSpy).not.toHaveBeenCalled()
      expect(errSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
      errSpy.mockRestore()
    }
  })

  for (const query of ['{}', '[{"$match":{"status":"active"}}]']) {
    const path = query.startsWith('[') ? 'aggregation' : 'find'
    for (const [label, sourceRows, truncated, visibleRows] of [
      ['N-1', 1, false, 1],
      ['N', 2, false, 2],
      ['N+1', 3, true, 2],
      ['more than N+1', 4, true, 2],
    ] as const) {
      test(`${path} reports truthful metadata for ${label} rows`, async () => {
        mockAdapter.rows = Array.from({ length: sourceRows }, (_, id) => ({ id }))
        const logSpy = spyOn(console, 'log').mockImplementation(() => {})

        await queryCommand(query, { collection: 'users', format: 'json', limit: 2 })

        expect(mockAdapter.lastExecuteOptions).toEqual({ limit: 3 })
        const formatted = formatterSpy.mock.calls[0]![0] as any
        expect(formatted.rows).toHaveLength(visibleRows)
        expect(formatted.rowCount).toBe(visibleRows)
        expect(formatted.appliedLimit).toEqual({ truncated, limitApplied: 2 })
        logSpy.mockRestore()
      })
    }
  }

  test('preserves a user-authored aggregation $limit without a dbcli truncation claim', async () => {
    mockAdapter.rows = [{ id: 1 }, { id: 2 }]
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})

    await queryCommand('[{"$limit":2},{"$project":{"id":1}}]', {
      collection: 'users',
      format: 'json',
    })

    expect(mockAdapter.lastExecuteOptions).toBeUndefined()
    const formatted = formatterSpy.mock.calls[0]![0] as any
    expect(formatted.appliedLimit).toBeUndefined()
    logSpy.mockRestore()
  })
})
