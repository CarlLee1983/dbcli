import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { insertCommand } from '@/commands/insert'
import { updateCommand } from '@/commands/update'
import { deleteCommand } from '@/commands/delete'
import type { DbcliConfig } from '@/utils/validation'

let mockConfig: DbcliConfig
let configReadSpy: any
let logSpy: any
let errorSpy: any
let sqlSpy: any
let mongoSpy: any
let redisSpy: any
let esSpy: any

function lastLog(): string {
  return String(logSpy.mock.calls.at(-1)?.[0] ?? '')
}

function baseSchema() {
  return { users: { name: 'users', columns: [] } }
}

function configFor(system: 'mongodb' | 'redis' | 'elasticsearch'): DbcliConfig {
  if (system === 'mongodb') {
    return {
      connection: { system: 'mongodb', uri: 'mongodb://localhost', database: 'test' } as any,
      permission: 'admin',
      schema: baseSchema(),
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
    } as DbcliConfig
  }
  if (system === 'redis') {
    return {
      connection: {
        system: 'redis',
        host: 'localhost',
        port: 6379,
        user: '',
        password: '',
        database: '0',
      } as any,
      permission: 'admin',
      schema: baseSchema(),
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
    } as DbcliConfig
  }
  return {
    connection: {
      system: 'elasticsearch',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: 'idx',
    } as any,
    permission: 'admin',
    schema: baseSchema(),
    metadata: { version: '1.0' },
    blacklist: { tables: [], columns: {} },
  } as DbcliConfig
}

describe('non-SQL --plan never opens a connection', () => {
  let originalIsTTY: boolean | undefined

  beforeEach(() => {
    originalIsTTY = (process.stdin as { isTTY?: boolean }).isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })

    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    configReadSpy = spyOn(configModule, 'read').mockImplementation(async () => mockConfig)
    sqlSpy = spyOn(AdapterFactory, 'createSqlAdapter')
    mongoSpy = spyOn(AdapterFactory, 'createMongoDBAdapter')
    redisSpy = spyOn(AdapterFactory, 'createRedisAdapter')
    esSpy = spyOn(AdapterFactory, 'createElasticsearchAdapter')
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    configReadSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    sqlSpy.mockRestore()
    mongoSpy.mockRestore()
    redisSpy.mockRestore()
    esSpy.mockRestore()
  })

  test('MongoDB insert --plan creates no adapter', async () => {
    mockConfig = configFor('mongodb')
    await insertCommand('users', {
      data: '{"name":"Alice"}',
      plan: true,
      format: 'json',
    } as any)
    expect(JSON.parse(lastLog()).operation).toBe('INSERT')
    expect(sqlSpy).not.toHaveBeenCalled()
    expect(mongoSpy).not.toHaveBeenCalled()
    expect(redisSpy).not.toHaveBeenCalled()
    expect(esSpy).not.toHaveBeenCalled()
  })

  test('Redis update --plan creates no adapter', async () => {
    mockConfig = configFor('redis')
    await updateCommand('user:42', {
      where: '',
      set: '{"name":"Alice"}',
      plan: true,
      format: 'json',
    } as any)
    expect(JSON.parse(lastLog()).operation).toBe('UPDATE')
    expect(sqlSpy).not.toHaveBeenCalled()
    expect(mongoSpy).not.toHaveBeenCalled()
    expect(redisSpy).not.toHaveBeenCalled()
    expect(esSpy).not.toHaveBeenCalled()
  })

  test('Elasticsearch delete --plan creates no adapter', async () => {
    mockConfig = configFor('elasticsearch')
    await deleteCommand('products', {
      where: '{"_id":"abc"}',
      plan: true,
      format: 'json',
    } as any)
    expect(JSON.parse(lastLog()).operation).toBe('DELETE')
    expect(sqlSpy).not.toHaveBeenCalled()
    expect(mongoSpy).not.toHaveBeenCalled()
    expect(redisSpy).not.toHaveBeenCalled()
    expect(esSpy).not.toHaveBeenCalled()
  })
})
