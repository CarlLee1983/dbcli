import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { claimUpdateHint, updateHintStatePathForTest } from '@/utils/update-hint-state'

describe('update hint session state', () => {
  const sandboxes: string[] = []

  afterEach(async () => {
    await Promise.all(
      sandboxes.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function makeConfigDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'dbcli-update-hints-'))
    sandboxes.push(directory)
    return directory
  }

  test('claims each hint kind once per session', async () => {
    const configPath = await makeConfigDirectory()

    expect(await claimUpdateHint(configPath, 'update', 'session-a', '1.2.0')).toBe(true)
    expect(await claimUpdateHint(configPath, 'update', 'session-a', '1.3.0')).toBe(false)
    expect(await claimUpdateHint(configPath, 'skill', 'session-a', 'codex')).toBe(true)
    expect(await claimUpdateHint(configPath, 'skill', 'session-a', 'codex')).toBe(false)
    expect(await claimUpdateHint(configPath, 'update', 'session-b', '1.3.0')).toBe(true)

    const state = JSON.parse(await readFile(updateHintStatePathForTest(configPath), 'utf8')) as {
      sessions: Record<string, { update?: string; skill?: string; updatedAt: string }>
    }
    expect(state.sessions['session-a']).toEqual({
      update: '1.2.0',
      skill: 'codex',
      updatedAt: expect.any(String),
    })
    expect(state.sessions['session-b']?.update).toBe('1.3.0')
  })

  test('supports a config file path as well as a config directory', async () => {
    const directory = await makeConfigDirectory()
    const configPath = join(directory, 'config.json')

    expect(await claimUpdateHint(configPath, 'update', 'session', '1.2.0')).toBe(true)
    expect(updateHintStatePathForTest(configPath)).toBe(join(directory, 'update-hints.json'))
  })

  test('keeps the default .dbcli directory sidecar inside .dbcli', async () => {
    const directory = await makeConfigDirectory()
    const configPath = join(directory, '.dbcli')

    expect(await claimUpdateHint(configPath, 'update', 'session', '1.2.0')).toBe(true)
    expect(updateHintStatePathForTest(configPath)).toBe(join(configPath, 'update-hints.json'))
  })

  test('concurrent claims for one session produce one winner', async () => {
    const configPath = await makeConfigDirectory()
    const claims = await Promise.all(
      Array.from({ length: 12 }, () => claimUpdateHint(configPath, 'update', 'session', '1.2.0'))
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
  })
})
