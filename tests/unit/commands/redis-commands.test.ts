import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { insertCommand } from '@/commands/insert'
import { updateCommand } from '@/commands/update'
import { deleteCommand } from '@/commands/delete'
import { exportCommand } from '@/commands/export'
import { AdapterFactory } from '@/adapters'

const redisConfig = {
  connection: {
    system: 'redis' as const,
    host: '127.0.0.1',
    port: 6379,
    user: '',
    password: '',
    database: '0',
  },
  permission: 'data-admin' as const,
  schema: {},
  metadata: { version: '1.0' },
}

class MockRedisAdapter {
  async connect() {}
  async disconnect() {}
  async insert() { return { affectedRows: 1, rows: [] } }
  async update() { return { affectedRows: 1, rows: [] } }
  async delete() { return { affectedRows: 1, rows: [] } }
  async execute() { return { rows: [{ value: 'ok' }], affectedRows: 1 } }
}

describe('Redis CLI commands', () => {
  let configSpy: any
  let logSpy: any
  let errSpy: any
  let exitSpy: any
  let adapterSpy: any
  let mockAdapter: MockRedisAdapter

  beforeEach(() => {
    mockAdapter = new MockRedisAdapter()
    configSpy = spyOn(configModule, 'read').mockResolvedValue(redisConfig as any)
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errSpy = spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    adapterSpy = spyOn(AdapterFactory, 'createRedisAdapter').mockReturnValue(mockAdapter as any)
  })

  afterEach(() => {
    configSpy.mockRestore()
    logSpy.mockRestore()
    errSpy.mockRestore()
    exitSpy.mockRestore()
    adapterSpy.mockRestore()
  })

  function combinedOutput(): string {
    const fromLog = logSpy.mock.calls.flat().join('\n')
    const fromErr = errSpy.mock.calls.flat().join('\n')
    return `${fromLog}\n${fromErr}`
  }

  test('insert command calls adapter.insert', async () => {
    const insertSpy = spyOn(mockAdapter, 'insert')
    try {
      await insertCommand('mykey', { data: '{"value":"hi"}' })
    } catch { /* ignore */ }
    const out = combinedOutput()
    try {
      expect(insertSpy).toHaveBeenCalled()
      expect(out).toContain('"status": "success"')
    } catch (e) {
      console.log('Output was:', out)
      throw e
    }
  })

  test('update command calls adapter.update', async () => {
    const updateSpy = spyOn(mockAdapter, 'update')
    try {
      await updateCommand('mykey', { where: 'ignore', set: '{"value":"new"}' })
    } catch { /* ignore */ }
    const out = combinedOutput()
    try {
      expect(updateSpy).toHaveBeenCalled()
      expect(out).toContain('"status": "success"')
    } catch (e) {
      console.log('Output was:', out)
      throw e
    }
  })

  test('delete command calls adapter.delete', async () => {
    const deleteSpy = spyOn(mockAdapter, 'delete')
    try {
      await deleteCommand('mykey', { where: 'field=val' })
    } catch { /* ignore */ }
    const out = combinedOutput()
    try {
      expect(deleteSpy).toHaveBeenCalled()
      expect(out).toContain('"status": "success"')
    } catch (e) {
      console.log('Output was:', out)
      throw e
    }
  })

  test('export command calls adapter.execute and formats output', async () => {
    const executeSpy = spyOn(mockAdapter, 'execute')
    try {
      await exportCommand('GET mykey', { format: 'json' })
    } catch { /* ignore */ }
    const out = combinedOutput()
    try {
      expect(executeSpy).toHaveBeenCalledWith('GET mykey')
      expect(out).toContain('"value": "ok"')
    } catch (e) {
      console.log('Output was:', out)
      throw e
    }
  })

  test('query command warns on KEYS command', async () => {
    const { queryCommand } = await import('@/commands/query')
    try {
      await queryCommand('KEYS *', {})
    } catch { /* ignore */ }
    const out = combinedOutput()
    expect(out).toContain('Warning: "KEYS" command is dangerous')
  })
})
