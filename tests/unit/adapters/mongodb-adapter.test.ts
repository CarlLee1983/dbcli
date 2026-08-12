import { describe, test, expect, beforeEach, spyOn } from 'bun:test'
import { MongoDBAdapter } from 'src/adapters/mongodb-adapter'
import type { ConnectionOptions } from 'src/adapters/types'
import { ConnectionError } from 'src/adapters/types'

const mockDocs = [
  { _id: '1', name: 'Alice', age: 30 },
  { _id: '2', name: 'Bob', age: 25 },
]
const mockCollectionDefs = [{ name: 'users' }, { name: 'orders' }]

interface FindCall {
  filter: object
  limit: number
  projection?: Record<string, 0 | 1>
}
interface AggregateCall {
  pipeline: object[]
}

class MockMongoClient {
  connected = false
  closed = false
  lastDbName: string | undefined
  findCalls: FindCall[] = []
  aggregateCalls: AggregateCall[] = []
  constructor(public uri: string) {}
  async connect() {
    this.connected = true
  }
  async close() {
    this.closed = true
  }
  db(name?: string) {
    this.lastDbName = name
    return {
      collection: (_name: string) => ({
        find: (filter: object, options?: { projection?: Record<string, 0 | 1> }) => {
          const call: FindCall = { filter, limit: 0, ...options }
          this.findCalls.push(call)
          return {
            limit(n: number) {
              call.limit = n
              return this
            },
            toArray: async () => mockDocs,
          }
        },
        aggregate: (pipeline: object[]) => {
          this.aggregateCalls.push({ pipeline })
          return { toArray: async () => [{ _id: 'NYC', count: 5 }] }
        },
        estimatedDocumentCount: async () => 100,
      }),
      listCollections: () => ({ toArray: async () => mockCollectionDefs }),
      command: async (_cmd: object) => ({ ok: 1 }),
      admin: () => ({ serverInfo: async () => ({ version: '6.0.1' }) }),
    }
  }
}

class FailingMongoClient {
  async connect() {
    throw new Error('ECONNREFUSED connect ECONNREFUSED 127.0.0.1:27017')
  }
  async close() {}
  db() {
    return {} as any
  }
}

const uriOptions: ConnectionOptions = {
  system: 'mongodb',
  uri: 'mongodb://localhost:27017/testdb',
  host: '',
  port: 27017,
  user: '',
  password: '',
  database: 'testdb',
}

const hostOptions: ConnectionOptions = {
  system: 'mongodb',
  host: 'localhost',
  port: 27017,
  user: 'testuser',
  password: 'testpass',
  database: 'testdb',
}

/** Connect with the given options and return the URI the driver actually received. */
async function connectedUri(options: ConnectionOptions): Promise<string> {
  const adapter = new MongoDBAdapter(options, MockMongoClient as any)
  await adapter.connect()
  return ((adapter as any).client as MockMongoClient).uri
}

describe('MongoDBAdapter', () => {
  let adapter: MongoDBAdapter

  beforeEach(() => {
    adapter = new MongoDBAdapter(uriOptions, MockMongoClient as any)
  })

  describe('逐欄設定組出的連線 URI', () => {
    test('帶入 authSource / replicaSet / tls', async () => {
      const uri = await connectedUri({
        ...hostOptions,
        authSource: 'appdb',
        replicaSet: 'rs0',
        tls: true,
      })

      const parsed = new URL(uri)
      expect(parsed.protocol).toBe('mongodb:')
      expect(parsed.host).toBe('localhost:27017')
      expect(parsed.pathname).toBe('/testdb')
      expect(parsed.searchParams.get('authSource')).toBe('appdb')
      expect(parsed.searchParams.get('replicaSet')).toBe('rs0')
      expect(parsed.searchParams.get('tls')).toBe('true')
    })

    test('未指定 authSource 時，有帳密則預設 admin', async () => {
      const uri = await connectedUri(hostOptions)
      expect(new URL(uri).searchParams.get('authSource')).toBe('admin')
    })

    test('無帳密時不帶 authSource', async () => {
      const uri = await connectedUri({ ...hostOptions, user: '', password: '' })
      const parsed = new URL(uri)
      expect(parsed.username).toBe('')
      expect(parsed.searchParams.get('authSource')).toBeNull()
    })

    test('帳號、密碼、資料庫名稱中的特殊字元都要跳脫', async () => {
      const uri = await connectedUri({
        ...hostOptions,
        user: 'admin@corp',
        password: 'p@ss:w/rd?#',
        database: 'my db',
      })

      // driver 收到的是原始字串，斷言必須落在字串本身而非寬容的 URL 解析結果：
      // 未跳脫的 @ / : / ? 會讓 driver 把 authority 切在錯的位置
      const authority = uri.slice('mongodb://'.length, uri.indexOf('@localhost'))
      expect(authority).toBe('admin%40corp:p%40ss%3Aw%2Frd%3F%23')
      expect(uri).toContain('/my%20db')
    })

    test('srv:true 產出 mongodb+srv 且不帶 port', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
        const url = String(input)
        if (url.includes('type=SRV')) {
          return new Response(
            JSON.stringify({
              Status: 0,
              Answer: [{ data: '0 0 27017 a.example.com.' }],
            })
          )
        }
        return new Response(JSON.stringify({ Status: 3 }), { status: 200 })
      }) as unknown as typeof fetch)

      try {
        const uri = await connectedUri({
          ...hostOptions,
          host: 'cluster.example.com',
          srv: true,
        })

        // SRV 展開後應為標準多主機形式，主機來自 SRV 記錄
        expect(uri.startsWith('mongodb://')).toBe(true)
        expect(uri).toContain('a.example.com:27017')
        expect(uri).not.toContain('cluster.example.com:27017')
      } finally {
        fetchSpy.mockRestore()
      }
    })

    test('uri 與逐欄欄位並存時，uri 優先', async () => {
      const uri = await connectedUri({
        ...hostOptions,
        uri: 'mongodb://explicit.example.com:27018/explicitdb',
      })

      expect(uri).toBe('mongodb://explicit.example.com:27018/explicitdb')
    })
  })

  describe('逐欄設定的錯誤處理', () => {
    test('只填 user 沒填 password 應該拋錯，而非靜默降級成無認證', async () => {
      const adapter = new MongoDBAdapter({ ...hostOptions, password: '' }, MockMongoClient as any)

      await expect(adapter.connect()).rejects.toThrow(ConnectionError)
    })

    test.each([
      ['authority 改寫字元', 'localhost/evil?x=1'],
      ['空字串', ''],
      ['內嵌埠號', 'localhost:1234'],
      ['空白', 'evil host'],
    ])('host 為 %s 時應該拋錯', async (_label, host) => {
      const adapter = new MongoDBAdapter({ ...hostOptions, host }, MockMongoClient as any)

      await expect(adapter.connect()).rejects.toThrow(ConnectionError)
    })

    test('加了方括號的 IPv6 host 應該可用', async () => {
      const uri = await connectedUri({ ...hostOptions, host: '[::1]', user: '', password: '' })
      expect(uri).toBe('mongodb://[::1]:27017/testdb')
    })

    test('未加方括號的 IPv6 host 應該拋錯並提示加方括號', async () => {
      const adapter = new MongoDBAdapter({ ...hostOptions, host: '::1' }, MockMongoClient as any)

      await expect(adapter.connect()).rejects.toThrow(ConnectionError)
    })

    test('authSource 為空字串時退回 admin，而非送出空的 authSource=', async () => {
      const uri = await connectedUri({ ...hostOptions, authSource: '' })
      expect(new URL(uri).searchParams.get('authSource')).toBe('admin')
    })
  })

  describe('錯誤分類不應誤命中', () => {
    function clientFailingWith(message: string) {
      return class {
        async connect() {
          throw new Error(message)
        }
        async close() {}
        db() {
          return {} as any
        }
      }
    }

    async function hintsFor(message: string): Promise<string> {
      const a = new MongoDBAdapter(uriOptions, clientFailingWith(message) as any)
      try {
        await a.connect()
      } catch (err) {
        return (err as ConnectionError).hints.join('\n')
      }
      throw new Error('expected connect() to reject')
    }

    test('連線被拒但訊息含 srv URI 與 tls query 時，不應歸類為 DNS 或 TLS', async () => {
      const hints = await hintsFor(
        'connect ECONNREFUSED 127.0.0.1:27017 (mongodb+srv://c.example.com/?tls=true)'
      )

      expect(hints).not.toContain('DNS/SRV 解析失敗')
      expect(hints).not.toContain('TLS 握手失敗')
    })
  })

  describe('connect()', () => {
    test('connects using provided uri', async () => {
      await adapter.connect()
      const client = (adapter as any).client as MockMongoClient
      expect(client.connected).toBe(true)
      expect(client.uri).toBe('mongodb://localhost:27017/testdb')
    })

    test('expands mongodb+srv uri into a standard multi-host uri before connecting', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
        const url = String(input)
        if (url.includes('type=SRV')) {
          return new Response(
            JSON.stringify({
              Status: 0,
              Answer: [{ data: '0 0 27017 a.example.com.' }, { data: '0 0 27017 b.example.com.' }],
            })
          )
        }

        if (url.includes('type=TXT')) {
          return new Response(
            JSON.stringify({
              Status: 0,
              Answer: [{ data: '"authSource=admin"' }],
            })
          )
        }

        return new Response(JSON.stringify({ Status: 3 }), { status: 200 })
      }) as unknown as typeof fetch)

      const srvOptions: ConnectionOptions = {
        system: 'mongodb',
        uri: 'mongodb+srv://user:pass@cluster.example.com/',
        host: '',
        port: 27017,
        user: '',
        password: '',
        database: 'cmg0001',
      }
      const srvAdapter = new MongoDBAdapter(srvOptions, MockMongoClient as any)

      try {
        await srvAdapter.connect()

        const client = (srvAdapter as any).client as MockMongoClient
        expect(client.uri).toContain(
          'mongodb://user:pass@a.example.com:27017,b.example.com:27017/cmg0001'
        )
        expect(client.uri).toContain('authSource=admin')
        expect(client.uri).toContain('tls=true')
      } finally {
        fetchSpy.mockRestore()
      }
    })

    test('builds uri from host/port/database when uri not provided', async () => {
      const a = new MongoDBAdapter(hostOptions, MockMongoClient as any)
      await a.connect()
      const client = (a as any).client as MockMongoClient
      expect(client.uri).toContain('localhost')
      expect(client.uri).toContain('27017')
      expect(client.uri).toContain('testdb')
    })

    test('includes credentials in built uri when user/password provided', async () => {
      const a = new MongoDBAdapter(hostOptions, MockMongoClient as any)
      await a.connect()
      const client = (a as any).client as MockMongoClient
      expect(client.uri).toContain('testuser')
      expect(client.uri).toContain('testpass')
    })

    test('wraps connection failure as ConnectionError', async () => {
      const a = new MongoDBAdapter(uriOptions, FailingMongoClient as any)
      await expect(a.connect()).rejects.toBeInstanceOf(ConnectionError)
    })
  })

  describe('連線失敗的分類與提示', () => {
    /** A client whose connect() fails with the given driver message. */
    function clientFailingWith(message: string) {
      return class {
        async connect() {
          throw new Error(message)
        }
        async close() {}
        db() {
          return {} as any
        }
      }
    }

    async function connectError(message: string): Promise<ConnectionError> {
      const a = new MongoDBAdapter(uriOptions, clientFailingWith(message) as any)
      try {
        await a.connect()
      } catch (err) {
        return err as ConnectionError
      }
      throw new Error('expected connect() to reject')
    }

    test('認證失敗時提示檢查 authSource', async () => {
      const err = await connectError('Authentication failed.')
      expect(err.hints.join('\n')).toContain('authSource')
    })

    test('SRV/DNS 解析失敗時提示檢查 srv 設定', async () => {
      const err = await connectError('querySrv ENOTFOUND _mongodb._tcp.cluster.example.com')
      expect(err.hints.join('\n')).toContain('srv')
    })

    test('TLS 握手失敗時提示 tls 欄位', async () => {
      const err = await connectError('unable to verify the first certificate')
      expect(err.hints.join('\n')).toContain('tls')
    })
  })

  describe('disconnect()', () => {
    test('closes client and sets internal reference to null', async () => {
      await adapter.connect()
      const client = (adapter as any).client as MockMongoClient
      await adapter.disconnect()
      expect(client.closed).toBe(true)
      expect((adapter as any).client).toBeNull()
    })

    test('is safe to call when not connected', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined()
    })
  })

  describe('execute()', () => {
    beforeEach(async () => {
      await adapter.connect()
    })

    test('executes find when query is JSON object', async () => {
      const result = await adapter.execute<{ name: string }>('{"age": {"$gt": 18}}', ['users'])
      expect(result.rows).toEqual(mockDocs)
      expect(result.affectedRows).toBe(2)
      const client = (adapter as any).client as MockMongoClient
      expect(client.lastDbName).toBe('testdb')
    })

    test('executes aggregate when query is JSON array', async () => {
      const pipeline =
        '[{"$match":{"status":"active"}},{"$group":{"_id":"$city","count":{"$sum":1}}}]'
      const result = await adapter.execute(pipeline, ['orders'])
      expect(result.rows).toEqual([{ _id: 'NYC', count: 5 }])
    })

    // ── server-side script 攔截（#47） ───────────────────────────────────

    test('主查詢路徑的 $where 被攔截，且沒有送出查詢', async () => {
      await expect(adapter.execute('{"$where": "this.a > 1"}', ['users'])).rejects.toThrow(
        /server-side script/i
      )
      const client = (adapter as any).client as MockMongoClient
      expect(client.findCalls).toHaveLength(0)
    })

    test('pipeline 裡的 $function 同樣被攔截', async () => {
      await expect(
        adapter.execute(
          '[{"$set":{"x":{"$function":{"body":"function(){}","args":[],"lang":"js"}}}}]',
          ['users']
        )
      ).rejects.toThrow(/server-side script/i)
    })

    test('throws when query is not valid JSON', async () => {
      await expect(adapter.execute('SELECT * FROM users', ['users'])).rejects.toThrow()
    })

    test('throws ConnectionError when not connected', async () => {
      const a = new MongoDBAdapter(uriOptions, MockMongoClient as any)
      await expect(a.execute('{}', ['users'])).rejects.toBeInstanceOf(ConnectionError)
    })

    test('applies options.limit to find filter', async () => {
      await adapter.execute('{"age": {"$gt": 18}}', ['users'], { limit: 7 })
      const client = (adapter as any).client as MockMongoClient
      expect(client.findCalls).toHaveLength(1)
      expect(client.findCalls[0]!.limit).toBe(7)
    })

    test('pushes projection into find options', async () => {
      const projection = { name: 1, age: 1 } as const

      await adapter.execute('{}', ['users'], { projection })

      const client = (adapter as any).client as MockMongoClient
      expect(client.findCalls).toHaveLength(1)
      expect(client.findCalls[0]!.projection).toEqual(projection)
    })

    test('passes limit 0 (no limit) when options.limit is omitted', async () => {
      await adapter.execute('{}', ['users'])
      const client = (adapter as any).client as MockMongoClient
      expect(client.findCalls).toHaveLength(1)
      expect(client.findCalls[0]!.limit).toBe(0)
      expect(client.findCalls[0]!.projection).toBeUndefined()
    })

    test('appends $limit stage to aggregate pipeline when options.limit is set', async () => {
      const pipeline = '[{"$match":{"status":"active"}}]'
      await adapter.execute(pipeline, ['orders'], { limit: 25 })
      const client = (adapter as any).client as MockMongoClient
      expect(client.aggregateCalls).toHaveLength(1)
      const stages = client.aggregateCalls[0]!.pipeline
      expect(stages.length).toBe(2)
      expect(stages[1]).toEqual({ $limit: 25 })
    })

    test('appends dbcli $limit before the final projection stage', async () => {
      const pipeline = '[{"$match":{"status":"active"}}]'
      const projection = { _id: 1, count: 1 } as const

      await adapter.execute(pipeline, ['orders'], { limit: 25, projection })

      const client = (adapter as any).client as MockMongoClient
      expect(client.aggregateCalls).toHaveLength(1)
      expect(client.aggregateCalls[0]!.pipeline).toEqual([
        { $match: { status: 'active' } },
        { $limit: 25 },
        { $project: projection },
      ])
    })

    test('leaves aggregation pipeline unchanged when projection and limit are omitted', async () => {
      const pipeline = '[{"$match":{"status":"active"}}]'

      await adapter.execute(pipeline, ['orders'])

      const client = (adapter as any).client as MockMongoClient
      expect(client.aggregateCalls).toHaveLength(1)
      expect(client.aggregateCalls[0]!.pipeline).toEqual([{ $match: { status: 'active' } }])
    })

    test('does not append $limit when the pipeline already contains $limit', async () => {
      const pipeline = '[{"$match":{"status":"active"}},{"$limit":3},{"$project":{"_id":1}}]'
      await adapter.execute(pipeline, ['orders'], { limit: 100 })
      const client = (adapter as any).client as MockMongoClient
      expect(client.aggregateCalls).toHaveLength(1)
      const stages = client.aggregateCalls[0]!.pipeline
      expect(stages.length).toBe(3)
      expect(stages[1]).toEqual({ $limit: 3 })
    })
  })

  describe('listCollections()', () => {
    beforeEach(async () => {
      await adapter.connect()
    })

    test('returns collections with document counts', async () => {
      const collections = await adapter.listCollections()
      expect(collections).toHaveLength(2)
      expect(collections[0]!.name).toBe('users')
      expect(collections[0]!.documentCount).toBe(100)
      expect(collections[1]!.name).toBe('orders')
      const client = (adapter as any).client as MockMongoClient
      expect(client.lastDbName).toBe('testdb')
    })

    test('throws ConnectionError when not connected', async () => {
      const a = new MongoDBAdapter(uriOptions, MockMongoClient as any)
      await expect(a.listCollections()).rejects.toBeInstanceOf(ConnectionError)
    })
  })

  describe('testConnection()', () => {
    test('returns true when connected', async () => {
      await adapter.connect()
      expect(await adapter.testConnection()).toBe(true)
      const client = (adapter as any).client as MockMongoClient
      expect(client.lastDbName).toBe('testdb')
    })

    test('returns false when not connected', async () => {
      expect(await adapter.testConnection()).toBe(false)
    })
  })

  describe('getServerVersion()', () => {
    test('returns version string from server info', async () => {
      await adapter.connect()
      const version = await adapter.getServerVersion()
      expect(version).toBe('6.0.1')
      const client = (adapter as any).client as MockMongoClient
      expect(client.lastDbName).toBe('testdb')
    })

    test('throws ConnectionError when not connected', async () => {
      await expect(adapter.getServerVersion()).rejects.toBeInstanceOf(ConnectionError)
    })
  })

  describe('getTableSchema()', () => {
    beforeEach(async () => {
      await adapter.connect()
    })

    test('uses default $sample size of 100 documents', async () => {
      await adapter.getTableSchema('users')
      const client = (adapter as any).client as MockMongoClient
      const lastAgg = client.aggregateCalls[client.aggregateCalls.length - 1]!
      expect(lastAgg.pipeline).toEqual([{ $sample: { size: 100 } }])
    })

    test('honors explicit options.sampleSize', async () => {
      await adapter.getTableSchema('users', { sampleSize: 200 })
      const client = (adapter as any).client as MockMongoClient
      const lastAgg = client.aggregateCalls[client.aggregateCalls.length - 1]!
      expect(lastAgg.pipeline).toEqual([{ $sample: { size: 200 } }])
    })

    test('caps sampleSize at 1000', async () => {
      await adapter.getTableSchema('users', { sampleSize: 9999 })
      const client = (adapter as any).client as MockMongoClient
      const lastAgg = client.aggregateCalls[client.aggregateCalls.length - 1]!
      expect(lastAgg.pipeline).toEqual([{ $sample: { size: 1000 } }])
    })

    test('falls back to default when sampleSize is below 1', async () => {
      await adapter.getTableSchema('users', { sampleSize: 0 })
      const client = (adapter as any).client as MockMongoClient
      const lastAgg = client.aggregateCalls[client.aggregateCalls.length - 1]!
      expect(lastAgg.pipeline).toEqual([{ $sample: { size: 100 } }])
    })

    test('sampleMethod=natural switches to find().limit()', async () => {
      await adapter.getTableSchema('users', { sampleMethod: 'natural', sampleSize: 25 })
      const client = (adapter as any).client as MockMongoClient
      const lastFind = client.findCalls[client.findCalls.length - 1]!
      expect(lastFind.limit).toBe(25)
    })

    test('returns inferred columns flattened from sampled docs', async () => {
      const schema = await adapter.getTableSchema('users', { sampleMethod: 'natural' })
      const names = schema.columns.map((c) => c.name).sort()
      expect(names).toEqual(['_id', 'age', 'name'])
    })
  })
})
