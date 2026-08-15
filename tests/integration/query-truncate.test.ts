import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let workspace: string
let configDir: string

async function run(args: string[]) {
  // `process.env` spreads into an object with only the declared keys, so the
  // annotation is what lets a test add or drop a variable dbcli reads.
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: 'test',
    DBCLI_NO_UPDATE_CHECK: '1',
  }
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
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-query-truncate-'))
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

describe('query table-cell truncation CLI parsing', () => {
  test('rejects malformed and non-positive limits before config access', async () => {
    for (const value of ['0', '-1', '1.5', 'abc']) {
      const result = await run(['SELECT 1', `--truncate=${value}`])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('positive integer')
      expect(result.stderr).not.toContain('primary')
    }
  })

  test('rejects truncate and no-truncate together before config access', async () => {
    for (const args of [
      ['SELECT 1', '--truncate=120', '--no-truncate'],
      ['SELECT 1', '--no-truncate', '--truncate', '120'],
    ]) {
      const result = await run(args)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('cannot be used together')
      expect(result.stderr).not.toContain('primary')
    }
  })

  test('rejects explicit truncation for JSON before config access', async () => {
    for (const args of [
      ['SELECT 1', '--format=json', '--truncate=120'],
      ['SELECT 1', '--ui', '--truncate=120'],
    ]) {
      const result = await run(args)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('--format table')
      expect(result.stderr).not.toContain('primary')
    }
  })

  test('accepts explicit and disabled table truncation syntax', async () => {
    for (const args of [
      ['SELECT 1', '--truncate=80'],
      ['SELECT 1', '--truncate', '80'],
      ['SELECT 1', '--no-truncate'],
    ]) {
      const result = await run(args)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('missing')
      expect(result.stderr).toContain('primary')
    }
  })
})
