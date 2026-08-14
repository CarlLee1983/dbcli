import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { MongoClient } from 'mongodb'
import { analyzeMongoDmlRisk } from '@/core/mongo/dml-plan'
import { maskMongoRows } from '@/core/mongo/field-masker'
import { MONGO_URI as URI } from './helpers'

const DB = 'dbcli_test_blacklist'

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

describe('mongo nested blacklist integration', () => {
  test('write to profile.tokens.access is blocked at plan time', () => {
    const plan = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'users',
        set: { $set: { 'profile.tokens.access': 'X' } },
        where: { _id: 'u1' },
        rawWhere: '{"_id":"u1"}',
      },
      {
        permission: 'admin',
        blacklist: { tables: [], columns: { users: ['profile.tokens.*'] } },
        schema: {
          users: {
            name: 'users',
            columns: [{ name: '_id', type: 'ObjectId', nullable: false }],
          },
        },
      }
    )
    expect(plan.decision).toBe('BLOCK')
  })

  test('read masks nested path with [REDACTED]', async () => {
    if (!client) return
    const col = client.db(DB).collection('users')
    await col.deleteMany({})
    await col.insertOne({
      _id: 'u1',
      email: 'a@b',
      profile: { name: 'A', tokens: { access: 'secret', refresh: 'r' } },
    } as any)
    const rows = (await col.find({} as any).toArray()) as Record<string, unknown>[]
    const masked = maskMongoRows(rows, 'users', {
      tables: [],
      columns: { users: ['profile.tokens.*'] },
    })
    expect((masked[0] as any).profile.tokens).toBe('[REDACTED]')
    expect((masked[0] as any).profile.name).toBe('A')
    expect((masked[0] as any)._id).toBeDefined()
  })
})
