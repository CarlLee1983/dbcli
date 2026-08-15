import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { isDbReachable, PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE } from '../helpers'

// It wanted "a real PostgreSQL", and the compose stack is one. Gating on an
// operator-supplied server meant this never ran anywhere, including CI.
const SKIP = !(await isDbReachable(PG_HOST, PG_PORT))
const cliPath = join(import.meta.dir, '..', '..', '..', 'src', 'cli.ts')

describe.skipIf(SKIP)('dbcli q (live PostgreSQL)', () => {
  let workdir = ''

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'q-live-'))
    mkdirSync(join(workdir, '.dbcli-shared/queries'), { recursive: true })
    writeFileSync(
      join(workdir, '.dbcli-shared/queries/one.sql'),
      `-- ---\n-- name: one\n-- engine: postgres\n-- params:\n--   v:\n--     type: int\n--     default: 1\n-- ---\nSELECT :v AS x;`
    )
    writeFileSync(
      join(workdir, '.dbcli-shared/queries/cte.sql'),
      `-- ---\n-- name: cte\n-- engine: postgres\n-- ---\nWITH src AS (SELECT 7 AS x) SELECT x FROM src;`
    )
    writeFileSync(
      join(workdir, '.dbcli'),
      JSON.stringify({
        connection: {
          system: 'postgresql',
          host: PG_HOST,
          port: PG_PORT,
          user: PG_USER,
          password: PG_PASSWORD,
          database: PG_DATABASE,
        },
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' },
      })
    )
  })

  test('default param returns 1', () => {
    const r = spawnSync('bun', ['run', cliPath, 'q', '@one', '--format', 'json'], {
      cwd: workdir,
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    // A string, not a number: PostgreSQL types an untyped parameter as text
    // (`EXPLAIN VERBOSE` on `SELECT $1 AS x` shows `'1'::text`), so this is
    // what the snippet returns. The assertion said `1` and had never been run
    // against a server to find out.
    expect(out.rows).toEqual([{ x: '1' }])
  })

  // The live half of the permission check added in issue #81 — the same CTE
  // shape as the unit test, but against a real server, so the statement the
  // guard classified is also the statement PostgreSQL accepted.
  test('read-only CTE snippet still runs on a query-only connection', () => {
    const r = spawnSync('bun', ['run', cliPath, 'q', '@cte', '--format', 'json'], {
      cwd: workdir,
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).rows).toEqual([{ x: 7 }])
  })

  test('--param overrides', () => {
    const r = spawnSync(
      'bun',
      ['run', cliPath, 'q', '@one', '--param', 'v=42', '--format', 'json'],
      {
        cwd: workdir,
        encoding: 'utf8',
      }
    )
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).rows).toEqual([{ x: '42' }])
  })
})
