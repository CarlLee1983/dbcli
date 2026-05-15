/**
 * `dbcli audit tail` — integration tests (Phase 24 / Plan 24-03 Task 3)
 *
 * Spawns the CLI against synthetic .dbcli/audit/<conn>.jsonl fixtures.
 * No mocks; real reader, real commander surface, real i18n strings.
 *
 * Covers D-39 (envelope), D-40 (flat), D-41 (rotation merge), D-42 (tie-break),
 * E (disabled / empty), L (cap warning), and --for-agent / --no-brief.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

/**
 * Minimal valid DbcliConfig — schema requires connection / permission / metadata.
 * blacklist + audit have zod defaults so are omitted; per-test overrides flip
 * audit.enabled to false.
 */
function makeMinimalConfig(overrides: Partial<{ audit: { enabled: boolean } }> = {}): unknown {
  return {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'u',
      password: 'p',
      database: 'd',
    },
    permission: 'query-only',
    metadata: { createdAt: '2026-05-15T00:00:00.000Z', version: '1.0' },
    ...(overrides.audit ? { audit: overrides.audit } : {}),
  }
}

function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(k)) continue
    if (k === 'DATABASE_URL') continue
    out[k] = v
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

function run(
  args: string[],
  workDir: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  // Pass --config workDir so resolveConfigStoragePath returns the workspace root,
  // making auditDir resolve to <workDir>/.dbcli/audit (mirrors audit-engines.test.ts pattern).
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, '--config', workDir, ...args], {
      cwd: workDir,
      env: sanitizeEnv(),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

interface SeedOpts {
  auditEnabled?: boolean
  secondaryConn?: boolean
  emptyAudit?: boolean
}

async function seed(opts: SeedOpts = {}): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-tail-'))
  // workspace layout: <work>/config.json + <work>/.dbcli/audit/<conn>.jsonl[.1]
  const auditDir = join(work, '.dbcli', 'audit')
  await mkdir(auditDir, { recursive: true })

  const cfg = makeMinimalConfig(
    opts.auditEnabled === false ? { audit: { enabled: false } } : {},
  )
  await writeFile(join(work, 'config.json'), JSON.stringify(cfg, null, 2))

  if (opts.emptyAudit) {
    await writeFile(join(auditDir, 'default.jsonl'), '')
    return work
  }

  const baseTs = Date.parse('2026-05-15T00:00:00.000Z')
  const mkEntry = (i: number, conn: string = 'default') => ({
    id: `${String(i).padStart(8, '0')}-uuid-${conn}`,
    ts: new Date(baseTs + i * 60_000).toISOString(),
    session_id: 'test-session',
    engine: 'postgresql',
    command: 'query',
    side_effect_tier: 'readonly',
    target: 'users',
    success: true,
    redacted_query: 'dbcli query ?',
  })

  const rotatedLines =
    Array.from({ length: 5 }, (_, i) => JSON.stringify(mkEntry(i + 1))).join('\n') + '\n'
  const currentLines =
    Array.from({ length: 12 }, (_, i) => JSON.stringify(mkEntry(i + 6))).join('\n') + '\n'
  await writeFile(join(auditDir, 'default.jsonl.1'), rotatedLines)
  await writeFile(join(auditDir, 'default.jsonl'), currentLines)

  if (opts.secondaryConn) {
    // Reuse default's mid-range timestamps (i+8) so 'default' and 'secondary'
    // collide on `ts`, exercising D-42 tie-break (default < secondary lex).
    const secondaryLines =
      Array.from({ length: 5 }, (_, i) => JSON.stringify(mkEntry(i + 8, 'secondary'))).join(
        '\n',
      ) + '\n'
    await writeFile(join(auditDir, 'secondary.jsonl'), secondaryLines)
  }
  return work
}

let work: string

afterEach(async () => {
  if (work) await rm(work, { recursive: true, force: true })
})

describe('dbcli audit tail (CLI)', () => {
  test('happy path: tail 10 entries from current connection (table)', async () => {
    work = await seed()
    const r = await run(['audit', 'tail'], work)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('ts')
    expect(r.stdout).toContain('command')
    expect(r.stdout.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(10)
  })

  test('cross-rotation: --n 15 --format json reads .jsonl.1 + .jsonl', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--n', '15', '--format', 'json'], work)
    expect(r.code).toBe(0)
    const arr = JSON.parse(r.stdout)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.length).toBe(15)
  })

  test('flat array shape (D-40): single connection, no envelope', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--format', 'json'], work)
    const arr = JSON.parse(r.stdout)
    expect(arr[0]).toHaveProperty('id')
    expect(arr[0]).toHaveProperty('ts')
    expect(arr[0]).not.toHaveProperty('connection')
    expect(arr[0]).not.toHaveProperty('entry')
  })

  test('envelope shape with --all (D-39)', async () => {
    work = await seed({ secondaryConn: true })
    const r = await run(['audit', 'tail', '--all', '--format', 'json'], work)
    const arr = JSON.parse(r.stdout)
    expect(arr[0]).toHaveProperty('connection')
    expect(arr[0]).toHaveProperty('entry')
    expect(arr[0].entry).toHaveProperty('id')
    expect(arr[0].entry).toHaveProperty('ts')
  })

  test('tie-break by connection name (D-42): default < secondary at same ts', async () => {
    work = await seed({ secondaryConn: true })
    const r = await run(
      ['audit', 'tail', '--all', '--n', '50', '--format', 'json'],
      work,
    )
    const arr: Array<{ connection: string; entry: { ts: string } }> = JSON.parse(r.stdout)
    let foundCollision = false
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i]!.entry.ts === arr[i + 1]!.entry.ts) {
        foundCollision = true
        expect(arr[i]!.connection.localeCompare(arr[i + 1]!.connection)).toBeLessThanOrEqual(
          0,
        )
      }
    }
    expect(foundCollision).toBe(true)
  })

  test('--for-agent collapses to brief json', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--for-agent'], work)
    const arr = JSON.parse(r.stdout)
    expect(arr[0]).toHaveProperty('ts')
    expect(arr[0]).toHaveProperty('command')
    expect(arr[0]).toHaveProperty('target')
    expect(arr[0]).toHaveProperty('success')
    expect(arr[0]).not.toHaveProperty('id')
    expect(arr[0]).not.toHaveProperty('session_id')
  })

  test('--for-agent --no-brief preserves full entry', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--for-agent', '--no-brief'], work)
    const arr = JSON.parse(r.stdout)
    expect(arr[0]).toHaveProperty('id')
    expect(arr[0]).toHaveProperty('session_id')
    expect(arr[0]).toHaveProperty('engine')
  })

  test('disabled: stderr disabled_hint, stdout empty, exit 0 (E)', async () => {
    work = await seed({ auditEnabled: false })
    const r = await run(['audit', 'tail'], work)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('Audit is disabled')
    expect(r.stdout.trim()).toBe('')
  })

  test('empty audit (table): stderr no_entries, exit 0', async () => {
    work = await seed({ emptyAudit: true })
    const r = await run(['audit', 'tail'], work)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('No audit entries.')
    expect(r.stdout.trim()).toBe('')
  })

  test('empty audit (json): stdout [], exit 0', async () => {
    work = await seed({ emptyAudit: true })
    const r = await run(['audit', 'tail', '--format', 'json'], work)
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('[]')
  })

  test('--n cap warning at 99999 (L)', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--n', '99999'], work)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('capped')
    expect(r.stderr).toContain('10000')
  })

  test('--n 0 rejected with positive integer error', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--n', '0'], work)
    expect(r.code).toBe(1)
    expect(r.stderr.toLowerCase()).toContain('positive integer')
  })

  test('audit --help lists 4 subcommands', async () => {
    work = await seed()
    const r = await run(['audit', '--help'], work)
    expect(r.code).toBe(0)
    for (const sub of ['tail', 'show', 'clear', 'health']) {
      expect(r.stdout).toContain(sub)
    }
  })
})
