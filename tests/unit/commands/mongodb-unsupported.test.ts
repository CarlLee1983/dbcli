import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { insertCommand } from '@/commands/insert'
import { schemaCommand } from '@/commands/schema'

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

describe('MongoDB unsupported commands', () => {
  let configSpy: any
  let errSpy: any
  let exitSpy: any

  beforeEach(() => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue(mongoConfig as any)
    errSpy = spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  })

  afterEach(() => {
    configSpy.mockRestore()
    errSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('insert command exits with MongoDB not-supported message', async () => {
    try {
      await insertCommand('users', { data: '{"name":"test"}' })
    } catch { /* exit() */ }
    const output = errSpy.mock.calls.flat().join(' ')
    expect(output).toContain('MongoDB')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('schema command exits with MongoDB not-supported message', async () => {
    try {
      await schemaCommand.parseAsync(['node', 'dbcli', 'schema'])
    } catch { /* exit() */ }
    const output = errSpy.mock.calls.flat().join(' ')
    expect(output).toContain('MongoDB')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
