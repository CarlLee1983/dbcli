import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readdir, rm, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configModule } from '@/core/config'
import { readV2Config, writeV2Config } from '@/core/config-v2'
import { configIntegrityPathForTest, refusesGroupOrWorldWritable } from '@/core/config-integrity'

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

  test('first trusted write publishes a detached anchor when the anchor path is new', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    const anchorDirectory = join(directory, 'host-anchor')
    process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR = anchorDirectory
    delete process.env.DBCLI_AGENT_MODE

    await writeV2Config(directory, config as any)

    expect(await readdir(anchorDirectory)).toHaveLength(1)
    process.env.DBCLI_AGENT_MODE = '1'
    expect((await readV2Config(directory)).default).toBe('local')
  })

  test('agent reads reject direct config edits after a trusted write', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)
    await Bun.write(
      join(directory, 'config.json'),
      JSON.stringify({
        ...config,
        default: 'local',
        metadata: { version: '1.0', permission: 'admin' },
      })
    )

    process.env.DBCLI_AGENT_MODE = '1'
    await expect(readV2Config(directory)).rejects.toThrow(
      /direct config tampering|out-of-band edit/
    )
  })

  test('agent reads reject a deleted or tampered local integrity record', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)

    const integrityPath = configIntegrityPathForTest(directory)
    await Bun.write(
      integrityPath,
      JSON.stringify({
        version: 1,
        configSha256: '0'.repeat(64),
        updatedAt: new Date().toISOString(),
      })
    )
    process.env.DBCLI_AGENT_MODE = '1'
    await expect(readV2Config(directory)).rejects.toThrow(
      /direct config tampering|out-of-band edit/
    )

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
    await expect(readV2Config(directory)).rejects.toThrow(
      /direct config tampering|out-of-band edit/
    )
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

  test('agent mode refuses a missing config instead of returning defaults', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    process.env.DBCLI_AGENT_MODE = '1'

    await expect(configModule.read(join(directory, '.dbcli'))).rejects.toThrow(
      /Agent mode refuses a missing config/
    )
  })

  test('a failed detached-anchor publish leaves the previous config and local record intact', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbcli-config-integrity-'))
    delete process.env.DBCLI_AGENT_MODE
    await writeV2Config(directory, config as any)
    const configPath = join(directory, 'config.json')
    const integrityPath = configIntegrityPathForTest(directory)
    const previousConfig = await Bun.file(configPath).text()
    const previousRecord = await Bun.file(integrityPath).text()

    const blockedAnchorDirectory = join(directory, 'blocked-anchor')
    await Bun.write(blockedAnchorDirectory, 'not a directory')
    process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR = blockedAnchorDirectory

    const replacement = {
      ...config,
      default: 'replacement',
      connections: { ...config.connections, replacement: config.connections.local },
    }
    await expect(writeV2Config(directory, replacement as any)).rejects.toThrow()

    expect(await Bun.file(configPath).text()).toBe(previousConfig)
    expect(await Bun.file(integrityPath).text()).toBe(previousRecord)
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

  test('the writability gate is POSIX-only: Windows modes carry no group/world meaning', () => {
    // A private POSIX file passes everywhere; a group/world-writable one is
    // refused on POSIX platforms only.
    expect(refusesGroupOrWorldWritable(0o600, 'linux')).toBe(false)
    expect(refusesGroupOrWorldWritable(0o600, 'darwin')).toBe(false)
    expect(refusesGroupOrWorldWritable(0o666, 'linux')).toBe(true)
    expect(refusesGroupOrWorldWritable(0o620, 'darwin')).toBe(true)

    // Windows reports 0o666 for every writable file and 0o444 when the
    // read-only bit is set. Treating those as group/world-writable refused
    // every config dbcli had just written itself.
    expect(refusesGroupOrWorldWritable(0o666, 'win32')).toBe(false)
    expect(refusesGroupOrWorldWritable(0o444, 'win32')).toBe(false)
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
