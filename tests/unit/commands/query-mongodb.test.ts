import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import type { ExecutionResult, QueryableAdapter } from '@/adapters/types'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { QueryResultFormatter } from '@/formatters'
import { queryCommand } from '@/commands/query'

class MockMongoAdapter implements QueryableAdapter {
  async connect() {}
  async disconnect() {}
  async execute<T>(): Promise<ExecutionResult<T>> {
    const data = [{ _id: '1', name: 'Alice', city: 'Taipei' }] as T[]
    return { rows: data, affectedRows: data.length }
  }
  async listCollections() { return [] }
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
let formatterSpy: any

describe('Query Command - MongoDB', () => {
  beforeEach(() => {
    configReadSpy = spyOn(configModule, 'read').mockResolvedValue(mongoConfig as any)
    createMongoAdapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(new MockMongoAdapter())
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
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    try {
      await queryCommand('{"age": 18}', { format: 'json' })
    } catch { /* exit() */ }
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('--collection'))
    errSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('rejects SQL-like statements with MongoDB error message', async () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    try {
      await queryCommand('SELECT * FROM users', { collection: 'users', format: 'json' })
    } catch { /* exit() */ }
    const calls = errSpy.mock.calls.flat().join(' ')
    expect(calls).toContain('MongoDB')
    expect(calls).toContain('JSON')
    errSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('rejects invalid JSON query', async () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    try {
      await queryCommand('{invalid json}', { collection: 'users', format: 'json' })
    } catch { /* exit() */ }
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('JSON'))
    errSpy.mockRestore()
    exitSpy.mockRestore()
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
})
