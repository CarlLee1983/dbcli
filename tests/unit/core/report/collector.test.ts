import { describe, test, expect, spyOn } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { collectReport } from '@/core/report/collector'
import { RedisAdapter } from '@/adapters/redis-adapter'

const FIXTURE = resolve(import.meta.dir, '../../../fixtures/inspect/v1-postgres')

describe('collectReport (no-connect)', () => {
  test('emits stable shape with empty sections and a warning', async () => {
    const snap = await collectReport({
      workspace: FIXTURE,
      configPath: resolve(FIXTURE, '.dbcli'),
      noConnect: true,
      sections: ['health', 'capacity', 'perf'],
    })
    expect(snap.schemaVersion).toBe(1)
    expect(typeof snap.generatedAt).toBe('string')
    expect(new Date(snap.generatedAt).toString()).not.toBe('Invalid Date')
    expect(snap.context.system).toBe('postgresql')
    expect(snap.sections).toEqual([])
    expect(snap.warnings.some((w) => w.message.includes('no-connect'))).toBe(true)
    expect(Array.isArray(snap.suggestedCommands)).toBe(true)
  })

  test('respects requested section subset', async () => {
    const snap = await collectReport({
      workspace: FIXTURE,
      configPath: resolve(FIXTURE, '.dbcli'),
      noConnect: true,
      sections: ['capacity'],
    })
    expect(snap.sections).toEqual([])
  })

  test('no-config workspace returns context-only with warning', async () => {
    const empty = resolve(import.meta.dir, '../../../fixtures/inspect/no-config')
    const snap = await collectReport({
      workspace: empty,
      configPath: resolve(empty, '.dbcli'),
      noConnect: true,
      sections: ['health'],
    })
    expect(snap.context.system).toBeNull()
    expect(snap.sections).toEqual([])
    expect(snap.warnings.length).toBeGreaterThan(0)
  })
})

test('Redis report uses the configured adapter and never persists protected key names', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dbcli-redis-report-'))
  const configPath = join(workspace, '.dbcli')
  await mkdir(configPath)
  await Bun.write(
    join(configPath, 'config.json'),
    JSON.stringify({
      connection: {
        system: 'redis',
        host: 'localhost',
        port: 6379,
        user: '',
        password: '',
        database: '0',
      },
      permission: 'query-only',
      blacklist: { tables: ['secrets:*'], columns: {} },
    })
  )

  const connect = spyOn(RedisAdapter.prototype, 'connect').mockImplementation(async function (
    this: RedisAdapter
  ) {
    ;(this as unknown as { client: unknown }).client = {
      send: async (command: string) => {
        if (command === 'INFO') return 'redis_version:7.2.0\r\nused_memory:100\r\n'
        if (command === 'SCAN') return ['0', ['public:key', 'secrets:api_key']]
        return []
      },
      close: () => {},
    }
  })

  try {
    const snap = await collectReport({ workspace, configPath, sections: ['capacity'] })
    const evidence = snap.sections.flatMap((section) => section.evidence)
    expect(evidence.find((item) => item.snippet === '@diag/redis-key-stats')?.status).toBe(
      'skipped'
    )
    expect(JSON.stringify(snap)).not.toContain('secrets:')
  } finally {
    connect.mockRestore()
    await rm(workspace, { recursive: true, force: true })
  }
})
