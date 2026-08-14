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
  disconnectError?: Error
  async connect() {}
  async disconnect() {
    if (this.disconnectError) throw this.disconnectError
  }
  async insert() {
    return { affectedRows: 1, rows: [] }
  }
  async update() {
    return { affectedRows: 1, rows: [] }
  }
  async delete() {
    return { affectedRows: 1, rows: [] }
  }
  async execute() {
    return { rows: [{ value: 'ok' }], affectedRows: 1 }
  }
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
      await insertCommand('mykey', { data: '{"value":"hi"}', force: true })
    } catch {
      /* ignore */
    }
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
      await updateCommand('mykey', { where: 'ignore', set: '{"value":"new"}', force: true })
    } catch {
      /* ignore */
    }
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
      await deleteCommand('mykey', { where: 'field=val', force: true })
    } catch {
      /* ignore */
    }
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
    } catch {
      /* ignore */
    }
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
    configSpy.mockResolvedValue({ ...redisConfig, permission: 'admin' } as any)
    try {
      await queryCommand('KEYS *', {})
    } catch {
      /* ignore */
    }
    const out = combinedOutput()
    expect(out).toContain('Warning: "KEYS" command is dangerous')
  })

  test('query rejects --fields before creating a Redis adapter', async () => {
    const { queryCommand } = await import('@/commands/query')
    await expect(queryCommand('GET mykey', { fields: 'value' })).rejects.toThrow(
      '--fields is not supported'
    )
    expect(adapterSpy).not.toHaveBeenCalled()
  })

  test('query --recovery suppresses the human KEYS warning on stderr', async () => {
    // Regression: --recovery means stderr should stay clean for the agent;
    // the recovery envelope (on stdout) is the sole authoritative output.
    const { queryCommand } = await import('@/commands/query')
    configSpy.mockResolvedValue({ ...redisConfig, permission: 'admin' } as any)
    try {
      await queryCommand('KEYS *', { recovery: true })
    } catch {
      /* ignore */
    }
    const stderrOnly = errSpy.mock.calls.flat().join('\n')
    expect(stderrOnly).not.toContain('Warning: "KEYS" command is dangerous')
    expect(stderrOnly).not.toContain('Please use "SCAN"')
  })

  test('query does not print the KEYS warning before a disconnect failure', async () => {
    const { queryCommand } = await import('@/commands/query')
    configSpy.mockResolvedValue({ ...redisConfig, permission: 'admin' } as any)
    mockAdapter.disconnectError = new Error('redis disconnect failed')

    await expect(queryCommand('KEYS *', {})).rejects.toThrow('redis disconnect failed')
    expect(logSpy).not.toHaveBeenCalled()
    expect(errSpy.mock.calls.flat().join('\n')).not.toContain(
      'Warning: "KEYS" command is dangerous'
    )
  })
})
