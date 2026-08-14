/**
 * What a dry run and a cancellation actually touch.
 *
 * The guarantee these commands make is narrower than "nothing reaches the
 * database": both paths open a connection and read the table schema, because
 * the SQL they exist to show cannot be built without the column list. What they
 * never do is issue the statement. Stated here at the command level, since the
 * core test can only speak for the executor and the connect/schema calls happen
 * before the executor is asked anything.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { promptUser } from '@/utils/prompts'

const schema = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'amount', type: 'integer', nullable: false, primaryKey: false },
  ],
  rowCount: 0,
  primaryKey: 'id',
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

describe('what dry run and cancellation touch', () => {
  let adapter: {
    connect: ReturnType<typeof mock>
    disconnect: ReturnType<typeof mock>
    execute: ReturnType<typeof mock>
    getTableSchema: ReturnType<typeof mock>
    listTables: ReturnType<typeof mock>
    ping: ReturnType<typeof mock>
  }
  let spies: Array<{ mockRestore: () => void }> = []
  let confirmAnswer = true

  beforeEach(() => {
    confirmAnswer = true
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
      spyOn(process.stderr, 'write').mockImplementation(() => true),
      spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as never),
      spyOn(configModule, 'read').mockImplementation(async () => config as never),
      spyOn(promptUser, 'confirm').mockImplementation(async () => confirmAnswer),
    ]
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
  })

  test('a dry run builds the statement without issuing it', async () => {
    const { updateCommand } = await import('@/commands/update')
    await updateCommand('users', { where: 'id=1', set: '{"amount":100}', dryRun: true })

    expect(adapter.execute).not.toHaveBeenCalled()
    // The narrower half of the same guarantee, asserted so that a future change
    // making these commands connection-free is a deliberate edit here.
    expect(adapter.connect).toHaveBeenCalledTimes(1)
    expect(adapter.getTableSchema).toHaveBeenCalledTimes(1)
  })

  test('declining at the prompt issues nothing', async () => {
    confirmAnswer = false
    const { updateCommand } = await import('@/commands/update')
    await updateCommand('users', { where: 'id=1', set: '{"amount":100}' })

    expect(adapter.execute).not.toHaveBeenCalled()
    expect(adapter.connect).toHaveBeenCalledTimes(1)
    expect(adapter.getTableSchema).toHaveBeenCalledTimes(1)
  })

  test('delete keeps the same boundary', async () => {
    confirmAnswer = false
    const { deleteCommand } = await import('@/commands/delete')
    await deleteCommand('users', { where: 'id=1' })

    expect(adapter.execute).not.toHaveBeenCalled()
  })

  test('insert keeps the same boundary', async () => {
    const { insertCommand } = await import('@/commands/insert')
    await insertCommand('users', { data: '{"amount":100}', dryRun: true })

    expect(adapter.execute).not.toHaveBeenCalled()
  })
})
