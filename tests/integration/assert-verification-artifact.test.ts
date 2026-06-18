import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDbReachable } from './helpers'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

// Connection from env with localhost postgres defaults; the suite skips when unreachable.
const CONN = {
  system: 'postgresql' as const,
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'postgres',
}

const TABLE = 'dbcli_assert_artifact_it'
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

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    // --config is a global option and must precede the subcommand
    const child = spawn('bun', ['run', CLI, '--config', WORK, ...args], { cwd: WORK, env: sanitizeEnv() })
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
  await adapter.execute(`DROP TABLE IF EXISTS ${TABLE}`)
  await adapter.execute(`CREATE TABLE ${TABLE} (id int, status int)`)
  // 3 rows with NULL status -> "count where status is null" == 3 (fail), and we can also assert == 0 etc.
  await adapter.execute(`INSERT INTO ${TABLE} (id, status) VALUES (1, NULL), (2, NULL), (3, NULL)`)
  await adapter.disconnect()

  WORK = await mkdtemp(join(tmpdir(), 'dbcli-assert-art-'))
  // Canonical config layout used by other integration tests: <work>/config.json
  // ( the assert command writes the artifact under <work>/.dbcli/verification/ ).
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

describe('dbcli assert --write-verification-artifact (integration)', () => {
  test('without the flag, output is unchanged and no artifact is written', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'assert',
      `SELECT count(*) AS n FROM ${TABLE} WHERE status IS NULL`,
      '--expect',
      'value == 3',
    ])
    const j = JSON.parse(stdout)
    expect(j.pass).toBe(true)
    expect(j.verificationArtifactPath).toBeUndefined()
    expect(code).toBe(0)
    expect(await listArtifacts()).toHaveLength(0)
  })

  test('passing assertion with the flag writes an artifact and emits verificationArtifactPath', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'assert',
      `SELECT count(*) AS n FROM ${TABLE} WHERE status IS NULL`,
      '--expect',
      'value == 3',
      '--write-verification-artifact',
      '--verification-subject',
      'backfill:safe-backfill-verify',
    ])
    const j = JSON.parse(stdout)
    expect(j.pass).toBe(true)
    expect(j.verificationArtifactPath).toContain('.dbcli/verification/')
    expect(code).toBe(0)
    const raw = JSON.parse(await readFile(j.verificationArtifactPath, 'utf8'))
    expect(raw.schemaVersion).toBe(1)
    expect(raw.status).toBe('verified')
    expect(raw.subject).toEqual({ kind: 'backfill', name: 'safe-backfill-verify' })
    expect(raw.evidence[0].kind).toBe('assert')
    expect(raw.evidence[0].exitCode).toBe(0)
  })

  test('failing assertion writes not_verified and exits 1', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'assert',
      `SELECT count(*) AS n FROM ${TABLE} WHERE status IS NULL`,
      '--expect',
      'value == 0',
      '--write-verification-artifact',
      '--verification-subject',
      'backfill:safe-backfill-verify',
    ])
    const j = JSON.parse(stdout)
    expect(j.pass).toBe(false)
    expect(code).toBe(1)
    const raw = JSON.parse(await readFile(j.verificationArtifactPath, 'utf8'))
    expect(raw.status).toBe('not_verified')
    expect(raw.evidence[0].exitCode).toBe(1)
  })

  test('--no-fail failing assertion exits 0 but artifact stays not_verified', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'assert',
      `SELECT count(*) AS n FROM ${TABLE} WHERE status IS NULL`,
      '--expect',
      'value == 0',
      '--no-fail',
      '--write-verification-artifact',
      '--verification-subject',
      'backfill:safe-backfill-verify',
    ])
    const j = JSON.parse(stdout)
    expect(j.pass).toBe(false)
    expect(code).toBe(0)
    const raw = JSON.parse(await readFile(j.verificationArtifactPath, 'utf8'))
    expect(raw.status).toBe('not_verified')
    expect(raw.evidence[0].exitCode).toBe(1)
  })

  test('malformed --verification-subject exits before connecting to the database', async () => {
    // No DB required: parse rejection happens before any connection attempt.
    const tmp = await mkdtemp(join(tmpdir(), 'dbcli-assert-bad-'))
    await writeFile(
      join(tmp, 'config.json'),
      JSON.stringify({
        connection: { system: 'postgresql', host: '203.0.113.1', port: 5432, user: 'u', password: 'p', database: 'd' },
        permission: 'query-only',
        metadata: { createdAt: '2026-06-19T00:00:00.000Z', version: '1.0' },
      }),
      'utf8'
    )
    // --config is a global option and must precede the subcommand
    const child = spawn(
      'bun',
      ['run', CLI, '--config', tmp, 'assert', 'SELECT 1', '--expect', 'rows > 0', '--write-verification-artifact', '--verification-subject', 'bogus:x'],
      { cwd: tmp, env: sanitizeEnv() }
    )
    let stderr = ''
    const code: number = await new Promise((res) => {
      child.stderr.on('data', (b) => (stderr += b.toString()))
      child.on('close', (c) => res(c ?? 0))
    })
    expect(stderr).toContain("Unknown verification subject kind 'bogus'")
    expect(code).toBe(1)
  })
})
