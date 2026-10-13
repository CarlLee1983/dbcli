import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readConfig,
  readV2Config,
  removeConnection,
  resolveConnection,
  resolvePasswordTarget,
  setConnectionPassword,
  type DbcliConfigV2,
} from '@/core/public'
import { getGlobalConnectionName, setGlobalConnectionName } from '@/core/config'
import { writeConfigWithIntegrity } from '@/core/config-integrity'
import { DbcliConfigV2Schema } from '@/utils/validation'

function noDefaultConfig(): DbcliConfigV2 {
  return {
    version: 2,
    connections: {
      staging: {
        system: 'postgresql',
        host: 'private-endpoint.invalid',
        port: 5432,
        user: 'private-user',
        password: 'private-password',
        database: 'private-database',
        permission: 'query-only',
      },
      secondary: {
        system: 'postgresql',
        host: 'other-private-endpoint.invalid',
        port: 5432,
        user: 'other-private-user',
        password: 'other-private-password',
        database: 'other-private-database',
        permission: 'query-only',
      },
    },
    schema: {},
    schemas: {},
    metadata: { version: '2.0' },
    blacklist: { tables: [], columns: {} },
    audit: { strict: false, enabled: false, rotation: { max_bytes: 10485760, max_entries: 1000 } },
  }
}

function assertSelectionError(error: unknown) {
  expect(error).toBeInstanceOf(Error)
  const message = (error as Error).message
  expect(message).toContain('--use')
  expect(message).toContain('DBCLI_CONNECTION')
  expect(message).toContain('staging')
  expect(message).toContain('secondary')
  expect(message).not.toContain('undefined')
  expect(message).not.toContain('private-')
  return message
}

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected connection selection to be refused')
}

async function captureAsyncError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected connection selection to be refused')
}

describe('optional default on the public core surface', () => {
  test('missing target gives an actionable selection error instead of an undefined name', () => {
    assertSelectionError(captureError(() => resolveConnection(noDefaultConfig(), undefined)))
  })

  test('explicit selection works without a default and preserves the input', () => {
    const config = noDefaultConfig()
    const before = structuredClone(config)
    const selected = resolveConnection(config, 'secondary')
    expect(selected.name).toBe('secondary')
    expect(selected.connection.database).toBe('other-private-database')
    expect(config).toEqual(before)
    expect(Object.hasOwn(config, 'default')).toBe(false)
  })

  test('unknown and blank names are rejected rather than falling back to the first connection', () => {
    for (const name of ['missing', '', '   ']) {
      const error = captureError(() => resolveConnection(noDefaultConfig(), name))
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('staging')
      expect((error as Error).message).toContain('secondary')
      expect((error as Error).message).not.toContain('private-')
    }
  })

  test('removing the default leaves no own default field instead of selecting by insertion order', () => {
    for (const names of [
      ['staging', 'secondary'],
      ['secondary', 'staging'],
    ]) {
      const config = { ...noDefaultConfig(), default: 'staging' }
      config.connections = Object.fromEntries(
        names.map((name) => [name, config.connections[name]!])
      )
      const before = structuredClone(config)
      const next = removeConnection(config, 'staging')
      expect(Object.hasOwn(next, 'default')).toBe(false)
      expect(Object.keys(next.connections)).toEqual(['secondary'])
      expect(config).toEqual(before)
    }
  })

  test('removing a nondefault connection preserves an existing default', () => {
    const config = { ...noDefaultConfig(), default: 'staging' }
    const next = removeConnection(config, 'secondary')
    expect(next.default).toBe('staging')
    expect(next.connections).toEqual({ staging: config.connections.staging! })
    expect(config.connections.secondary).toBeDefined()
  })

  test('removing from no-default config preserves the absence and original input', () => {
    const config = noDefaultConfig()
    const before = structuredClone(config)
    const next = removeConnection(config, 'staging')
    expect(Object.hasOwn(next, 'default')).toBe(false)
    expect(next.connections).toEqual({ secondary: config.connections.secondary! })
    expect(config).toEqual(before)
  })

  test.each(['staging', undefined])(
    'last connection removal is refused with default %j and no mutation',
    (defaultName) => {
      const config: DbcliConfigV2 = {
        ...noDefaultConfig(),
        ...(defaultName === undefined ? {} : { default: defaultName }),
        connections: { staging: noDefaultConfig().connections.staging! },
      }
      const before = structuredClone(config)
      expect(() => removeConnection(config, 'staging')).toThrow(/最後|last/)
      expect(config).toEqual(before)
    }
  )
})

describe('shared readers and credential targets fail safely with no default', () => {
  let workspace: string
  let configDir: string
  let originalGlobalSelection: string | undefined
  let originalEnvironment: Record<string, string | undefined>
  const ENV_KEYS = [
    'DBCLI_AGENT_MODE',
    'DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR',
    'DBCLI_PASSWORD',
  ] as const
  const ENV_TEXT = 'DBCLI_PASSWORD="not-loaded-without-selection"\n'

  async function snapshot() {
    const names = (await readdir(configDir)).sort()
    return Promise.all(
      names.map(async (name) => [name, await Bun.file(join(configDir, name)).text()])
    )
  }

  beforeEach(async () => {
    originalEnvironment = Object.fromEntries(ENV_KEYS.map((name) => [name, process.env[name]]))
    for (const name of ENV_KEYS) delete process.env[name]
    originalGlobalSelection = getGlobalConnectionName()
    setGlobalConnectionName(undefined)
    workspace = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-optional-default-core-')))
    configDir = join(workspace, '.dbcli')
    await writeConfigWithIntegrity(configDir, JSON.stringify(noDefaultConfig(), null, 2))
    await Bun.write(join(configDir, '.env.local'), ENV_TEXT)
  })

  afterEach(async () => {
    setGlobalConnectionName(originalGlobalSelection)
    for (const name of ENV_KEYS) {
      const original = originalEnvironment[name]
      if (original === undefined) delete process.env[name]
      else process.env[name] = original
    }
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  test('readV2Config accepts omission without synthesizing a default', async () => {
    const before = await snapshot()
    const config = await readV2Config(configDir)
    expect(Object.hasOwn(config, 'default')).toBe(false)
    expect(Object.keys(config.connections)).toEqual(['staging', 'secondary'])
    expect(await snapshot()).toEqual(before)
  })

  test('public readConfig uses the same error before loading credentials or writing artifacts', async () => {
    const before = await snapshot()
    const resolverError = assertSelectionError(
      captureError(() => resolveConnection(noDefaultConfig(), undefined))
    )
    const readerError = assertSelectionError(await captureAsyncError(() => readConfig(configDir)))
    expect(readerError).toContain(resolverError)
    expect(process.env.DBCLI_PASSWORD).toBeUndefined()
    expect(await snapshot()).toEqual(before)
  })

  test('public readConfig resolves an explicit name without creating a persisted default', async () => {
    const before = await Bun.file(join(configDir, 'config.json')).text()
    const config = await readConfig(configDir, 'secondary')
    expect(config.connection.database).toBe('other-private-database')
    expect(config.connection.password).toBe('other-private-password')
    expect(await Bun.file(join(configDir, 'config.json')).text()).toBe(before)
    expect(Object.hasOwn(await readV2Config(configDir), 'default')).toBe(false)
  })

  test('resolvePasswordTarget refuses no-default with the shared actionable error', async () => {
    const before = await snapshot()
    const error = await captureAsyncError(() => resolvePasswordTarget(configDir))
    assertSelectionError(error)
    expect(await snapshot()).toEqual(before)
  })

  test('password writes without a target fail before changing config, credentials or integrity', async () => {
    const before = await snapshot()
    const error = await captureAsyncError(() =>
      setConnectionPassword(configDir, undefined, 'must-not-be-written')
    )
    assertSelectionError(error)
    expect(await snapshot()).toEqual(before)
    expect(process.env.DBCLI_PASSWORD).toBeUndefined()
  })

  test('explicit credential target resolution remains read-only and names the selected connection', async () => {
    const before = await snapshot()
    expect(await resolvePasswordTarget(configDir, 'secondary')).toEqual({
      connection: 'secondary',
      envFile: '.env.local',
      varName: 'DBCLI_SECONDARY_PASSWORD',
      convertedToEnvRef: true,
    })
    expect(await snapshot()).toEqual(before)
  })

  test('an unknown credential target also cannot modify credentials', async () => {
    const before = await snapshot()
    await expect(
      setConnectionPassword(configDir, 'missing', 'must-not-be-written')
    ).rejects.toThrow('missing')
    expect(await snapshot()).toEqual(before)
  })
})

describe('default and target names must be owned connection keys', () => {
  test.each(['toString', 'constructor', '__proto__'])(
    'an inherited %s key is not a configured default or selector',
    (name) => {
      const config = noDefaultConfig()
      expect(DbcliConfigV2Schema.safeParse({ ...config, default: name }).success).toBe(false)
      expect(() => resolveConnection(config, name)).toThrow(name)
      expect(() => removeConnection(config, name)).toThrow(name)
      expect(config).toEqual(noDefaultConfig())
    }
  )

  test.each(['toString', 'constructor'])('an actual own %s connection remains valid', (name) => {
    const config = {
      ...noDefaultConfig(),
      default: name,
      connections: { [name]: noDefaultConfig().connections.staging! },
    }
    expect(DbcliConfigV2Schema.safeParse(config).success).toBe(true)
    expect(resolveConnection(config, undefined).name).toBe(name)
  })
})
