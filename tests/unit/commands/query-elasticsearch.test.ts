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
  async connect() {}
  async disconnect() {}
  async execute<T>(
    query: string,
    params?: unknown[],
    options?: { limit?: number }
  ): Promise<ExecutionResult<T>> {
    this.lastQuery = query
    this.lastParams = params
    this.lastOptions = options
    const rows = [{ _id: '1', name: 'Alice', 'user.email': 'a@example.com' }] as T[]
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
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    try {
      await queryCommand('status:active', { format: 'json' } as any)
    } catch {
      /* expected: process.exit mock throws */
    }
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('--collection'))
    errSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('uses --index as alias for adapter params', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await queryCommand('status:active', { index: 'users', format: 'json', limit: 50 } as any)
    expect(mockAdapter.lastParams).toEqual(['users'])
    expect(mockAdapter.lastOptions).toEqual({ limit: 50 })
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('query-only default limit is 1000', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await queryCommand('{"query":{"match_all":{}}}', { collection: 'users', format: 'json' } as any)
    expect(mockAdapter.lastOptions).toEqual({ limit: 1000 })
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

  test('filters dotted blacklisted fields before formatting', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await queryCommand('status:active', { collection: 'users', format: 'json' } as any)
    const formatterArg = formatterSpy.mock.calls[0]![0] as any
    expect(formatterArg.rows).toEqual([{ _id: '1', name: 'Alice' }])
    logSpy.mockRestore()
  })
})
