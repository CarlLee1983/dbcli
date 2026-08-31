/**
 * The refusal at the adapter's own boundary, not just in the pure function.
 *
 * `assertNoMongoServerSideScript` has been the point every MongoDB path goes
 * through since #47; the field check is mounted beside it for the same reason.
 * What these assert is the operator-visible half: the request does not reach
 * the driver, so no aggregation runs and nothing comes back to be masked.
 */
import { test, expect } from 'bun:test'
import { AdapterFactory, MongoDBAdapter } from '@/adapters'
import type { ConnectionOptions } from '@/adapters/types'

const connection = {
  system: 'mongodb',
  host: 'localhost',
  port: 27017,
  database: 'app',
} as unknown as ConnectionOptions

function adapterWithRules(): { adapter: MongoDBAdapter; ran: unknown[] } {
  const ran: unknown[] = []
  const adapter = AdapterFactory.createMongoDBAdapter({
    connection,
    blacklist: { columns: { users: ['password'] } },
  }) as unknown as MongoDBAdapter
  ;(adapter as unknown as { client: unknown }).client = {
    db: () => ({
      collection: () => ({
        aggregate: (stages: unknown) => {
          ran.push(stages)
          return { toArray: async () => [] }
        },
        find: (filter: unknown) => {
          ran.push(filter)
          return { limit: () => ({ toArray: async () => [] }) }
        },
        updateMany: async (...args: unknown[]) => {
          ran.push(args)
          return { modifiedCount: 0 }
        },
        deleteMany: async (...args: unknown[]) => {
          ran.push(args)
          return { deletedCount: 0 }
        },
        insertOne: async (...args: unknown[]) => {
          ran.push(args)
          return { acknowledged: true, insertedId: { toString: () => 'id' } }
        },
      }),
    }),
  }
  return { adapter, ran }
}

test('a $project that renames a protected field never reaches the driver', async () => {
  const { adapter, ran } = adapterWithRules()
  await expect(adapter.execute('[{"$project":{"leak":"$password"}}]', ['users'])).rejects.toThrow(
    /BlacklistRejection/
  )
  expect(ran).toEqual([])
})

test('$group by a protected field never reaches the driver', async () => {
  const { adapter, ran } = adapterWithRules()
  await expect(adapter.execute('[{"$group":{"_id":"$password"}}]', ['users'])).rejects.toThrow(
    /BlacklistRejection/
  )
  expect(ran).toEqual([])
})

test('a filter naming a protected field is refused on the read path', async () => {
  const { adapter, ran } = adapterWithRules()
  await expect(adapter.execute('{"password":{"$exists":true}}', ['users'])).rejects.toThrow(
    /BlacklistRejection/
  )
  expect(ran).toEqual([])
})

test('update and delete are refused when their filter names a protected field', async () => {
  const { adapter, ran } = adapterWithRules()
  await expect(adapter.update('users', { password: 'x' }, { $set: { a: 1 } })).rejects.toThrow(
    /BlacklistRejection/
  )
  await expect(adapter.delete('users', { password: 'x' })).rejects.toThrow(/BlacklistRejection/)
  expect(ran).toEqual([])
})

test('an ordinary query on the same collection still runs', async () => {
  const { adapter, ran } = adapterWithRules()
  await adapter.execute('[{"$match":{"status":"active"}}]', ['users'])
  expect(ran.length).toBe(1)
})

test('a collection with no rules is unaffected', async () => {
  const { adapter, ran } = adapterWithRules()
  await adapter.execute('[{"$project":{"leak":"$password"}}]', ['events'])
  expect(ran.length).toBe(1)
})

/**
 * `insert` reached the driver with neither check.
 *
 * `assertNoMongoServerSideScript`'s comment claims every path is covered (#47)
 * and `insert` was not one of them; the field check landed on `execute`,
 * `update` and `delete` and missed it the same way. What covered it was
 * `checkColumnBlacklistOnWrite` in `src/commands/insert.ts` — a control at the
 * call site, which is the thing ADR-0015 Decision 1 exists to stop relying on.
 */
test('insert is refused when the document names a protected field', async () => {
  const { adapter, ran } = adapterWithRules()
  await expect(adapter.insert('users', { password: 'x' })).rejects.toThrow(/BlacklistRejection/)
  expect(ran).toEqual([])
})

test('insert of an ordinary document still runs', async () => {
  const { adapter, ran } = adapterWithRules()
  await adapter.insert('users', { name: 'a' })
  expect(ran.length).toBe(1)
})

test('insert carrying a server-side script is refused', async () => {
  const { adapter, ran } = adapterWithRules()
  await expect(adapter.insert('events', { $where: 'this.a > 1' })).rejects.toThrow()
  expect(ran).toEqual([])
})
