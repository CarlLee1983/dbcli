import { describe, test, expect } from 'bun:test'
import { RedisAdapter, parseRedisCommand } from 'src/adapters/redis-adapter'
import type { ConnectionOptions } from 'src/adapters/types'
import { ConnectionError } from 'src/adapters/types'
import { BlacklistRejection } from 'src/adapters/redis/types'

type Handler = (...args: unknown[]) => unknown

class MockRedisClient {
  connected = false
  closed = false
  storage = new Map<string, unknown>()
  ttls = new Map<string, number>()
  types = new Map<string, string>()
  sendLog: Array<{ cmd: string; args: unknown[] }> = []
  scanResponses: Array<[string, string[]]> = [['0', []]]
  customHandlers: Record<string, Handler> = {}
  serverInfoText = '# Server\r\nredis_version:7.4.0\r\n'
  onclose?: (err?: unknown) => void

  async connect() {
    this.connected = true
  }
  close() {
    this.closed = true
  }

  async ttl(key: string): Promise<number> {
    return this.ttls.has(key) ? this.ttls.get(key)! : -1
  }
  async set(key: string, value: unknown) {
    this.storage.set(key, value)
    return 'OK'
  }
  async expire(key: string, sec: number) {
    this.ttls.set(key, sec)
    return 1
  }
  async hmset(key: string, args: string[]) {
    const obj = (this.storage.get(key) as Record<string, string>) ?? {}
    for (let i = 0; i < args.length; i += 2) {
      obj[args[i]!] = args[i + 1]!
    }
    this.storage.set(key, obj)
    return 'OK'
  }
  async del(key: string) {
    return this.storage.delete(key) ? 1 : 0
  }

  async send(cmd: string, args: unknown[] = []) {
    this.sendLog.push({ cmd, args })
    if (this.customHandlers[cmd]) return this.customHandlers[cmd]!(...args)

    const upper = cmd.toUpperCase()
    switch (upper) {
      case 'PING':
        return 'PONG'
      case 'INFO':
        return this.serverInfoText
      case 'TYPE':
        return this.types.get(String(args[0])) ?? 'none'
      case 'STRLEN':
        return String(this.storage.get(String(args[0])) ?? '').length
      case 'HLEN': {
        const v = this.storage.get(String(args[0]))
        return v && typeof v === 'object' ? Object.keys(v as object).length : 0
      }
      case 'HKEYS': {
        const v = this.storage.get(String(args[0]))
        return v && typeof v === 'object' ? Object.keys(v as object) : []
      }
      case 'LLEN':
      case 'SCARD':
      case 'ZCARD':
      case 'XLEN': {
        const v = this.storage.get(String(args[0]))
        return Array.isArray(v) ? v.length : 0
      }
      case 'HDEL': {
        const obj = this.storage.get(String(args[0])) as Record<string, string> | undefined
        const field = String(args[1])
        if (!obj || !(field in obj)) return 0
        delete obj[field]
        return 1
      }
      case 'RPUSH': {
        const key = String(args[0])
        const values = args.slice(1)
        const current = (this.storage.get(key) as unknown[]) ?? []
        this.storage.set(key, [...current, ...values])
        return values.length
      }
      case 'SADD': {
        const key = String(args[0])
        const values = args.slice(1)
        const current = new Set((this.storage.get(key) as unknown[]) ?? [])
        let added = 0
        for (const v of values) {
          if (!current.has(v)) {
            current.add(v)
            added++
          }
        }
        this.storage.set(key, Array.from(current))
        return added
      }
      case 'ZADD': {
        const key = String(args[0])
        const argsList = args.slice(1)
        const current = (this.storage.get(key) as string[]) ?? []
        const currentSet = new Set(current)
        let added = 0
        for (let i = 0; i < argsList.length; i += 2) {
          const member = String(argsList[i + 1])
          if (!currentSet.has(member)) {
            currentSet.add(member)
            added++
          }
        }
        this.storage.set(key, Array.from(currentSet))
        return added
      }
      case 'LREM': {
        const key = String(args[0])
        const value = String(args[2])
        const current = (this.storage.get(key) as unknown[]) ?? []
        const idx = current.indexOf(value)
        if (idx === -1) return 0
        current.splice(idx, 1)
        this.storage.set(key, current)
        return 1
      }
      case 'SREM':
      case 'ZREM': {
        const key = String(args[0])
        const value = String(args[1])
        const current = (this.storage.get(key) as unknown[]) ?? []
        const idx = current.indexOf(value)
        if (idx === -1) return 0
        current.splice(idx, 1)
        this.storage.set(key, current)
        return 1
      }
      case 'SCAN': {
        const cursor = String(args[0])
        const idx = Number(cursor) || 0
        const next = this.scanResponses[idx + 1] ? String(idx + 1) : '0'
        const [, keys] = this.scanResponses[idx] ?? ['0', []]
        return [next, keys]
      }
      default:
        return 'OK'
    }
  }
}

class FailingRedisClient {
  onclose?: (err?: unknown) => void
  async connect() {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
    })
    throw err
  }
  close() {}
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
    expect(client.closed).toBe(true)
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
  test('execute() routes through client.send with parsed tokens', async () => {
    const { adapter, client } = makeAdapter()
    client.customHandlers.GET = (_key) => 'world'
    await adapter.connect()
    const result = await adapter.execute('GET hello')
    const getEntry = client.sendLog.find((e) => e.cmd === 'GET')
    expect(getEntry).toEqual({ cmd: 'GET', args: ['hello'] })
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

  test('insert() with __type=list pushes values', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.connect()
    await adapter.insert('mylists', { __type: 'list', values: ['a', 'b'] })
    expect(client.storage.get('mylists')).toEqual(['a', 'b'])
  })

  test('insert() with __type=set adds members', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.connect()
    await adapter.insert('myset', { __type: 'set', values: ['m1', 'm2'] })
    expect(client.storage.get('myset')).toEqual(['m1', 'm2'])
  })

  test('insert() with __type=zset adds members with scores', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.connect()
    await adapter.insert('myzset', { __type: 'zset', members: { m1: 10, m2: 20 } })
    expect(client.storage.get('myzset')).toEqual(['m1', 'm2'])
    const zaddCall = client.sendLog.find((l) => l.cmd === 'ZADD')
    expect(zaddCall?.args).toEqual(['myzset', '10', 'm1', '20', 'm2'])
  })

  test('update() can append to lists/sets', async () => {
    const { adapter, client } = makeAdapter()
    client.storage.set('mylists', ['a'])
    await adapter.connect()
    await adapter.update('mylists', {}, { __type: 'list', values: ['b'] })
    expect(client.storage.get('mylists')).toEqual(['a', 'b'])
  })

  test('delete() can remove list/set/zset members', async () => {
    const { adapter, client } = makeAdapter()
    client.storage.set('myset', ['m1', 'm2'])
    client.types.set('myset', 'set')
    await adapter.connect()
    const result = await adapter.delete('myset', { value: 'm1' })
    expect(result.affectedRows).toBe(1)
    expect(client.storage.get('myset')).toEqual(['m2'])
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

describe('RedisAdapter — middleware (blacklist + size guard)', () => {
  function makeMiddlewareAdapter(blacklist: string[] = [], mockReply: unknown = []) {
    const sent: { head: string; args: unknown[] }[] = []
    const client = {
      send: async (head: string, args: unknown[]) => {
        sent.push({ head, args })
        return mockReply
      },
      ttl: async () => -1,
      del: async () => 1,
      set: async () => 'OK',
      hmset: async () => 'OK',
      close: () => {},
      onclose: undefined as unknown,
    }
    const adapter = new RedisAdapter(baseOptions)
    ;(adapter as unknown as { client: unknown }).client = client
    adapter.setBlacklistRules(blacklist)
    return { adapter, client, sent }
  }

  test('execute rejects blacklisted key', async () => {
    const { adapter } = makeMiddlewareAdapter(['secrets:*'])
    await expect(adapter.execute('GET secrets:api_key')).rejects.toBeInstanceOf(BlacklistRejection)
  })

  test('execute on SCAN injects COUNT and emits warning', async () => {
    const { adapter, sent } = makeMiddlewareAdapter([], ['0', ['k1', 'k2']])
    const r = await adapter.execute('SCAN 0')
    expect(sent[0]!.args).toEqual(['0', 'COUNT', '1000'])
    expect(r.warnings?.[0]?.code).toBe('REDIS_SIZE_REWRITE')
  })

  test('execute on HGETALL truncates large reply', async () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < 1500; i++) big[`f${i}`] = String(i)
    const { adapter } = makeMiddlewareAdapter([], big)
    const r = await adapter.execute('HGETALL h')
    expect(r.warnings?.[0]?.code).toBe('REDIS_SIZE_TRUNCATE')
  })

  test('listCollections filters blacklisted keys', async () => {
    const client = {
      send: async (head: string) => {
        if (head === 'SCAN') return ['0', ['user:1', 'secrets:k', 'user:2']]
        return null
      },
      close: () => {},
      onclose: undefined as unknown,
    }
    const adapter = new RedisAdapter(baseOptions)
    ;(adapter as unknown as { client: unknown }).client = client
    adapter.setBlacklistRules(['secrets:*'])
    const cols = await adapter.listCollections()
    expect(cols.map((c) => c.name)).toEqual(['user:1', 'user:2'])
  })

  test('getTableSchema rejects blacklisted key', async () => {
    const adapter = new RedisAdapter(baseOptions)
    ;(adapter as unknown as { client: unknown }).client = {
      send: async () => null,
      close: () => {},
    }
    adapter.setBlacklistRules(['secrets:*'])
    await expect(adapter.getTableSchema('secrets:foo')).rejects.toBeInstanceOf(BlacklistRejection)
  })
})
