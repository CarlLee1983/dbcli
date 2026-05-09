import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveApplySource } from '@/commands/recover'

let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-recover-'))
})

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true })
})

const RAW_ENV = {
  schemaVersion: 1,
  generatedAt: '2026-05-10T00:00:00.000Z',
  ok: false,
  error: { code: 'CONFIG_MISSING', category: 'config', message: 'x' },
  recovery: [],
}

describe('resolveApplySource', () => {
  test('reads .dbcli/last-recovery.json when --from is undefined', async () => {
    const realCwd = await realpath(workspace)
    await mkdir(join(workspace, '.dbcli'), { recursive: true })
    await writeFile(
      join(workspace, '.dbcli/last-recovery.json'),
      JSON.stringify({
        schemaVersion: 1,
        savedAt: '2026-05-10T00:00:00.000Z',
        command: 'dbcli query <sql>',
        cwd: realCwd,
        envelope: RAW_ENV,
      })
    )
    const r = await resolveApplySource({ from: undefined, cwd: workspace })
    expect(r.kind).toBe('auto')
    expect(r.cwd).toBe(realCwd)
    expect(r.envelope.error.code).toBe('CONFIG_MISSING')
  })

  test('throws "no envelope" with exit code 2 when nothing exists', async () => {
    await expect(resolveApplySource({ from: undefined, cwd: workspace })).rejects.toMatchObject({
      exitCode: 2,
    })
  })

  test('--from accepts a raw RecoveryEnvelope and synthesizes cwd/command', async () => {
    const path = join(workspace, 'env.json')
    await writeFile(path, JSON.stringify(RAW_ENV))
    const r = await resolveApplySource({ from: path, cwd: workspace })
    expect(r.kind).toBe('from')
    expect(typeof r.cwd).toBe('string')
  })

  test('--from accepts a SavedRecoveryEnvelope and uses its cwd/command', async () => {
    const path = join(workspace, 'saved.json')
    const fakeCwd = await mkdtemp(join(tmpdir(), 'dbcli-recover-fakecwd-'))
    const realFakeCwd = await realpath(fakeCwd)
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: '2026-05-10T00:00:00.000Z',
        command: 'dbcli q @foo',
        cwd: realFakeCwd,
        envelope: RAW_ENV,
      })
    )
    const r = await resolveApplySource({ from: path, cwd: workspace })
    expect(r.kind).toBe('from')
    expect(r.cwd).toBe(realFakeCwd)
    await rm(fakeCwd, { recursive: true, force: true })
  })

  test('--from with nonexistent file throws exit 2', async () => {
    await expect(
      resolveApplySource({ from: join(workspace, 'missing.json'), cwd: workspace })
    ).rejects.toMatchObject({ exitCode: 2 })
  })

  test('--from with malformed JSON throws exit 2', async () => {
    const path = join(workspace, 'bad.json')
    await writeFile(path, 'not-json')
    await expect(resolveApplySource({ from: path, cwd: workspace })).rejects.toMatchObject({
      exitCode: 2,
    })
  })

  test('SavedRecoveryEnvelope with non-existent cwd throws exit 2', async () => {
    const path = join(workspace, 'saved.json')
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: '2026-05-10T00:00:00.000Z',
        command: 'dbcli q @foo',
        cwd: '/this/path/does/not/exist',
        envelope: RAW_ENV,
      })
    )
    await expect(resolveApplySource({ from: path, cwd: workspace })).rejects.toMatchObject({
      exitCode: 2,
    })
  })
})
