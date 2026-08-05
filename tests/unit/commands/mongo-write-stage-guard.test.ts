import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import type { ExecutionResult, QueryableAdapter } from '@/adapters/types'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { queryCommand } from '@/commands/query'

/**
 * Regression guard: a MongoDB aggregation pipeline can write through `$out` and
 * `$merge`. Those stages were only rejected on the multi-connection fan-out
 * path, so a single-connection `dbcli query` executed them even under
 * `permission: query-only`.
 */
class MockMongoAdapter implements QueryableAdapter {
  lastQuery?: string
  async connect() {}
  async disconnect() {}
  async execute<T>(query: string): Promise<ExecutionResult<T>> {
    this.lastQuery = query
    return { rows: [] as T[], affectedRows: 0 }
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

function mongoConfig(permission: 'query-only' | 'data-admin') {
  return {
    connection: {
      system: 'mongodb' as const,
      uri: 'mongodb://localhost:27017/testdb',
      host: '',
      port: 27017,
      user: '',
      password: '',
      database: 'testdb',
    },
    permission,
    schema: {},
    metadata: { version: '1.0' },
  }
}

let configReadSpy: any
let createMongoAdapterSpy: any
let mockAdapter: MockMongoAdapter

function useConfig(permission: 'query-only' | 'data-admin') {
  configReadSpy?.mockRestore()
  configReadSpy = spyOn(configModule, 'read').mockResolvedValue(mongoConfig(permission) as any)
}

describe('MongoDB write-stage guard on single-connection query', () => {
  beforeEach(() => {
    mockAdapter = new MockMongoAdapter()
    createMongoAdapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(
      mockAdapter
    )
    useConfig('query-only')
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    createMongoAdapterSpy.mockRestore()
  })

  test('rejects a $out pipeline under query-only permission', async () => {
    const pipeline = '[{"$match":{"status":"active"}},{"$out":"users_copy"}]'

    await expect(queryCommand(pipeline, { collection: 'users', format: 'json' })).rejects.toThrow(
      /\$out/
    )
    expect(mockAdapter.lastQuery).toBeUndefined()
  })

  test('rejects a $merge pipeline under query-only permission', async () => {
    const pipeline = '[{"$match":{"status":"active"}},{"$merge":{"into":"users_copy"}}]'

    await expect(queryCommand(pipeline, { collection: 'users', format: 'json' })).rejects.toThrow(
      /\$merge/
    )
    expect(mockAdapter.lastQuery).toBeUndefined()
  })

  test('rejects a write stage nested later in the pipeline', async () => {
    const pipeline =
      '[{"$match":{"status":"active"}},{"$group":{"_id":"$city"}},{"$out":"city_rollup"}]'

    await expect(queryCommand(pipeline, { collection: 'users', format: 'json' })).rejects.toThrow(
      /\$out/
    )
    expect(mockAdapter.lastQuery).toBeUndefined()
  })

  test('still allows an ordinary read pipeline under query-only permission', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      await queryCommand('[{"$match":{"status":"active"}}]', {
        collection: 'users',
        format: 'json',
      })
      expect(mockAdapter.lastQuery).toBe('[{"$match":{"status":"active"}}]')
    } finally {
      logSpy.mockRestore()
    }
  })
})

function mongoSnippet(body: string) {
  return {
    snippet: {
      query: {
        meta: {
          key: '@rollup',
          name: 'rollup',
          params: [],
          tags: [],
          engine: ['mongodb'],
          operation: 'aggregate',
        },
        sqlBody: body,
        file: '/tmp/rollup.mongodb.sql',
        source: 'shared',
      },
      hasLocalOverride: false,
    } as any,
    prepared: {
      driver: { sql: body, values: [] },
      rewrittenBody: body,
      warnings: [],
      execHints: { collection: 'users', mongoOperation: 'aggregate' },
    } as any,
  }
}

describe('MongoDB write-stage guard on saved snippets', () => {
  beforeEach(() => {
    mockAdapter = new MockMongoAdapter()
    createMongoAdapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(
      mockAdapter
    )
  })

  afterEach(() => {
    createMongoAdapterSpy.mockRestore()
  })

  test('refuses a $out snippet even at admin permission', async () => {
    const { qMongoBranch } = await import('@/commands/q-mongo')
    const { snippet, prepared } = mongoSnippet('[{"$match":{}},{"$out":"users_copy"}]')

    await expect(
      qMongoBranch(snippet, prepared, {}, mongoConfig('data-admin') as any)
    ).rejects.toThrow(/\$out/)
    expect(createMongoAdapterSpy).not.toHaveBeenCalled()
  })

  test('refuses a $merge snippet even at admin permission', async () => {
    const { qMongoBranch } = await import('@/commands/q-mongo')
    const { snippet, prepared } = mongoSnippet('[{"$match":{}},{"$merge":{"into":"users_copy"}}]')

    await expect(
      qMongoBranch(snippet, prepared, {}, mongoConfig('data-admin') as any)
    ).rejects.toThrow(/\$merge/)
    expect(createMongoAdapterSpy).not.toHaveBeenCalled()
  })

  test('refuses a $out snippet in --dry-run instead of previewing it as safe', async () => {
    const { qMongoBranch } = await import('@/commands/q-mongo')
    const { snippet, prepared } = mongoSnippet('[{"$out":"users_copy"}]')
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await expect(
        qMongoBranch(snippet, prepared, { dryRun: true }, mongoConfig('data-admin') as any)
      ).rejects.toThrow(/\$out/)
    } finally {
      logSpy.mockRestore()
    }
  })
})

describe('MongoDB write-stage guard on export', () => {
  beforeEach(() => {
    mockAdapter = new MockMongoAdapter()
    createMongoAdapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(
      mockAdapter
    )
    useConfig('query-only')
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    createMongoAdapterSpy.mockRestore()
  })

  test('rejects a $out pipeline under query-only permission', async () => {
    const { exportCommand } = await import('@/commands/export')

    await expect(
      exportCommand('[{"$match":{}},{"$out":"users_copy"}]', {
        collection: 'users',
        format: 'jsonl',
      } as any)
    ).rejects.toThrow(/\$out/)
    expect(mockAdapter.lastQuery).toBeUndefined()
  })
})
