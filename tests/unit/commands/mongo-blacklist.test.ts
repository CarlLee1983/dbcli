/**
 * Mongo write-path blacklist enforcement.
 *
 * Verifies that insert / update / delete on a MongoDB connection:
 *   - Reject blacklisted tables (BlacklistError → exit 1, JSON error output).
 *   - For insert/update, reject when the payload writes a blacklisted column.
 *   - The mongo adapter is never instantiated when the request is rejected.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { AdapterFactory } from '@/adapters'

const baseMongoConnection = {
  system: 'mongodb' as const,
  uri: 'mongodb://localhost:27017/testdb',
  host: '',
  port: 27017,
  user: '',
  password: '',
  database: 'testdb',
}

function makeMockAdapter() {
  const state = { insertCalled: false, updateCalled: false, deleteCalled: false }
  return {
    state,
    async connect() {},
    async disconnect() {},
    async insert() {
      state.insertCalled = true
      return { rows: [], affectedRows: 1, lastInsertId: 'abc' }
    },
    async update() {
      state.updateCalled = true
      return { rows: [], affectedRows: 1 }
    },
    async delete() {
      state.deleteCalled = true
      return { rows: [], affectedRows: 1 }
    },
  }
}

describe('MongoDB write-path blacklist enforcement', () => {
  let configSpy: any
  let adapterSpy: any
  let logSpy: any
  let errSpy: any
  let exitSpy: any
  let logged: string[]
  let mockAdapter: ReturnType<typeof makeMockAdapter>

  beforeEach(() => {
    logged = []
    mockAdapter = makeMockAdapter()
    adapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(mockAdapter as any)
    logSpy = spyOn(console, 'log').mockImplementation((msg: any) => {
      logged.push(String(msg))
    })
    errSpy = spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`)
    }) as any)
  })

  afterEach(() => {
    configSpy?.mockRestore()
    adapterSpy.mockRestore()
    logSpy.mockRestore()
    errSpy.mockRestore()
    exitSpy.mockRestore()
  })

  test('insert: blacklisted table is rejected and adapter.insert never runs', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: ['secrets'], columns: {} },
    } as any)

    const { insertCommand } = await import('@/commands/insert')
    try {
      await insertCommand('secrets', { data: '{"name":"x"}' })
    } catch {
      /* exit */
    }

    expect(mockAdapter.state.insertCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "error"')
    expect(out).toContain('secrets')
  })

  test('insert: blacklisted column in payload is rejected with conflict listed', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: [], columns: { users: ['password'] } },
    } as any)

    const { insertCommand } = await import('@/commands/insert')
    try {
      await insertCommand('users', { data: '{"name":"alice","password":"secret"}' })
    } catch {
      /* exit */
    }

    expect(mockAdapter.state.insertCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "error"')
    expect(out).toContain('password')
  })

  test('update: blacklisted column inside $set is rejected', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: [], columns: { users: ['password'] } },
    } as any)

    const { updateCommand } = await import('@/commands/update')
    try {
      await updateCommand('users', {
        where: '{"id":"1"}',
        set: '{"$set":{"password":"new"}}',
      })
    } catch {
      /* exit */
    }

    expect(mockAdapter.state.updateCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "error"')
    expect(out).toContain('password')
  })

  test('update: blacklisted column in non-operator (replacement-style) payload is rejected', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: [], columns: { users: ['password'] } },
    } as any)

    const { updateCommand } = await import('@/commands/update')
    try {
      await updateCommand('users', {
        where: '{"id":"1"}',
        set: '{"password":"new"}',
      })
    } catch {
      /* exit */
    }

    expect(mockAdapter.state.updateCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "error"')
    expect(out).toContain('password')
  })

  test('delete: blacklisted table is rejected and adapter.delete never runs', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'admin',
      blacklist: { tables: ['secrets'], columns: {} },
    } as any)

    const { deleteCommand } = await import('@/commands/delete')
    try {
      await deleteCommand('secrets', { where: '{"id":"1"}' })
    } catch {
      /* exit */
    }

    expect(mockAdapter.state.deleteCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "error"')
    expect(out).toContain('secrets')
  })

  test('insert: blacklisted column under a nested path is rejected (flattened paths, not top-level keys)', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: [], columns: { users: ['user.password'] } },
    } as any)

    const { insertCommand } = await import('@/commands/insert')
    try {
      await insertCommand('users', { data: '{"user":{"password":"secret"}}' })
    } catch {
      /* exit */
    }

    expect(mockAdapter.state.insertCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "error"')
    expect(out).toContain('user.password')
  })

  test('update: blacklisted column written via $inc is rejected (not just $set/$unset)', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: [], columns: { users: ['balance'] } },
    } as any)

    const { updateCommand } = await import('@/commands/update')
    try {
      await updateCommand('users', {
        where: '{"id":"1"}',
        set: '{"$inc":{"balance":100}}',
      })
    } catch {
      /* exit */
    }

    expect(mockAdapter.state.updateCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "error"')
    expect(out).toContain('balance')
  })

  test('insert: clean payload passes through and reaches adapter.insert', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: [], columns: { users: ['password'] } },
    } as any)

    const { insertCommand } = await import('@/commands/insert')
    try {
      await insertCommand('users', { data: '{"name":"alice","email":"a@b.com"}', force: true })
    } catch {
      /* exit */
    }

    expect(mockAdapter.state.insertCalled).toBe(true)
    const out = logged.join('\n')
    expect(out).toContain('"status": "success"')
  })
})
