import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { MongoClient } from 'mongodb'
import { analyzeMongoDmlRisk } from '@/core/mongo/dml-plan'

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017'
const DB = 'dbcli_test_optier'

let client: MongoClient | null = null

beforeAll(async () => {
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 1000 })
  try {
    await client.connect()
  } catch {
    client = null
  }
})

afterAll(async () => {
  if (client) await client.close()
})

describe('mongo operator tier integration', () => {
  test('$inc plan → WARN, execution increments value', async () => {
    if (!client) return
    const col = client.db(DB).collection('counters')
    await col.deleteMany({})
    await col.insertOne({ _id: 'k', n: 1 } as any)

    const plan = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'counters',
        set: { $inc: { n: 1 } },
        where: { _id: 'k' },
        rawWhere: '{"_id":"k"}',
      },
      {
        permission: 'admin',
        blacklist: { tables: [], columns: {} },
        schema: {
          counters: {
            name: 'counters',
            columns: [{ name: 'n', type: 'number', nullable: true }],
          },
        },
      }
    )
    expect(plan.decision).toBe('WARN')
    expect(plan.riskFactors.find((f) => f.code === 'mongo_arithmetic_operator')).toBeDefined()

    const result = await col.updateOne({ _id: 'k' } as any, { $inc: { n: 1 } })
    expect(result.modifiedCount).toBe(1)
    const doc = await col.findOne({ _id: 'k' } as any)
    expect((doc as any).n).toBe(2)
  })

  test('$push plan → WARN, execution grows array', async () => {
    if (!client) return
    const col = client.db(DB).collection('tag_targets')
    await col.deleteMany({})
    await col.insertOne({ _id: 't', tags: [] } as any)
    const plan = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'tag_targets',
        set: { $push: { tags: 'new' } },
        where: { _id: 't' },
        rawWhere: '{"_id":"t"}',
      },
      {
        permission: 'admin',
        blacklist: { tables: [], columns: {} },
        schema: {
          tag_targets: {
            name: 'tag_targets',
            columns: [{ name: 'tags', type: 'array', nullable: true }],
          },
        },
      }
    )
    expect(plan.decision).toBe('WARN')
    await col.updateOne({ _id: 't' } as any, { $push: { tags: 'new' } })
    const doc = await col.findOne({ _id: 't' } as any)
    expect((doc as any).tags).toEqual(['new'])
  })

  test('$where plan → BLOCK (does not execute)', () => {
    const plan = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'x',
        set: { $where: 'function(){return true}' },
        where: { _id: 'a' },
        rawWhere: '{"_id":"a"}',
      },
      {
        permission: 'admin',
        blacklist: { tables: [], columns: {} },
        schema: { x: { name: 'x', columns: [] } },
      }
    )
    expect(plan.decision).toBe('BLOCK')
  })
})
