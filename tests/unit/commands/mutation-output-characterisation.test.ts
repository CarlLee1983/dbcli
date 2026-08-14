/**
 * Characterisation tests for what update/delete print to stdout.
 *
 * These exist to freeze current behaviour across the move of presentation out
 * of core. They are deliberately exact-match: the whole point of the refactor
 * is that not one byte changes, so a loose assertion would defeat it.
 *
 * Once ceremony lands these expectations change on purpose, and that diff is
 * the reviewable record of what a human's output became.
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
  let spies: Array<{ mockRestore: () => void }> = []
  let originalExit: typeof process.exit
  let confirmAnswer = true

  beforeEach(() => {
    lines = []
    confirmAnswer = true
    originalExit = process.exit
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as any

    spies = [
      spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '))
      }),
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

  test('update prints the confirmation block, then the result envelope', async () => {
    const { updateCommand } = await import('@/commands/update')
    const output = await run(() =>
      updateCommand('users', { where: 'id=1', set: '{"amount":100}' })
    )

    expect(output).toBe(
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

  test('cancelling at the prompt still prints a success envelope today', async () => {
    confirmAnswer = false
    const { updateCommand } = await import('@/commands/update')
    const output = await run(() =>
      updateCommand('users', { where: 'id=1', set: '{"amount":100}' })
    )

    expect(output).toContain('"rows_affected": 0')
    expect(output).toContain('"status": "success"')
  })

  test('delete leads with the destructive warning', async () => {
    const { deleteCommand } = await import('@/commands/delete')
    const output = await run(() => deleteCommand('users', { where: 'id=1' }))

    expect(output).toContain('⚠️  Warning: DELETE operation is destructive and cannot be undone!')
    expect(output).toContain('Generated SQL:')
    expect(output).toContain('  DELETE FROM "users" WHERE "id" = $1')
  })
})
