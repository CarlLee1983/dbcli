/**
 * The schema cache write seam — DBCLI-PLAT-012.
 *
 * A schema cache is derived data: re-readable at any time from the database the
 * config already points at, and visible in full to anyone who can run
 * `dbcli schema`. It is not connection identity, not a permission and not a
 * credential. It sits behind the agent-mode guard only because it is stored
 * inside `config.json`, next to things that are.
 *
 * Storing it through `configModule.write` did more than store it. Measured on
 * c3e701a1 against a config holding `connection.password: "testpass"` and an
 * `.env.local` reading `DB_PASSWORD=untouched`, one schema write deleted the
 * password from `config.json` and overwrote `.env.local` with a regenerated
 * `DBCLI_PASSWORD=testpass`. That happens outside agent mode too, where no
 * guard fires at all — so the real defect was never "the guard is misplaced",
 * it was that a cache update was a whole-config publication wearing a cache's
 * name.
 *
 * The seam is narrow by signature, not by permission: it takes a schema and two
 * cache timestamps, reads the config itself, and writes back a document that
 * differs only in the cache fields. There is no parameter through which a
 * caller could express a credential change, which is why no flag guards it.
 * `assertOnlyCacheFieldsChanged` is the same claim made out loud, so a future
 * edit that widens the write fails here rather than in production.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertOnlyCacheFieldsChanged,
  persistSchemaCache,
  SchemaCacheWriteError,
} from '@/core/schema-cache-persistence'
import { assertConfigIntegrity, writeConfigWithIntegrity } from '@/core/config-integrity'

const DEMO_SCHEMA = {
  plat012_demo: { name: 'plat012_demo', columns: [{ name: 'id', type: 'integer' }] },
}

const V1_CONFIG = {
  connection: {
    system: 'postgresql',
    host: '127.0.0.1',
    port: 5433,
    user: 'dbcli',
    password: 'testpass',
    database: 'dbcli_test',
  },
  permission: 'query-only',
  schema: {},
  metadata: { createdAt: '2026-01-01T00:00:00.000Z', version: '1.0' },
  blacklist: { tables: ['secrets'], columns: { users: ['password'] } },
  audit: { enabled: true },
}

const V2_CONFIG = {
  version: 2,
  default: 'primary',
  connections: {
    primary: {
      system: 'postgresql',
      host: '127.0.0.1',
      port: 5433,
      user: 'dbcli',
      password: 'testpass',
      database: 'dbcli_test',
      permission: 'query-only',
    },
  },
  schemas: {},
  blacklist: { tables: ['secrets'], columns: { users: ['password'] } },
  metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
}

const ENV_LOCAL = 'DB_PASSWORD=untouched\n'

let storagePath: string

async function seed(config: unknown): Promise<void> {
  await writeConfigWithIntegrity(storagePath, JSON.stringify(config, null, 2))
  await Bun.write(join(storagePath, '.env.local'), ENV_LOCAL)
}

const readConfig = async () =>
  JSON.parse(await readFile(join(storagePath, 'config.json'), 'utf8')) as Record<string, unknown>

const CACHE_WRITE = {
  schema: DEMO_SCHEMA,
  schemaLastUpdated: '2026-02-02T00:00:00.000Z',
  schemaTableCount: 1,
}

beforeEach(async () => {
  storagePath = await mkdtemp(join(tmpdir(), 'dbcli-plat012-'))
})

afterEach(async () => {
  await rm(storagePath, { recursive: true, force: true })
})

describe('persistSchemaCache — v1', () => {
  test('writes the schema and the two cache timestamps', async () => {
    await seed(V1_CONFIG)
    await persistSchemaCache({ storagePath, ...CACHE_WRITE })

    const after = await readConfig()
    expect(after.schema).toEqual(DEMO_SCHEMA)
    expect(after.metadata).toEqual({
      createdAt: '2026-01-01T00:00:00.000Z',
      version: '1.0',
      schemaLastUpdated: '2026-02-02T00:00:00.000Z',
      schemaTableCount: 1,
    })
  })

  test('leaves the credential where it was, in config.json', async () => {
    // The behaviour this Story changes. `configModule.write` moved the password
    // out to `.env.local` as a side effect of caching a schema.
    await seed(V1_CONFIG)
    await persistSchemaCache({ storagePath, ...CACHE_WRITE })

    const after = await readConfig()
    expect(after.connection).toEqual(V1_CONFIG.connection)
  })

  test('leaves .env.local byte-identical', async () => {
    await seed(V1_CONFIG)
    await persistSchemaCache({ storagePath, ...CACHE_WRITE })

    expect(await readFile(join(storagePath, '.env.local'), 'utf8')).toBe(ENV_LOCAL)
  })

  test('changes nothing outside the cache fields', async () => {
    await seed(V1_CONFIG)
    const before = await readConfig()
    await persistSchemaCache({ storagePath, ...CACHE_WRITE })
    const after = await readConfig()

    for (const key of ['connection', 'permission', 'blacklist', 'audit']) {
      expect(after[key]).toEqual(before[key])
    }
  })

  test('the written config passes its own integrity check', async () => {
    await seed(V1_CONFIG)
    await persistSchemaCache({ storagePath, ...CACHE_WRITE })

    const content = await readFile(join(storagePath, 'config.json'), 'utf8')
    await expect(
      assertConfigIntegrity(storagePath, content, { requireRecord: true })
    ).resolves.toBeUndefined()
  })

  test('a table name that looks like SQL is stored verbatim', async () => {
    // The cache mirrors what the server reported. Rewriting it here would make
    // the cache disagree with the database; the injection surface a name would
    // matter for is SQL construction, which this is not.
    await seed(V1_CONFIG)
    const hostile = { 'users; DROP TABLE x': { name: 'users; DROP TABLE x', columns: [] } }
    await persistSchemaCache({ ...CACHE_WRITE, storagePath, schema: hostile })

    expect(Object.keys((await readConfig()).schema as object)).toEqual(['users; DROP TABLE x'])
  })
})

describe('persistSchemaCache — legacy single-file layout', () => {
  test('patches the document in place, integrity record and all absent', async () => {
    // `.dbcli` as a file rather than a directory is still readable and writable
    // through `configModule`, so the seam has to handle it or `dbcli schema`
    // would begin refusing on a layout that works today. Agent mode never
    // reaches this: `configModule.read` refuses a legacy single-file config.
    const legacy = join(storagePath, '.dbcli')
    await Bun.write(legacy, JSON.stringify(V1_CONFIG, null, 2))

    await persistSchemaCache({ ...CACHE_WRITE, storagePath: legacy })

    const after = JSON.parse(await readFile(legacy, 'utf8')) as Record<string, unknown>
    expect(after.schema).toEqual(DEMO_SCHEMA)
    expect(after.connection).toEqual(V1_CONFIG.connection)
  })

  test('a missing configuration is refused rather than created', async () => {
    // Writing a config that was not there would mean publishing connection
    // details out of a cache write.
    await expect(
      persistSchemaCache({ ...CACHE_WRITE, storagePath: join(storagePath, 'nothing-here') })
    ).rejects.toThrow(/No dbcli configuration/)
  })
})

describe('persistSchemaCache — v2', () => {
  test('writes into the named connection slot only', async () => {
    await seed(V2_CONFIG)
    await persistSchemaCache({ storagePath, connectionName: 'primary', ...CACHE_WRITE })

    const after = await readConfig()
    expect(after.schemas).toEqual({ primary: DEMO_SCHEMA })
    expect(after.connections).toEqual(V2_CONFIG.connections)
    expect(after.blacklist).toEqual(V2_CONFIG.blacklist)
    expect(after.default).toBe('primary')
  })

  test('an unknown connection is refused, naming the connection and no path', async () => {
    await seed(V2_CONFIG)
    const before = await readFile(join(storagePath, 'config.json'), 'utf8')

    let message = ''
    try {
      await persistSchemaCache({
        storagePath,
        connectionName: 'no-such-connection',
        ...CACHE_WRITE,
      })
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaCacheWriteError)
      message = (error as Error).message
    }

    expect(message).toContain('no-such-connection')
    expect(message).not.toContain(storagePath)
    expect(await readFile(join(storagePath, 'config.json'), 'utf8')).toBe(before)
  })
})

describe('persistSchemaCache — refusals leave the config alone', () => {
  test('under agent mode a tampered config is refused before anything is written', async () => {
    // Integrity verification is an agent-mode boundary by design — see
    // `assertIntegrityRecord`. The seam reaches for it the same way every other
    // reader does, so moving the cache out from behind the mutation guard did
    // not move it out from behind this one.
    await seed(V1_CONFIG)
    const tampered = JSON.stringify({ ...V1_CONFIG, permission: 'admin' }, null, 2)
    await Bun.write(join(storagePath, 'config.json'), tampered)

    const previous = process.env.DBCLI_AGENT_MODE
    process.env.DBCLI_AGENT_MODE = '1'
    try {
      await expect(persistSchemaCache({ storagePath, ...CACHE_WRITE })).rejects.toThrow(/tampering/)
    } finally {
      if (previous === undefined) delete process.env.DBCLI_AGENT_MODE
      else process.env.DBCLI_AGENT_MODE = previous
    }

    expect(await readFile(join(storagePath, 'config.json'), 'utf8')).toBe(tampered)
  })

  test('under agent mode an untampered config is written', async () => {
    // The whole point of the Story: agent mode no longer blocks a cache write.
    await seed(V1_CONFIG)
    const previous = process.env.DBCLI_AGENT_MODE
    process.env.DBCLI_AGENT_MODE = '1'
    try {
      await persistSchemaCache({ storagePath, ...CACHE_WRITE })
    } finally {
      if (previous === undefined) delete process.env.DBCLI_AGENT_MODE
      else process.env.DBCLI_AGENT_MODE = previous
    }

    expect((await readConfig()).schema).toEqual(DEMO_SCHEMA)
  })

  // POSIX mode bits are how this fault is injected, and Windows does not honour
  // them: `chmod(dir, 0o500)` there leaves the directory writable, the seam
  // succeeds, and the test fails for a reason that has nothing to do with the
  // seam. Skipped rather than weakened — the property still holds on Windows,
  // it just cannot be provoked this way. Same reasoning as
  // `refusesGroupOrWorldWritable` in `src/core/config-integrity.ts`.
  test.skipIf(process.platform === 'win32')(
    'an unwritable storage directory fails without a partial config',
    async () => {
      await seed(V1_CONFIG)
      const before = await readFile(join(storagePath, 'config.json'), 'utf8')
      await chmod(storagePath, 0o500)

      try {
        await expect(persistSchemaCache({ storagePath, ...CACHE_WRITE })).rejects.toThrow()
        expect(await readFile(join(storagePath, 'config.json'), 'utf8')).toBe(before)
      } finally {
        await chmod(storagePath, 0o700)
      }
    }
  )
})

describe('assertOnlyCacheFieldsChanged', () => {
  const cacheUpdated = {
    ...V1_CONFIG,
    schema: DEMO_SCHEMA,
    metadata: { ...V1_CONFIG.metadata, schemaLastUpdated: 'x', schemaTableCount: 1 },
  }

  test('accepts a change confined to the cache fields', () => {
    expect(() => assertOnlyCacheFieldsChanged(V1_CONFIG, cacheUpdated)).not.toThrow()
  })

  test.each([
    ['connection', { connection: { ...V1_CONFIG.connection, password: 'attacker-supplied' } }],
    ['permission', { permission: 'admin' }],
    ['blacklist', { blacklist: { tables: [], columns: {} } }],
    ['audit', { audit: { enabled: false } }],
  ])('refuses a candidate that also changes %s', (field, override) => {
    let message = ''
    try {
      assertOnlyCacheFieldsChanged(V1_CONFIG, { ...cacheUpdated, ...override })
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaCacheWriteError)
      message = (error as Error).message
    }

    expect(message).toContain(field)
    // The field is named; its value never is. A refusal that quoted the
    // rejected `connection` would print the credential it exists to protect.
    expect(message).not.toMatch(/attacker-supplied|testpass|127\.0\.0\.1|5433|admin\b/)
  })

  test('refuses a metadata change outside the two cache keys', () => {
    // `metadata.version` is the config document's own version marker, not a
    // cache timestamp. SchemaUpdater writes it alongside a refresh today; that
    // is out of this Story's scope and must not slip in through the seam.
    expect(() =>
      assertOnlyCacheFieldsChanged(V1_CONFIG, {
        ...cacheUpdated,
        metadata: { ...cacheUpdated.metadata, version: '2.0' },
      })
    ).toThrow(SchemaCacheWriteError)
  })

  test('refuses a v2 candidate that writes another connection slot', () => {
    const before = { ...V2_CONFIG, schemas: { primary: {}, other: {} } }
    const after = { ...before, schemas: { primary: DEMO_SCHEMA, other: DEMO_SCHEMA } }
    expect(() => assertOnlyCacheFieldsChanged(before, after, 'primary')).toThrow(
      SchemaCacheWriteError
    )
  })

  test('refuses a candidate that adds an unrelated top-level field', () => {
    expect(() =>
      assertOnlyCacheFieldsChanged(V1_CONFIG, {
        ...cacheUpdated,
        binding: { type: 'home-storage' },
      })
    ).toThrow(/binding/)
  })
})
