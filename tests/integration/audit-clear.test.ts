/**
 * `dbcli audit clear` — integration tests (Phase 24 / Plan 24-05 Task 2).
 *
 * Spawns the CLI with --config <workDir> and synthetic JSONL fixtures.
 * Spawn has no controlling TTY, so the interactive prompt is exercised by
 * acceptance grep + manual verification (24-05 plan); these tests cover
 * the `--yes`, no-op, non-TTY rejection, disabled fixture, lock cleanup,
 * F decision, and D-48 paths.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

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
  workDir: string
): Promise<{ stdout: string; stderr: string; code: number }> {
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
  emptyDir?: boolean
}

async function seed(opts: SeedOpts = {}): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-clear-'))
  const auditDir = join(work, '.dbcli', 'audit')
  await mkdir(auditDir, { recursive: true })

  const cfg = makeMinimalConfig(opts.auditEnabled === false ? { audit: { enabled: false } } : {})
  await writeFile(join(work, 'config.json'), JSON.stringify(cfg, null, 2))

  if (opts.emptyDir) return work

  const baseTs = Date.parse('2026-05-15T00:00:00.000Z')
  const mkEntry = (i: number) =>
    JSON.stringify({
      id: `${String(i).padStart(8, '0')}-uuid-default`,
      ts: new Date(baseTs + i * 60_000).toISOString(),
      session_id: 'test-session',
      engine: 'postgresql',
      command: 'query',
      side_effect_tier: 'readonly',
      target: 'users',
      success: true,
      redacted_query: 'dbcli query ?',
    })

  const rotatedLines = Array.from({ length: 3 }, (_, i) => mkEntry(i + 1)).join('\n') + '\n'
  const currentLines = Array.from({ length: 5 }, (_, i) => mkEntry(i + 4)).join('\n') + '\n'
  await writeFile(join(auditDir, 'default.jsonl.1'), rotatedLines)
  await writeFile(join(auditDir, 'default.jsonl'), currentLines)
  return work
}

describe('dbcli audit clear (CLI)', () => {
  let work: string

  afterEach(async () => {
    if (work) {
      await rm(work, { recursive: true, force: true })
      work = ''
    }
  })

  test('--yes deletes both .jsonl + .jsonl.1', async () => {
    work = await seed()
    const auditDir = join(work, '.dbcli', 'audit')
    const r = await run(['audit', 'clear', '--yes'], work)
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(/Cleared.*entries/)
    await expect(stat(join(auditDir, 'default.jsonl'))).rejects.toThrow()
    await expect(stat(join(auditDir, 'default.jsonl.1'))).rejects.toThrow()
  })

  test('--yes on truly empty audit dir prints Nothing to clear', async () => {
    work = await seed({ emptyDir: true })
    const r = await run(['audit', 'clear', '--yes'], work)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('Nothing to clear')
  })

  test('non-TTY without --yes is rejected (D-46)', async () => {
    work = await seed()
    const r = await run(['audit', 'clear'], work)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('Cannot prompt for confirmation')
  })

  test('--yes works on audit.enabled=false fixture (no short-circuit)', async () => {
    work = await seed({ auditEnabled: false })
    const auditDir = join(work, '.dbcli', 'audit')
    const r = await run(['audit', 'clear', '--yes'], work)
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(/Cleared.*entries/)
    await expect(stat(join(auditDir, 'default.jsonl'))).rejects.toThrow()
  })

  test('--yes also removes leftover .lock file', async () => {
    work = await seed()
    const lockPath = join(work, '.dbcli', 'audit', 'default.jsonl.lock')
    await writeFile(lockPath, JSON.stringify({ pid: 99999, ts: new Date().toISOString() }))
    const r = await run(['audit', 'clear', '--yes'], work)
    expect(r.code).toBe(0)
    await expect(stat(lockPath)).rejects.toThrow()
  })

  test('clear does not write any new audit entry (F decision)', async () => {
    work = await seed()
    const r = await run(['audit', 'clear', '--yes'], work)
    expect(r.code).toBe(0)
    const auditDir = join(work, '.dbcli', 'audit')
    // After clear, default.jsonl must not be re-created (no audit-on-audit write).
    await expect(stat(join(auditDir, 'default.jsonl'))).rejects.toThrow()
  })

  test('clear does not touch .dbcli/last-session-id (D-48)', async () => {
    work = await seed()
    const sidPath = join(work, '.dbcli', 'last-session-id')
    const before = JSON.stringify({
      sessionId: 'sticky-test-id',
      pid: process.pid,
      createdAt: new Date().toISOString(),
    })
    await writeFile(sidPath, before)
    const r = await run(['audit', 'clear', '--yes'], work)
    expect(r.code).toBe(0)
    const after = await Bun.file(sidPath).text()
    expect(after).toBe(before)
  })
})
