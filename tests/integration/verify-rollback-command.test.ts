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

const TABLE = 'dbcli_verify_rollback_it'
// A reverting ALTER TABLE that is analyzed but never executed.
const DDL = `ALTER TABLE ${TABLE} DROP COLUMN never_dropped`
// A reverting UPDATE that is analyzed but never executed.
const DML = `UPDATE ${TABLE} SET status = NULL WHERE status = 9`
// All seeded rows have status NULL, so "no rows with status = 9" holds.
const VERIFY = `SELECT count(*)::int AS n FROM ${TABLE} WHERE status = 9`
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

function run(
  args: string[],
  cwd = WORK
): Promise<{ stdout: string; stderr: string; code: number }> {
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
    await adapter.execute(`INSERT INTO ${TABLE} (id, status) VALUES (1, NULL), (2, NULL), (3, NULL)`)
    await adapter.disconnect()

    WORK = await mkdtemp(join(tmpdir(), 'dbcli-verify-rb-'))
    await writeFile(
      join(WORK, 'config.json'),
      JSON.stringify({
        connection: CONN,
        permission: 'query-only',
        metadata: { createdAt: '2026-06-22T00:00:00.000Z', version: '1.0' },
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

describe('dbcli verify rollback (integration)', () => {
  test('ddl preflight json has the stable rollback shape and writes no artifact', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'rollback',
      '--kind',
      'ddl',
      '--table',
      TABLE,
      '--statement',
      DDL,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 0',
      '--format',
      'json',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.scenario).toBe('rollback')
    expect(j.mode).toBe('preflight')
    expect(j.status).toBe('ready')
    expect(j.kind).toBe('ddl')
    expect(j.table).toBe(TABLE)
    expect(j.plannedStatement).toBe(DDL)
    expect(j.guards.map((g: { name: string }) => g.name)).toEqual([
      'blacklist',
      'schema',
      'ddl',
      'verify-query-readonly',
    ])
    expect(j.afterWriteCommand).toContain('--after-write')
    expect(await listArtifacts()).toHaveLength(0)
  })

  test('dml preflight uses the plan guard and reports kind=dml', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'rollback',
      '--kind',
      'dml',
      '--table',
      TABLE,
      '--statement',
      DML,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 0',
      '--format',
      'json',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.kind).toBe('dml')
    expect(j.guards.map((g: { name: string }) => g.name)).toEqual([
      'blacklist',
      'schema',
      'plan',
      'verify-query-readonly',
    ])
  })

  test('ddl after-write success writes a migration-subject artifact (statement never executed)', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'rollback',
      '--kind',
      'ddl',
      '--table',
      TABLE,
      '--statement',
      DDL,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 0',
      '--after-write',
      '--format',
      'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(0)
    expect(j.status).toBe('verified')
    expect(j.artifact.subject.kind).toBe('migration')
    expect(j.artifact.subject.command).toBe('verify rollback')
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.schemaVersion).toBe(1)
    // The DROP COLUMN was never executed: the `status` column must still exist.
    const probe = await run([
      'query',
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = '${TABLE}' AND column_name = 'status'`,
      '--no-limit',
      '--format',
      'json',
    ])
    expect(JSON.parse(probe.stdout).rows[0].n).toBe(1)
  })

  test('dml after-write success writes a backfill-subject artifact', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'rollback',
      '--kind',
      'dml',
      '--table',
      TABLE,
      '--statement',
      DML,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 0',
      '--after-write',
      '--format',
      'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(0)
    expect(j.status).toBe('verified')
    expect(j.artifact.subject.kind).toBe('backfill')
    expect(j.artifact.subject.command).toBe('verify rollback')
  })

  test('an invalid --kind fails closed with exit 1 before any DB connection', async () => {
    if (!DB_OK) return
    const { stderr, code } = await run([
      'verify',
      'rollback',
      '--kind',
      'schema',
      '--table',
      TABLE,
      '--statement',
      DDL,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 0',
    ])
    expect(code).toBe(1)
    expect(stderr).toContain("Invalid --kind 'schema'")
  })

  test('ddl: a non-ALTER statement is blocked with a bounded reason', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'rollback',
      '--kind',
      'ddl',
      '--table',
      TABLE,
      '--statement',
      `DROP TABLE ${TABLE}`,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 0',
      '--after-write',
      '--format',
      'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(1)
    expect(j.status).toBe('blocked')
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.blockedReason).toContain('ALTER TABLE')
  })

  test('dml: a non-UPDATE statement is blocked', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'rollback',
      '--kind',
      'dml',
      '--table',
      TABLE,
      '--statement',
      `DELETE FROM ${TABLE} WHERE id = 1`,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 0',
      '--after-write',
      '--format',
      'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(1)
    expect(j.status).toBe('blocked')
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.blockedReason).toContain('UPDATE')
  })

  test('a statement targeting a different table than --table is blocked', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'rollback',
      '--kind',
      'ddl',
      '--table',
      TABLE,
      '--statement',
      `ALTER TABLE ${TABLE}_other DROP COLUMN status`,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 0',
      '--after-write',
      '--format',
      'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(1)
    expect(j.status).toBe('blocked')
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.blockedReason).toContain('must match --table')
  })

  test('artifacts do not persist raw statement / verify-query / expect literals', async () => {
    if (!DB_OK) return
    const { stdout } = await run([
      'verify',
      'rollback',
      '--kind',
      'dml',
      '--table',
      TABLE,
      '--statement',
      `UPDATE ${TABLE} SET token = 'topsecret' WHERE id = 12345`,
      '--verify-query',
      `SELECT count(*)::int AS n FROM ${TABLE} WHERE id = 67890`,
      '--expect',
      "value == 'sensitive-literal'",
      '--after-write',
      '--format',
      'json',
    ])
    const j = JSON.parse(stdout)
    const raw = await readFile(j.artifact.path, 'utf8')
    expect(raw).not.toContain('topsecret')
    expect(raw).not.toContain('12345')
    expect(raw).not.toContain('67890')
    expect(raw).not.toContain('sensitive-literal')
    expect(raw).not.toContain(String(CONN.port))
    expect(raw).not.toContain(CONN.password)
  })
})
