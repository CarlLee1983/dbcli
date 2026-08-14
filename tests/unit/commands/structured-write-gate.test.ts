/**
 * The tier-two rule for update and delete.
 *
 * These commands make a WHERE mandatory, so "no WHERE" cannot happen — an empty
 * one produces invalid SQL the database rejects. What can happen is a WHERE that
 * selects by nothing in particular: `--where "status=active"` reads like a
 * filter and behaves like a full-table write. The criterion here is therefore
 * whether the conditions pin the statement to a primary key or a unique index,
 * which is information the schema already carries at the point the write runs.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { promptUser } from '@/utils/prompts'

const schema = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'email', type: 'text', nullable: false, primaryKey: false },
    { name: 'status', type: 'text', nullable: false, primaryKey: false },
  ],
  rowCount: 0,
  primaryKey: ['id'],
  indexes: [
    { name: 'users_email_key', columns: ['email'], unique: true },
    { name: 'users_status_idx', columns: ['status'], unique: false },
  ],
  foreignKeys: [],
}

const config = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'test',
    user: 'user',
    password: 'pass',
  },
  permission: 'admin',
  blacklist: { tables: [], columns: {} },
}

describe('a structured write that selects by nothing unique', () => {
  let adapter: {
    connect: ReturnType<typeof mock>
    disconnect: ReturnType<typeof mock>
    execute: ReturnType<typeof mock>
    getTableSchema: ReturnType<typeof mock>
    listTables: ReturnType<typeof mock>
    ping: ReturnType<typeof mock>
  }
  let spies: Array<{ mockRestore: () => void }> = []
  let originalIsTTY: unknown
  let originalStdinIsTTY: unknown
  let typedAnswer = ''

  // Both streams, because tier two prompts on stdin and reports on stdout: a
  // terminal on one side only is the agent-harness case the gate must refuse.
  const setTTY = (value: boolean) => {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
  }

  beforeEach(() => {
    typedAnswer = ''
    originalIsTTY = (process.stdout as { isTTY?: boolean }).isTTY
    originalStdinIsTTY = (process.stdin as { isTTY?: boolean }).isTTY
    adapter = {
      connect: mock(async () => {}),
      disconnect: mock(async () => {}),
      execute: mock(async () => ({ affectedRows: 3, rows: [] })),
      getTableSchema: mock(async () => schema),
      listTables: mock(async () => []),
      ping: mock(async () => {}),
    }

    spies = [
      spyOn(console, 'log').mockImplementation(() => {}),
      spyOn(console, 'error').mockImplementation(() => {}),
      spyOn(process.stderr, 'write').mockImplementation(() => true),
      spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit')
      }) as never),
      spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as never),
      spyOn(configModule, 'read').mockImplementation(async () => config as never),
      spyOn(promptUser, 'confirm').mockImplementation(async () => true),
      spyOn(promptUser, 'text').mockImplementation(async () => typedAnswer),
    ]
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinIsTTY,
      configurable: true,
    })
  })

  test('an update matched on the primary key runs unattended, as it always has', async () => {
    setTTY(false)
    const { updateCommand } = await import('@/commands/update')
    await updateCommand('users', { where: 'id=1', set: '{"status":"banned"}', force: true })

    expect(adapter.execute).toHaveBeenCalled()
  })

  test('a unique index is as good as the primary key', async () => {
    setTTY(false)
    const { updateCommand } = await import('@/commands/update')
    await updateCommand('users', {
      where: 'email=a@b.c',
      set: '{"status":"banned"}',
      force: true,
    })

    expect(adapter.execute).toHaveBeenCalled()
  })

  test('a non-unique column is a full-table write in disguise and is refused unattended', async () => {
    setTTY(false)
    const { updateCommand } = await import('@/commands/update')

    await expect(
      updateCommand('users', { where: 'status=active', set: '{"status":"banned"}', force: true })
    ).rejects.toThrow()
    expect(adapter.execute).not.toHaveBeenCalled()
  })

  test('--force does not open the gate either', async () => {
    setTTY(false)
    const { deleteCommand } = await import('@/commands/delete')

    await expect(deleteCommand('users', { where: 'status=active', force: true })).rejects.toThrow()
    expect(adapter.execute).not.toHaveBeenCalled()
  })

  test('a person who types the table name gets the write', async () => {
    setTTY(true)
    typedAnswer = 'users'
    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand('users', { where: 'status=active', force: true })

    expect(promptUser.text).toHaveBeenCalledTimes(1)
    expect(adapter.execute).toHaveBeenCalled()
  })

  test('a person who types something else does not', async () => {
    setTTY(true)
    typedAnswer = 'y'
    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand('users', { where: 'status=active', force: true })

    expect(adapter.execute).not.toHaveBeenCalled()
  })
})
