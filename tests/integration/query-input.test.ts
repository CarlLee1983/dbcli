import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let workspace: string
let configDir: string
let failingMongoConfigFile: string

function sanitizedEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^DBCLI_/i.test(key) || key === 'DATABASE_URL') delete env[key]
  }
  env.NODE_ENV = 'test'
  env.DBCLI_NO_UPDATE_CHECK = '1'
  env.HOME = workspace
  return env
}

async function run(
  args: string[],
  stdin?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = Bun.spawn({
    cmd: ['bun', 'run', CLI, ...args],
    cwd: workspace,
    env: sanitizedEnv(),
    stdin: stdin === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (stdin !== undefined) {
    // `stdin: 'pipe'` is what the spawn above asked for on exactly this branch,
    // but the handle's type does not carry that correlation.
    child.stdin!.write(stdin)
    child.stdin!.end()
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

function queryArgs(args: string[]): string[] {
  return ['--config', configDir, '--use', 'missing', 'query', ...args]
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-query-input-'))
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
  failingMongoConfigFile = join(workspace, 'failing-mongo.json')
  await Bun.write(
    failingMongoConfigFile,
    JSON.stringify({
      connection: {
        system: 'mongodb',
        uri: 'mongodb://[invalid/test',
        database: 'test',
      },
      permission: 'query-only',
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
      audit: { enabled: false },
    })
  )
})

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('query file and stdin CLI input', () => {
  test('zero sources fails before config access', async () => {
    const result = await run(queryArgs([]))
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Exactly one query source')
    expect(result.stderr).not.toContain('primary')
  })

  test('positional and file sources conflict before file or config access', async () => {
    const result = await run(queryArgs(['SELECT 1', '-f', 'never-read.sql']))
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Query source conflict')
    expect(result.stderr).not.toContain('never-read.sql')
    expect(result.stderr).not.toContain('primary')
  })

  test('missing file reports its path with bounded stderr', async () => {
    const path = join(workspace, 'missing.sql')
    const result = await run(queryArgs(['-f', path]))
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(path)
    expect(result.stderr).not.toMatch(/^\s*\d+\s*\|/m)
    expect(result.stderr).not.toMatch(/\n\s+at\s+/)
    expect(result.stderr).not.toContain('primary')
  })

  test('an empty file is rejected before config access', async () => {
    const path = join(workspace, 'empty.sql')
    await Bun.write(path, '\uFEFF  \n')
    const result = await run(queryArgs(['-f', path]))
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Query input is empty')
    expect(result.stderr).not.toContain('primary')
  })

  test('recovery remains JSON-only and redacts the query-file path in saved argv', async () => {
    const path = join(workspace, 'missing-recovery.sql')
    const result = await run(queryArgs(['-f', path, '--recovery']))
    expect(result.code).toBe(1)
    expect(result.stderr).toBe('')
    expect(() => JSON.parse(result.stdout)).not.toThrow()

    const saved = JSON.parse(await Bun.file(join(configDir, 'last-recovery.json')).text()) as {
      command: string
    }
    expect(saved.command).toContain('-f <redacted> --recovery')
    expect(saved.command).not.toContain('<sql>')
    expect(saved.command).not.toContain(path)
  })

  test('BOM-prefixed multiline SQL resolves before the normal config path', async () => {
    const path = join(workspace, 'multiline.sql')
    await Bun.write(path, '\uFEFF  SELECT id,\n  name\nFROM users\n')
    const result = await run(queryArgs(['-f', path]))
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('missing')
    expect(result.stderr).toContain('primary')
    expect(result.stderr).not.toContain('Query input is empty')
  })

  test('stdin is consumed through EOF and then follows the normal config path', async () => {
    const result = await run(queryArgs(['-f', '-']), 'SELECT 1\n')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('missing')
    expect(result.stderr).toContain('primary')
    expect(result.stderr).not.toContain('Failed to read query from stdin')
  }, 5_000)

  test('MongoDB aggregation from stdin reaches the Mongo execution route unchanged', async () => {
    const pipeline = `[{"$match":{"message":{"$regex":"user's event"}}}]\n`
    const result = await run(
      ['--config', failingMongoConfigFile, 'query', '--collection', 'raw_logs', '-f', '-'],
      pipeline
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/connect|invalid|parse|address|MongoDB/i)
    expect(result.stderr).not.toContain('MongoDB 查詢必須是有效的 JSON')
    expect(result.stderr).not.toContain('Query input is empty')
  }, 5_000)
})
