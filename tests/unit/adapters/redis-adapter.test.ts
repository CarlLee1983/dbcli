import { describe, test, expect } from 'bun:test'
import { RedisAdapter, parseRedisCommand } from 'src/adapters/redis-adapter'
import type { ConnectionOptions } from 'src/adapters/types'
import { ConnectionError } from 'src/adapters/types'

type Handler = (...args: unknown[]) => unknown

class MockRedisClient {
  connected = false
  quit_called = false
  disconnected = false
  storage = new Map<string, unknown>()
  ttls = new Map<string, number>()
  types = new Map<string, string>()
  callLog: Array<{ cmd: string; args: unknown[] }> = []
  scanResponses: Array<[string, string[]]> = [['0', []]]
  customHandlers: Record<string, Handler> = {}
  serverInfoText = '# Server\r\nredis_version:7.4.0\r\n'

  async connect() {
    this.connected = true
  }
  async quit() {
    this.quit_called = true
  }
  disconnect() {
    this.disconnected = true
  }

  async ping() {
    return 'PONG'
  }
  async info(_section?: string) {
    return this.serverInfoText
  }
  async type(key: string): Promise<string> {
    return this.types.get(key) ?? 'none'
  }
  async ttl(key: string): Promise<number> {
    return this.ttls.has(key) ? this.ttls.get(key)! : -1
  }
  async strlen(key: string): Promise<number> {
    return String(this.storage.get(key) ?? '').length
  }
  async hlen(key: string): Promise<number> {
    const v = this.storage.get(key)
    return v && typeof v === 'object' ? Object.keys(v as object).length : 0
  }
  async hkeys(key: string): Promise<string[]> {
    const v = this.storage.get(key)
    return v && typeof v === 'object' ? Object.keys(v as object) : []
  }
  async llen(key: string): Promise<number> {
    const v = this.storage.get(key)
    return Array.isArray(v) ? v.length : 0
  }
  async scard(key: string): Promise<number> {
    return this.llen(key)
  }
  async zcard(key: string): Promise<number> {
    return this.llen(key)
  }
  async xlen(key: string): Promise<number> {
    return this.llen(key)
  }
  async scan(
    cursor: string,
    _matchTok: string,
    _pattern: string,
    _countTok: string,
    _count: number
  ): Promise<[string, string[]]> {
    const idx = Number(cursor) || 0
    const next = this.scanResponses[idx + 1] ? String(idx + 1) : '0'
    const [, keys] = this.scanResponses[idx] ?? ['0', []]
    return [next, keys]
  }
  async set(key: string, value: unknown) {
    this.storage.set(key, value)
    return 'OK'
  }
  async expire(key: string, sec: number) {
    this.ttls.set(key, sec)
    return 1
  }
  async hset(key: string, ...rest: string[]) {
    const obj = (this.storage.get(key) as Record<string, string>) ?? {}
    for (let i = 0; i < rest.length; i += 2) {
      obj[rest[i]!] = rest[i + 1]!
    }
    this.storage.set(key, obj)
    return rest.length / 2
  }
  async hdel(key: string, field: string) {
    const obj = this.storage.get(key) as Record<string, string> | undefined
    if (!obj || !(field in obj)) return 0
    delete obj[field]
    return 1
  }
  async del(key: string) {
    return this.storage.delete(key) ? 1 : 0
  }
  async call(cmd: string, ...args: unknown[]) {
    this.callLog.push({ cmd, args })
    if (this.customHandlers[cmd]) return this.customHandlers[cmd]!(...args)
    return 'OK'
  }
}

class FailingRedisClient {
  async connect() {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
    })
    throw err
  }
  async quit() {}
  disconnect() {}
}

const baseOptions: ConnectionOptions = {
  system: 'redis',
  host: 'localhost',
  port: 6379,
  user: '',
  password: '',
  database: '0',
  timeout: 1000,
}

function makeAdapter(client: MockRedisClient = new MockRedisClient()) {
  const ctor = function (_opts: unknown) {
    return client
  } as unknown as new (opts: unknown) => never
  const adapter = new RedisAdapter(baseOptions, ctor as never)
  return { adapter, client }
}

describe('RedisAdapter — connection lifecycle', () => {
  test('connect() opens the underlying client', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.connect()
    expect(client.connected).toBe(true)
  })

  test('connect() wraps driver errors in ConnectionError with ECONNREFUSED code', async () => {
    const ctor = function () {
      return new FailingRedisClient()
    } as unknown as new (opts: unknown) => never
    const adapter = new RedisAdapter(baseOptions, ctor as never)
    let caught: unknown
    try {
      await adapter.connect()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ConnectionError)
    expect((caught as ConnectionError).code).toBe('ECONNREFUSED')
  })

  test('disconnect() is idempotent and never throws', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.connect()
    await adapter.disconnect()
    await adapter.disconnect()
    expect(client.quit_called).toBe(true)
  })

  test('testConnection() returns true when ping returns PONG', async () => {
    const { adapter } = makeAdapter()
    await adapter.connect()
    expect(await adapter.testConnection()).toBe(true)
  })

  test('getServerVersion() parses redis_version from INFO', async () => {
    const { adapter, client } = makeAdapter()
    client.serverInfoText = '# Server\r\nredis_version:7.4.1\r\nuptime:1234\r\n'
    await adapter.connect()
    expect(await adapter.getServerVersion()).toBe('7.4.1')
  })

  test('rejects out-of-range port at construction', () => {
    expect(
      () =>
        new RedisAdapter({ ...baseOptions, port: 70_000 }, function () {
          return new MockRedisClient()
        } as unknown as new (opts: unknown) => never)
    ).toThrow(/Invalid port/)
  })
})

describe('parseRedisCommand', () => {
  test('splits on whitespace', () => {
    expect(parseRedisCommand('GET foo')).toEqual(['GET', 'foo'])
  })

  test('keeps double-quoted args together', () => {
    expect(parseRedisCommand('SET key "hello world"')).toEqual(['SET', 'key', 'hello world'])
  })

  test('keeps single-quoted args together', () => {
    expect(parseRedisCommand("HSET h f 'v with spaces'")).toEqual([
      'HSET',
      'h',
      'f',
      'v with spaces',
    ])
  })

  test('handles backslash escape inside quotes', () => {
    expect(parseRedisCommand('SET k "she said \\"hi\\""')).toEqual(['SET', 'k', 'she said "hi"'])
  })

  test('rejects unterminated quotes', () => {
    expect(() => parseRedisCommand('SET k "oops')).toThrow(/未閉合/)
  })

  test('returns empty array for whitespace-only input', () => {
    expect(parseRedisCommand('   ')).toEqual([])
  })
})

describe('RedisAdapter — discovery & schema', () => {
  test('listCollections() walks SCAN cursor until 0', async () => {
    const { adapter, client } = makeAdapter()
    client.scanResponses = [
      ['1', ['user:1', 'user:2']],
      ['2', ['session:abc']],
      ['0', ['cache:x']],
    ]
    await adapter.connect()
    const result = await adapter.listCollections()
    const names = result.map((r) => r.name).sort()
    expect(names).toEqual(['cache:x', 'session:abc', 'user:1', 'user:2'])
  })

  test('getTableSchema() reports type/ttl/size for a string key', async () => {
    const { adapter, client } = makeAdapter()
    client.types.set('greeting', 'string')
    client.storage.set('greeting', 'hello')
    client.ttls.set('greeting', 60)
    await adapter.connect()
    const schema = await adapter.getTableSchema('greeting')
    expect(schema.name).toBe('greeting')
    expect(schema.estimatedRowCount).toBe(5)
    const cols = Object.fromEntries(schema.columns.map((c) => [c.name, c.type]))
    expect(cols.type).toBe('string')
    expect(cols.ttl).toBe('60s')
    expect(cols.size).toBe('5')
  })

  test('getTableSchema() reports a hash sample for hash keys', async () => {
    const { adapter, client } = makeAdapter()
    client.types.set('user:1', 'hash')
    client.storage.set('user:1', { name: 'Alice', email: 'alice@example.com' })
    await adapter.connect()
    const schema = await adapter.getTableSchema('user:1')
    expect(schema.estimatedRowCount).toBe(2)
    const cols = Object.fromEntries(schema.columns.map((c) => [c.name, c.type]))
    expect(cols.sample).toContain('name')
  })

  test('getTableSchema() returns empty columns when key is missing', async () => {
    const { adapter } = makeAdapter()
    await adapter.connect()
    const schema = await adapter.getTableSchema('does-not-exist')
    expect(schema.columns).toEqual([])
  })
})

describe('RedisAdapter — command execution & DML', () => {
  test('execute() routes through client.call with parsed tokens', async () => {
    const { adapter, client } = makeAdapter()
    client.customHandlers.GET = (_key) => 'world'
    await adapter.connect()
    const result = await adapter.execute('GET hello')
    expect(client.callLog).toEqual([{ cmd: 'GET', args: ['hello'] }])
    expect(result.rows).toEqual([{ value: 'world' }])
  })

  test('execute() flattens HGETALL replies into a single object row', async () => {
    const { adapter, client } = makeAdapter()
    client.customHandlers.HGETALL = () => ['name', 'Alice', 'age', '30']
    await adapter.connect()
    const result = await adapter.execute<Record<string, unknown>>('HGETALL user:1')
    expect(result.rows).toEqual([{ name: 'Alice', age: '30' }])
  })

  test('execute() rejects empty commands', async () => {
    const { adapter } = makeAdapter()
    await adapter.connect()
    let caught: unknown
    try {
      await adapter.execute('')
    } catch (err) {
      caught = err
    }
    expect((caught as Error).message).toContain('不可為空')
  })

  test('insert() with __type=string sets the key and applies TTL', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.connect()
    const result = await adapter.insert('greeting', { value: 'hi', ttl: 30 })
    expect(result.affectedRows).toBe(1)
    expect(client.storage.get('greeting')).toBe('hi')
    expect(client.ttls.get('greeting')).toBe(30)
  })

  test('insert() with __type=hash writes all fields', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.connect()
    await adapter.insert('user:1', {
      __type: 'hash',
      fields: { name: 'Alice', email: 'a@example.com' },
    })
    expect(client.storage.get('user:1')).toEqual({ name: 'Alice', email: 'a@example.com' })
  })

  test('update() can patch hash fields', async () => {
    const { adapter, client } = makeAdapter()
    client.storage.set('user:1', { name: 'Alice' })
    await adapter.connect()
    await adapter.update('user:1', {}, { fields: { name: 'Bob' } })
    expect(client.storage.get('user:1')).toEqual({ name: 'Bob' })
  })

  test('delete() removes the entire key when no field filter is given', async () => {
    const { adapter, client } = makeAdapter()
    client.storage.set('greeting', 'hi')
    await adapter.connect()
    const result = await adapter.delete('greeting', {})
    expect(result.affectedRows).toBe(1)
    expect(client.storage.has('greeting')).toBe(false)
  })

  test('delete() removes a specific hash field when filter.field is given', async () => {
    const { adapter, client } = makeAdapter()
    client.storage.set('user:1', { name: 'Alice', email: 'a@example.com' })
    await adapter.connect()
    const result = await adapter.delete('user:1', { field: 'email' })
    expect(result.affectedRows).toBe(1)
    expect(client.storage.get('user:1')).toEqual({ name: 'Alice' })
  })
})
