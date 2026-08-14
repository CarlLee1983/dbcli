import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'

const recoverySentinel = new Error('recovery envelope emitted')
const recoveryCalls: Array<{ error: unknown; context: unknown; options: unknown }> = []

mock.module('@/core/recovery', () => ({
  emitRecoveryEnvelope(error: unknown, context: unknown, options: unknown): never {
    recoveryCalls.push({ error, context, options })
    throw recoverySentinel
  },
}))

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

describe('SQL mutation recovery output', () => {
  let lines: string[]
  let spies: Array<{ mockRestore: () => void }>
  let stdoutIsTTY: PropertyDescriptor | undefined
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-mutation-recovery-'))
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
    lines = []
    recoveryCalls.length = 0
    stdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })

    const adapter = {
      connect: mock(async () => {}),
      disconnect: mock(async () => {}),
      execute: mock(async () => {
        throw new Error('statement exploded')
      }),
      getTableSchema: mock(async () => schema),
      listTables: mock(async () => []),
      ping: mock(async () => {}),
    }

    spies = [
      spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '))
      }),
      spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as never),
      spyOn(configModule, 'read').mockResolvedValue({
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
      } as never),
    ]
  })

  afterEach(async () => {
    for (const spy of spies) spy.mockRestore()
    if (stdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    await rm(workDir, { recursive: true, force: true })
  })

  test('--recovery emits its envelope before any human or result output', async () => {
    const { updateCommand } = await import('@/commands/update')

    await expect(
      updateCommand('users', {
        where: 'id=1',
        set: '{"amount":100}',
        force: true,
        recovery: true,
        config: workDir,
      })
    ).rejects.toBe(recoverySentinel)

    expect(lines).toEqual([])
    expect(recoveryCalls.length).toBeGreaterThanOrEqual(1)
    expect(recoveryCalls[0]?.context).toEqual({
      operation: 'update',
      table: 'users',
      writeOperation: 'UPDATE',
    })
    const emitOptions = recoveryCalls[0]?.options as {
      envelopeId?: string
      auditRef?: string
    }
    const envelopeId = emitOptions.envelopeId
    const auditRef = emitOptions.auditRef
    expect(emitOptions).toMatchObject({
      envelopeId: expect.any(String),
      auditRef: expect.any(String),
    })

    const rawAudit = await Bun.file(join(workDir, '.dbcli', 'audit', 'default.jsonl')).text()
    const auditEntries = rawAudit
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            id: string
            recovery_ref: string
          }
      )
    const auditEntry = auditEntries.find((entry) => entry.recovery_ref === envelopeId) as {
      id: string
      recovery_ref: string
    }
    expect(auditEntry.recovery_ref).toBe(envelopeId)
    expect(auditEntry.id).toBe(auditRef)
  })
})
