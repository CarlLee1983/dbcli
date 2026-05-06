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
    const self = this
    return {
      collection: (_name: string) => ({
        find: (filter: object) => {
          const call: FindCall = { filter, limit: 0 }
          self.findCalls.push(call)
          return {
            limit(n: number) {
              call.limit = n
              return this
            },
            toArray: async () => mockDocs,
          }
        },
        aggregate: (pipeline: object[]) => {
          self.aggregateCalls.push({ pipeline })
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

describe('MongoDBAdapter', () => {
  let adapter: MongoDBAdapter

  beforeEach(() => {
    adapter = new MongoDBAdapter(uriOptions, MockMongoClient as any)
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

    test('passes limit 0 (no limit) when options.limit is omitted', async () => {
      await adapter.execute('{}', ['users'])
      const client = (adapter as any).client as MockMongoClient
      expect(client.findCalls).toHaveLength(1)
      expect(client.findCalls[0]!.limit).toBe(0)
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

    test('does not append $limit when pipeline already ends with $limit', async () => {
      const pipeline = '[{"$match":{"status":"active"}},{"$limit":3}]'
      await adapter.execute(pipeline, ['orders'], { limit: 100 })
      const client = (adapter as any).client as MockMongoClient
      expect(client.aggregateCalls).toHaveLength(1)
      const stages = client.aggregateCalls[0]!.pipeline
      expect(stages.length).toBe(2)
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

    test('uses default sample size of 50 documents', async () => {
      await adapter.getTableSchema('users')
      const client = (adapter as any).client as MockMongoClient
      const lastFind = client.findCalls[client.findCalls.length - 1]!
      expect(lastFind.limit).toBe(50)
    })

    test('honors explicit options.sampleSize', async () => {
      await adapter.getTableSchema('users', { sampleSize: 200 })
      const client = (adapter as any).client as MockMongoClient
      const lastFind = client.findCalls[client.findCalls.length - 1]!
      expect(lastFind.limit).toBe(200)
    })

    test('caps sampleSize at 1000', async () => {
      await adapter.getTableSchema('users', { sampleSize: 9999 })
      const client = (adapter as any).client as MockMongoClient
      const lastFind = client.findCalls[client.findCalls.length - 1]!
      expect(lastFind.limit).toBe(1000)
    })

    test('falls back to default when sampleSize is below 1', async () => {
      await adapter.getTableSchema('users', { sampleSize: 0 })
      const client = (adapter as any).client as MockMongoClient
      const lastFind = client.findCalls[client.findCalls.length - 1]!
      expect(lastFind.limit).toBe(50)
    })

    test('returns inferred columns as union of typeof per field', async () => {
      const schema = await adapter.getTableSchema('users')
      const names = schema.columns.map((c) => c.name).sort()
      expect(names).toEqual(['_id', 'age', 'name'])
    })
  })
})
