import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, rm, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configModule } from '@/core/config'
import { readV2Config, writeV2Config } from '@/core/config-v2'
import { configIntegrityPathForTest } from '@/core/config-integrity'

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

describe('agent-mode config integrity boundary', () => {
  const originalAgentMode = process.env.DBCLI_AGENT_MODE
  const originalAnchorDirectory = process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR
  let directory = ''

  afterEach(async () => {
    if (originalAgentMode === undefined) delete process.env.DBCLI_AGENT_MODE
    else process.env.DBCLI_AGENT_MODE = originalAgentMode
    if (originalAnchorDirectory === undefined) delete process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR
    else process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR = originalAnchorDirectory
    if (directory) await rm(directory, { recursive: true, force: true })
    directory = ''
  })

  test('trusted writes create an integrity record and agent reads accept unchanged content', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)
    expect(await Bun.file(configIntegrityPathForTest(directory)).exists()).toBe(true)

    process.env.DBCLI_AGENT_MODE = '1'
    expect((await readV2Config(directory)).default).toBe('local')
  })

  test('agent reads reject direct config edits after a trusted write', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)
    await Bun.write(
      join(directory, 'config.json'),
      JSON.stringify({ ...config, default: 'local', metadata: { version: '1.0', permission: 'admin' } })
    )

    process.env.DBCLI_AGENT_MODE = '1'
    await expect(readV2Config(directory)).rejects.toThrow(/direct config tampering|out-of-band edit/)
  })

  test('agent reads reject a deleted or tampered local integrity record', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)

    const integrityPath = configIntegrityPathForTest(directory)
    await Bun.write(
      integrityPath,
      JSON.stringify({ version: 1, configSha256: '0'.repeat(64), updatedAt: new Date().toISOString() })
    )
    process.env.DBCLI_AGENT_MODE = '1'
    await expect(readV2Config(directory)).rejects.toThrow(/direct config tampering|out-of-band edit/)

    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)
    await unlink(integrityPath)
    process.env.DBCLI_AGENT_MODE = '1'
    await expect(readV2Config(directory)).rejects.toThrow(/missing config integrity record/)
  })

  test('a host-protected anchor detects a config and local record replaced together', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    const anchorDirectory = join(directory, 'host-anchor')
    process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR = anchorDirectory
    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)

    const replacement = JSON.stringify({ ...config, default: 'attacker' }, null, 2)
    await Bun.write(join(directory, 'config.json'), replacement)
    const localRecord = await Bun.file(configIntegrityPathForTest(directory)).json()
    localRecord.configSha256 = createHash('sha256').update(replacement).digest('hex')
    await Bun.write(configIntegrityPathForTest(directory), JSON.stringify(localRecord, null, 2))

    process.env.DBCLI_AGENT_MODE = '1'
    await expect(readV2Config(directory)).rejects.toThrow(/direct config tampering|out-of-band edit/)
  })

  test('agent mode refuses legacy single-file configs until human migration', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    const legacyPath = join(directory, '.dbcli')
    await Bun.write(
      legacyPath,
      JSON.stringify({
        connection: config.connections.local,
        permission: 'query-only',
        schema: {},
      })
    )
    process.env.DBCLI_AGENT_MODE = '1'
    await expect(configModule.read(legacyPath)).rejects.toThrow(/legacy single-file config/)
  })

  test('agent reads reject group/world-writable config files', async () => {
    if (process.platform === 'win32') return
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)
    await chmod(join(directory, 'config.json'), 0o666)

    process.env.DBCLI_AGENT_MODE = '1'
    await expect(readV2Config(directory)).rejects.toThrow(/writable config/)
  })

  test('agent mode checks regular-file safety before reading a symlinked config', async () => {
    if (process.platform === 'win32') return
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    const target = join(directory, 'target.json')
    const configPath = join(directory, 'config.json')
    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)
    await Bun.write(target, await Bun.file(configPath).text())
    await unlink(configPath)
    await symlink(target, configPath)

    process.env.DBCLI_AGENT_MODE = '1'
    await expect(readV2Config(directory)).rejects.toThrow(/non-regular .* file/)
  })
})
