/**
 * `--no-limit` must survive the CLI boundary.
 *
 * Commander turns the flag into `limit: false`; before normalization `query`
 * rejected it as an invalid row count and `q` / `export` ignored it entirely.
 * These run the real binary so the whole option path is exercised — the
 * connection is unreachable on purpose, so reaching a connection error proves
 * the flag was accepted rather than rejected during parsing.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let workspace: string
let configDir: string

async function run(args: string[]) {
  const env = { ...process.env, NODE_ENV: 'test', DBCLI_NO_UPDATE_CHECK: '1' }
  delete env.DBCLI_CONNECTION
  const child = Bun.spawn({
    cmd: ['bun', 'run', CLI, '--config', configDir, ...args],
    cwd: workspace,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-no-limit-'))
  configDir = join(workspace, '.dbcli')
  await mkdir(configDir, { recursive: true })
  await Bun.write(
    join(configDir, 'config.json'),
    JSON.stringify({
      version: 2,
      default: 'primary',
      connections: {
        primary: {
          system: 'postgresql',
          host: 'primary.invalid',
          port: 5432,
          user: 'test',
          password: 'test',
          database: 'primary',
        },
      },
      schema: {},
      metadata: { version: '2.0' },
    })
  )
})

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('--no-limit is accepted, not parsed as a row count', () => {
  test('query --no-limit is not rejected as an invalid limit', async () => {
    const { stderr } = await run(['query', 'SELECT 1', '--no-limit'])
    expect(stderr).not.toContain('--limit must be a positive integer')
  })

  test('export --no-limit is not rejected as an invalid limit', async () => {
    const { stderr } = await run(['export', 'SELECT 1', '--no-limit', '--format', 'json'])
    expect(stderr).not.toContain('--limit must be a positive integer')
  })

  test('query --limit 0 is still rejected', async () => {
    const { stderr, code } = await run(['query', 'SELECT 1', '--limit', '0'])
    expect(stderr).toContain('positive integer')
    expect(code).not.toBe(0)
  })

  test('query --limit 5 is still accepted', async () => {
    const { stderr } = await run(['query', 'SELECT 1', '--limit', '5'])
    expect(stderr).not.toContain('positive integer')
  })
})
