import { describe, test, expect, beforeEach } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(k)) continue
    out[k] = v
  }
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

function run(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd, env: sanitizeEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

interface ArtifactSeed {
  id: string
  createdAt: string
  status?: string
  subject?: { kind: string; name?: string }
  summary?: string
}

async function seedWork(seeds: ArtifactSeed[]): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-vcmd-'))
  const dir = join(work, '.dbcli', 'verification')
  await mkdir(dir, { recursive: true })
  for (const s of seeds) {
    const stamp = s.createdAt.replace(/[-:T.Z]/g, '').slice(0, 14)
    const file = `verification-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${s.id}.json`
    const artifact = {
      schemaVersion: 1,
      id: s.id,
      createdAt: s.createdAt,
      status: s.status ?? 'verified',
      subject: s.subject ?? { kind: 'backfill', name: 'safe-backfill-verify' },
      summary: s.summary ?? 'Assertion verified the expected state.',
      evidence: [{ kind: 'assert', exitCode: 0 }],
    }
    await writeFile(join(dir, file), JSON.stringify(artifact, null, 2), 'utf8')
  }
  return work
}

describe('dbcli verification list', () => {
  test('returns valid artifacts latest-first as JSON', async () => {
    const work = await seedWork([
      { id: 'aaaa', createdAt: '2026-06-19T01:02:03.000Z' },
      { id: 'bbbb', createdAt: '2026-06-19T02:03:04.000Z' },
    ])
    const { stdout, code } = await run(work, ['verification', 'list', '--format', 'json'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.storageDir).toContain('.dbcli/verification')
    expect(j.artifacts.map((a: { id: string }) => a.id)).toEqual(['bbbb', 'aaaa'])
    expect(j.artifacts[0].evidenceCount).toBe(1)
    expect(j.invalid).toEqual([])
  })

  test('exits 0 with empty list when the directory is missing', async () => {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-vcmd-empty-'))
    const { stdout, code } = await run(work, ['verification', 'list', '--format', 'json'])
    expect(code).toBe(0)
    expect(JSON.parse(stdout).artifacts).toEqual([])
  })

  test('--status filters by status', async () => {
    const work = await seedWork([
      { id: 'aaaa', createdAt: '2026-06-19T01:00:00.000Z', status: 'verified' },
      { id: 'bbbb', createdAt: '2026-06-19T02:00:00.000Z', status: 'not_verified' },
    ])
    const { stdout } = await run(work, ['verification', 'list', '--format', 'json', '--status', 'verified'])
    expect(JSON.parse(stdout).artifacts.map((a: { id: string }) => a.id)).toEqual(['aaaa'])
  })

  test('--subject filters by kind:name', async () => {
    const work = await seedWork([
      { id: 'aaaa', createdAt: '2026-06-19T01:00:00.000Z', subject: { kind: 'backfill', name: 'one' } },
      { id: 'bbbb', createdAt: '2026-06-19T02:00:00.000Z', subject: { kind: 'migration', name: 'two' } },
    ])
    const { stdout } = await run(work, ['verification', 'list', '--format', 'json', '--subject', 'migration:two'])
    expect(JSON.parse(stdout).artifacts.map((a: { id: string }) => a.id)).toEqual(['bbbb'])
  })

  test('invalid --status exits 1', async () => {
    const work = await seedWork([{ id: 'aaaa', createdAt: '2026-06-19T01:00:00.000Z' }])
    const { code, stderr } = await run(work, ['verification', 'list', '--status', 'bogus'])
    expect(code).toBe(1)
    expect(stderr).toContain('bogus')
  })

  test('--include-invalid surfaces bounded invalid records', async () => {
    const work = await seedWork([{ id: 'aaaa', createdAt: '2026-06-19T01:00:00.000Z' }])
    await writeFile(join(work, '.dbcli', 'verification', 'verification-broken.json'), '{ not json', 'utf8')
    const { stdout } = await run(work, ['verification', 'list', '--format', 'json', '--include-invalid'])
    const j = JSON.parse(stdout)
    expect(j.invalid).toHaveLength(1)
    expect(j.invalid[0].filename).toBe('verification-broken.json')
  })

  test('table format prints headers and a row', async () => {
    const work = await seedWork([
      { id: 'cccc', createdAt: '2026-06-19T03:00:00.000Z', status: 'verified' },
    ])
    const { stdout, code } = await run(work, ['verification', 'list', '--format', 'table'])
    expect(code).toBe(0)
    expect(stdout).toContain('createdAt')
    expect(stdout).toContain('status')
  })

  test('--subject filters by kind alone', async () => {
    const work = await seedWork([
      { id: 'aaaa', createdAt: '2026-06-19T01:00:00.000Z', subject: { kind: 'backfill', name: 'alpha' } },
      { id: 'bbbb', createdAt: '2026-06-19T02:00:00.000Z', subject: { kind: 'backfill', name: 'beta' } },
      { id: 'cccc', createdAt: '2026-06-19T03:00:00.000Z', subject: { kind: 'migration', name: 'gamma' } },
    ])
    const { stdout, code } = await run(work, ['verification', 'list', '--format', 'json', '--subject', 'backfill'])
    expect(code).toBe(0)
    const ids = JSON.parse(stdout).artifacts.map((a: { id: string }) => a.id)
    expect(ids).toContain('aaaa')
    expect(ids).toContain('bbbb')
    expect(ids).not.toContain('cccc')
  })

  test('invalid --subject exits 1', async () => {
    const work = await seedWork([{ id: 'aaaa', createdAt: '2026-06-19T01:00:00.000Z' }])
    const { code, stderr } = await run(work, ['verification', 'list', '--subject', 'bogus'])
    expect(code).toBe(1)
    expect(stderr).toContain('bogus')
  })
})
