import { describe, test, expect, beforeEach } from 'bun:test'
import { MongoDBAdapter } from 'src/adapters/mongodb-adapter'
import type { ConnectionOptions } from 'src/adapters/types'

class ObjectIdLike {
  constructor(public _hex: string) {}
}
;(ObjectIdLike.prototype as any).constructor = { name: 'ObjectId' }

class DecimalLike {}
;(DecimalLike.prototype as any).constructor = { name: 'Decimal128' }

const sampleDocs = [
  { _id: new ObjectIdLike('a'), email: 'a@b', profile: { name: 'A', tokens: { access: 'x' } } },
  { _id: new ObjectIdLike('b'), email: 'c@d', profile: { name: 'B' }, tags: ['x', 'y'] },
  { _id: new ObjectIdLike('c'), email: 'e@f', balance: new DecimalLike(), tags: null },
]

class MockMongoClient {
  aggregateArgs: unknown[][] = []
  findCalls = 0
  constructor(public uri: string) {}
  async connect() {}
  async close() {}
  db() {
    return {
      collection: () => ({
        estimatedDocumentCount: async () => 99,
        aggregate: (pipeline: object[]) => {
          this.aggregateArgs.push(pipeline as unknown[])
          return { toArray: async () => sampleDocs }
        },
        find: () => {
          this.findCalls++
          return { limit: () => ({ toArray: async () => sampleDocs }) }
        },
      }),
    }
  }
}

const opts = (): ConnectionOptions => ({
  system: 'mongodb',
  host: 'h',
  port: 27017,
  user: '',
  password: '',
  database: 'db',
})

describe('MongoDBAdapter.getTableSchema sampling', () => {
  let client: MockMongoClient
  let adapter: MongoDBAdapter
  beforeEach(async () => {
    client = new MockMongoClient('mongodb://h:27017')
    adapter = new MongoDBAdapter(opts(), MockMongoClient as any)
    await adapter.connect()
    ;(adapter as unknown as { client: MockMongoClient }).client = client
  })

  test('defaults to $sample with size 100', async () => {
    await adapter.getTableSchema('users')
    expect(client.aggregateArgs.length).toBe(1)
    expect(client.aggregateArgs[0]).toEqual([{ $sample: { size: 100 } }])
    expect(client.findCalls).toBe(0)
  })

  test('respects sampleSize cap of 1000', async () => {
    await adapter.getTableSchema('users', { sampleSize: 9999 })
    expect(client.aggregateArgs[0]).toEqual([{ $sample: { size: 1000 } }])
  })

  test('sampleMethod=natural switches to find().limit()', async () => {
    await adapter.getTableSchema('users', { sampleMethod: 'natural', sampleSize: 25 })
    expect(client.aggregateArgs.length).toBe(0)
    expect(client.findCalls).toBe(1)
  })

  test('expands nested paths into columns', async () => {
    const schema = await adapter.getTableSchema('users')
    const names = schema.columns.map((c) => c.name)
    expect(names).toContain('email')
    expect(names).toContain('profile')
    expect(names).toContain('profile.name')
    expect(names).toContain('profile.tokens')
    expect(names).toContain('profile.tokens.access')
    expect(names).toContain('tags')
  })

  test('detects ObjectId and Decimal128 as leaves', async () => {
    const schema = await adapter.getTableSchema('users')
    const id = schema.columns.find((c) => c.name === '_id')
    const bal = schema.columns.find((c) => c.name === 'balance')
    expect(id?.type).toBe('ObjectId')
    expect(bal?.type).toBe('Decimal128')
  })

  test('computes presence 0..1 per path', async () => {
    const schema = await adapter.getTableSchema('users')
    const email = schema.columns.find((c) => c.name === 'email')
    const balance = schema.columns.find((c) => c.name === 'balance')
    expect(email?.presence).toBeCloseTo(1.0, 5)
    expect(balance?.presence).toBeCloseTo(1 / 3, 5)
  })

  test('null-only or null+type yields nullable=true', async () => {
    const schema = await adapter.getTableSchema('users')
    const tags = schema.columns.find((c) => c.name === 'tags')
    expect(tags?.nullable).toBe(true)
    expect(tags?.type).toMatch(/array/)
    expect(tags?.type).toMatch(/null/)
  })
})
