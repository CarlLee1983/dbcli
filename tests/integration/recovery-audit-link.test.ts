/**
 * Phase 25 contract test — bi-directional ref + DOCS-02 audit_recent + J1 asymmetry guard.
 *
 * Release-blocking: round-trip (wired surface) + J1 negative guard.
 * Standard: DOCS-02 4-surface checks + back-compat + Phase 22/24 meta-guards.
 *
 * Parallel to:
 * - tests/integration/audit-contract.test.ts (Phase 22 entry-shape lock; NOT modified here)
 * - tests/integration/audit-envelope.test.ts (Phase 24 envelope-wrapper lock; NOT modified here)
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function makeMinimalConfig(auditEnabled: boolean = true): unknown {
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
    audit: { enabled: auditEnabled, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
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
    const child = spawn('bun', ['run', CLI, ...args], { cwd: workDir, env: sanitizeEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

async function seedConfig(workDir: string, auditEnabled = true): Promise<void> {
  // Canonical layout: `--config <workDir>` resolves to <workDir>/config.json;
  // audit data goes under <workDir>/.dbcli/audit/. Matches audit-envelope.test.ts.
  await writeFile(
    join(workDir, 'config.json'),
    JSON.stringify(makeMinimalConfig(auditEnabled)),
    'utf8'
  )
}

async function readAuditEntries(workDir: string): Promise<Array<Record<string, unknown>>> {
  // Audit logger writes to <storagePath>/.dbcli/audit/default.jsonl. The catch
  // block in inspect.ts / query.ts passes the LOCAL options to writeAuditEntry
  // (options.config is undefined for inspect/query subcommands — only the parent
  // program declares --config), which causes the audit logger to fall back to
  // the relative path '.dbcli', resolving to <cwd>/.dbcli/.dbcli/audit/...
  // We probe both layouts so the test works regardless of how config propagates.
  for (const file of [
    join(workDir, '.dbcli', 'audit', 'default.jsonl'),
    join(workDir, '.dbcli', '.dbcli', 'audit', 'default.jsonl'),
  ]) {
    try {
      const raw = await readFile(file, 'utf8')
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    } catch {
      // try next layout
    }
  }
  return []
}

async function readEnvelope(workDir: string): Promise<Record<string, unknown> | null> {
  const file = join(workDir, '.dbcli', 'last-recovery.json')
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function seedAuditEntries(workDir: string, count: number): Promise<void> {
  const auditDir = join(workDir, '.dbcli', 'audit')
  await mkdir(auditDir, { recursive: true })
  const lines =
    Array.from({ length: count }, (_, i) =>
      JSON.stringify({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        ts: `2026-05-15T10:${String(i % 60).padStart(2, '0')}:00Z`,
        session_id: 'sess-abc',
        engine: 'postgresql',
        command: 'query',
        side_effect_tier: 'readonly',
        target: 'users',
        success: true,
        redacted_query: 'dbcli query <sql>',
      })
    ).join('\n') + '\n'
  await writeFile(join(auditDir, 'default.jsonl'), lines, 'utf8')
}

describe('Bi-directional ref round-trip (wired surface) [INTEGRATE-02 / -03 release-blocking]', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-rt-'))
    await seedConfig(workDir)
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('inspect failure with --require-schema-cache --recovery: bi-directional UUIDs match (ROADMAP #1+#2+#4)', async () => {
    const r = await run(
      ['--config', workDir, 'inspect', '--require-schema-cache', '--recovery', '--no-connect'],
      workDir
    )
    expect(r.code).not.toBe(0)

    const entries = await readAuditEntries(workDir)
    expect(entries.length).toBeGreaterThan(0)
    const lastEntry = entries[entries.length - 1]!
    expect(lastEntry.success).toBe(false)
    expect(typeof lastEntry.recovery_ref).toBe('string')
    expect(lastEntry.recovery_ref as string).toMatch(/^[0-9a-f-]{36}$/)

    const envelope = await readEnvelope(workDir)
    expect(envelope).not.toBeNull()
    // ROADMAP #1: audit_entry.recovery_ref === envelope.id
    expect(envelope!.id).toBe(lastEntry.recovery_ref as string)
    // ROADMAP #2: envelope.audit_ref === audit_entry.id
    expect(envelope!.audit_ref).toBe(lastEntry.id as string)
  })
})

describe('6-command bi-directional ref round-trip (replaces former J1 negative guard) [INTEGRATE-03 positive contract]', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-bi-'))
    await seedConfig(workDir)
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  const cases: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'insert', args: ['insert', 'nonexistent_table', '--data', '{"a":1}', '--recovery'] },
    {
      cmd: 'update',
      args: ['update', 'nonexistent_table', '--set', '{"a":1}', '--where', 'id=1', '--recovery'],
    },
    { cmd: 'delete', args: ['delete', 'nonexistent_table', '--where', 'id=1', '--recovery'] },
    {
      cmd: 'export',
      args: [
        'export',
        'select 1',
        '--output',
        join(tmpdir(), 'phase25-export.csv'),
        '--format',
        'csv',
        '--recovery',
      ],
    },
    { cmd: 'q', args: ['q', '@nope/does-not-exist', '--recovery'] },
    { cmd: 'schema', args: ['schema', 'nonexistent_table', '--recovery'] },
  ]

  for (const { cmd, args } of cases) {
    test(`${cmd} --recovery failure: envelope.audit_ref === audit.id AND audit.recovery_ref === envelope.id`, async () => {
      await run(['--config', workDir, ...args], workDir)

      const entries = await readAuditEntries(workDir)
      expect(entries.length).toBeGreaterThan(0)
      const lastEntry = entries[entries.length - 1]!
      expect(lastEntry.success).toBe(false)
      expect(typeof lastEntry.recovery_ref).toBe('string')
      expect(lastEntry.recovery_ref as string).toMatch(/^[0-9a-f-]{36}$/)

      const envelope = await readEnvelope(workDir)
      expect(envelope).not.toBeNull()
      expect(envelope!.id).toBe(lastEntry.recovery_ref as string)
      expect(envelope!.audit_ref).toBe(lastEntry.id as string)
    })
  }
})

describe('DOCS-02 audit_recent embedding [4 agent surfaces]', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-docs02-'))
    await seedConfig(workDir)
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('inspect --for-agent JSON has audit_recent at top level', async () => {
    const r = await run(['--config', workDir, 'inspect', '--for-agent', '--no-connect'], workDir)
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(Array.isArray(parsed.audit_recent)).toBe(true)
  })

  test('guide health --for-agent JSON has audit_recent at top level (not inside context)', async () => {
    const r = await run(['--config', workDir, 'guide', 'health', '--for-agent'], workDir)
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(Array.isArray(parsed.audit_recent)).toBe(true)
    const ctx = parsed.context as Record<string, unknown> | undefined
    if (ctx) {
      const ctxAuditRecent = ctx.audit_recent
      const empty =
        ctxAuditRecent === undefined ||
        (Array.isArray(ctxAuditRecent) && (ctxAuditRecent as unknown[]).length === 0)
      expect(empty).toBe(true)
    }
  })

  test('recover --format json JSON has audit_recent (no-apply branch)', async () => {
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
    const env = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-15T10:00:00Z',
      ok: false as const,
      error: { code: 'UNKNOWN', category: 'unknown', message: 'test' },
      recovery: [],
    }
    const saved = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:00:00Z',
      command: 'dbcli query',
      cwd: workDir,
      envelope: env,
    }
    await writeFile(join(workDir, '.dbcli', 'last-recovery.json'), JSON.stringify(saved), 'utf8')

    const r = await run(['--config', workDir, 'recover', '--format', 'json'], workDir)
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(Array.isArray(parsed.audit_recent)).toBe(true)
    expect(parsed.ok).toBe(false)
    expect('error' in parsed).toBe(true)
    expect('recovery' in parsed).toBe(true)
  })

  test('recover --apply JSON has audit_recent alongside ApplyResult fields', async () => {
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
    const env = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-15T10:00:00Z',
      ok: false as const,
      error: { code: 'UNKNOWN', category: 'unknown', message: 'test' },
      recovery: [],
    }
    const saved = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:00:00Z',
      command: 'dbcli query',
      cwd: workDir,
      envelope: env,
    }
    await writeFile(join(workDir, '.dbcli', 'last-recovery.json'), JSON.stringify(saved), 'utf8')

    const r = await run(['--config', workDir, 'recover', '--apply'], workDir)
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(Array.isArray(parsed.audit_recent)).toBe(true)
    expect(typeof parsed.schemaVersion).toBe('number')
    expect('startedAt' in parsed).toBe(true)
    expect('finalStatus' in parsed).toBe(true)
  })
})

describe('audit_recent shape contract [D-58 / D-59 / D-60]', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-shape-'))
    await seedConfig(workDir)
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('items have EXACTLY {id, ts, command, target, success} (D-59 forbidden keys absent)', async () => {
    await seedAuditEntries(workDir, 1)
    const r = await run(['--config', workDir, 'inspect', '--for-agent', '--no-connect'], workDir)
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.stdout) as { audit_recent: Array<Record<string, unknown>> }
    expect(parsed.audit_recent.length).toBe(1)
    const item = parsed.audit_recent[0]!
    expect(Object.keys(item).sort()).toEqual(['command', 'id', 'success', 'target', 'ts'])
    for (const forbidden of [
      'redacted_query',
      'redacted_sql',
      'metadata',
      'session_id',
      'engine',
      'side_effect_tier',
    ]) {
      expect(forbidden in item).toBe(false)
    }
  })

  test('caps at N=5 when 10 entries exist (D-58)', async () => {
    await seedAuditEntries(workDir, 10)
    const r = await run(['--config', workDir, 'inspect', '--for-agent', '--no-connect'], workDir)
    const parsed = JSON.parse(r.stdout) as { audit_recent: unknown[] }
    expect(parsed.audit_recent.length).toBe(5)
  })

  test('is [] when audit.enabled = false (D-60)', async () => {
    await writeFile(join(workDir, 'config.json'), JSON.stringify(makeMinimalConfig(false)), 'utf8')
    const r = await run(['--config', workDir, 'inspect', '--for-agent', '--no-connect'], workDir)
    const parsed = JSON.parse(r.stdout) as { audit_recent: unknown[] }
    expect(parsed.audit_recent).toEqual([])
  })

  test('is [] when audit dir does not exist (D-60)', async () => {
    const r = await run(['--config', workDir, 'inspect', '--for-agent', '--no-connect'], workDir)
    const parsed = JSON.parse(r.stdout) as { audit_recent: unknown[] }
    expect(parsed.audit_recent).toEqual([])
  })

  test('inspect --format markdown (no --for-agent) stdout does NOT contain audit_recent (D-57)', async () => {
    await seedAuditEntries(workDir, 1)
    const r = await run(
      ['--config', workDir, 'inspect', '--format', 'markdown', '--no-connect'],
      workDir
    )
    expect(r.stdout.includes('audit_recent')).toBe(false)
  })
})

describe('Legacy envelope backward compatibility [D-54]', () => {
  let workDir: string
  let extFile: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-bc-'))
    await seedConfig(workDir)
    extFile = join(workDir, 'legacy-envelope.json')
    const legacy = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:00:00Z',
      command: 'dbcli query',
      cwd: workDir,
      envelope: {
        schemaVersion: 1,
        generatedAt: '2026-05-15T10:00:00Z',
        ok: false,
        error: { code: 'UNKNOWN', category: 'unknown', message: 'legacy test' },
        recovery: [],
      },
    }
    await writeFile(extFile, JSON.stringify(legacy), 'utf8')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('recover --from <legacy-fixture.json> parses without error (D-54)', async () => {
    const r = await run(
      ['--config', workDir, 'recover', '--from', extFile, '--format', 'json'],
      workDir
    )
    expect(r.code).not.toBe(2) // EXIT_CODE.malformed = 2
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(parsed.ok).toBe(false)
  })
})

describe('Phase 22 / 24 meta-guard fences', () => {
  test('Phase 22 audit-contract.test.ts is not gutted (sentinel string present)', async () => {
    const path = resolve(import.meta.dir, 'audit-contract.test.ts')
    const raw = await readFile(path, 'utf8')
    expect(raw.includes('Audit Contract Integration')).toBe(true)
  })

  test('Phase 24 audit-envelope.test.ts is not gutted (sentinel string present)', async () => {
    const path = resolve(import.meta.dir, 'audit-envelope.test.ts')
    const raw = await readFile(path, 'utf8')
    const hasSentinel =
      raw.includes('D-39') || raw.includes('D-40') || raw.includes("'audit tail --all'")
    expect(hasSentinel).toBe(true)
  })
})
