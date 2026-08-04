import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let workspace: string
let configPath: string

async function run(args: string[]) {
  const processHandle = Bun.spawn({
    cmd: ['bun', 'run', CLI, ...args],
    cwd: workspace,
    env: { ...process.env, NODE_ENV: 'test', DBCLI_NO_UPDATE_CHECK: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ])
  return { stdout, stderr, code }
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-blacklist-format-'))
  configPath = join(workspace, '.dbcli')
  await Bun.write(
    configPath,
    JSON.stringify({
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'testdb',
      },
      permission: 'query-only',
      blacklist: { tables: ['audit_logs'], columns: { users: ['password'] } },
    })
  )
})

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('blacklist list JSON output', () => {
  test('advertises and emits the documented machine-readable contract', async () => {
    const help = await run(['blacklist', 'list', '--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('--format <type>')

    const result = await run(['blacklist', 'list', '--config', configPath, '--format', 'json'])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      tables: ['audit_logs'],
      columns: { users: ['password'] },
      warnings: [],
    })
  })

  test('rejects unsupported formats without contaminating stdout', async () => {
    const result = await run(['blacklist', 'list', '--config', configPath, '--format', 'csv'])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Invalid format')
  })
})
