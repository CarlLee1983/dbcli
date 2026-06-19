import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDbReachable } from './helpers'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

const CONN = {
  system: 'postgresql' as const,
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'postgres',
}

const TABLE = 'dbcli_verify_safe_backfill_it'
const UPDATE_SQL = `UPDATE ${TABLE} SET status = 1 WHERE status IS NULL`
let WORK = ''
let DB_OK = false

function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(k)) continue
    out[k] = v
  }
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

function run(args: string[], cwd = WORK): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, '--config', cwd, ...args], { cwd, env: sanitizeEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

async function listArtifacts(): Promise<string[]> {
  try {
    return await readdir(join(WORK, '.dbcli', 'verification'))
  } catch {
    return []
  }
}

beforeAll(async () => {
  DB_OK = await isDbReachable(CONN.host, CONN.port)
  if (!DB_OK) return
  const { AdapterFactory } = await import('@/adapters')
  const adapter = AdapterFactory.createSqlAdapter(CONN)
  try {
    await adapter.connect()
  } catch {
    DB_OK = false
    return
  }
  try {
    await adapter.execute(`DROP TABLE IF EXISTS ${TABLE}`)
    await adapter.execute(`CREATE TABLE ${TABLE} (id int, status int)`)
    // 3 rows with NULL status: the read-back "count where status is null" is 3 here
    // (the scenario never runs the UPDATE, so the count stays 3 for the test).
    await adapter.execute(`INSERT INTO ${TABLE} (id, status) VALUES (1, NULL), (2, NULL), (3, NULL)`)
    await adapter.disconnect()

    WORK = await mkdtemp(join(tmpdir(), 'dbcli-verify-sbf-'))
    await writeFile(
      join(WORK, 'config.json'),
      JSON.stringify({
        connection: CONN,
        permission: 'query-only',
        metadata: { createdAt: '2026-06-19T00:00:00.000Z', version: '1.0' },
        audit: { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
      }),
      'utf8'
    )
  } catch {
    DB_OK = false
    await adapter.disconnect().catch(() => {})
  }
})

afterAll(async () => {
  if (!DB_OK) return
  const { AdapterFactory } = await import('@/adapters')
  const adapter = AdapterFactory.createSqlAdapter(CONN)
  try {
    await adapter.connect()
    await adapter.execute(`DROP TABLE IF EXISTS ${TABLE}`)
    await adapter.disconnect()
  } catch {
    /* best effort */
  }
})

describe('dbcli verify safe-backfill (integration)', () => {
  test('preflight prints the after-write command and writes no artifact', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify', 'safe-backfill',
      '--table', TABLE,
      '--query', UPDATE_SQL,
      '--verify-query', `SELECT count(*)::int AS n FROM ${TABLE} WHERE status IS NULL`,
      '--expect', 'value == 3',
    ])
    expect(code).toBe(0)
    expect(stdout).toContain('--after-write')
    expect(await listArtifacts()).toHaveLength(0)
  })

  test('preflight --format json returns stable shape', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify', 'safe-backfill',
      '--table', TABLE,
      '--query', UPDATE_SQL,
      '--verify-query', `SELECT count(*)::int AS n FROM ${TABLE} WHERE status IS NULL`,
      '--expect', 'value == 3',
      '--format', 'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(0)
    expect(j.scenario).toBe('safe-backfill')
    expect(j.mode).toBe('preflight')
    expect(j.status).toBe('ready')
    expect(j.table).toBe(TABLE)
    expect(j.guards.map((g: { name: string }) => g.name)).toEqual([
      'blacklist', 'schema', 'plan', 'verify-query-readonly',
    ])
    expect(j.afterWriteCommand).toContain('--after-write')
  })

  test('after-write success writes a verified artifact', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify', 'safe-backfill',
      '--table', TABLE,
      '--query', UPDATE_SQL,
      '--verify-query', `SELECT count(*)::int AS n FROM ${TABLE} WHERE status IS NULL`,
      '--expect', 'value == 3',
      '--after-write',
      '--format', 'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(0)
    expect(j.status).toBe('verified')
    expect(j.artifact.path).toContain('.dbcli/verification/')
    expect(j.artifact.subject).toEqual({ kind: 'backfill', name: TABLE, command: 'verify safe-backfill' })
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.schemaVersion).toBe(1)
    expect(raw.status).toBe('verified')
    expect(raw.evidence.map((e: { kind: string }) => e.kind)).toContain('task-pack-plan')
  })

  test('after-write assertion failure exits 1 and writes not_verified', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify', 'safe-backfill',
      '--table', TABLE,
      '--query', UPDATE_SQL,
      '--verify-query', `SELECT count(*)::int AS n FROM ${TABLE} WHERE status IS NULL`,
      '--expect', 'value == 0',
      '--after-write',
      '--format', 'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(1)
    expect(j.status).toBe('not_verified')
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.status).toBe('not_verified')
  })

  test('after-write with a non-read-only verify-query is blocked and writes a blocked artifact', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify', 'safe-backfill',
      '--table', TABLE,
      '--query', UPDATE_SQL,
      '--verify-query', `UPDATE ${TABLE} SET status = 9 WHERE id = 1`,
      '--expect', 'rows == 0',
      '--after-write',
      '--format', 'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(1)
    expect(j.status).toBe('blocked')
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.status).toBe('blocked')
    expect(raw.blockedReason).toContain('read-only')
  })

  test('invalid --format fails before running guards', async () => {
    if (!DB_OK) return
    const { stderr, code } = await run([
      'verify', 'safe-backfill',
      '--table', TABLE,
      '--query', UPDATE_SQL,
      '--verify-query', `SELECT 1`,
      '--expect', 'rows > 0',
      '--format', 'csv',
    ])
    expect(code).toBe(1)
    expect(stderr).toContain("Invalid --format 'csv'")
  })

  test('missing --expect fails before running guards', async () => {
    if (!DB_OK) return
    const { stderr, code } = await run([
      'verify', 'safe-backfill',
      '--table', TABLE,
      '--query', UPDATE_SQL,
      '--verify-query', `SELECT 1`,
    ])
    expect(code).toBe(1)
    // Commander's required-option error.
    expect(stderr.toLowerCase()).toContain('required')
  })

  test('verification list --subject backfill:<table> finds the written artifact', async () => {
    if (!DB_OK) return
    // Ensure at least one artifact exists from the success case above.
    await run([
      'verify', 'safe-backfill',
      '--table', TABLE,
      '--query', UPDATE_SQL,
      '--verify-query', `SELECT count(*)::int AS n FROM ${TABLE} WHERE status IS NULL`,
      '--expect', 'value == 3',
      '--after-write',
      '--format', 'json',
    ])
    const { stdout, code } = await run([
      'verification', 'list', '--subject', `backfill:${TABLE}`, '--format', 'json',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.artifacts.length).toBeGreaterThan(0)
    expect(j.artifacts.every((a: { subject: { kind: string } }) => a.subject.kind === 'backfill')).toBe(true)
  })
})
