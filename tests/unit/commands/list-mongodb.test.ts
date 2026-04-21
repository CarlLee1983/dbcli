import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import type { QueryableAdapter } from '@/adapters/types'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { listCommand } from '@/commands/list'

class MockMongoAdapter implements QueryableAdapter {
  async connect() {}
  async disconnect() {}
  async execute<T>(): Promise<any> { return { rows: [], affectedRows: 0 } }
  async listCollections() {
    return [
      { name: 'users', documentCount: 12450 },
      { name: 'orders', documentCount: 89012 },
      { name: 'products', documentCount: 3200 },
    ]
  }
  async testConnection() { return true }
  async getServerVersion() { return '6.0.1' }
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

describe('List Command - MongoDB', () => {
  beforeEach(() => {
    configReadSpy = spyOn(configModule, 'read').mockResolvedValue(mongoConfig as any)
    createMongoAdapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(new MockMongoAdapter())
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    createMongoAdapterSpy.mockRestore()
  })

  test('lists collections in table format showing names and counts', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await listCommand.parseAsync(['node', 'list', '--format', 'table'])
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('users')
    expect(output).toContain('orders')
    expect(output).toContain('12')
    logSpy.mockRestore()
  })

  test('lists collections in json format with name and documentCount', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await listCommand.parseAsync(['node', 'list', '--format', 'json'])
    const rawOutput = logSpy.mock.calls.flat().join('\n')
    const parsed = JSON.parse(rawOutput)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].name).toBe('users')
    expect(parsed[0].documentCount).toBe(12450)
    logSpy.mockRestore()
  })

  test('shows collection count in summary line', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    await listCommand.parseAsync(['node', 'list'])
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('3')
    logSpy.mockRestore()
  })
})
