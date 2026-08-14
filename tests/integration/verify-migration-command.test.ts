import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDbReachable, PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE } from './helpers'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

const CONN = {
  system: 'postgresql' as const,
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
}

const TABLE = 'dbcli_verify_migration_it'
// Column `status` already exists; the DDL "adds" a column that is never executed.
const DDL = `ALTER TABLE ${TABLE} ADD COLUMN never_added int`
const VERIFY = `SELECT count(*)::int AS n FROM ${TABLE} WHERE status IS NULL`
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
    await adapter.execute(
      `INSERT INTO ${TABLE} (id, status) VALUES (1, NULL), (2, NULL), (3, NULL)`
    )
    await adapter.disconnect()

    WORK = await mkdtemp(join(tmpdir(), 'dbcli-verify-mig-'))
    await writeFile(
      join(WORK, 'config.json'),
      JSON.stringify({
        connection: CONN,
        permission: 'query-only',
        metadata: { createdAt: '2026-06-20T00:00:00.000Z', version: '1.0' },
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

describe('dbcli verify migration (integration)', () => {
  test('preflight --format json has the stable migration shape and writes no artifact', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'migration',
      '--table',
      TABLE,
      '--ddl',
      DDL,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 3',
      '--format',
      'json',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.scenario).toBe('migration')
    expect(j.mode).toBe('preflight')
    expect(j.status).toBe('ready')
    expect(j.table).toBe(TABLE)
    expect(j.plannedDdl).toBe(DDL)
    expect(j.guards.map((g: { name: string }) => g.name)).toEqual([
      'blacklist',
      'schema',
      'ddl',
      'verify-query-readonly',
    ])
    expect(j.afterWriteCommand).toContain('--after-write')
    expect(await listArtifacts()).toHaveLength(0)
  })

  test('after-write success writes a migration artifact (DDL never executed)', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'migration',
      '--table',
      TABLE,
      '--ddl',
      DDL,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 3',
      '--after-write',
      '--evidence-receipt',
      'evidence/migration-receipt.json',
      '--format',
      'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(0)
    expect(j.status).toBe('verified')
    expect(j.evidenceReceiptPath).toContain('evidence/migration-receipt.json')
    expect(j.artifact.id).toBeTruthy()
    expect(j.artifact.subject.kind).toBe('migration')
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.schemaVersion).toBe(1)
    const receipt = JSON.parse(await readFile(j.evidenceReceiptPath, 'utf8'))
    expect(receipt.operation).toBe('verify')
    expect(receipt.outcome).toBe('succeeded')
    expect(JSON.stringify(receipt)).not.toContain(DDL)
    // The DDL was never executed: the "never_added" column must not exist.
    const probe = await run([
      'query',
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = '${TABLE}' AND column_name = 'never_added'`,
      '--no-limit',
      '--format',
      'json',
    ])
    expect(JSON.parse(probe.stdout).rows[0].n).toBe(0)
  })

  test('after-write assertion failure exits 1 and writes not_verified', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'migration',
      '--table',
      TABLE,
      '--ddl',
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
    expect(code).toBe(1)
    expect(j.status).toBe('not_verified')
  })

  test('non-ALTER DDL is blocked with a bounded reason', async () => {
    if (!DB_OK) return
    for (const ddl of [
      `CREATE TABLE ${TABLE}_x (id int)`,
      `DROP TABLE ${TABLE}`,
      `CREATE INDEX idx_${TABLE} ON ${TABLE} (id)`,
      `ALTER TABLE ${TABLE} ADD COLUMN a int; DROP TABLE ${TABLE}`,
    ]) {
      const { stdout, code } = await run([
        'verify',
        'migration',
        '--table',
        TABLE,
        '--ddl',
        ddl,
        '--verify-query',
        VERIFY,
        '--expect',
        'value == 3',
        '--after-write',
        '--format',
        'json',
      ])
      const j = JSON.parse(stdout)
      expect(code).toBe(1)
      expect(j.status).toBe('blocked')
      const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
      expect((raw.blockedReason ?? '').length).toBeGreaterThan(0)
    }
  })

  test('DDL targeting a different table than --table is blocked', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'migration',
      '--table',
      TABLE,
      '--ddl',
      `ALTER TABLE ${TABLE}_other ADD COLUMN a int`,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 3',
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

  test('DDL with an unparsable ALTER TABLE target is blocked with a contract reason', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'migration',
      '--table',
      TABLE,
      '--ddl',
      `ALTER TABLE "${TABLE} ADD COLUMN a int`, // unterminated double-quoted target
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 3',
      '--after-write',
      '--format',
      'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(1)
    expect(j.status).toBe('blocked')
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.blockedReason).toContain('could not be parsed')
    expect(raw.blockedReason).not.toContain('must match --table')
  })

  test('EXPLAIN / data-modifying verify-query is blocked', async () => {
    if (!DB_OK) return
    const { stdout, code } = await run([
      'verify',
      'migration',
      '--table',
      TABLE,
      '--ddl',
      DDL,
      '--verify-query',
      `EXPLAIN ANALYZE UPDATE ${TABLE} SET status = 9 WHERE id = 1`,
      '--expect',
      'rows == 0',
      '--after-write',
      '--format',
      'json',
    ])
    const j = JSON.parse(stdout)
    expect(code).toBe(1)
    expect(j.status).toBe('blocked')
    const raw = JSON.parse(await readFile(j.artifact.path, 'utf8'))
    expect(raw.blockedReason).toContain('plain SELECT')
  })

  test('verification list --subject migration:<table> finds the artifact', async () => {
    if (!DB_OK) return
    await run([
      'verify',
      'migration',
      '--table',
      TABLE,
      '--ddl',
      DDL,
      '--verify-query',
      VERIFY,
      '--expect',
      'value == 3',
      '--after-write',
      '--format',
      'json',
    ])
    const { stdout, code } = await run([
      'verification',
      'list',
      '--subject',
      `migration:${TABLE}`,
      '--format',
      'json',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.artifacts.length).toBeGreaterThan(0)
    expect(
      j.artifacts.every((a: { subject: { kind: string } }) => a.subject.kind === 'migration')
    ).toBe(true)
  })

  test('artifacts do not persist raw DDL/verify-query/expect literals', async () => {
    if (!DB_OK) return
    const { stdout } = await run([
      'verify',
      'migration',
      '--table',
      TABLE,
      '--ddl',
      `ALTER TABLE ${TABLE} ADD COLUMN token text DEFAULT 'topsecret'`,
      '--verify-query',
      `SELECT count(*)::int AS n FROM ${TABLE} WHERE id = 12345`,
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
    expect(raw).not.toContain('sensitive-literal')
    expect(raw).not.toContain(String(CONN.port))
    expect(raw).not.toContain(CONN.password)
  })
})
