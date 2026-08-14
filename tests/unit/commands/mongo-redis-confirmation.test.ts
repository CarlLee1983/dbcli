/**
 * MongoDB and Redis writes ask before they write.
 *
 * These two engines never pass through `DataExecutor`, so the confirmation it
 * performs for SQL never ran for them: `dbcli delete` against a collection
 * destroyed documents without asking anybody. The gate is now in the command
 * layer, and these tests hold it there — one per engine per operation, because
 * six near-identical branches is exactly the shape where the fifth gets the fix
 * and the sixth does not.
 *
 * The adapter is a mock here; `tests/integration/mongo-redis-confirmation.test.ts`
 * makes the same assertions against real servers, where "did not write" can be
 * checked by reading the data back rather than by counting calls.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { promptUser } from '@/utils/prompts'

const ENGINES = [
  { system: 'redis', factory: 'createRedisAdapter' },
  { system: 'mongodb', factory: 'createMongoDBAdapter' },
] as const

function configFor(system: string) {
  return {
    connection: { system, host: 'localhost', port: 6379, database: '0', user: '', password: '' },
    permission: 'admin',
    blacklist: { tables: [], columns: {} },
  }
}

describe('mongodb and redis writes are confirmed', () => {
  let adapter: Record<string, ReturnType<typeof mock>>
  let spies: Array<{ mockRestore: () => void }> = []
  let confirmAnswer = false
  let stdout: string[] = []

  function setup(system: string) {
    adapter = {
      connect: mock(async () => {}),
      disconnect: mock(async () => {}),
      insert: mock(async () => ({ affectedRows: 1, rows: [] })),
      update: mock(async () => ({ affectedRows: 1, rows: [] })),
      delete: mock(async () => ({ affectedRows: 1, rows: [] })),
      execute: mock(async () => ({ affectedRows: 1, rows: [] })),
      ping: mock(async () => {}),
    }

    spies.push(
      spyOn(AdapterFactory, ENGINES.find((e) => e.system === system)!.factory).mockReturnValue(
        adapter as never
      ),
      spyOn(configModule, 'read').mockImplementation(async () => configFor(system) as never)
    )
  }

  beforeEach(() => {
    confirmAnswer = false
    stdout = []
    spies = [
      spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        stdout.push(args.map(String).join(' '))
      }),
      spyOn(process.stderr, 'write').mockImplementation((() => true) as never),
      spyOn(promptUser, 'confirm').mockImplementation(async () => confirmAnswer),
    ]
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies = []
  })

  const run = {
    insert: async (opts: Record<string, unknown> = {}) =>
      (await import('@/commands/insert')).insertCommand('users', {
        data: '{"amount":100}',
        ...opts,
      }),
    update: async (opts: Record<string, unknown> = {}) =>
      (await import('@/commands/update')).updateCommand('users', {
        where: '{"id":1}',
        set: '{"amount":100}',
        ...opts,
      }),
    delete: async (opts: Record<string, unknown> = {}) =>
      (await import('@/commands/delete')).deleteCommand('users', {
        where: '{"id":1}',
        ...opts,
      }),
  }

  for (const { system } of ENGINES) {
    for (const operation of ['insert', 'update', 'delete'] as const) {
      test(`${system} ${operation} declined at the prompt writes nothing`, async () => {
        setup(system)
        confirmAnswer = false

        await run[operation]()

        expect(promptUser.confirm).toHaveBeenCalled()
        expect(adapter[operation]).not.toHaveBeenCalled()
        // Declining must not even open a connection: the question is answered
        // before the adapter is built.
        expect(adapter.connect).not.toHaveBeenCalled()
        expect(stdout.join('\n')).toContain('"status": "cancelled"')
      })

      test(`${system} ${operation} confirmed at the prompt writes`, async () => {
        setup(system)
        confirmAnswer = true

        await run[operation]()

        expect(adapter[operation]).toHaveBeenCalledTimes(1)
        expect(stdout.join('\n')).toContain('"status": "success"')
      })

      test(`${system} ${operation} --force does not ask`, async () => {
        setup(system)

        await run[operation]({ force: true })

        expect(promptUser.confirm).not.toHaveBeenCalled()
        expect(adapter[operation]).toHaveBeenCalledTimes(1)
      })

      test(`${system} ${operation} --dry-run neither asks nor writes`, async () => {
        setup(system)

        await run[operation]({ dryRun: true })

        expect(promptUser.confirm).not.toHaveBeenCalled()
        expect(adapter[operation]).not.toHaveBeenCalled()
        expect(stdout.join('\n')).toContain('"status": "dry_run"')
      })
    }
  }
})
