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
    cmd: ['bun', 'run', CLI, '--config', configDir, '--use', 'missing', 'query', ...args],
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
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-query-fields-'))
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

describe('query --fields CLI parsing', () => {
  test('portable exclusion syntax reaches normal config resolution', async () => {
    const result = await run(['SELECT 1', '--fields=-raw_response,-request_payload'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('missing')
    expect(result.stderr).toContain('primary')
    expect(result.stderr).not.toContain('unknown option')
  })

  test('mixed inclusion and exclusion fail before config access', async () => {
    const result = await run(['SELECT 1', '--fields=id,-secret'])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('cannot mix')
    expect(result.stderr).not.toContain('primary')
  })

  test('an empty fields list fails before config access', async () => {
    const result = await run(['SELECT 1', '--fields='])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('empty')
    expect(result.stderr).not.toContain('primary')
  })
})
