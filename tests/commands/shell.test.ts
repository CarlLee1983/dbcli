// tests/commands/shell.test.ts
import { describe, test, expect } from 'bun:test'
import {
  shellCommand,
  populateMongoColumns,
  MONGO_COMPLETION_EAGER_THRESHOLD,
  populateRedisKeyCompletion,
  REDIS_COMPLETION_KEY_LIMIT,
} from '../../src/commands/shell'
import type { QueryableAdapter } from '../../src/adapters/types'

describe('shellCommand', () => {
  test('is a Commander command', () => {
    expect(shellCommand.name()).toBe('shell')
  })

  test('has --sql option', () => {
    const opts = shellCommand.options
    const sqlOpt = opts.find((o) => o.long === '--sql')
    expect(sqlOpt).toBeDefined()
  })

  test('has description', () => {
    expect(shellCommand.description()).toBeTruthy()
  })
})

describe('populateMongoColumns', () => {
  function makeAdapter(
    schemas: Record<string, string[]>,
    failures: Set<string> = new Set()
  ): QueryableAdapter {
    return {
      connect: async () => {},
      disconnect: async () => {},
      execute: async () => ({ rows: [], affectedRows: 0 }),
      listCollections: async () => Object.keys(schemas).map((name) => ({ name, documentCount: 1 })),
      getTableSchema: async (name: string) => {
        if (failures.has(name)) throw new Error('boom')
        return {
          name,
          columns: (schemas[name] ?? []).map((c) => ({
            name: c,
            type: 'string',
            nullable: true,
          })),
          tableType: 'table' as const,
        }
      },
      testConnection: async () => true,
      getServerVersion: async () => '7.0',
      insert: async () => ({ rows: [], affectedRows: 0 }),
      update: async () => ({ rows: [], affectedRows: 0 }),
      delete: async () => ({ rows: [], affectedRows: 0 }),
    }
  }

  test('eagerly samples each collection when count is below threshold', async () => {
    const adapter = makeAdapter({
      users: ['_id', 'email', 'name'],
      orders: ['_id', 'total'],
    })
    const result = await populateMongoColumns(adapter, ['users', 'orders'])
    expect(result.users).toEqual(['_id', 'email', 'name'])
    expect(result.orders).toEqual(['_id', 'total'])
  })

  test('returns empty map when collection count exceeds threshold', async () => {
    const names = Array.from({ length: MONGO_COMPLETION_EAGER_THRESHOLD + 5 }, (_, i) => `c${i}`)
    const adapter = makeAdapter(Object.fromEntries(names.map((n) => [n, ['_id']])))
    const result = await populateMongoColumns(adapter, names)
    expect(Object.keys(result)).toHaveLength(0)
  })

  test('honors custom threshold', async () => {
    const adapter = makeAdapter({ a: ['_id'], b: ['_id'], c: ['_id'] })
    const result = await populateMongoColumns(adapter, ['a', 'b', 'c'], 2)
    expect(Object.keys(result)).toHaveLength(0)
  })

  test('skips collections whose schema fetch throws', async () => {
    const adapter = makeAdapter({ users: ['_id', 'email'], orders: ['_id'] }, new Set(['orders']))
    const result = await populateMongoColumns(adapter, ['users', 'orders'])
    expect(result.users).toEqual(['_id', 'email'])
    expect(result.orders).toBeUndefined()
  })

  test('returns empty map when adapter has no getTableSchema', async () => {
    const adapter: QueryableAdapter = {
      connect: async () => {},
      disconnect: async () => {},
      execute: async () => ({ rows: [], affectedRows: 0 }),
      listCollections: async () => [],
      testConnection: async () => true,
      getServerVersion: async () => '7.0',
      insert: async () => ({ rows: [], affectedRows: 0 }),
      update: async () => ({ rows: [], affectedRows: 0 }),
      delete: async () => ({ rows: [], affectedRows: 0 }),
    }
    const result = await populateMongoColumns(adapter, ['users'])
    expect(Object.keys(result)).toHaveLength(0)
  })

  test('returns empty map for empty collection list', async () => {
    const adapter = makeAdapter({})
    const result = await populateMongoColumns(adapter, [])
    expect(Object.keys(result)).toHaveLength(0)
  })
})

describe('populateRedisKeyCompletion', () => {
  test('returns sampled names and truncated flag from the adapter', async () => {
    const adapter = {
      sampleKeyNames: async (_limit: number) => ({
        names: ['user:1', 'user:2'],
        truncated: true,
      }),
    }
    const result = await populateRedisKeyCompletion(adapter)
    expect(result.tableNames).toEqual(['user:1', 'user:2'])
    expect(result.truncated).toBe(true)
  })

  test('passes the configured key limit to the adapter', async () => {
    let received = -1
    const adapter = {
      sampleKeyNames: async (limit: number) => {
        received = limit
        return { names: [], truncated: false }
      },
    }
    await populateRedisKeyCompletion(adapter)
    expect(received).toBe(REDIS_COMPLETION_KEY_LIMIT)
  })

  test('is best-effort: a throwing adapter yields empty completion, no rethrow', async () => {
    const adapter = {
      sampleKeyNames: async (_limit: number): Promise<{ names: string[]; truncated: boolean }> => {
        throw new Error('SCAN failed')
      },
    }
    const result = await populateRedisKeyCompletion(adapter)
    expect(result.tableNames).toEqual([])
    expect(result.truncated).toBe(false)
  })
})
