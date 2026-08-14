import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { insertCommand } from '@/commands/insert'
import { schemaCommand } from '@/commands/schema'
import { AdapterFactory } from '@/adapters'

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
  permission: 'data-admin' as const,
  schema: {},
  metadata: { version: '1.0' },
}

describe('MongoDB unsupported commands', () => {
  let configSpy: any
  let errSpy: any
  let logSpy: any
  let exitSpy: any

  beforeEach(() => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue(mongoConfig as any)
    errSpy = spyOn(console, 'error').mockImplementation(() => {})
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
  })

  afterEach(() => {
    configSpy.mockRestore()
    errSpy.mockRestore()
    logSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('insert command routes MongoDB writes through Mongo adapter', async () => {
    const adapter = {
      connect: async () => {},
      disconnect: async () => {},
      insert: async () => ({ rows: [], affectedRows: 1, lastInsertId: 'abc123' }),
    }
    const adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)
    try {
      await insertCommand('users', { data: '{"name":"test"}', force: true })
      const output = logSpy.mock.calls.flat().join('\n')
      expect(output).toContain('"operation": "insert"')
      expect(output).toContain('"rows_affected": 1')
    } finally {
      adapterSpy.mockRestore()
    }
  })

  test('schema command can inspect MongoDB collections through adapter compatibility methods', async () => {
    const adapter = {
      connect: async () => {},
      disconnect: async () => {},
      getTableSchema: async (name: string) => ({
        name,
        columns: [{ name: '_id', type: 'object', nullable: false }],
        estimatedRowCount: 1,
        tableType: 'collection',
      }),
    }
    const adapterSpy = spyOn(AdapterFactory, 'createAdapter').mockReturnValue(adapter as any)
    try {
      await schemaCommand.parseAsync(['node', 'dbcli', 'users', '--format', 'json'])
      const output = logSpy.mock.calls.flat().join('\n')
      expect(output).toContain('"name": "users"')
      expect(output).toContain('_id')
    } finally {
      adapterSpy.mockRestore()
    }
  })
})
