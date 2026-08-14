/**
 * What the audit log says about the tier-two gate.
 *
 * Every evaluation is recorded, allowed or refused, and the reason it exists is
 * measurement: in six months "is this gate stopping anything, or has everyone
 * routed around it" has to be answerable from data. A log that only kept the
 * refusals could not tell "nobody writes like that" apart from "everybody found
 * a way past it".
 *
 * Asserted against the file an auditor reads rather than against the mapping
 * that produces it.
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
    { name: 'status', type: 'text', nullable: false, primaryKey: false },
  ],
  rowCount: 0,
  primaryKey: ['id'],
  indexes: [],
  foreignKeys: [],
}

describe('tier-two decisions in the audit log', () => {
  let workDir: string
  let spies: Array<{ mockRestore: () => void }> = []
  let originalExit: typeof process.exit
  let originalIsTTY: unknown
  let originalStdinIsTTY: unknown
  let typedAnswer = ''

  // Both streams, because tier two prompts on stdin and reports on stdout: a
  // terminal on one side only is the agent-harness case the gate must refuse.
  const setTTY = (value: boolean) => {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
  }

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-write-gate-audit-'))
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
    typedAnswer = ''
    originalIsTTY = (process.stdout as { isTTY?: boolean }).isTTY
    originalStdinIsTTY = (process.stdin as { isTTY?: boolean }).isTTY
    originalExit = process.exit
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never

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
      spyOn(console, 'error').mockImplementation(() => {}),
      spyOn(process.stderr, 'write').mockImplementation(() => true),
      spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as never),
      spyOn(promptUser, 'confirm').mockImplementation(async () => true),
      spyOn(promptUser, 'text').mockImplementation(async () => typedAnswer),
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
          }) as never
      ),
    ]
  })

  afterEach(async () => {
    process.exit = originalExit
    for (const spy of spies) spy.mockRestore()
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinIsTTY,
      configurable: true,
    })
    await rm(workDir, { recursive: true, force: true })
  })

  async function gateEntries(): Promise<Array<Record<string, unknown>>> {
    const raw = await Bun.file(join(workDir, '.dbcli', 'audit', 'default.jsonl')).text()
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => (entry.metadata as Record<string, unknown>)?.write_gate_tier === 'two')
  }

  async function runQuery(sql: string): Promise<void> {
    const { queryCommand } = await import('@/commands/query')
    try {
      await queryCommand(sql, { config: workDir } as never)
    } catch {
      // Refusals throw; the log is what this file is about.
    }
  }

  test('a refusal is recorded with its reason', async () => {
    setTTY(false)
    await runQuery('DELETE FROM users')

    const entries = await gateEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.success).toBe(false)
    const metadata = entries[0]!.metadata as Record<string, unknown>
    expect(metadata.write_gate_outcome).toBe('refused')
    expect(metadata.write_gate_reason).toBe('no_where')
  })

  test('a statement somebody confirmed is recorded too, so the gate can be measured', async () => {
    setTTY(true)
    typedAnswer = 'users'
    await runQuery('DELETE FROM users')

    const entries = await gateEntries()
    expect(entries).toHaveLength(1)
    const metadata = entries[0]!.metadata as Record<string, unknown>
    expect(metadata.write_gate_outcome).toBe('allowed')
  })

  test('declining at the typed prompt is neither a success nor a refusal', async () => {
    setTTY(true)
    typedAnswer = 'nope'
    await runQuery('DELETE FROM users')

    const entries = await gateEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.success).toBe(false)
    expect((entries[0]!.metadata as Record<string, unknown>).write_gate_outcome).toBe('declined')
  })

  test('a structured delete refused for matching on nothing unique says so', async () => {
    setTTY(false)
    const { deleteCommand } = await import('@/commands/delete')
    try {
      await deleteCommand('users', {
        where: 'status=active',
        force: true,
        config: workDir,
      } as never)
    } catch {
      // process.exit sentinel
    }

    const entries = await gateEntries()
    expect(entries).toHaveLength(1)
    expect((entries[0]!.metadata as Record<string, unknown>).write_gate_reason).toBe(
      'non_unique_where'
    )
  })
})
