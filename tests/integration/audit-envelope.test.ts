/**
 * `audit tail --all` envelope contract test (Phase 24 / Plan 24-05 Task 3).
 *
 * Independent of `audit-contract.test.ts` (Phase 22; locks the on-disk entry shape).
 * This file locks the CLI-only envelope wrapper from D-39:
 *   `[{ connection: string, entry: <AuditEntry with all required keys> }, ...]`
 *
 * Also guards:
 * - D-42 tie-break: same `ts` → connection lex ascending
 * - D-39 CLI-only invariant: envelope wrapper is NEVER written back to disk
 * - D-40 single-connection flat shape (no envelope when `--all` is absent)
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

const ENTRY_REQUIRED_KEYS = [
  'id',
  'ts',
  'session_id',
  'engine',
  'command',
  'side_effect_tier',
  'target',
  'success',
  'redacted_query',
] as const

function makeMinimalConfig(): unknown {
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
  secondaryConn?: boolean
}

async function seed(opts: SeedOpts = {}): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-envelope-'))
  const auditDir = join(work, '.dbcli', 'audit')
  await mkdir(auditDir, { recursive: true })
  await writeFile(join(work, 'config.json'), JSON.stringify(makeMinimalConfig(), null, 2))

  const baseTs = Date.parse('2026-05-15T00:00:00.000Z')
  const mkEntry = (i: number, conn: string = 'default') =>
    JSON.stringify({
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

  const currentLines = Array.from({ length: 8 }, (_, i) => mkEntry(i + 1)).join('\n') + '\n'
  await writeFile(join(auditDir, 'default.jsonl'), currentLines)

  if (opts.secondaryConn) {
    // Reuse default's mid-range timestamps (i+3) so 'default' and 'secondary'
    // collide on `ts`, exercising D-42 tie-break.
    const secondaryLines =
      Array.from({ length: 5 }, (_, i) => mkEntry(i + 3, 'secondary')).join('\n') + '\n'
    await writeFile(join(auditDir, 'secondary.jsonl'), secondaryLines)
  }
  return work
}

describe('audit tail --all envelope contract', () => {
  let work: string

  afterEach(async () => {
    if (work) {
      await rm(work, { recursive: true, force: true })
      work = ''
    }
  })

  test('envelope element has {connection: string, entry: <AuditEntry with all required keys>}', async () => {
    work = await seed({ secondaryConn: true })
    const r = await run(['audit', 'tail', '--all', '--n', '50', '--format', 'json'], work)
    expect(r.code).toBe(0)
    const arr = JSON.parse(r.stdout)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.length).toBeGreaterThan(0)
    for (const env of arr) {
      expect(typeof env.connection).toBe('string')
      expect(env.entry).toBeDefined()
      for (const key of ENTRY_REQUIRED_KEYS) {
        expect(env.entry).toHaveProperty(key)
      }
    }
  })

  test('connection tie-break (D-42): same ts → connection lexicographic ascending', async () => {
    work = await seed({ secondaryConn: true })
    const r = await run(['audit', 'tail', '--all', '--n', '50', '--format', 'json'], work)
    const arr: Array<{ connection: string; entry: { ts: string } }> = JSON.parse(r.stdout)
    let foundTiePair = false
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i]!.entry.ts === arr[i + 1]!.entry.ts) {
        foundTiePair = true
        expect(arr[i]!.connection.localeCompare(arr[i + 1]!.connection)).toBeLessThanOrEqual(0)
      }
    }
    expect(foundTiePair).toBe(true)
  })

  test('envelope is CLI-only: on-disk .jsonl never contains "connection" or "entry" key', async () => {
    work = await seed({ secondaryConn: true })
    await run(['audit', 'tail', '--all', '--format', 'json'], work)
    const auditDir = join(work, '.dbcli', 'audit')
    for (const file of ['default.jsonl', 'secondary.jsonl']) {
      const path = join(auditDir, file)
      let raw = ''
      try {
        raw = await readFile(path, 'utf8')
      } catch {
        continue
      }
      const lines = raw.split('\n').filter(Boolean)
      for (const line of lines) {
        const obj = JSON.parse(line)
        expect(obj).not.toHaveProperty('connection')
        expect(obj).not.toHaveProperty('entry')
      }
    }
  })

  test('single-connection tail flat array (D-40) does NOT have envelope wrapper', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--format', 'json'], work)
    const arr = JSON.parse(r.stdout)
    expect(arr[0]).toHaveProperty('id')
    expect(arr[0]).not.toHaveProperty('connection')
    expect(arr[0]).not.toHaveProperty('entry')
  })

  test('Phase 22 audit-contract.test.ts is not modified by Phase 24', async () => {
    // Meta-guard: Phase 22 contract file should not mention 'envelope'
    // (envelope is Phase 24 CLI-only and lives in this file alone).
    const contractPath = resolve(import.meta.dir, 'audit-contract.test.ts')
    const raw = await readFile(contractPath, 'utf8').catch(() => '')
    expect(raw).not.toContain('envelope')
  })
})
