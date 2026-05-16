/**
 * `dbcli audit show` + `dbcli audit health` — integration tests
 * (Phase 24 / Plan 24-04 Task 3).
 *
 * Spawns the CLI with --config <workDir> against synthetic JSONL fixtures.
 * No mocks; real reader, real commander surface, real i18n strings.
 *
 * Covers D-35 (prefix length / no_match / ambiguous), D-36 (--all envelope),
 * D-37 (recovery-ref exact), D-38 (mutex), D-33 (brief variants for show + health),
 * E exception (health does NOT short-circuit on disabled).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  withAmbiguousPrefix?: boolean
  secondaryConn?: boolean
}

interface Seeded {
  work: string
  knownFullId: string
  knownPrefix: string
  knownRecoveryRef: string
  ambiguousPrefix: string
}

const KNOWN_RECOVERY_REF = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

async function seed(opts: SeedOpts = {}): Promise<Seeded> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-show-health-'))
  const auditDir = join(work, '.dbcli', 'audit')
  await mkdir(auditDir, { recursive: true })

  const cfg = makeMinimalConfig(opts.auditEnabled === false ? { audit: { enabled: false } } : {})
  await writeFile(join(work, 'config.json'), JSON.stringify(cfg, null, 2))

  const baseTs = Date.parse('2026-05-15T00:00:00.000Z')
  const mkEntry = (
    i: number,
    overrides: { id?: string; recovery_ref?: string; conn?: string } = {}
  ) => {
    const conn = overrides.conn ?? 'default'
    const id = overrides.id ?? `${String(i).padStart(8, '0')}-uuid-${conn}`
    const base: Record<string, unknown> = {
      id,
      ts: new Date(baseTs + i * 60_000).toISOString(),
      session_id: 'test-session',
      engine: 'postgresql',
      command: 'query',
      side_effect_tier: 'readonly',
      target: 'users',
      success: true,
      redacted_query: 'dbcli query ?',
    }
    if (overrides.recovery_ref) base.recovery_ref = overrides.recovery_ref
    return base
  }

  const entries: ReturnType<typeof mkEntry>[] = [mkEntry(1, { recovery_ref: KNOWN_RECOVERY_REF })]
  for (let i = 2; i <= 8; i++) entries.push(mkEntry(i))

  if (opts.withAmbiguousPrefix) {
    entries.push(mkEntry(9, { id: 'aaaa1234-x-uuid' }))
    entries.push(mkEntry(10, { id: 'aaaa1234-y-uuid' }))
  }

  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await writeFile(join(auditDir, 'default.jsonl'), lines)

  if (opts.secondaryConn) {
    const secondaryEntries = [mkEntry(20, { id: 'bbbb1111-uuid-secondary', conn: 'secondary' })]
    const secondaryLines = secondaryEntries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(join(auditDir, 'secondary.jsonl'), secondaryLines)
  }

  const knownFullId = String(entries[0]!.id)
  return {
    work,
    knownFullId,
    knownPrefix: knownFullId.slice(0, 8),
    knownRecoveryRef: KNOWN_RECOVERY_REF,
    ambiguousPrefix: 'aaaa1234',
  }
}

let work: string

afterEach(async () => {
  if (work) {
    await rm(work, { recursive: true, force: true })
    work = ''
  }
})

describe('dbcli audit show (CLI)', () => {
  test('show <full-uuid> happy: prints full vertical entry', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'show', s.knownFullId], s.work)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('Id:')
    expect(r.stdout).toContain(s.knownFullId)
  })

  test('show <prefix-≥4> happy: 8-char prefix matches single entry', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'show', s.knownPrefix], s.work)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain(s.knownFullId)
  })

  test('show <prefix-3> rejected as too-short (D-35)', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'show', 'abc'], s.work)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('at least 4 characters')
  })

  test('show <ambiguous-prefix> rejected with count (D-35)', async () => {
    const s = await seed({ withAmbiguousPrefix: true })
    work = s.work
    const r = await run(['audit', 'show', s.ambiguousPrefix], s.work)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('Ambiguous prefix')
    expect(r.stderr).toContain('2')
  })

  test('show <no-match> rejected with no_match', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'show', 'zzzz9999-nope'], s.work)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('No audit entry matches')
  })

  test('show --recovery-ref happy (D-37)', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'show', '--recovery-ref', s.knownRecoveryRef], s.work)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain(s.knownFullId)
    expect(r.stdout).toContain(s.knownRecoveryRef)
  })

  test('show --recovery-ref no-match', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'show', '--recovery-ref', 'r-no-such'], s.work)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('No audit entry has recovery_ref')
  })

  test('show <id> --recovery-ref mutex (D-38)', async () => {
    const s = await seed()
    work = s.work
    const r = await run(
      ['audit', 'show', s.knownPrefix, '--recovery-ref', s.knownRecoveryRef],
      s.work
    )
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('either <id> argument or --recovery-ref')
  })

  test('show <id> --all envelope (D-36)', async () => {
    const s = await seed({ secondaryConn: true })
    work = s.work
    const r = await run(['audit', 'show', 'bbbb1111', '--all', '--format', 'json'], s.work)
    expect(r.code).toBe(0)
    const obj = JSON.parse(r.stdout)
    expect(obj).toHaveProperty('connection', 'secondary')
    expect(obj).toHaveProperty('entry')
    expect(obj.entry).toHaveProperty('id', 'bbbb1111-uuid-secondary')
  })

  test('show <prefix> --format json --brief omits metadata + redacted_query', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'show', s.knownPrefix, '--format', 'json', '--brief'], s.work)
    expect(r.code).toBe(0)
    const obj = JSON.parse(r.stdout)
    expect(obj).not.toHaveProperty('metadata')
    expect(obj).not.toHaveProperty('redacted_query')
    expect(obj).toHaveProperty('id')
    expect(obj).toHaveProperty('ts')
  })

  test('show <prefix> --brief table mode skips stripped fields (no "undefined")', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'show', s.knownPrefix, '--brief'], s.work)
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain('undefined')
    expect(r.stdout).toContain('Id:')
  })

  test('show on disabled audit: stderr disabled_hint, exit 0 (E)', async () => {
    const s = await seed({ auditEnabled: false })
    work = s.work
    const r = await run(['audit', 'show', s.knownPrefix], s.work)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('Audit is disabled')
  })
})

describe('dbcli audit health (CLI)', () => {
  test('health table happy: shows all 9 rows', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'health'], s.work)
    expect(r.code).toBe(0)
    for (const label of [
      'Enabled:',
      'File:',
      'Size:',
      'Entries:',
      'Lock:',
      'Last write:',
      'Last error:',
      'Session id:',
      'Last rotation:',
    ]) {
      expect(r.stdout).toContain(label)
    }
  })

  test('health --format json: full AuditHealthReport shape', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'health', '--format', 'json'], s.work)
    expect(r.code).toBe(0)
    const obj = JSON.parse(r.stdout)
    for (const key of [
      'enabled',
      'currentFile',
      'rotationUsage',
      'lock',
      'lastWrite',
      'lastError',
      'sessionId',
      'rotation',
    ]) {
      expect(obj).toHaveProperty(key)
    }
  })

  test('health --brief --format json: only enabled / lastWrite / rotationUsage', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'health', '--brief', '--format', 'json'], s.work)
    expect(r.code).toBe(0)
    const obj = JSON.parse(r.stdout)
    expect(Object.keys(obj).sort()).toEqual(['enabled', 'lastWrite', 'rotationUsage'].sort())
  })

  test('health --for-agent: equivalent to brief json', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'health', '--for-agent'], s.work)
    expect(r.code).toBe(0)
    const obj = JSON.parse(r.stdout)
    expect(Object.keys(obj).sort()).toEqual(['enabled', 'lastWrite', 'rotationUsage'].sort())
  })

  test('health --for-agent --no-brief: full json', async () => {
    const s = await seed()
    work = s.work
    const r = await run(['audit', 'health', '--for-agent', '--no-brief'], s.work)
    expect(r.code).toBe(0)
    const obj = JSON.parse(r.stdout)
    expect(obj).toHaveProperty('currentFile')
    expect(obj).toHaveProperty('lock')
    expect(obj).toHaveProperty('sessionId')
  })

  test('health on disabled audit: still prints snapshot, no disabled_hint (E exception)', async () => {
    const s = await seed({ auditEnabled: false })
    work = s.work
    const r = await run(['audit', 'health'], s.work)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('Enabled:')
    expect(r.stdout).toContain('false')
    expect(r.stderr).not.toContain('Audit is disabled')
  })
})
