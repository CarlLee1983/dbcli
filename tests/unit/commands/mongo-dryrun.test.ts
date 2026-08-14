/**
 * Mongo --dry-run on insert / update / delete.
 *
 * The driver must NOT be reached in dry-run mode. Output JSON shape mirrors
 * the SQL path so dbcli consumers can keep one parser.
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
  const state = {
    connectCalled: false,
    insertCalled: false,
    updateCalled: false,
    deleteCalled: false,
  }
  return {
    state,
    async connect() {
      state.connectCalled = true
    },
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

describe('MongoDB --dry-run output', () => {
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

  test('insert --dry-run does not connect or call adapter.insert', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)

    const { insertCommand } = await import('@/commands/insert')
    await insertCommand('users', { data: '{"name":"alice"}', dryRun: true })

    expect(mockAdapter.state.connectCalled).toBe(false)
    expect(mockAdapter.state.insertCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "dry_run"')
    expect(out).toContain('"operation": "insert"')
    expect(out).toContain('"rows_affected": 0')
    expect(out).toContain('db.users.insertOne(')
    expect(out).toContain('alice')
  })

  test('update --dry-run preview wraps non-operator $set and never calls adapter.update', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)

    const { updateCommand } = await import('@/commands/update')
    await updateCommand('users', {
      where: '{"id":1}',
      set: '{"a":1}',
      dryRun: true,
    })

    expect(mockAdapter.state.connectCalled).toBe(false)
    expect(mockAdapter.state.updateCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "dry_run"')
    expect(out).toContain('"operation": "update"')
    expect(out).toContain('db.users.updateMany(')
    expect(out).toContain('$set')
    expect(out).toContain('\\"a\\": 1')
  })

  test('update --dry-run keeps user-supplied operator doc as-is', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)

    const { updateCommand } = await import('@/commands/update')
    await updateCommand('users', {
      where: '{"id":1}',
      set: '{"$inc":{"hits":1}}',
      dryRun: true,
    })

    const out = logged.join('\n')
    expect(out).toContain('$inc')
    expect(out).toContain('hits')
    expect(mockAdapter.state.updateCalled).toBe(false)
  })

  test('delete --dry-run with JSON filter renders deleteMany preview', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'admin',
    } as any)

    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand('orders', { where: '{"status":"cancelled"}', dryRun: true })

    expect(mockAdapter.state.connectCalled).toBe(false)
    expect(mockAdapter.state.deleteCalled).toBe(false)
    const out = logged.join('\n')
    expect(out).toContain('"status": "dry_run"')
    expect(out).toContain('"operation": "delete"')
    expect(out).toContain('db.orders.deleteMany(')
    expect(out).toContain('cancelled')
  })

  test('delete --dry-run with key=value filter parses and renders preview', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'admin',
    } as any)

    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand('orders', { where: 'id=42', dryRun: true })

    const out = logged.join('\n')
    expect(out).toContain('db.orders.deleteMany(')
    expect(out).toContain('\\"id\\": 42')
    expect(mockAdapter.state.deleteCalled).toBe(false)
  })

  test('dry-run uses the shared human outcome in a terminal', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
    } as any)
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })

    try {
      const { insertCommand } = await import('@/commands/insert')
      await insertCommand('users', { data: '{"name":"alice"}', dryRun: true })
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, 'isTTY', descriptor)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
    }

    const out = logged.join('\n')
    expect(out).toContain('Preview only. users was not changed')
    expect(out).not.toContain('"status"')
  })

  test('insert --dry-run still enforces blacklist (no preview emitted)', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: baseMongoConnection,
      permission: 'read-write',
      blacklist: { tables: [], columns: { users: ['password'] } },
    } as any)

    const { insertCommand } = await import('@/commands/insert')
    try {
      await insertCommand('users', {
        data: '{"name":"a","password":"x"}',
        dryRun: true,
      })
    } catch {
      /* exit */
    }

    const out = logged.join('\n')
    expect(out).toContain('"status": "error"')
    expect(out).toContain('password')
    expect(out).not.toContain('db.users.insertOne(')
    expect(mockAdapter.state.insertCalled).toBe(false)
  })
})
