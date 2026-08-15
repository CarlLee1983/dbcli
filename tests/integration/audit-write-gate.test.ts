/**
 * `dbcli audit write-gate` — integration tests (issue #79).
 *
 * ADR 0010 justifies the tier-two gate on a measurement rather than on an
 * argument, and until now taking that measurement meant hand-writing jq over
 * `.dbcli/audit/*.jsonl`. These tests spawn the real CLI over synthetic audit
 * files, so what is asserted is the number an auditor would actually read —
 * not the mapping that produces it.
 */
import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

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

let seq = 0

/** A gate decision as `recordGateDecision` writes it. */
function decision(
  ts: string,
  tier: 'one' | 'two',
  outcome: string,
  reason: string
): Record<string, unknown> {
  return {
    id: `${String(++seq).padStart(8, '0')}-uuid`,
    ts,
    session_id: 'test-session',
    engine: 'postgresql',
    command: 'delete',
    side_effect_tier: 'db-write',
    target: 'users',
    success: outcome === 'allowed',
    redacted_query: 'dbcli delete users',
    metadata: {
      write_gate_tier: tier,
      write_gate_outcome: outcome,
      write_gate_reason: reason,
      connection_name: 'default',
    },
  }
}

/** An ordinary read: it widens the window without being a decision. */
function plain(ts: string): Record<string, unknown> {
  return {
    id: `${String(++seq).padStart(8, '0')}-uuid`,
    ts,
    session_id: 'test-session',
    engine: 'postgresql',
    command: 'query',
    side_effect_tier: 'readonly',
    target: 'users',
    success: true,
    redacted_query: 'dbcli query ?',
    metadata: { connection_name: 'default' },
  }
}

async function seed(files: Record<string, Array<Record<string, unknown>>>): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-write-gate-'))
  const auditDir = join(work, '.dbcli', 'audit')
  await mkdir(auditDir, { recursive: true })
  await writeFile(
    join(work, 'config.json'),
    JSON.stringify({
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
    })
  )
  for (const [name, entries] of Object.entries(files)) {
    const body = entries.length === 0 ? '' : entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(join(auditDir, name), body)
  }
  return work
}

describe('dbcli audit write-gate', () => {
  test('counts outcomes and reasons across the retained history', async () => {
    const work = await seed({
      // Rotated out, but still a decision the criterion made — a summary that
      // ignored the rotated file would shrink every time the log rolled over.
      'default.jsonl.1': [decision('2026-01-01T00:00:00.000Z', 'two', 'allowed', 'no_where')],
      'default.jsonl': [
        plain('2026-01-05T00:00:00.000Z'),
        decision('2026-02-01T00:00:00.000Z', 'two', 'declined', 'no_where'),
        decision('2026-02-02T00:00:00.000Z', 'two', 'refused', 'unparseable'),
        decision('2026-02-03T00:00:00.000Z', 'one', 'declined', 'no_where'),
      ],
    })

    const r = await run(['audit', 'write-gate', '--format', 'json'], work)
    expect(r.code).toBe(0)
    const { connections, summary } = JSON.parse(r.stdout)

    expect(connections).toEqual(['default'])
    expect(summary.total).toBe(3)
    expect(summary.outcomes).toEqual({ allowed: 1, declined: 1, refused: 1 })
    expect(summary.reasons.no_where).toBe(2)
    expect(summary.reasons.unparseable).toBe(1)
    expect(summary.tierOne).toEqual({ total: 1, outcomes: { declined: 1 } })
    expect(summary.scanned).toBe(5)
    expect(summary.range).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-02T00:00:00.000Z',
    })
  })

  test('table output names the three numbers that decide the question', async () => {
    const work = await seed({
      'default.jsonl': [
        decision('2026-02-01T00:00:00.000Z', 'two', 'allowed', 'no_where'),
        decision('2026-02-02T00:00:00.000Z', 'two', 'declined', 'ddl_destruction'),
      ],
    })

    const r = await run(['audit', 'write-gate'], work)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('Tier-two evaluations: 2')
    expect(r.stdout).toMatch(/allowed\s+1/)
    expect(r.stdout).toMatch(/declined\s+1/)
    expect(r.stdout).toMatch(/refused\s+0/)
    // A reason nobody triggered is the finding ADR 0010 asks for, so it stays
    // on the table at zero rather than being omitted.
    expect(r.stdout).toMatch(/unparseable\s+0/)
  })

  // The empty case is the one the ADR actually predicts, so it has to read as a
  // stated result rather than as a blank table.
  test('no decisions is reported as a finding about the criterion', async () => {
    const work = await seed({
      'default.jsonl': [plain('2026-01-01T00:00:00.000Z'), plain('2026-04-01T00:00:00.000Z')],
    })

    const r = await run(['audit', 'write-gate'], work)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('never reached')
    expect(r.stdout).toContain('falsifies the criterion')
    // The window is what makes "six months" statable instead of a figure of speech.
    expect(r.stdout).toContain('2026-01-01T00:00:00.000Z')
    expect(r.stdout).toContain('2026-04-01T00:00:00.000Z')
  })

  test('an empty log says so instead of claiming the gate went untouched', async () => {
    const work = await seed({ 'default.jsonl': [] })
    const r = await run(['audit', 'write-gate'], work)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('audit log is empty')
    expect(r.stdout).not.toContain('falsifies the criterion')
  })

  test('--all merges every connection into one measurement', async () => {
    const work = await seed({
      'default.jsonl': [decision('2026-02-01T00:00:00.000Z', 'two', 'allowed', 'no_where')],
      'staging.jsonl': [decision('2026-02-02T00:00:00.000Z', 'two', 'declined', 'no_where')],
    })

    const r = await run(['audit', 'write-gate', '--all', '--for-agent'], work)
    expect(r.code).toBe(0)
    const { connections, summary } = JSON.parse(r.stdout)
    expect(connections).toEqual(['default', 'staging'])
    expect(summary.total).toBe(2)
    expect(summary.outcomes).toEqual({ allowed: 1, declined: 1, refused: 0 })
  })
})
