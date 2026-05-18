import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { MongoClient } from 'mongodb'
import { MongoDBAdapter } from 'src/adapters/mongodb-adapter'

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017'
const DB = 'dbcli_test_sampling'

let raw: MongoClient | null = null

beforeAll(async () => {
  raw = new MongoClient(URI, { serverSelectionTimeoutMS: 1000 })
  try {
    await raw.connect()
    const col = raw.db(DB).collection('users')
    await col.deleteMany({})
    for (let i = 0; i < 30; i++) {
      await col.insertOne({
        email: `u${i}@b`,
        profile:
          i % 2 === 0 ? { name: `n${i}`, tokens: { access: `a${i}` } } : { name: `n${i}` },
        tags: i < 10 ? ['t1'] : null,
      } as any)
    }
  } catch {
    raw = null
  }
})

afterAll(async () => {
  if (raw) await raw.close()
})

describe('mongo schema sampling integration', () => {
  test('default random sampling exposes nested paths', async () => {
    if (!raw) return
    const adapter = new MongoDBAdapter({
      system: 'mongodb',
      host: 'localhost',
      port: 27017,
      user: '',
      password: '',
      database: DB,
    })
    await adapter.connect()
    try {
      const schema = await adapter.getTableSchema('users', { sampleSize: 30 })
      const names = schema.columns.map((c) => c.name)
      expect(names).toContain('profile')
      expect(names).toContain('profile.name')
      expect(names).toContain('profile.tokens')
      expect(names).toContain('profile.tokens.access')
      const tokensAccess = schema.columns.find((c) => c.name === 'profile.tokens.access')
      expect(tokensAccess?.presence).toBeGreaterThan(0)
      expect(tokensAccess?.presence).toBeLessThan(1)
    } finally {
      await adapter.disconnect()
    }
  })
})
