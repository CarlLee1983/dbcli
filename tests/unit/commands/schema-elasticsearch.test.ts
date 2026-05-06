import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { QueryableAdapter, TableSchema } from '@/adapters/types'
import { configModule } from '@/core/config'
import { schemaCommand } from '@/commands/schema'

class MockElasticsearchSchemaAdapter implements QueryableAdapter {
  async connect() {}
  async disconnect() {}
  async execute<T>() {
    return { rows: [] as T[], affectedRows: 0 }
  }
  async listCollections() {
    return []
  }
  async listTables(): Promise<TableSchema[]> {
    return [{ name: 'users', columns: [], tableType: 'table' as const }]
  }
  async getTableSchema(name: string): Promise<TableSchema> {
    return {
      name,
      columns: [
        { name: 'id', type: 'keyword', nullable: false },
        { name: 'profile.email', type: 'keyword', nullable: true },
      ],
      tableType: 'table',
    }
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
    system: 'elasticsearch',
    protocol: 'http',
    host: 'localhost',
    port: 9200,
    user: '',
    password: '',
    database: '',
  },
  permission: 'query-only',
  schema: {},
  metadata: { version: '1.0' },
}

describe('Schema Command - Elasticsearch', () => {
  let configReadSpy: any
  let createSpy: any
  let adapter: MockElasticsearchSchemaAdapter

  beforeEach(() => {
    configReadSpy = spyOn(configModule, 'read').mockResolvedValue(esConfig as any)
    adapter = new MockElasticsearchSchemaAdapter()
    createSpy = spyOn(AdapterFactory, 'createElasticsearchAdapter').mockReturnValue(adapter)
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    createSpy.mockRestore()
  })

  test('shows flattened index schema', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    // schemaCommand has [table] as argument
    await schemaCommand.parseAsync(['users', '--format', 'table'], { from: 'user' })
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Table: users')
    expect(output).toContain('profile.email')
    expect(output).toContain('keyword')
    logSpy.mockRestore()
  })
})
