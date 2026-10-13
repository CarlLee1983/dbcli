/** Regression coverage for issue #212. All databases and config files are disposable fixtures. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { writeConfigWithIntegrity } from '@/core/config-integrity'
import {
  getProjectStoragePath,
  readV2Config,
  writeProjectBinding,
  type DbcliConfigV2,
} from '@/core/public'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const NAMES = ['primary', 'staging', 'production'] as const
const ENV_CONTENT = 'UNRELATED_FIXTURE_SECRET="leave-me-alone"\n'
let workspace: string
let configDir: string
let configFile: string
const FIXTURE_ENV_KEYS = ['DBCLI_AGENT_MODE', 'DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR'] as const
let originalFixtureEnvironment: Record<string, string | undefined>
let files: Record<(typeof NAMES)[number], string>

interface Result {
  stdout: string
  stderr: string
  code: number
}

function fixtureConfig(defaultName?: string): DbcliConfigV2 {
  return {
    version: 2,
    ...(defaultName === undefined ? {} : { default: defaultName }),
    connections: Object.fromEntries(
      NAMES.map((name) => [
        name,
        {
          system: 'sqlite',
          host: '',
          port: 0,
          user: '',
          password: '',
          database: '',
          file: files[name],
          permission: 'query-only',
          environment: name === 'production' ? 'production' : 'development',
        },
      ])
    ),
    schema: {},
    schemas: {},
    metadata: { version: '2.0' },
    blacklist: { tables: [], columns: {} },
    audit: { strict: false, enabled: false, rotation: { max_bytes: 10485760, max_entries: 1000 } },
  }
}

function fixtureStoragePath(): string {
  const originalHome = process.env.DBCLI_CONFIG_HOME
  try {
    process.env.DBCLI_CONFIG_HOME = join(workspace, 'registry')
    return getProjectStoragePath(configDir)
  } finally {
    if (originalHome === undefined) delete process.env.DBCLI_CONFIG_HOME
    else process.env.DBCLI_CONFIG_HOME = originalHome
  }
}

async function writeConfig(config: unknown = fixtureConfig()) {
  await writeConfigWithIntegrity(configDir, JSON.stringify(config, null, 2))
}

async function run(args: string[], extraEnv: Record<string, string> = {}): Promise<Result> {
  const env: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(name) || /^DB_/i.test(name) || name === 'DATABASE_URL') continue
    env[name] = value
  }
  Object.assign(
    env,
    {
      HOME: join(workspace, 'home'),
      XDG_CONFIG_HOME: join(workspace, 'home', '.config'),
      DBCLI_CONFIG_HOME: join(workspace, 'registry'),
      NODE_ENV: 'test',
      DBCLI_LANG: 'en',
      DBCLI_NO_UPDATE_CHECK: '1',
      NO_COLOR: '1',
    },
    extraEnv
  )
  const child = Bun.spawn({
    cmd: [process.execPath, 'run', CLI, '--config', configDir, ...args],
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

async function protectedFiles() {
  return Promise.all(
    ['config.json', '.config-integrity.json', '.env.local'].map((name) =>
      Bun.file(join(configDir, name)).text()
    )
  )
}

async function databaseHashes() {
  return Promise.all(
    NAMES.map(async (name) =>
      createHash('sha256')
        .update(new Uint8Array(await Bun.file(files[name]).arrayBuffer()))
        .digest('hex')
    )
  )
}

function assertSelectionError(result: Result) {
  expect(result.code).toBe(1)
  const output = `${result.stdout}\n${result.stderr}`
  expect(output).toContain('--use')
  expect(output).toContain('DBCLI_CONNECTION')
  for (const name of NAMES) expect(output).toContain(name)
  expect(output).not.toContain('undefined')
  for (const file of Object.values(files)) expect(output).not.toContain(file)
  expect(output).not.toContain('UNRELATED_FIXTURE_SECRET')
  expect(output).not.toContain('leave-me-alone')
  expect(output).not.toMatch(/SQLITE_CANTOPEN|ECONNREFUSED|Failed to connect/)
}

async function selectedMarker(args: string[] = [], extraEnv: Record<string, string> = {}) {
  const result = await run(
    [...args, 'query', 'SELECT marker FROM fixture_marker', '--format', 'json'],
    extraEnv
  )
  expect(result.code).toBe(0)
  return result.stdout
}

beforeEach(async () => {
  originalFixtureEnvironment = Object.fromEntries(
    FIXTURE_ENV_KEYS.map((name) => [name, process.env[name]])
  )
  for (const name of FIXTURE_ENV_KEYS) delete process.env[name]
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-optional-default-')))
  configDir = join(workspace, '.dbcli')
  configFile = join(configDir, 'config.json')
  await mkdir(join(workspace, 'home'), { recursive: true })
  files = Object.fromEntries(
    NAMES.map((name) => [name, join(workspace, `${name}.sqlite`)])
  ) as typeof files
  for (const name of NAMES) {
    const database = new Database(files[name], { create: true })
    database.run('CREATE TABLE fixture_marker (marker TEXT NOT NULL)')
    database.run('INSERT INTO fixture_marker VALUES (?)', [`${name}-value`])
    database.close(true)
  }
  await writeConfig()
  await Bun.write(join(configDir, '.env.local'), ENV_CONTENT)
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  for (const name of FIXTURE_ENV_KEYS) {
    const original = originalFixtureEnvironment[name]
    if (original === undefined) delete process.env[name]
    else process.env[name] = original
  }
})

describe('no implicit target when a v2 default is absent', () => {
  test.each(
    [
      ['query', 'SELECT marker FROM fixture_marker', '--format', 'json'],
      ['list', '--format', 'json'],
      ['schema', '--format', 'json'],
      ['export', 'SELECT marker FROM fixture_marker', '--format', 'json'],
      ['check', '--all'],
      ['inspect', '--no-connect', '--format', 'json'],
      ['status', '--format', 'json'],
    ].map((args) => ({ args }))
  )(
    '%j fails with explicit-selection guidance without changing config or databases',
    async ({ args }) => {
      const beforeConfig = await protectedFiles()
      const beforeDatabases = await databaseHashes()
      assertSelectionError(await run(args))
      expect(await protectedFiles()).toEqual(beforeConfig)
      expect(await databaseHashes()).toEqual(beforeDatabases)
    },
    15_000
  )

  test('a missing selector makes zero connection attempts to a local fake database listener', async () => {
    let connectionAttempts = 0
    const listener = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        open(socket) {
          connectionAttempts += 1
          socket.end()
        },
        data() {},
      },
    })
    try {
      await writeConfig({
        ...fixtureConfig(),
        connections: Object.fromEntries(
          NAMES.map((name) => [
            name,
            {
              system: 'postgresql',
              host: '127.0.0.1',
              port: listener.port,
              user: 'fixture-login',
              password: 'fixture-secret',
              database: 'fixture-database',
              permission: 'query-only',
            },
          ])
        ),
      })
      assertSelectionError(await run(['query', 'SELECT 1']))
      expect(connectionAttempts).toBe(0)
    } finally {
      listener.stop(true)
    }
  })

  test('available connection names are safe to show without exposing network credentials', async () => {
    const config = fixtureConfig()
    const privateConnection = {
      system: 'postgresql',
      host: 'secret-host.invalid',
      port: 5432,
      user: 'secret-login',
      password: 'secret-password',
      database: 'secret-database',
      permission: 'query-only',
    }
    await writeConfig({
      ...config,
      connections: { ...config.connections, warehouse: privateConnection },
    })
    const result = await run(['query', 'SELECT 1'])
    assertSelectionError(result)
    const output = `${result.stdout}\n${result.stderr}`
    expect(output).toContain('warehouse')
    for (const secret of [
      'secret-host.invalid',
      'secret-login',
      'secret-password',
      'secret-database',
    ]) {
      expect(output).not.toContain(secret)
    }
  })

  test('explicit root, command and environment selectors can query disposable databases', async () => {
    const before = await protectedFiles()
    for (const [args, env, marker] of [
      [
        ['--use', 'primary', 'query', 'SELECT marker FROM fixture_marker', '--format', 'json'],
        {},
        'primary-value',
      ],
      [
        ['query', '--use', 'staging', 'SELECT marker FROM fixture_marker', '--format', 'json'],
        {},
        'staging-value',
      ],
      [
        ['query', 'SELECT marker FROM fixture_marker', '--format', 'json'],
        { DBCLI_CONNECTION: '  staging  ' },
        'staging-value',
      ],
    ] as Array<[string[], Record<string, string>, string]>) {
      const result = await run(args, env)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain(marker)
    }
    expect(await protectedFiles()).toEqual(before)
  }, 15_000)

  test('root --use overrides the environment and environment overrides a persisted default', async () => {
    expect(await selectedMarker(['--use', 'primary'], { DBCLI_CONNECTION: 'staging' })).toContain(
      'primary-value'
    )
    await writeConfig(fixtureConfig('primary'))
    expect(await selectedMarker([], { DBCLI_CONNECTION: 'staging' })).toContain('staging-value')
    expect(await selectedMarker()).toContain('primary-value')
  }, 15_000)

  test('command --use overrides the environment without persisting a default', async () => {
    const before = await protectedFiles()
    const result = await run(
      ['query', '--use', 'primary', 'SELECT marker FROM fixture_marker', '--format', 'json'],
      { DBCLI_CONNECTION: 'staging' }
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('primary-value')
    expect(result.stdout).not.toContain('staging-value')
    expect(await protectedFiles()).toEqual(before)
  })

  test('conflicting root and command selectors fail, matching selectors succeed', async () => {
    const before = await protectedFiles()
    const conflicting = await run(['--use', 'primary', 'query', '--use', 'staging', 'SELECT 1'])
    expect(conflicting.code).toBe(1)
    expect(conflicting.stderr).toMatch(/Conflicting connection selectors.*primary.*staging/)
    const matching = await run([
      '--use',
      'primary',
      'query',
      '--use',
      'primary',
      'SELECT marker FROM fixture_marker',
      '--format',
      'json',
    ])
    expect(matching.code).toBe(0)
    expect(matching.stdout).toContain('primary-value')
    expect(await protectedFiles()).toEqual(before)
  })

  test.each(['', '   '])(
    'blank CLI selector %j is rejected instead of falling through to the environment',
    async (selector) => {
      const before = await protectedFiles()
      const result = await run(['--use', selector, 'inspect', '--no-connect', '--format', 'json'], {
        DBCLI_CONNECTION: 'staging',
      })
      expect(result.code).toBe(1)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/empty|blank|non-empty/i)
      expect(await protectedFiles()).toEqual(before)
    }
  )

  test.each(['', '   '])('blank environment selector %j is absent', async (selector) => {
    assertSelectionError(
      await run(['inspect', '--no-connect', '--format', 'json'], { DBCLI_CONNECTION: selector })
    )
  })

  test('unknown selector keeps available-name validation and leaves config unchanged', async () => {
    const before = await protectedFiles()
    const result = await run(['--use', 'missing', 'inspect', '--no-connect', '--format', 'json'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('missing')
    for (const name of NAMES) expect(result.stderr).toContain(name)
    expect(result.stderr).not.toContain('undefined')
    expect(await protectedFiles()).toEqual(before)
  })

  test('production is permitted only by explicit selection, even after setting its default', async () => {
    expect(await selectedMarker(['--use', 'production'])).toContain('production-value')
    expect(await selectedMarker([], { DBCLI_CONNECTION: 'production' })).toContain(
      'production-value'
    )
    await writeConfig(fixtureConfig('production'))
    const result = await run(['inspect', '--no-connect', '--format', 'json'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--use production')
    expect(result.stderr).toContain('DBCLI_CONNECTION=production')
  }, 15_000)
})

describe('use --unset is an integrity-protected v2 mutation', () => {
  test('clears only default, is idempotent, and leaves a valid integrity record', async () => {
    await writeConfig(fixtureConfig('primary'))
    const before = JSON.parse(await Bun.file(configFile).text())
    const databaseBefore = await databaseHashes()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await run(['use', '--unset'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Default connection cleared')
      const updated = JSON.parse(await Bun.file(configFile).text())
      expect(Object.hasOwn(updated, 'default')).toBe(false)
      const withoutDefault = { ...before }
      delete withoutDefault.default
      expect(updated).toEqual(withoutDefault)
      expect(await Bun.file(join(configDir, '.env.local')).text()).toBe(ENV_CONTENT)
      const trustedRead = await run(['use', '--list', '--format', 'json'], {
        DBCLI_AGENT_MODE: '1',
      })
      expect(trustedRead.code).toBe(0)
      expect(
        JSON.parse(trustedRead.stdout).connections.every(
          (connection: { isDefault: boolean }) => !connection.isDefault
        )
      ).toBe(true)
    }
    expect(await databaseHashes()).toEqual(databaseBefore)
  }, 15_000)

  test.each(
    [
      ['primary'],
      [''],
      ['--list'],
      ['--confirm-production', 'production'],
      ['--format', 'json'],
    ].map((conflict) => ({ conflict }))
  )('rejects conflicting arguments %j without writing protected files', async ({ conflict }) => {
    await writeConfig(fixtureConfig('primary'))
    const before = await protectedFiles()
    const result = await run(['use', '--unset', ...conflict])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--unset')
    expect(result.stderr).not.toContain('unknown option')
    expect(await protectedFiles()).toEqual(before)
  })

  test.each(['mongodb', 'postgresql'] as const)(
    'unset preserves raw minimal %s fields and is a byte-for-byte no-op when absent',
    async (system) => {
      const connection =
        system === 'mongodb'
          ? { system, uri: 'mongodb://fixture.invalid/example', permission: 'query-only' }
          : {
              system,
              host: 'fixture.invalid',
              port: 5432,
              user: 'fixture-user',
              database: 'fixture-database',
              permission: 'query-only',
            }
      const raw = { version: 2, connections: { fixture: connection }, metadata: { version: '2.0' } }
      await writeConfig({ ...raw, default: 'fixture' })
      const cleared = await run(['use', '--unset'])
      expect(cleared.code).toBe(0)
      expect(JSON.parse(await Bun.file(configFile).text())).toEqual(raw)
      const before = await protectedFiles()
      const repeated = await run(['use', '--unset'])
      expect(repeated.code).toBe(0)
      expect(repeated.stdout).toContain('Default connection cleared')
      expect(await protectedFiles()).toEqual(before)
      const guarded = await run(['use', '--unset'], { DBCLI_AGENT_MODE: '1' })
      expect(guarded.code).toBe(1)
      expect(guarded.stderr).toContain('Agent mode blocks configuration')
      expect(await protectedFiles()).toEqual(before)
    }
  )

  test.each(['primary', undefined])(
    'agent mode refuses unset when default is %j, after integrity passes',
    async (defaultName) => {
      await writeConfig(fixtureConfig(defaultName))
      const read = await run(['use', '--list', '--format', 'json'], { DBCLI_AGENT_MODE: '1' })
      expect(read.code).toBe(0)
      const before = await protectedFiles()
      const result = await run(['use', '--unset'], { DBCLI_AGENT_MODE: '1' })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(
        'Agent mode blocks configuration, permission, and credential changes'
      )
      expect(result.stderr).not.toContain('integrity')
      expect(await protectedFiles()).toEqual(before)
    }
  )

  test('rejects v1 without upgrading or overwriting it', async () => {
    await writeConfig({
      connection: { system: 'sqlite', file: files.primary },
      permission: 'query-only',
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
      audit: {
        strict: false,
        enabled: false,
        rotation: { max_bytes: 10485760, max_entries: 1000 },
      },
    })
    const before = await protectedFiles()
    const result = await run(['use', '--unset'])
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/v2/i)
    expect(await protectedFiles()).toEqual(before)
  })
})

describe('connection management and inventory preserve no-default state', () => {
  test.each([
    ['primary', 'primary', undefined],
    ['primary', 'staging', 'primary'],
    [undefined, 'primary', undefined],
  ])(
    'remove with default %j and target %j leaves default %j',
    async (defaultName, target, expectedDefault) => {
      await writeConfig(fixtureConfig(defaultName))
      const before = JSON.parse(await Bun.file(configFile).text())
      const result = await run(['init', '--remove', target!])
      expect(result.code).toBe(0)
      const updated = JSON.parse(await Bun.file(configFile).text())
      expect(updated.default).toBe(expectedDefault)
      expect(Object.hasOwn(updated, 'default')).toBe(expectedDefault !== undefined)
      const remaining = { ...before.connections }
      delete remaining[target!]
      expect(updated.connections).toEqual(remaining)
      if (defaultName === target) expect(result.stdout).toContain('Default connection cleared')
      else expect(result.stdout).not.toContain('Default connection cleared')
      expect(await Bun.file(join(configDir, '.env.local')).text()).toBe(ENV_CONTENT)
      expect(
        (await run(['use', '--list', '--format', 'json'], { DBCLI_AGENT_MODE: '1' })).code
      ).toBe(0)
    }
  )

  test.each(['primary', undefined])(
    'last connection removal is refused without changing default %j',
    async (defaultName) => {
      const config = fixtureConfig(defaultName)
      await writeConfig({ ...config, connections: { primary: config.connections.primary } })
      const before = await protectedFiles()
      const result = await run(['init', '--remove', 'primary'])
      expect(result.code).toBe(1)
      expect(result.stderr).toMatch(/last|最後/)
      expect(await protectedFiles()).toEqual(before)
    }
  )

  test('use describes the absent default and text inventory marks no default', async () => {
    const current = await run(['use'])
    expect(current.code).toBe(0)
    expect(current.stdout).toContain('No default connection')
    expect(current.stdout).toContain('--use')
    expect(current.stdout).toContain('DBCLI_CONNECTION')
    const inventory = await run(['use', '--list'])
    expect(inventory.code).toBe(0)
    for (const name of NAMES) expect(inventory.stdout).toContain(name)
    expect(inventory.stdout).not.toMatch(/^\s*\*\s/m)
  })

  test('JSON inventory has no default and is read-only even in agent mode', async () => {
    const before = await protectedFiles()
    const result = await run(['use', '--list', '--format', 'json'], { DBCLI_AGENT_MODE: '1' })
    expect(result.code).toBe(0)
    const inventory = JSON.parse(result.stdout)
    expect(
      inventory.connections.map((connection: { name: string; isDefault: boolean }) => [
        connection.name,
        connection.isDefault,
      ])
    ).toEqual(NAMES.map((name) => [name, false]))
    expect(result.stdout).not.toContain('"password"')
    expect(result.stdout).not.toContain('"user"')
    expect(await protectedFiles()).toEqual(before)
  })

  test('doctor without a selector reports required selection rather than malformed v2 data', async () => {
    const before = await protectedFiles()
    const result = await run(['doctor', '--format', 'json'])
    const report = JSON.parse(result.stdout)
    expect(report.results).toContainEqual(
      expect.objectContaining({ label: 'Config valid', status: 'pass' })
    )
    expect(report.results).toContainEqual(
      expect.objectContaining({ label: 'Connection selection', status: 'error' })
    )
    expect(report.results).toContainEqual(
      expect.objectContaining({ label: 'Default connection', status: 'pass' })
    )
    expect(
      report.results.some(
        (item: { label: string; status: string }) =>
          item.label === 'V2 config validation' && item.status === 'error'
      )
    ).toBe(false)
    expect(result.stdout).not.toContain('V2 設定檔格式無效')
    expect(result.stdout).toContain('--use')
    expect(result.stdout).toContain('DBCLI_CONNECTION')
    expect(await protectedFiles()).toEqual(before)
  }, 15_000)

  test('doctor with an explicit target accepts the absent persisted default', async () => {
    const result = await run(['--use', 'staging', 'doctor', '--format', 'json'])
    const report = JSON.parse(result.stdout)
    expect(report.results).toContainEqual(
      expect.objectContaining({ label: 'Config valid', status: 'pass' })
    )
    expect(report.results).toContainEqual(
      expect.objectContaining({ label: 'Default connection', status: 'pass' })
    )
    expect(
      report.results.some(
        (item: { label: string; status: string }) =>
          item.label === 'V2 config validation' && item.status === 'error'
      )
    ).toBe(false)
  }, 15_000)

  test('renaming while no default is set leaves it absent', async () => {
    const before = JSON.parse(await Bun.file(configFile).text())
    const result = await run(['init', '--rename', 'primary:renamed'])
    expect(result.code).toBe(0)
    const updated = JSON.parse(await Bun.file(configFile).text())
    expect(Object.hasOwn(updated, 'default')).toBe(false)
    expect(updated.connections.renamed).toEqual(before.connections.primary)
    expect(updated.connections.primary).toBeUndefined()
    expect(updated.connections.staging).toEqual(before.connections.staging)
  })

  test('switching from no default sets it and production switching still requires confirmation', async () => {
    const before = await protectedFiles()
    const rejected = await run(['use', 'production'])
    expect(rejected.code).toBe(1)
    expect(rejected.stderr).toContain('--confirm-production production')
    expect(await protectedFiles()).toEqual(before)
    const switched = await run(['use', 'staging'])
    expect(switched.code).toBe(0)
    expect(JSON.parse(await Bun.file(configFile).text()).default).toBe('staging')
    const confirmed = await run(['use', 'production', '--confirm-production', 'production'])
    expect(confirmed.code).toBe(0)
    expect(JSON.parse(await Bun.file(configFile).text()).default).toBe('production')
  }, 15_000)
})

describe('adding connections preserves an optional default across storage layouts', () => {
  test.each([
    ['bound', undefined],
    ['direct', undefined],
    ['direct', 'staging'],
  ] as const)(
    'init adds to %s v2 storage with selector %j without losing connections',
    async (layout, selector) => {
      const original = fixtureConfig()
      if (layout === 'bound') {
        const storagePath = fixtureStoragePath()
        await writeConfigWithIntegrity(storagePath, JSON.stringify(original, null, 2))
        await writeProjectBinding(configDir, storagePath)
      }
      const extraFile = join(workspace, 'extra.sqlite')
      const database = new Database(extraFile, { create: true })
      database.run('CREATE TABLE extra_marker (id INTEGER PRIMARY KEY)')
      database.close(true)
      const beforeDatabases = await databaseHashes()
      const result = await run([
        ...(selector ? ['--use', selector] : []),
        'init',
        '--conn-name',
        'extra',
        '--system',
        'sqlite',
        '--file',
        extraFile,
        '--permission',
        'query-only',
        '--skip-test',
        '--no-interactive',
        '--force',
      ])
      expect(result, result.stderr).toEqual(expect.objectContaining({ code: 0 }))
      const config = await readV2Config(configDir)
      expect(Object.hasOwn(config, 'default')).toBe(false)
      expect(Object.keys(config.connections).sort()).toEqual([...NAMES, 'extra'].sort())
      for (const name of NAMES) expect(config.connections[name]).toEqual(original.connections[name])
      expect(config.connections.extra).toEqual(
        expect.objectContaining({ system: 'sqlite', file: extraFile, permission: 'query-only' })
      )
      expect(await databaseHashes()).toEqual(beforeDatabases)
      const binding = JSON.parse(await Bun.file(configFile).text())
      expect(binding.version).toBe(3)
      expect(binding.binding.storagePath.startsWith(workspace)).toBe(true)
    },
    15_000
  )
})

describe('legacy custom env files are never relocated implicitly by init', () => {
  const CUSTOM_ENV = 'FIXTURE_CUSTOM_PASSWORD="must-stay-in-place"\n'

  test.each([
    { defaultName: undefined, selector: undefined },
    { defaultName: undefined, selector: 'staging' },
    { defaultName: 'primary', selector: 'staging' },
  ])(
    'direct v2 import %j refuses before creating storage or changing credentials',
    async ({ defaultName, selector }) => {
      const original = fixtureConfig(defaultName)
      original.connections.primary = { ...original.connections.primary!, envFile: '.env.primary' }
      await writeConfig(original)
      const customEnvFile = join(configDir, '.env.primary')
      await Bun.write(customEnvFile, CUSTOM_ENV)
      const before = await protectedFiles()
      const beforeNames = (await readdir(configDir)).sort()
      const destination = fixtureStoragePath()
      await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
      const result = await run([
        ...(selector ? ['--use', selector] : []),
        'init',
        '--conn-name',
        'extra',
        '--system',
        'sqlite',
        '--file',
        files.primary,
        '--permission',
        'query-only',
        '--skip-test',
        '--no-interactive',
        '--force',
      ])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('envFile')
      expect(result.stderr).toContain('.env.local')
      expect(result.stderr).toContain('home storage')
      expect(result.stderr).not.toContain('must-stay-in-place')
      expect(await protectedFiles()).toEqual(before)
      expect(await Bun.file(customEnvFile).text()).toBe(CUSTOM_ENV)
      expect((await readdir(configDir)).sort()).toEqual(beforeNames)
      await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    },
    15_000
  )

  test('a home-bound no-default registry can add a connection without moving its custom env file', async () => {
    const original = fixtureConfig()
    original.connections.primary = { ...original.connections.primary!, envFile: '.env.primary' }
    const storagePath = fixtureStoragePath()
    await writeConfigWithIntegrity(storagePath, JSON.stringify(original, null, 2))
    const customEnvFile = join(storagePath, '.env.primary')
    await Bun.write(customEnvFile, CUSTOM_ENV)
    await writeProjectBinding(configDir, storagePath)
    const result = await run([
      'init',
      '--conn-name',
      'extra',
      '--system',
      'sqlite',
      '--file',
      files.primary,
      '--permission',
      'query-only',
      '--skip-test',
      '--no-interactive',
      '--force',
    ])
    expect(result, result.stderr).toEqual(expect.objectContaining({ code: 0 }))
    const config = await readV2Config(configDir)
    expect(Object.hasOwn(config, 'default')).toBe(false)
    expect(Object.keys(config.connections).sort()).toEqual([...NAMES, 'extra'].sort())
    for (const name of NAMES) expect(config.connections[name]).toEqual(original.connections[name])
    expect(await Bun.file(customEnvFile).text()).toBe(CUSTOM_ENV)
    expect(JSON.parse(await Bun.file(configFile).text()).binding.storagePath).toBe(storagePath)
    expect((await run(['use', '--list', '--format', 'json'], { DBCLI_AGENT_MODE: '1' })).code).toBe(
      0
    )
  }, 15_000)
})
