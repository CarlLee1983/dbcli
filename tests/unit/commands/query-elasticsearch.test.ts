import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { QueryableAdapter, ExecutionResult } from '@/adapters/types'
import { configModule } from '@/core/config'
import { queryCommand } from '@/commands/query'
import { QueryResultFormatter } from '@/formatters/query-result-formatter'

class MockElasticsearchAdapter implements QueryableAdapter {
  lastQuery = ''
  lastParams: unknown[] | undefined
  lastOptions: { limit?: number } | undefined
  rows: Record<string, unknown>[] = [{ _id: '1', name: 'Alice', 'user.email': 'a@example.com' }]
  executeError?: Error
  disconnectError?: Error
  async connect() {}
  async disconnect() {
    if (this.disconnectError) throw this.disconnectError
  }
  async execute<T>(
    query: string,
    params?: unknown[],
    options?: { limit?: number }
  ): Promise<ExecutionResult<T>> {
    this.lastQuery = query
    this.lastParams = params
    this.lastOptions = options
    if (this.executeError) throw this.executeError
    const rows = this.rows as T[]
    return { rows, affectedRows: rows.length }
  }
  async listCollections() {
    return []
  }
  async testConnection() {
    return true
  }
  async getServerVersion() {
    return '8.13.0'
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

const esConfig = {
  connection: {
    system: 'elasticsearch' as const,
    protocol: 'http' as const,
    host: 'localhost',
    port: 9200,
    user: '',
    password: '',
    database: '',
  },
  permission: 'query-only' as const,
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: { users: ['user.email'] } },
}

describe('Query Command - Elasticsearch', () => {
  let configReadSpy: any
  let createAdapterSpy: any
  let formatterSpy: any
  let mockAdapter: MockElasticsearchAdapter

  beforeEach(() => {
    configReadSpy = spyOn(configModule, 'read').mockResolvedValue(esConfig as any)
    mockAdapter = new MockElasticsearchAdapter()
    createAdapterSpy = spyOn(AdapterFactory, 'createElasticsearchAdapter').mockReturnValue(
      mockAdapter
    )
    formatterSpy = spyOn(QueryResultFormatter.prototype, 'format').mockImplementation(
      (result: any) => JSON.stringify(result.rows)
    )
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    createAdapterSpy.mockRestore()
    formatterSpy.mockRestore()
  })

  test('requires --collection or --index for Elasticsearch', async () => {
    await expect(queryCommand('status:active', { format: 'json' } as any)).rejects.toThrow(
      '--collection'
    )
  })

  test('rejects --fields before creating an Elasticsearch adapter', async () => {
    await expect(
      queryCommand('status:active', { index: 'users', fields: 'name' } as any)
    ).rejects.toThrow('--fields is not supported')
    expect(createAdapterSpy).not.toHaveBeenCalled()
  })

  test('uses --index as alias for adapter params', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await queryCommand('status:active', { index: 'users', format: 'json', limit: 50 } as any)
    expect(mockAdapter.lastParams).toEqual(['users'])
    expect(mockAdapter.lastOptions).toEqual({ limit: 51 })
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('query-only default limit is 1000', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await queryCommand('{"query":{"match_all":{}}}', { collection: 'users', format: 'json' } as any)
    expect(mockAdapter.lastOptions).toEqual({ limit: 1001 })
    logSpy.mockRestore()
  })

  test('no-limit passes 10000 and prints Elasticsearch warning', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = spyOn(console, 'error').mockImplementation(() => {})
    await queryCommand('status:active', {
      collection: 'users',
      format: 'json',
      noLimit: true,
    } as any)
    expect(mockAdapter.lastOptions).toEqual({ limit: 10000 })
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('10000')
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  test('does not print the no-limit warning before an adapter failure', async () => {
    mockAdapter.executeError = new Error('elasticsearch execute failed')
    const warnSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(
        queryCommand('status:active', {
          collection: 'users',
          format: 'json',
          noLimit: true,
        } as any)
      ).rejects.toThrow('elasticsearch execute failed')
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  test('does not print the no-limit warning before a disconnect failure', async () => {
    mockAdapter.disconnectError = new Error('elasticsearch disconnect failed')
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(
        queryCommand('status:active', {
          collection: 'users',
          format: 'json',
          noLimit: true,
        } as any)
      ).rejects.toThrow('elasticsearch disconnect failed')
      expect(logSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  test('filters dotted blacklisted fields before formatting', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await queryCommand('status:active', { collection: 'users', format: 'json' } as any)
    const formatterArg = formatterSpy.mock.calls[0]![0] as any
    expect(formatterArg.rows).toEqual([{ _id: '1', name: 'Alice' }])
    logSpy.mockRestore()
  })

  for (const query of ['status:active', '{"query":{"match_all":{}}}']) {
    const path = query.startsWith('{') ? 'DSL' : 'URI query'
    for (const [label, sourceRows, truncated, visibleRows] of [
      ['N-1', 1, false, 1],
      ['N', 2, false, 2],
      ['N+1', 3, true, 2],
      ['more than N+1', 4, true, 2],
    ] as const) {
      test(`${path} reports truthful metadata for ${label} rows`, async () => {
        mockAdapter.rows = Array.from({ length: sourceRows }, (_, id) => ({ id }))
        const logSpy = spyOn(console, 'log').mockImplementation(() => {})

        await queryCommand(query, { collection: 'users', format: 'json', limit: 2 } as any)

        expect(mockAdapter.lastOptions).toEqual({ limit: 3 })
        const formatted = formatterSpy.mock.calls[0]![0] as any
        expect(formatted.rows).toHaveLength(visibleRows)
        expect(formatted.rowCount).toBe(visibleRows)
        expect(formatted.appliedLimit).toEqual({ truncated, limitApplied: 2 })
        logSpy.mockRestore()
      })
    }
  }

  test('preserves user-authored DSL size without a dbcli truncation claim', async () => {
    mockAdapter.rows = [{ id: 1 }, { id: 2 }]
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})

    await queryCommand('{"size":2,"query":{"match_all":{}}}', {
      collection: 'users',
      format: 'json',
    } as any)

    const formatted = formatterSpy.mock.calls[0]![0] as any
    expect(formatted.appliedLimit).toBeUndefined()
    logSpy.mockRestore()
  })
})
