/**
 * What the audit log records for each way a mutation can end.
 *
 * The log is the reason the status contract had to change rather than gain a
 * parallel field: `success` was read straight off `status === 'success'`, and a
 * cancelled write reported success, so declining at the prompt left a record
 * saying the database had been written to. Asserting on the file rather than on
 * the mapping is deliberate — the file is what an auditor reads.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('audit entries for mutation outcomes', () => {
  let workDir: string
  let spies: Array<{ mockRestore: () => void }> = []
  let confirmAnswer = true
  let originalExit: typeof process.exit

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-outcome-'))
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
    confirmAnswer = true
    originalExit = process.exit
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as any

    const adapter = {
      connect: mock(async () => {}),
      disconnect: mock(async () => {}),
      execute: mock(async () => ({ affectedRows: 3, rows: [] })),
      getTableSchema: mock(async () => schema),
      listTables: mock(async () => []),
      ping: mock(async () => {}),
    }

    spies = [
      spyOn(console, 'log').mockImplementation(() => {}),
      spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any),
      spyOn(promptUser, 'confirm').mockImplementation(async () => confirmAnswer),
      spyOn(configModule, 'read').mockImplementation(
        async () =>
          ({
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
            audit: { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
          }) as any
      ),
    ]
  })

  afterEach(async () => {
    process.exit = originalExit
    for (const spy of spies) spy.mockRestore()
    await rm(workDir, { recursive: true, force: true })
  })

  async function runUpdate(options: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { updateCommand } = await import('@/commands/update')
    try {
      await updateCommand('users', {
        where: 'id=1',
        set: '{"amount":100}',
        config: workDir,
        ...options,
      } as any)
    } catch {
      // process.exit sentinel
    }

    const raw = await Bun.file(join(workDir, '.dbcli', 'audit', 'default.jsonl')).text()
    const lines = raw.trim().split('\n').filter(Boolean)
    return JSON.parse(lines[lines.length - 1]!)
  }

  test('a confirmed write is recorded as a success that touched rows', async () => {
    const entry = await runUpdate({})

    expect(entry.success).toBe(true)
    expect((entry.metadata as Record<string, unknown>).outcome).toBe('success')
    expect((entry.metadata as Record<string, unknown>).rows_affected).toBe(3)
  })

  test('a cancelled write is not recorded as a success', async () => {
    confirmAnswer = false
    const entry = await runUpdate({})

    // The bug this whole change exists for.
    expect(entry.success).toBe(false)
    expect((entry.metadata as Record<string, unknown>).outcome).toBe('cancelled')
    expect((entry.metadata as Record<string, unknown>).rows_affected).toBe(0)
  })

  test('a dry run is recorded as a preview, not as a write', async () => {
    const entry = await runUpdate({ dryRun: true })

    expect(entry.success).toBe(true)
    expect((entry.metadata as Record<string, unknown>).outcome).toBe('dry_run')
    expect((entry.metadata as Record<string, unknown>).dry_run).toBe(true)
    expect((entry.metadata as Record<string, unknown>).rows_affected).toBe(0)
  })
})
