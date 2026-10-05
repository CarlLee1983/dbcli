/**
 * Postgres key columns and write-permission ordering
 * (specs/stories/postgres-schema-key-columns.md).
 *
 * `array_agg(attname)` is a `name[]`, which the `pg` driver returns as the
 * string "{id}", so the adapter used to report no key columns and the write
 * gate then refused every structured write as `non_unique_where`. These tests
 * run against the real `postgres` service of docker-compose.test.yml.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PostgreSQLAdapter } from 'src/adapters/postgresql-adapter'
import type { ConnectionOptions } from 'src/adapters/types'
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER, shouldSkipTests } from './helpers'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

const CONN: ConnectionOptions = {
  system: 'postgresql',
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
}

const PARENT = 'dbcli_pgkeys_parent_it'
const CHILD = 'dbcli_pgkeys_child_it'

const workDirs: string[] = []
let skip = false

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
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, '--config', cwd, ...args], {
      cwd,
      env: sanitizeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? -1 }))
  })
}

async function withAdapter<T>(fn: (a: PostgreSQLAdapter) => Promise<T>): Promise<T> {
  const adapter = new PostgreSQLAdapter(CONN)
  await adapter.connect()
  try {
    return await fn(adapter)
  } finally {
    await adapter.disconnect()
  }
}

async function seedRows(): Promise<void> {
  await withAdapter(async (a) => {
    await a.execute(`DELETE FROM ${CHILD}`)
    await a.execute(`DELETE FROM ${PARENT}`)
    await a.execute(
      `INSERT INTO ${PARENT} (id, email, status) VALUES (1, 'a@x.test', 'new'), (2, 'b@x.test', 'new'), (3, 'c@x.test', 'new')`
    )
  })
}

async function snapshot(): Promise<Array<{ id: number; status: string }>> {
  return withAdapter(async (a) => {
    const r = await a.execute<{ id: number; status: string }>(
      `SELECT id, status FROM ${PARENT} ORDER BY id`
    )
    return r.rows
  })
}

async function makeWork(permission: 'query-only' | 'read-write' | 'data-admin'): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-pgkeys-'))
  workDirs.push(work)
  await writeFile(
    join(work, 'config.json'),
    JSON.stringify({
      connection: CONN,
      permission,
      metadata: { createdAt: '2026-06-22T00:00:00.000Z', version: '1.0' },
      audit: { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
    }),
    'utf8'
  )
  return work
}

/** Every audit JSONL file under the config dir, wherever the logger put it. */
async function auditFiles(work: string): Promise<string[]> {
  return (await readdir(work, { recursive: true })).filter((n) => n.endsWith('.jsonl')).sort()
}

async function auditText(work: string): Promise<string> {
  const parts = await Promise.all(
    (await auditFiles(work)).map((n) => readFile(join(work, n), 'utf8'))
  )
  return parts.join('\n')
}

beforeAll(async () => {
  skip = await shouldSkipTests(CONN)
  if (skip) return
  await withAdapter(async (a) => {
    await a.execute(`DROP TABLE IF EXISTS ${CHILD}`)
    await a.execute(`DROP TABLE IF EXISTS ${PARENT}`)
    await a.execute(`CREATE TABLE ${PARENT} (id int PRIMARY KEY, email text UNIQUE, status text)`)
    await a.execute(
      `CREATE TABLE ${CHILD} (id int PRIMARY KEY, parent_id int, CONSTRAINT ${CHILD}_parent_fk FOREIGN KEY (parent_id) REFERENCES ${PARENT} (id))`
    )
  })
})

afterAll(async () => {
  if (!skip) {
    await withAdapter(async (a) => {
      await a.execute(`DROP TABLE IF EXISTS ${CHILD}`)
      await a.execute(`DROP TABLE IF EXISTS ${PARENT}`)
    })
  }
  await Promise.all(workDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('PostgreSQLAdapter.getTableSchema key columns (AC 1)', () => {
  test('reports primary key, unique index columns and foreign key columns', async () => {
    if (skip) return
    await withAdapter(async (a) => {
      const parent = await a.getTableSchema(PARENT)
      expect(parent.primaryKey).toEqual(['id'])
      const unique = parent.indexes!.find((i) => i.unique)
      expect(unique?.columns).toEqual(['email'])

      const child = await a.getTableSchema(CHILD)
      expect(child.primaryKey).toEqual(['id'])
      expect(child.foreignKeys!).toHaveLength(1)
      expect(child.foreignKeys![0]!.columns).toEqual(['parent_id'])
      expect(child.foreignKeys![0]!.refTable).toBe(PARENT)
      expect(child.foreignKeys![0]!.refColumns).toEqual(['id'])
      const col = child.columns.find((c) => c.name === 'parent_id')
      expect(col?.foreignKey).toEqual({ table: PARENT, column: 'id' })
    })
  })
})

describe('read-write update/delete without a terminal', () => {
  test('update by primary key changes exactly that row (AC 2)', async () => {
    if (skip) return
    await seedRows()
    const work = await makeWork('read-write')
    const r = await run(
      ['update', PARENT, '--where', 'id = 2', '--set', '{"status":"done"}', '--force'],
      work
    )
    expect(r.code).toBe(0)
    expect(await snapshot()).toEqual([
      { id: 1, status: 'new' },
      { id: 2, status: 'done' },
      { id: 3, status: 'new' },
    ])
  })

  test('delete by primary key removes exactly that row (AC 2)', async () => {
    if (skip) return
    await seedRows()
    const work = await makeWork('data-admin')
    const r = await run(['delete', PARENT, '--where', 'id = 2', '--force'], work)
    expect(r.code).toBe(0)
    expect((await snapshot()).map((x) => x.id)).toEqual([1, 3])
  })

  test('update on a non-unique column is refused as non_unique_where (AC 3)', async () => {
    if (skip) return
    await seedRows()
    const work = await makeWork('read-write')
    const r = await run(
      ['update', PARENT, '--where', "status = 'new'", '--set', '{"status":"x"}'],
      work
    )
    expect(r.code).not.toBe(0)
    expect(await snapshot()).toHaveLength(3)
    expect((await snapshot()).every((x) => x.status === 'new')).toBe(true)
    expect(await auditText(work)).toContain('non_unique_where')
  })

  test('delete on a non-unique column is refused as non_unique_where (AC 3)', async () => {
    if (skip) return
    await seedRows()
    const work = await makeWork('data-admin')
    const r = await run(['delete', PARENT, '--where', "status = 'new'"], work)
    expect(r.code).not.toBe(0)
    expect(await snapshot()).toHaveLength(3)
    expect(await auditText(work)).toContain('non_unique_where')
  })
})

describe('query-only update/delete are refused for permission, not the gate (AC 4)', () => {
  const cases: Array<{ command: 'update' | 'delete'; where: string; label: string }> = [
    { command: 'update', where: 'id = 2', label: 'primary key' },
    { command: 'update', where: "status = 'new'", label: 'non-unique column' },
    { command: 'delete', where: 'id = 2', label: 'primary key' },
    { command: 'delete', where: "status = 'new'", label: 'non-unique column' },
  ]

  for (const { command, where, label } of cases) {
    test(`${command} where ${label}`, async () => {
      if (skip) return
      await seedRows()
      const work = await makeWork('query-only')
      const args =
        command === 'update'
          ? ['update', PARENT, '--where', where, '--set', '{"status":"x"}']
          : ['delete', PARENT, '--where', where]
      const r = await run(args, work)
      const out = r.stdout + r.stderr

      expect(r.code).not.toBe(0)
      expect(out).toContain(
        command === 'update'
          ? 'UPDATE operation requires read-write permission or higher (current level: query-only)'
          : 'Delete command requires data-admin or admin permission'
      )
      expect(await snapshot()).toEqual([
        { id: 1, status: 'new' },
        { id: 2, status: 'new' },
        { id: 3, status: 'new' },
      ])
      // The refusal itself is audited (success:false, with the permission
      // error). Asserting that record exists keeps the 'write_gate' absence
      // check below from passing vacuously on an unread or empty audit log.
      const entries = (await auditText(work))
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as { command: string; success: boolean; error?: string })
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ command, success: false })
      expect(entries[0]!.error).toContain(
        command === 'update' ? 'requires read-write permission' : 'requires data-admin'
      )
      expect(await auditText(work)).not.toContain('write_gate')
    })
  }
})
