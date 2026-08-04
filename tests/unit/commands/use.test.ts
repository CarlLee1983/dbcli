import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  listConnectionIdentities,
  listConnectionsForDisplay,
  switchDefault,
} from '@/commands/use'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempDirectory: string
let configDirectory: string

const baseV2Config = {
  version: 2,
  default: 'local',
  connections: {
    local: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'dev',
      password: 'secret',
      database: 'myapp',
      permission: 'read-write',
      environment: 'development',
    },
    staging: {
      system: 'postgresql',
      host: 'staging.example.com',
      port: 5432,
      user: 'admin',
      password: 'stagingpass',
      database: 'staging_db',
      permission: 'query-only',
      environment: 'staging',
    },
    production: {
      system: 'postgresql',
      host: 'production.example.com',
      port: 5432,
      user: 'admin',
      password: 'productionpass',
      database: 'production_db',
      permission: 'query-only',
      environment: 'production',
    },
  },
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} },
}

describe('use command', () => {
  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-use-test-'))
    configDirectory = join(tempDirectory, '.dbcli')
    await mkdir(configDirectory, { recursive: true })
    await Bun.write(join(configDirectory, 'config.json'), JSON.stringify(baseV2Config, null, 2))
  })

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true })
  })

  describe('switchDefault', () => {
    test('should switch default connection', async () => {
      await switchDefault(configDirectory, 'staging', baseV2Config as any)
      const updated = JSON.parse(await Bun.file(join(configDirectory, 'config.json')).text())
      expect(updated.default).toBe('staging')
    })

    test('should throw for non-existent connection', async () => {
      expect(switchDefault(configDirectory, 'nonexistent', baseV2Config as any)).rejects.toThrow(
        /nonexistent/
      )
    })

    test('suggests a similarly named connection', async () => {
      expect(switchDefault(configDirectory, 'stagng', baseV2Config as any)).rejects.toThrow(
        /你是否要使用：staging/
      )
    })

    test('fails closed when changing the persisted default to production without confirmation', async () => {
      await expect(switchDefault(configDirectory, 'production', baseV2Config as any)).rejects.toThrow(
        /confirm-production production/
      )

      const unchanged = JSON.parse(await Bun.file(join(configDirectory, 'config.json')).text())
      expect(unchanged.default).toBe('local')
    })

    test('allows a production default only after repeating the exact connection name', async () => {
      await switchDefault(configDirectory, 'production', baseV2Config as any, {
        confirmProduction: 'production',
      })
      const updated = JSON.parse(await Bun.file(join(configDirectory, 'config.json')).text())
      expect(updated.default).toBe('production')
    })
  })

  describe('listConnectionsForDisplay', () => {
    test('should list all connections with default marker', () => {
      const lines = listConnectionsForDisplay(baseV2Config as any)
      expect(lines).toHaveLength(3)
      expect(lines[0]).toContain('*')
      expect(lines[0]).toContain('local')
      expect(lines[0]).toContain('[development]')
      expect(lines[1]).not.toContain('*')
      expect(lines[1]).toContain('staging')
    })
  })

  describe('listConnectionIdentities', () => {
    test('returns non-secret identity fields for machine output', () => {
      const connections = listConnectionIdentities(baseV2Config as any)

      expect(connections).toEqual([
        {
          name: 'local',
          environment: 'development',
          permission: 'read-write',
          system: 'postgresql',
          server: { host: 'localhost', port: 5432 },
          database: 'myapp',
          isDefault: true,
        },
        {
          name: 'staging',
          environment: 'staging',
          permission: 'query-only',
          system: 'postgresql',
          server: { host: 'staging.example.com', port: 5432 },
          database: 'staging_db',
          isDefault: false,
        },
        {
          name: 'production',
          environment: 'production',
          permission: 'query-only',
          system: 'postgresql',
          server: { host: 'production.example.com', port: 5432 },
          database: 'production_db',
          isDefault: false,
        },
      ])
      expect(JSON.stringify(connections)).not.toContain('secret')
      expect(JSON.stringify(connections)).not.toContain('stagingpass')
    })

    test('uses null when configured identity values are unavailable', () => {
      const config = {
        ...baseV2Config,
        default: 'mongo',
        connections: {
          mongo: {
            system: 'mongodb',
            uri: 'mongodb://agent:secret@db.example.com/app',
            host: '',
            port: 27017,
            user: 'agent',
            password: 'secret',
            database: '',
            permission: 'query-only',
          },
          cloud: {
            system: 'elasticsearch',
            host: '',
            port: 9200,
            user: 'agent',
            password: 'secret',
            database: '',
            apiKey: 'api-secret',
            cloudId: 'cloud-secret',
            permission: 'query-only',
          },
          environmental: {
            system: 'postgresql',
            host: { $env: 'DBCLI_ENV_HOST' },
            port: { $env: 'DBCLI_ENV_PORT' },
            user: 'agent',
            password: 'secret',
            database: { $env: 'DBCLI_ENV_DATABASE' },
            permission: 'query-only',
          },
        },
      }

      const output = JSON.stringify(listConnectionIdentities(config as any))
      expect(JSON.parse(output)).toEqual([
        {
          name: 'mongo',
          environment: null,
          permission: 'query-only',
          system: 'mongodb',
          server: { host: null, port: null },
          database: null,
          isDefault: true,
        },
        {
          name: 'cloud',
          environment: null,
          permission: 'query-only',
          system: 'elasticsearch',
          server: { host: null, port: null },
          database: null,
          isDefault: false,
        },
        {
          name: 'environmental',
          environment: null,
          permission: 'query-only',
          system: 'postgresql',
          server: { host: null, port: null },
          database: null,
          isDefault: false,
        },
      ])
      for (const secret of [
        'mongodb://agent:secret@db.example.com/app',
        'DBCLI_ENV_HOST',
        'DBCLI_ENV_PORT',
        'DBCLI_ENV_DATABASE',
        'agent',
        'secret',
        'api-secret',
        'cloud-secret',
      ]) {
        expect(output).not.toContain(secret)
      }
    })
  })
})
