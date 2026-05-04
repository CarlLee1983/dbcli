import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SKIP = !process.env.DBCLI_LIVE_PG_HOST
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
      join(workdir, '.dbcli'),
      JSON.stringify({
        connection: {
          system: 'postgresql',
          host: process.env.DBCLI_LIVE_PG_HOST,
          port: Number(process.env.DBCLI_LIVE_PG_PORT ?? 5432),
          user: process.env.DBCLI_LIVE_PG_USER,
          password: process.env.DBCLI_LIVE_PG_PASSWORD ?? '',
          database: process.env.DBCLI_LIVE_PG_DATABASE,
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
    expect(out.rows).toEqual([{ x: 1 }])
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
    expect(JSON.parse(r.stdout).rows).toEqual([{ x: 42 }])
  })
})
