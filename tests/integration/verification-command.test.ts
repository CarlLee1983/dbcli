import { describe, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, utimes, symlink } from 'node:fs/promises'
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

function run(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
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
    const { stdout } = await run(work, [
      'verification',
      'list',
      '--format',
      'json',
      '--status',
      'verified',
    ])
    expect(JSON.parse(stdout).artifacts.map((a: { id: string }) => a.id)).toEqual(['aaaa'])
  })

  test('--subject filters by kind:name', async () => {
    const work = await seedWork([
      {
        id: 'aaaa',
        createdAt: '2026-06-19T01:00:00.000Z',
        subject: { kind: 'backfill', name: 'one' },
      },
      {
        id: 'bbbb',
        createdAt: '2026-06-19T02:00:00.000Z',
        subject: { kind: 'migration', name: 'two' },
      },
    ])
    const { stdout } = await run(work, [
      'verification',
      'list',
      '--format',
      'json',
      '--subject',
      'migration:two',
    ])
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
    await writeFile(
      join(work, '.dbcli', 'verification', 'verification-broken.json'),
      '{ not json',
      'utf8'
    )
    const { stdout } = await run(work, [
      'verification',
      'list',
      '--format',
      'json',
      '--include-invalid',
    ])
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
      {
        id: 'aaaa',
        createdAt: '2026-06-19T01:00:00.000Z',
        subject: { kind: 'backfill', name: 'alpha' },
      },
      {
        id: 'bbbb',
        createdAt: '2026-06-19T02:00:00.000Z',
        subject: { kind: 'backfill', name: 'beta' },
      },
      {
        id: 'cccc',
        createdAt: '2026-06-19T03:00:00.000Z',
        subject: { kind: 'migration', name: 'gamma' },
      },
    ])
    const { stdout, code } = await run(work, [
      'verification',
      'list',
      '--format',
      'json',
      '--subject',
      'backfill',
    ])
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

describe('dbcli verification show', () => {
  test('prints the full matching artifact by id', async () => {
    const work = await seedWork([{ id: 'abcd1234', createdAt: '2026-06-19T01:00:00.000Z' }])
    const { stdout, code } = await run(work, [
      'verification',
      'show',
      'abcd1234',
      '--format',
      'json',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.path).toContain('.dbcli/verification')
    expect(j.artifact.id).toBe('abcd1234')
    expect(j.artifact.schemaVersion).toBe(1)
  })

  test('unique prefix succeeds', async () => {
    const work = await seedWork([
      { id: 'abcd1234', createdAt: '2026-06-19T01:00:00.000Z' },
      { id: 'zzzz0000', createdAt: '2026-06-19T02:00:00.000Z' },
    ])
    const { stdout, code } = await run(work, ['verification', 'show', 'abcd', '--format', 'json'])
    expect(code).toBe(0)
    expect(JSON.parse(stdout).artifact.id).toBe('abcd1234')
  })

  test('ambiguous prefix exits 1 with candidates', async () => {
    const work = await seedWork([
      { id: 'abcd1111', createdAt: '2026-06-19T01:00:00.000Z' },
      { id: 'abcd2222', createdAt: '2026-06-19T02:00:00.000Z' },
    ])
    const { code, stderr } = await run(work, ['verification', 'show', 'abcd'])
    expect(code).toBe(1)
    expect(stderr.toLowerCase()).toContain('ambiguous')
  })

  test('no match exits 1', async () => {
    const work = await seedWork([{ id: 'abcd1234', createdAt: '2026-06-19T01:00:00.000Z' }])
    const { code } = await run(work, ['verification', 'show', 'nope'])
    expect(code).toBe(1)
  })

  test('path outside the storage dir exits 1', async () => {
    const work = await seedWork([{ id: 'abcd1234', createdAt: '2026-06-19T01:00:00.000Z' }])
    const { code, stderr } = await run(work, [
      'verification',
      'show',
      '.dbcli/verification/../../etc/passwd',
    ])
    expect(code).toBe(1)
    expect(stderr.toLowerCase()).toContain('outside')
  })

  test('selecting a malformed file exits 1 with a bounded error', async () => {
    const work = await seedWork([{ id: 'abcd1234', createdAt: '2026-06-19T01:00:00.000Z' }])
    await writeFile(
      join(work, '.dbcli', 'verification', 'verification-broken.json'),
      '{ not json',
      'utf8'
    )
    const { code, stderr } = await run(work, [
      'verification',
      'show',
      '.dbcli/verification/verification-broken.json',
    ])
    expect(code).toBe(1)
    expect(stderr.toLowerCase()).toContain('invalid')
  })
})

describe('dbcli verification summary', () => {
  test('returns latest, counts, invalid count, and subject breakdown', async () => {
    const work = await seedWork([
      {
        id: 'aaaa',
        createdAt: '2026-06-19T03:00:00.000Z',
        status: 'verified',
        subject: { kind: 'backfill', name: 'one' },
      },
      {
        id: 'bbbb',
        createdAt: '2026-06-19T02:00:00.000Z',
        status: 'not_verified',
        subject: { kind: 'backfill', name: 'one' },
      },
      {
        id: 'cccc',
        createdAt: '2026-06-19T01:00:00.000Z',
        status: 'blocked',
        subject: { kind: 'migration', name: 'm' },
      },
    ])
    await writeFile(
      join(work, '.dbcli', 'verification', 'verification-broken.json'),
      '{ not json',
      'utf8'
    )
    const { stdout, code } = await run(work, ['verification', 'summary', '--format', 'json'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.storageDir).toContain('.dbcli/verification')
    expect(j.latest.id).toBe('aaaa')
    expect(j.counts).toEqual({
      total: 3,
      verified: 1,
      not_verified: 1,
      indeterminate: 0,
      blocked: 1,
      invalid: 1,
    })
    expect(j.subjects[0]).toEqual({
      subject: { kind: 'backfill', name: 'one' },
      total: 2,
      latestStatus: 'verified',
      latestCreatedAt: '2026-06-19T03:00:00.000Z',
    })
  })

  test('no valid artifacts yields null latest, zero counts, exit 0', async () => {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-vsum-empty-'))
    const { stdout, code } = await run(work, ['verification', 'summary', '--format', 'json'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.latest).toBeNull()
    expect(j.counts.total).toBe(0)
  })

  test('--subject scopes the summary', async () => {
    const work = await seedWork([
      {
        id: 'aaaa',
        createdAt: '2026-06-19T02:00:00.000Z',
        subject: { kind: 'backfill', name: 'one' },
      },
      {
        id: 'bbbb',
        createdAt: '2026-06-19T01:00:00.000Z',
        subject: { kind: 'migration', name: 'm' },
      },
    ])
    const { stdout } = await run(work, [
      'verification',
      'summary',
      '--format',
      'json',
      '--subject',
      'backfill',
    ])
    const j = JSON.parse(stdout)
    expect(j.counts.total).toBe(1)
    expect(j.latest.id).toBe('aaaa')
  })
})

const DAY_MS = 24 * 60 * 60 * 1000
function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString()
}

describe('dbcli verification prune', () => {
  test('dry-run is the default: reports candidates, deletes nothing, exit 0', async () => {
    const work = await seedWork([
      { id: 'old1', createdAt: daysAgoISO(100) },
      { id: 'new1', createdAt: daysAgoISO(1) },
    ])
    const { stdout, code } = await run(work, [
      'verification', 'prune', '--older-than', '30d', '--keep-latest', '0', '--format', 'json',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.dryRun).toBe(true)
    expect(j.storageDir).toContain('.dbcli/verification')
    expect(j.candidates.map((c: { id: string }) => c.id)).toEqual(['old1'])
    expect(j.deleted).toEqual([])
    expect(j).toHaveProperty('protected')
    expect(j).toHaveProperty('skipped')
    expect(j).toHaveProperty('cutoff')
  })

  test('--execute without --force exits 1 and deletes nothing', async () => {
    const work = await seedWork([{ id: 'old1', createdAt: daysAgoISO(100) }])
    const { code, stderr } = await run(work, [
      'verification', 'prune', '--older-than', '30d', '--keep-latest', '0', '--execute',
    ])
    expect(code).toBe(1)
    expect(stderr.toLowerCase()).toContain('force')
    // Confirm nothing was deleted by re-listing.
    const after = await run(work, ['verification', 'list', '--format', 'json'])
    expect(JSON.parse(after.stdout).artifacts).toHaveLength(1)
  })

  test('--force without --execute performs dry-run only', async () => {
    const work = await seedWork([{ id: 'old1', createdAt: daysAgoISO(100) }])
    const { stdout, code } = await run(work, [
      'verification', 'prune', '--older-than', '30d', '--keep-latest', '0', '--force', '--format', 'json',
    ])
    expect(code).toBe(0)
    expect(JSON.parse(stdout).dryRun).toBe(true)
    const after = await run(work, ['verification', 'list', '--format', 'json'])
    expect(JSON.parse(after.stdout).artifacts).toHaveLength(1)
  })

  test('--execute --force deletes only selected artifacts', async () => {
    const work = await seedWork([
      { id: 'old1', createdAt: daysAgoISO(100) },
      { id: 'new1', createdAt: daysAgoISO(1) },
    ])
    const { stdout, code } = await run(work, [
      'verification', 'prune', '--older-than', '30d', '--keep-latest', '0', '--execute', '--force', '--format', 'json',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.dryRun).toBe(false)
    expect(j.deleted.map((d: { id: string }) => d.id)).toEqual(['old1'])
    const after = await run(work, ['verification', 'list', '--format', 'json'])
    expect(after.stdout).not.toContain('"id": "old1"')
    expect(after.stdout).toContain('"id": "new1"')
  })

  test('keep-latest protects newest by default', async () => {
    const work = await seedWork([
      { id: 'old1', createdAt: daysAgoISO(100) },
      { id: 'old2', createdAt: daysAgoISO(90) },
    ])
    const { stdout } = await run(work, [
      'verification', 'prune', '--older-than', '30d', '--keep-latest', '1', '--format', 'json',
    ])
    const j = JSON.parse(stdout)
    expect(j.protected.map((p: { id: string }) => p.id)).toEqual(['old2'])
    expect(j.candidates.map((c: { id: string }) => c.id)).toEqual(['old1'])
  })

  test('--status filters candidates', async () => {
    const work = await seedWork([
      { id: 'okk', createdAt: daysAgoISO(100), status: 'verified' },
      { id: 'noo', createdAt: daysAgoISO(90), status: 'not_verified' },
    ])
    const { stdout } = await run(work, [
      'verification', 'prune', '--older-than', '30d', '--keep-latest', '0', '--status', 'verified', '--format', 'json',
    ])
    expect(JSON.parse(stdout).candidates.map((c: { id: string }) => c.id)).toEqual(['okk'])
  })

  test('--include-invalid selects old malformed files', async () => {
    const work = await seedWork([{ id: 'valid1', createdAt: daysAgoISO(100) }])
    const broken = join(work, '.dbcli', 'verification', 'verification-broken.json')
    await writeFile(broken, '{ not json', 'utf8')
    const old = new Date(Date.now() - 100 * DAY_MS)
    await utimes(broken, old, old)
    const { stdout } = await run(work, [
      'verification', 'prune', '--older-than', '30d', '--keep-latest', '0', '--include-invalid', '--format', 'json',
    ])
    const j = JSON.parse(stdout)
    expect(j.candidates.some((c: { invalid: boolean; filename: string }) => c.invalid && c.filename === 'verification-broken.json')).toBe(true)
  })

  test('missing directory exits 0 with empty arrays', async () => {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-prune-empty-'))
    const { stdout, code } = await run(work, ['verification', 'prune', '--older-than', '30d', '--format', 'json'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.candidates).toEqual([])
    expect(j.protected).toEqual([])
  })

  test('missing --older-than exits 1', async () => {
    const work = await seedWork([{ id: 'old1', createdAt: daysAgoISO(100) }])
    const { code, stderr } = await run(work, ['verification', 'prune', '--format', 'json'])
    expect(code).toBe(1)
    expect(stderr.toLowerCase()).toContain('older-than')
  })

  test('invalid --older-than exits 1', async () => {
    const work = await seedWork([{ id: 'old1', createdAt: daysAgoISO(100) }])
    const { code, stderr } = await run(work, ['verification', 'prune', '--older-than', '1h'])
    expect(code).toBe(1)
    expect(stderr).toContain('1h')
  })

  test('table format prints the summary header', async () => {
    const work = await seedWork([{ id: 'old1', createdAt: daysAgoISO(100) }])
    const { stdout, code } = await run(work, [
      'verification', 'prune', '--older-than', '30d', '--keep-latest', '0', '--format', 'table',
    ])
    expect(code).toBe(0)
    expect(stdout).toContain('mode')
    expect(stdout).toContain('dry-run')
    expect(stdout).toContain('candidates')
  })
})

describe('dbcli verification malformed-artifact hardening', () => {
  // Write one malformed artifact (evidence: [null]) into a seeded workspace.
  async function seedWithMalformed(): Promise<{ work: string; file: string }> {
    const work = await seedWork([{ id: 'good', createdAt: '2026-06-19T01:02:03.000Z' }])
    const dir = join(work, '.dbcli', 'verification')
    const file = 'verification-20260101-000000-bad.json'
    const malformed = {
      schemaVersion: 1,
      id: 'ver_bad',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'verified',
      subject: { kind: 'backfill', name: 'x' },
      summary: 'malformed evidence',
      evidence: [null],
    }
    await writeFile(join(dir, file), JSON.stringify(malformed, null, 2), 'utf8')
    return { work, file }
  }

  test('list --include-invalid reports evidence:[null] under invalid, not artifacts', async () => {
    const { work } = await seedWithMalformed()
    const { stdout, code } = await run(work, [
      'verification',
      'list',
      '--format',
      'json',
      '--include-invalid',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.artifacts.some((a: { id: string }) => a.id === 'ver_bad')).toBe(false)
    expect(j.invalid).toHaveLength(1)
    expect(j.invalid[0].filename).toBe('verification-20260101-000000-bad.json')
  })

  test('show --format table never crashes on malformed JSON; reports via invalid path', async () => {
    const { work, file } = await seedWithMalformed()
    const selector = join('.dbcli', 'verification', file)
    const { stderr, code } = await run(work, ['verification', 'show', selector, '--format', 'table'])
    expect(code).toBe(1)
    expect(stderr).toContain('is invalid')
    expect(stderr).not.toContain('TypeError')
  })
})

describe('dbcli verification prune execute-mode table detail', () => {
  test('table output lists deleted files after deletion', async () => {
    // One old valid artifact; keep-latest 0 so it is eligible; older-than 1d so age passes.
    const work = await seedWork([{ id: 'old1', createdAt: '2020-01-01T00:00:00.000Z' }])
    const { stdout, code } = await run(work, [
      'verification',
      'prune',
      '--older-than',
      '1d',
      '--keep-latest',
      '0',
      '--execute',
      '--force',
      '--format',
      'table',
    ])
    expect(code).toBe(0)
    expect(stdout).toContain('deleted')
    expect(stdout).toContain('verification-')
    expect(stdout).toContain('old1')
  })

  test('table output lists skipped files when a candidate hits a safety guard', async () => {
    // A real old artifact plus a symlink named like an artifact; the symlink is a
    // candidate (its resolved content is valid + old) but lstat marks it not-regular-file.
    const work = await seedWork([{ id: 'real1', createdAt: '2020-01-01T00:00:00.000Z' }])
    const dir = join(work, '.dbcli', 'verification')
    const realName = 'verification-20200101-000000-real1.json'
    const linkName = 'verification-20200101-000000-zlink.json'
    await symlink(join(dir, realName), join(dir, linkName))

    const { stdout, code } = await run(work, [
      'verification',
      'prune',
      '--older-than',
      '1d',
      '--keep-latest',
      '0',
      '--execute',
      '--force',
      '--format',
      'table',
    ])
    expect(code).toBe(0)
    expect(stdout).toContain('skipped')
    expect(stdout).toContain('not-regular-file')
    expect(stdout).toContain(linkName)
  })
})

describe('dbcli verification --help wording', () => {
  test('parent help describes inspection + lifecycle, not globally read-only', async () => {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-vhelp-'))
    const { stdout, code } = await run(work, ['verification', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('Inspect and manage local verification artifacts')
    expect(stdout).not.toContain('Read-only inspection of verification artifacts')
  })

  test('prune --help states keep-latest is global before filters', async () => {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-vhelp-'))
    const { stdout, code } = await run(work, ['verification', 'prune', '--help'])
    expect(code).toBe(0)
    // commander wraps the option help, so assert the distinctive phrase that
    // renders intact on one line rather than the full wrapped string. Also
    // assert 'across' so the wrapped word cannot silently disappear.
    expect(stdout).toContain('across')
    expect(stdout).toContain('all subjects/statuses before filters')
  })
})
