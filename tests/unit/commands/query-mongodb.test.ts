import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import type { ExecutionResult, QueryableAdapter } from '@/adapters/types'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { QueryResultFormatter } from '@/formatters'
import { queryCommand } from '@/commands/query'

class MockMongoAdapter implements QueryableAdapter {
  lastExecuteOptions: { limit?: number } | undefined
  async connect() {}
  async disconnect() {}
  async execute<T>(
    _query: string,
    _params?: unknown[],
    options?: { limit?: number }
  ): Promise<ExecutionResult<T>> {
    this.lastExecuteOptions = options
    const data = [{ _id: '1', name: 'Alice', city: 'Taipei' }] as T[]
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
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    try {
      await queryCommand('{"age": 18}', { format: 'json' })
    } catch {
      /* exit() */
    }
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('--collection'))
    errSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('rejects SQL-like statements with MongoDB error message', async () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    try {
      await queryCommand('SELECT * FROM users', { collection: 'users', format: 'json' })
    } catch {
      /* exit() */
    }
    const calls = errSpy.mock.calls.flat().join(' ')
    expect(calls).toContain('MongoDB')
    expect(calls).toContain('JSON')
    errSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('rejects invalid JSON query', async () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    try {
      await queryCommand('{invalid json}', { collection: 'users', format: 'json' })
    } catch {
      /* exit() */
    }
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

  test('passes explicit --limit through to mongo adapter execute()', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    await queryCommand('{}', { collection: 'users', format: 'json', limit: 5 })
    expect(mockAdapter.lastExecuteOptions).toEqual({ limit: 5 })
    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  test('applies query-only auto-limit when no --limit/--no-limit given', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    await queryCommand('{}', { collection: 'users', format: 'json' })
    expect(mockAdapter.lastExecuteOptions?.limit).toBe(1000)
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
})
