import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

const V2_CONFIG = {
  version: 2,
  default: 'primary',
  connections: {
    primary: {
      system: 'postgresql',
      host: 'primary.invalid',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'primary_db',
      permission: 'query-only',
      environment: 'production',
    },
    staging: {
      system: 'postgresql',
      host: 'staging.invalid',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'staging_db',
      permission: 'read-write',
      environment: 'staging',
    },
  },
  schema: {},
  metadata: { version: '2.0' },
}

let workspace: string
let configDir: string
let configFile: string

async function run(
  args: string[],
  environmentConnection?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DBCLI_NO_UPDATE_CHECK: '1',
  }
  if (environmentConnection === undefined) {
    delete env.DBCLI_CONNECTION
  } else {
    env.DBCLI_CONNECTION = environmentConnection
  }

  const processHandle = Bun.spawn({
    cmd: ['bun', 'run', CLI, ...args],
    cwd: workspace,
    env,
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

async function inspectWith(args: string[], environmentConnection?: string) {
  const result = await run(
    ['--config', configDir, ...args, 'inspect', '--no-connect', '--format', 'json'],
    environmentConnection
  )
  expect(result.code).toBe(0)
  return JSON.parse(result.stdout) as { connection: { name: string; database: string } }
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-connection-selector-'))
  configDir = join(workspace, '.dbcli')
  configFile = join(configDir, 'config.json')
  await Bun.write(configFile, JSON.stringify(V2_CONFIG, null, 2))
})

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('stateless single-connection selection', () => {
  test('use --list --format json exposes only connection identity metadata', async () => {
    const result = await run(['--config', configDir, 'use', '--list', '--format', 'json'])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      connections: [
        {
          name: 'primary',
          environment: 'production',
          permission: 'query-only',
          system: 'postgresql',
          server: { host: 'primary.invalid', port: 5432 },
          database: 'primary_db',
          isDefault: true,
        },
        {
          name: 'staging',
          environment: 'staging',
          permission: 'read-write',
          system: 'postgresql',
          server: { host: 'staging.invalid', port: 5432 },
          database: 'staging_db',
          isDefault: false,
        },
      ],
    })
    expect(result.stdout).not.toContain('"password"')
    expect(result.stdout).not.toContain('"user"')
  })

  test('use refuses JSON output when switching to prevent a text-only write result', async () => {
    const before = await Bun.file(configFile).text()
    const result = await run(['--config', configDir, 'use', 'staging', '--format', 'json'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--format json is only supported with --list')
    expect(await Bun.file(configFile).text()).toBe(before)
  })

  test('root --use and DBCLI_CONNECTION select the same named connection', async () => {
    const rootSelected = await inspectWith(['--use', 'staging'])
    const environmentSelected = await inspectWith([], '  staging  ')

    expect(rootSelected.connection.database).toBe('staging_db')
    expect(environmentSelected.connection).toEqual(rootSelected.connection)
  })

  test('empty DBCLI_CONNECTION falls back to the configured default', async () => {
    const selected = await inspectWith([], '   ')
    expect(selected.connection.database).toBe('primary_db')
  })

  test('all five supported commands parse post-subcommand --use', async () => {
    const cases = [
      ['query', '--use', 'missing', 'SELECT 1'],
      ['schema', '--use', 'missing'],
      ['list', '--use', 'missing'],
      ['export', '--use', 'missing', 'SELECT 1', '--format', 'json'],
      ['check', '--use', 'missing', '--all'],
    ]

    const results = await Promise.all(cases.map((args) => run(['--config', configDir, ...args])))
    for (const result of results) {
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('missing')
      expect(result.stderr).not.toContain('unknown option')
    }
  })

  test('commands outside the supported five require root-level --use and provide a copyable hint', async () => {
    const result = await run(['--config', configDir, 'status', '--use', 'missing'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("unknown option '--use'")
    expect(result.stderr).toContain('dbcli --use <connection> status')
  })

  test('the hint identifies the command, not a root option value', async () => {
    const result = await run([
      '--config',
      join(workspace, 'status'),
      'proxy',
      'analyze',
      '--use=missing',
    ])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("unknown option '--use=missing'")
    expect(result.stderr).toContain('dbcli --use <connection> proxy analyze')
    expect(result.stderr).not.toContain('dbcli --use <connection> status')
  })

  test('the hint preserves nested blacklist subcommands', async () => {
    const result = await run(['--config', configDir, 'blacklist', 'list', '--use', 'missing'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("unknown option '--use'")
    expect(result.stderr).toContain('dbcli --use <connection> blacklist list')
  })

  test('the hint never echoes query arguments', async () => {
    const secret = 'sensitive-token'
    const result = await run([
      '--config',
      configDir,
      'lint',
      `SELECT '${secret}'`,
      '--use',
      'missing',
    ])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('dbcli --use <connection> lint')
    expect(result.stderr).not.toContain(secret)
  })

  test('conflicting root and command selectors fail before command execution', async () => {
    const result = await run([
      '--config',
      configDir,
      '--use',
      'primary',
      'query',
      '--use',
      'staging',
      'SELECT 1',
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/Conflicting connection selectors.*primary.*staging/)
  })

  test('matching root and command selectors are accepted', async () => {
    const result = await run([
      '--config',
      configDir,
      '--use',
      'missing',
      'query',
      '--use',
      'missing',
      'SELECT 1',
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('missing')
    expect(result.stderr).not.toContain('Conflicting connection selectors')
  })

  test('explicit --use takes precedence over DBCLI_CONNECTION', async () => {
    const result = await run(
      ['--config', configDir, 'query', '--use', 'missing', 'SELECT 1'],
      'primary'
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('missing')
  })

  test('parallel environment selectors remain process-local and do not mutate default', async () => {
    const before = await Bun.file(configFile).text()
    const [primary, staging] = await Promise.all([
      inspectWith([], 'primary'),
      inspectWith([], 'staging'),
    ])

    expect(primary.connection.database).toBe('primary_db')
    expect(staging.connection.database).toBe('staging_db')
    expect(await Bun.file(configFile).text()).toBe(before)
  })

  test('explicit fan-out selectors reject empty and duplicate names before execution', async () => {
    for (const selector of ['primary,,staging', 'primary, primary']) {
      const result = await run(['--config', configDir, 'query', '--use', selector, 'SELECT 1'])
      expect(result.code).toBe(1)
      expect(result.stderr).toMatch(/empty|duplicate/i)
    }
  })

  test('DBCLI_CONNECTION remains a single literal connection selector', async () => {
    const result = await run(['--config', configDir, 'query', 'SELECT 1'], 'primary,staging')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("'primary,staging'")
    expect(result.stdout).not.toContain('"results"')
  })
})
