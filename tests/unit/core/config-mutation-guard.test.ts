import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeV2Config } from '@/core/config-v2'
import { configModule } from '@/core/config'

const config = {
  version: 2 as const,
  default: 'local',
  connections: {
    local: {
      system: 'postgresql' as const,
      host: 'localhost',
      port: 5432,
      user: 'u',
      password: 'p',
      database: 'd',
      permission: 'query-only' as const,
    },
  },
}

describe('agent-mode config mutation guard', () => {
  const originalAgentMode = process.env.DBCLI_AGENT_MODE
  let directory = ''

  afterEach(async () => {
    if (originalAgentMode === undefined) delete process.env.DBCLI_AGENT_MODE
    else process.env.DBCLI_AGENT_MODE = originalAgentMode
    if (directory) await rm(directory, { recursive: true, force: true })
    directory = ''
  })

  test('blocks direct v2 config writes in agent mode', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-mutation-guard-'))
    process.env.DBCLI_AGENT_MODE = '1'
    delete process.env.DBCLI_CONFIG_MUTATION_APPROVED

    await expect(writeV2Config(directory, config as any)).rejects.toThrow(/Agent mode blocks/)
    expect(await Bun.file(join(directory, 'config.json')).exists()).toBe(false)
  })

  test('requires the human/admin workflow to run outside agent mode', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-mutation-guard-'))
    delete process.env.DBCLI_AGENT_MODE

    await writeV2Config(directory, config as any)
    expect(await Bun.file(join(directory, 'config.json')).exists()).toBe(true)
  })

  test('same-process approval variables cannot bypass agent mode', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-mutation-guard-'))
    process.env.DBCLI_AGENT_MODE = '1'
    process.env.DBCLI_CONFIG_MUTATION_APPROVED = '1'

    await expect(writeV2Config(directory, config as any)).rejects.toThrow(/outside agent mode/)
  })

  test('also blocks legacy config writes so the gate cannot be bypassed by format', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-mutation-guard-'))
    process.env.DBCLI_AGENT_MODE = '1'
    delete process.env.DBCLI_CONFIG_MUTATION_APPROVED

    await expect(
      configModule.write(join(directory, '.dbcli'), {
        connection: config.connections.local,
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
      } as any)
    ).rejects.toThrow(/Agent mode blocks/)
  })
})
