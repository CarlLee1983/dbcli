import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  detectConfigVersion,
  readV2Config,
  writeV2Config,
  resolveConnection,
  patchConnectionSchema,
  findSimilarConnectionNames,
} from '@/core/config-v2'
import { DbcliConfigV2Schema } from '@/utils/validation'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempDirectory: string

describe('config-v2', () => {
  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-config-v2-test-'))
    await mkdir(join(tempDirectory, '.dbcli'), { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true })
  })

  describe('detectConfigVersion', () => {
    test('should return 2 for v2 config', () => {
      expect(
        detectConfigVersion({
          version: 2,
          default: 'local',
          connections: { local: {} },
        })
      ).toBe(2)
    })

    test('should return 1 for v1 config', () => {
      expect(
        detectConfigVersion({
          connection: { system: 'postgresql' },
        })
      ).toBe(1)
    })

    test('should return 1 for empty object', () => {
      expect(detectConfigVersion({})).toBe(1)
    })

    test('should return 1 if version is not 2', () => {
      expect(detectConfigVersion({ version: 1, connections: {} })).toBe(1)
    })
  })

  describe('resolveConnection', () => {
    const v2Config = {
      version: 2 as const,
      default: 'local',
      connections: {
        local: {
          system: 'postgresql' as const,
          host: 'localhost',
          port: 5432,
          user: 'dev',
          password: 'secret',
          database: 'myapp',
          permission: 'read-write' as const,
        },
        staging: {
          system: 'postgresql' as const,
          host: 'staging.example.com',
          port: 5432,
          user: 'admin',
          password: 'stagingpass',
          database: 'myapp_staging',
          permission: 'query-only' as const,
          envFile: '.env.staging',
          environment: 'staging',
        },
      },
      schema: {},
      schemas: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
      audit: {
        strict: false,
        enabled: true,
        rotation: { max_bytes: 10_485_760, max_entries: 1000 },
      },
    }

    test('should resolve default connection when no name given', () => {
      const result = resolveConnection(v2Config, undefined)
      expect(result.name).toBe('local')
      expect(result.connection.host).toBe('localhost')
      expect(result.permission).toBe('read-write')
    })

    test('should resolve named connection', () => {
      const result = resolveConnection(v2Config, 'staging')
      expect(result.name).toBe('staging')
      expect(result.connection.host).toBe('staging.example.com')
      expect(result.permission).toBe('query-only')
      expect(result.envFile).toBe('.env.staging')
      expect(result.environment).toBe('staging')
    })

    test('should throw for non-existent connection', () => {
      expect(() => resolveConnection(v2Config, 'nonexistent')).toThrow(/不存在/)
    })

    test('suggests a similar configured connection for a misspelled selector', () => {
      expect(() => resolveConnection(v2Config, 'stagin')).toThrow(/你是否要使用：staging/)
    })

    test('ranks suggestions deterministically and limits them to three', () => {
      expect(
        findSimilarConnectionNames('prod', ['prod-c', 'prod-b', 'prod-a', 'unrelated'])
      ).toEqual(['prod-a', 'prod-b', 'prod-c'])
      expect(findSimilarConnectionNames('unmatched', ['local', 'staging'])).toEqual([])
    })

    test('normalizes an empty environment label to an absent label', () => {
      const parsed = DbcliConfigV2Schema.parse({
        ...v2Config,
        connections: {
          ...v2Config.connections,
          local: { ...v2Config.connections.local, environment: '   ' },
        },
      })

      expect(parsed.connections.local!.environment).toBeUndefined()
    })
  })

  describe('readV2Config / writeV2Config', () => {
    test('should round-trip a v2 config', async () => {
      const configPath = join(tempDirectory, '.dbcli')
      const config = {
        version: 2 as const,
        default: 'local',
        connections: {
          local: {
            system: 'postgresql' as const,
            host: 'localhost',
            port: 5432,
            user: 'dev',
            password: 'secret',
            database: 'myapp',
            permission: 'query-only' as const,
          },
        },
        schema: {},
        schemas: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
        audit: {
          strict: false,
          enabled: true,
          rotation: { max_bytes: 10_485_760, max_entries: 1000 },
        },
      }

      await writeV2Config(configPath, config)
      const read = await readV2Config(configPath)

      expect(read.version).toBe(2)
      expect(read.default).toBe('local')
      expect(read.connections.local!.host).toBe('localhost')
    })
  })

  describe('patchConnectionSchema', () => {
    const BASE_CONFIG = {
      version: 2 as const,
      default: 'staging',
      connections: {
        staging: {
          system: 'postgresql' as const,
          host: 'staging.db',
          port: 5432,
          user: 'dev',
          password: 'secret',
          database: 'staging_db',
          permission: 'query-only' as const,
        },
        prod: {
          system: 'postgresql' as const,
          host: 'prod.db',
          port: 5432,
          user: 'admin',
          password: 'prodpass',
          database: 'prod_db',
          permission: 'query-only' as const,
        },
      },
      schema: {},
      schemas: {},
      metadata: { version: '2.0' },
      blacklist: { tables: [], columns: {} },
      audit: {
        strict: false,
        enabled: true,
        rotation: { max_bytes: 10_485_760, max_entries: 1000 },
      },
    }

    test('writes schema to correct connection slot', async () => {
      const configPath = join(tempDirectory, '.dbcli')
      await writeV2Config(configPath, BASE_CONFIG)

      const stagingSchema = { users: { name: 'users', columns: [{ name: 'id' }] } }
      await patchConnectionSchema(configPath, 'staging', stagingSchema)

      const updated = await readV2Config(configPath)
      expect(updated.schemas?.staging).toEqual(stagingSchema)
      expect(updated.schemas?.prod).toBeUndefined()
    })

    test('two connections stay isolated', async () => {
      const configPath = join(tempDirectory, '.dbcli')
      await writeV2Config(configPath, BASE_CONFIG)

      const stagingSchema = { users: { name: 'users' } }
      const prodSchema = { orders: { name: 'orders' } }

      await patchConnectionSchema(configPath, 'staging', stagingSchema)
      await patchConnectionSchema(configPath, 'prod', prodSchema)

      const updated = await readV2Config(configPath)
      expect(updated.schemas?.staging).toEqual(stagingSchema)
      expect(updated.schemas?.prod).toEqual(prodSchema)
    })

    test('updates metadata without touching connections', async () => {
      const configPath = join(tempDirectory, '.dbcli')
      await writeV2Config(configPath, BASE_CONFIG)

      const ts = '2026-04-21T10:00:00.000Z'
      await patchConnectionSchema(
        configPath,
        'staging',
        {},
        { schemaLastUpdated: ts, schemaTableCount: 3 }
      )

      const updated = await readV2Config(configPath)
      expect(updated.metadata.schemaLastUpdated).toBe(ts)
      expect(updated.metadata.schemaTableCount).toBe(3)
      expect(updated.connections.staging!.host).toBe('staging.db')
      expect(updated.default).toBe('staging')
    })

    test('second patch replaces first for same connection', async () => {
      const configPath = join(tempDirectory, '.dbcli')
      await writeV2Config(configPath, BASE_CONFIG)

      await patchConnectionSchema(configPath, 'staging', { users: { name: 'users' } })
      await patchConnectionSchema(configPath, 'staging', { orders: { name: 'orders' } })

      const updated = await readV2Config(configPath)
      expect(updated.schemas?.staging).toEqual({ orders: { name: 'orders' } })
    })
  })

  describe('audit config schema (CONFIG-01 / CONFIG-03)', () => {
    const BASE_V2 = {
      version: 2 as const,
      default: 'local',
      connections: {
        local: {
          system: 'postgresql' as const,
          host: 'localhost',
          port: 5432,
          user: 'dev',
          password: 'secret',
          database: 'myapp',
          permission: 'query-only' as const,
        },
      },
    }

    test('Test 1: upgraded .dbcli with NO audit key gets audit.enabled=true and rotation defaults', () => {
      const parsed = DbcliConfigV2Schema.parse({ ...BASE_V2 })
      expect(parsed.audit.enabled).toBe(true)
      expect(parsed.audit.rotation.max_bytes).toBe(10485760)
      expect(parsed.audit.rotation.max_entries).toBe(10_000)
    })

    test('Test 2: audit.enabled=false is preserved verbatim; rotation still uses defaults', () => {
      const parsed = DbcliConfigV2Schema.parse({
        ...BASE_V2,
        audit: { strict: false, enabled: false },
      })
      expect(parsed.audit.enabled).toBe(false)
      expect(parsed.audit.rotation.max_bytes).toBe(10485760)
      expect(parsed.audit.rotation.max_entries).toBe(10_000)
    })

    test('Test 3: custom audit values are preserved end-to-end', () => {
      const parsed = DbcliConfigV2Schema.parse({
        ...BASE_V2,
        audit: {
          strict: false,
          enabled: true,
          rotation: { max_bytes: 5_242_880, max_entries: 500 },
        },
      })
      expect(parsed.audit.enabled).toBe(true)
      expect(parsed.audit.rotation.max_bytes).toBe(5_242_880)
      expect(parsed.audit.rotation.max_entries).toBe(500)
    })

    test('Test 4: rotation.max_bytes=0 fails validation (must be positive int)', () => {
      expect(() =>
        DbcliConfigV2Schema.parse({
          ...BASE_V2,
          audit: { strict: false, enabled: true, rotation: { max_bytes: 0, max_entries: 1000 } },
        })
      ).toThrow()
    })

    test('Test 5: rotation.max_bytes=-1 fails validation (must be positive int)', () => {
      expect(() =>
        DbcliConfigV2Schema.parse({
          ...BASE_V2,
          audit: { strict: false, enabled: true, rotation: { max_bytes: -1, max_entries: 1000 } },
        })
      ).toThrow()
    })
  })
})
