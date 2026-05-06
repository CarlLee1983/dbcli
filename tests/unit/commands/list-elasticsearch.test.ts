import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { QueryableAdapter, TableSchema } from '@/adapters/types'
import { configModule } from '@/core/config'
import { listCommand } from '@/commands/list'

class MockElasticsearchListAdapter implements QueryableAdapter {
  lastOptions: { includeSystem?: boolean } | undefined
  async connect() {}
  async disconnect() {}
  async execute<T>() { return { rows: [] as T[], affectedRows: 0 } }
  async listCollections() { return [] }
  async listTables(options?: { includeSystem?: boolean }): Promise<TableSchema[]> {
    this.lastOptions = options
    return [
      { name: 'users', columns: [], estimatedRowCount: 2, tableType: 'table' },
      { name: 'active_users', columns: [], tableType: 'view' },
    ]
  }
  async testConnection() { return true }
  async getServerVersion() { return '8.13.0' }
  async insert() { return { rows: [], affectedRows: 1 } }
  async update() { return { rows: [], affectedRows: 1 } }
  async delete() { return { rows: [], affectedRows: 1 } }
}

const esConfig = {
  connection: { system: 'elasticsearch', protocol: 'http', host: 'localhost', port: 9200, user: '', password: '', database: '' },
  permission: 'query-only',
  schema: {},
  metadata: { version: '1.0' },
}

describe('List Command - Elasticsearch', () => {
  let configReadSpy: any
  let createSpy: any
  let adapter: MockElasticsearchListAdapter

  beforeEach(() => {
    configReadSpy = spyOn(configModule, 'read').mockResolvedValue(esConfig as any)
    adapter = new MockElasticsearchListAdapter()
    createSpy = spyOn(AdapterFactory, 'createElasticsearchAdapter').mockReturnValue(adapter)
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    createSpy.mockRestore()
  })

  test('prints Elasticsearch indices in table output', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await listCommand.parseAsync(['--format', 'table'], { from: 'user' })
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Indices in elasticsearch')
    expect(output).toContain('users')
    expect(output).toContain('active_users')
    expect(output).toContain('Found 1 indices (1 aliases)')
    logSpy.mockRestore()
  })

  test('passes includeSystem option to adapter', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await listCommand.parseAsync(['--include-system'], { from: 'user' })
    expect(adapter.lastOptions).toEqual({ includeSystem: true })
    logSpy.mockRestore()
  })
})
