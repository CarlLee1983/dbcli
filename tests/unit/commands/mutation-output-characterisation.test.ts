/**
 * Characterisation tests for what update/delete print, and to which stream.
 *
 * These exist to freeze current behaviour across the move of presentation out
 * of core. They are deliberately exact-match: the whole point of the refactor
 * is that not one byte changes, so a loose assertion would defeat it.
 *
 * The confirmation block is the one part that did change on purpose: it is
 * ceremony addressed to a person, and it now goes to stderr so that stdout
 * carries exactly one JSON document whether or not the write was forced. The
 * text itself is still pinned byte for byte, on the other stream.
 *
 * Uses spyOn rather than mock.module, per the convention in the sibling
 * blacklist wiring test, to avoid leaking mocks across files.
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

const mockAdapter = {
  connect: mock(async () => {}),
  disconnect: mock(async () => {}),
  execute: mock(async () => ({ affectedRows: 3, rows: [] })),
  getTableSchema: mock(async () => schema),
  listTables: mock(async () => []),
  ping: mock(async () => {}),
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

describe('update/delete stdout characterisation', () => {
  let lines: string[] = []
  let errorOutput: string[] = []
  let spies: Array<{ mockRestore: () => void }> = []
  let originalExit: typeof process.exit
  let confirmAnswer = true

  beforeEach(() => {
    lines = []
    errorOutput = []
    confirmAnswer = true
    originalExit = process.exit
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as any

    spies = [
      spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '))
      }),
      spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        errorOutput.push(String(chunk))
        return true
      }) as never),
      spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(mockAdapter as any),
      spyOn(configModule, 'read').mockImplementation(async () => config as any),
      spyOn(promptUser, 'confirm').mockImplementation(async () => confirmAnswer),
    ]
  })

  afterEach(() => {
    process.exit = originalExit
    for (const spy of spies) spy.mockRestore()
  })

  async function run(fn: () => Promise<void>): Promise<string> {
    try {
      await fn()
    } catch {
      // process.exit sentinel
    }
    // The only nondeterministic part of the envelope; everything else is
    // compared byte for byte.
    return lines.join('\n').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<timestamp>')
  }

  /** Everything the run wrote to stderr, as one string. */
  function stderr(): string {
    return errorOutput.join('')
  }

  async function runWithTTY(fn: () => Promise<void>): Promise<string> {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    try {
      return await run(fn)
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, 'isTTY', descriptor)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
    }
  }

  test('the confirmation block goes to stderr and the envelope to stdout', async () => {
    const { updateCommand } = await import('@/commands/update')
    const output = await run(() => updateCommand('users', { where: 'id=1', set: '{"amount":100}' }))

    expect(stderr()).toBe(
      [
        '',
        'Generated SQL:',
        '  UPDATE "users" SET "amount" = $1 WHERE "id" = $2',
        '',
        'Parameters:',
        '  [',
        '  100,',
        '  1',
        ']',
        '',
      ].join('\n')
    )

    expect(output).toBe(
      [
        '{',
        '  "status": "success",',
        '  "operation": "update",',
        '  "rows_affected": 3,',
        '  "timestamp": "<timestamp>",',
        '  "sql": "UPDATE \\"users\\" SET \\"amount\\" = $1 WHERE \\"id\\" = $2"',
        '}',
      ].join('\n')
    )
  })

  test('cancelling at the prompt reports cancelled, not success', async () => {
    confirmAnswer = false
    const { updateCommand } = await import('@/commands/update')
    const output = await run(() => updateCommand('users', { where: 'id=1', set: '{"amount":100}' }))

    expect(output).toContain('"rows_affected": 0')
    expect(output).toContain('"status": "cancelled"')
    expect(output).not.toContain('"status": "success"')
  })

  test('delete leads with the destructive warning', async () => {
    const { deleteCommand } = await import('@/commands/delete')
    const output = await run(() => deleteCommand('users', { where: 'id=1' }))

    expect(stderr()).toContain('⚠️  Warning: DELETE operation is destructive and cannot be undone!')
    expect(stderr()).toContain('Generated SQL:')
    expect(stderr()).toContain('  DELETE FROM "users" WHERE "id" = $1')
    expect(output).not.toContain('Generated SQL:')
  })

  test('a mutation nobody forced still leaves stdout parseable as json', async () => {
    // The regression this file exists to prevent: confirmation ceremony on the
    // same stream as the envelope. --format json is asked for by the callers
    // that parse stdout, and force is deliberately not passed, because passing
    // it skips the confirmation and therefore skips the bug.
    const { updateCommand } = await import('@/commands/update')
    const output = await run(() =>
      updateCommand('users', { where: 'id=1', set: '{"amount":100}', format: 'json' })
    )

    expect(() => JSON.parse(output)).not.toThrow()
    expect(JSON.parse(output)).toMatchObject({ status: 'success', operation: 'update' })
  })

  test('a cancelled json run is one document too', async () => {
    confirmAnswer = false
    const { deleteCommand } = await import('@/commands/delete')
    const output = await run(() => deleteCommand('users', { where: 'id=1', format: 'json' }))

    expect(JSON.parse(output)).toMatchObject({ status: 'cancelled', rows_affected: 0 })
  })

  test('a human in a terminal still sees the confirmation before answering', async () => {
    const { updateCommand } = await import('@/commands/update')
    await runWithTTY(() => updateCommand('users', { where: 'id=1', set: '{"amount":100}' }))

    expect(stderr()).toContain('Generated SQL:')
    expect(stderr()).toContain('  UPDATE "users" SET "amount" = $1 WHERE "id" = $2')
  })

  test('all three SQL mutations use human outcomes in a terminal', async () => {
    const [{ insertCommand }, { updateCommand }, { deleteCommand }] = await Promise.all([
      import('@/commands/insert'),
      import('@/commands/update'),
      import('@/commands/delete'),
    ])

    const insertOutput = await runWithTTY(() =>
      insertCommand('users', { data: '{"amount":100}', force: true })
    )
    lines = []
    const updateOutput = await runWithTTY(() =>
      updateCommand('users', { where: 'id=1', set: '{"amount":100}', force: true })
    )
    lines = []
    const deleteOutput = await runWithTTY(() =>
      deleteCommand('users', { where: 'id=1', force: true })
    )

    expect(insertOutput).toContain('Inserted 3 row(s) into users')
    expect(updateOutput).toContain('Updated 3 row(s) in users')
    expect(deleteOutput).toContain('Deleted 3 row(s) from users')
    expect(`${insertOutput}${updateOutput}${deleteOutput}`).not.toContain('"status"')
  })

  test('--format json keeps the result envelope in a terminal', async () => {
    const { updateCommand } = await import('@/commands/update')
    const output = await runWithTTY(() =>
      updateCommand('users', {
        where: 'id=1',
        set: '{"amount":100}',
        force: true,
        format: 'json',
      })
    )

    expect(output).toContain('"status": "success"')
    expect(output).not.toContain('Updated 3 row(s) in users')
  })
})
