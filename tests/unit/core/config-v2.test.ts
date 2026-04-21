import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  detectConfigVersion,
  readV2Config,
  writeV2Config,
  resolveConnection,
  patchConnectionSchema,
} from '@/core/config-v2'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-config-v2-test'

describe('config-v2', () => {
  beforeEach(async () => {
    await Bun.$`mkdir -p ${TMP_DIR}/.dbcli`
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
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
        },
      },
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
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
    })

    test('should throw for non-existent connection', () => {
      expect(() => resolveConnection(v2Config, 'nonexistent')).toThrow(/不存在/)
    })
  })

  describe('readV2Config / writeV2Config', () => {
    test('should round-trip a v2 config', async () => {
      const configPath = join(TMP_DIR, '.dbcli')
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
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
      }

      await writeV2Config(configPath, config)
      const read = await readV2Config(configPath)

      expect(read.version).toBe(2)
      expect(read.default).toBe('local')
      expect(read.connections.local.host).toBe('localhost')
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
    }

    test('writes schema to correct connection slot', async () => {
      const configPath = join(TMP_DIR, '.dbcli')
      await writeV2Config(configPath, BASE_CONFIG)

      const stagingSchema = { users: { name: 'users', columns: [{ name: 'id' }] } }
      await patchConnectionSchema(configPath, 'staging', stagingSchema)

      const updated = await readV2Config(configPath)
      expect(updated.schemas?.staging).toEqual(stagingSchema)
      expect(updated.schemas?.prod).toBeUndefined()
    })

    test('two connections stay isolated', async () => {
      const configPath = join(TMP_DIR, '.dbcli')
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
      const configPath = join(TMP_DIR, '.dbcli')
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
      expect(updated.connections.staging.host).toBe('staging.db')
      expect(updated.default).toBe('staging')
    })

    test('second patch replaces first for same connection', async () => {
      const configPath = join(TMP_DIR, '.dbcli')
      await writeV2Config(configPath, BASE_CONFIG)

      await patchConnectionSchema(configPath, 'staging', { users: { name: 'users' } })
      await patchConnectionSchema(configPath, 'staging', { orders: { name: 'orders' } })

      const updated = await readV2Config(configPath)
      expect(updated.schemas?.staging).toEqual({ orders: { name: 'orders' } })
    })
  })
})
