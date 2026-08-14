/**
 * The MongoDB and Redis confirmation gate, against real servers.
 *
 * `tests/unit/commands/mongo-redis-confirmation.test.ts` proves the adapter
 * method is not called. That is a statement about a mock. What a user cares
 * about is whether the document is still there afterwards, and only a real
 * server can answer that — a gate that returns early while some earlier line
 * has already written would pass the unit test and fail here.
 *
 * Services come from docker-compose.test.yml:
 *   docker compose -f docker-compose.test.yml up -d --wait redis mongodb
 * Unreachable servers skip, as everywhere else in this directory.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach, spyOn } from 'bun:test'
import { MongoClient } from 'mongodb'
import { RedisClient } from 'bun'
import { configModule } from '@/core/config'
import { promptUser } from '@/utils/prompts'
import { isDbReachable, SKIP_BY_ENV } from './helpers'

const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost'
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379)
const MONGO_URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017'
const MONGO_DB = 'dbcli_test_confirm'
const COLLECTION = 'widgets'
const KEY = 'dbcli:test:confirm'

let redisUp = false
let mongoUp = false
let mongo: MongoClient | null = null
let redis: RedisClient | null = null

const redisConfig = {
  connection: {
    system: 'redis',
    host: REDIS_HOST,
    port: REDIS_PORT,
    database: '0',
    user: '',
    password: '',
  },
  permission: 'admin',
  blacklist: { tables: [], columns: {} },
}

const mongoConfig = {
  connection: {
    system: 'mongodb',
    host: new URL(MONGO_URI).hostname,
    port: Number(new URL(MONGO_URI).port || 27017),
    database: MONGO_DB,
    user: '',
    password: '',
  },
  permission: 'admin',
  blacklist: { tables: [], columns: {} },
}

/** Answer the confirmation prompt, and count how often it was asked. */
let answers: boolean[] = []
let asked = 0

const spies: Array<{ mockRestore: () => void }> = []

function useConfig(config: unknown): void {
  spies.push(spyOn(configModule, 'read').mockImplementation(async () => config as never))
}

beforeAll(async () => {
  if (SKIP_BY_ENV) return
  redisUp = await isDbReachable(REDIS_HOST, REDIS_PORT)
  mongoUp = await isDbReachable(
    new URL(MONGO_URI).hostname,
    Number(new URL(MONGO_URI).port || 27017)
  )

  if (redisUp) {
    redis = new RedisClient(`redis://${REDIS_HOST}:${REDIS_PORT}`)
    await redis.connect()
  }
  if (mongoUp) {
    mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 1000 })
    await mongo.connect()
  }
  if (!redisUp || !mongoUp) {
    console.log(
      `⏭ confirmation integration: redis=${redisUp} mongo=${mongoUp} — skipping the rest`
    )
  }
})

afterAll(async () => {
  if (redis) await redis.del(KEY)
  if (mongo) {
    await mongo.db(MONGO_DB).dropDatabase()
    await mongo.close()
  }
  redis?.close()
})

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

/** Silence the envelope and the ceremony; the assertions read the database. */
function quiet(): void {
  spies.push(
    spyOn(console, 'log').mockImplementation(() => {}),
    spyOn(console, 'error').mockImplementation(() => {}),
    spyOn(process.stderr, 'write').mockImplementation((() => true) as never),
    spyOn(promptUser, 'confirm').mockImplementation(async () => {
      asked += 1
      return answers.shift() ?? false
    })
  )
}

describe('redis writes wait for an answer', () => {
  test('a declined delete leaves the key in place', async () => {
    if (!redisUp) return
    quiet()
    useConfig(redisConfig)
    answers = [false]
    asked = 0
    await redis!.set(KEY, 'keep-me')

    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand(KEY, { where: '{}' })

    expect(asked).toBe(1)
    expect(await redis!.get(KEY)).toBe('keep-me')
  })

  test('a confirmed delete removes it', async () => {
    if (!redisUp) return
    quiet()
    useConfig(redisConfig)
    answers = [true]
    await redis!.set(KEY, 'delete-me')

    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand(KEY, { where: '{}' })

    expect(await redis!.get(KEY)).toBeNull()
  })

  test('a declined insert writes nothing', async () => {
    if (!redisUp) return
    quiet()
    useConfig(redisConfig)
    answers = [false]
    await redis!.del(KEY)

    const { insertCommand } = await import('@/commands/insert')
    await insertCommand(KEY, { data: '{"value":"written"}' })

    expect(await redis!.get(KEY)).toBeNull()
  })

  test('--force writes without asking', async () => {
    if (!redisUp) return
    quiet()
    useConfig(redisConfig)
    answers = []
    asked = 0
    await redis!.del(KEY)

    const { insertCommand } = await import('@/commands/insert')
    await insertCommand(KEY, { data: '{"value":"forced"}', force: true })

    expect(asked).toBe(0)
    expect(await redis!.get(KEY)).toBe('forced')
  })
})

describe('mongodb writes wait for an answer', () => {
  const docs = () => mongo!.db(MONGO_DB).collection(COLLECTION)

  test('a declined delete leaves the documents in place', async () => {
    if (!mongoUp) return
    quiet()
    useConfig(mongoConfig)
    answers = [false]
    asked = 0
    await docs().deleteMany({})
    await docs().insertMany([{ id: 1 }, { id: 2 }])

    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand(COLLECTION, { where: '{}' })

    expect(asked).toBe(1)
    expect(await docs().countDocuments({})).toBe(2)
  })

  test('a confirmed delete removes them', async () => {
    if (!mongoUp) return
    quiet()
    useConfig(mongoConfig)
    answers = [true]
    await docs().deleteMany({})
    await docs().insertMany([{ id: 1 }, { id: 2 }])

    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand(COLLECTION, { where: '{}' })

    expect(await docs().countDocuments({})).toBe(0)
  })

  test('a declined update leaves the values alone', async () => {
    if (!mongoUp) return
    quiet()
    useConfig(mongoConfig)
    answers = [false]
    await docs().deleteMany({})
    await docs().insertOne({ id: 1, amount: 1 })

    const { updateCommand } = await import('@/commands/update')
    await updateCommand(COLLECTION, { where: '{"id":1}', set: '{"amount":999}' })

    expect(await docs().findOne({ id: 1 })).toMatchObject({ amount: 1 })
  })

  test('a dry run neither asks nor writes', async () => {
    if (!mongoUp) return
    quiet()
    useConfig(mongoConfig)
    answers = []
    asked = 0
    await docs().deleteMany({})
    await docs().insertOne({ id: 1, amount: 1 })

    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand(COLLECTION, { where: '{}', dryRun: true })

    expect(asked).toBe(0)
    expect(await docs().countDocuments({})).toBe(1)
  })
})
