/**
 * 配置模組單元測試
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { configModule } from '@/core/config'
import { ConfigError } from '@/utils/errors'
import type { DbcliConfig } from '@/utils/validation'
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 用於測試的臨時路徑
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'dbcli-config-test-'))
const TEST_CONFIG_PATH = join(TEST_ROOT, 'test.dbcli.json')

describe('configModule', () => {
  afterAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  afterEach(() => {
    // 清理測試文件
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH)
    }
  })

  describe('read', () => {
    test('應該在文件不存在時返回預設配置', async () => {
      const result = await configModule.read(TEST_CONFIG_PATH)

      expect(result.connection.system).toBe('postgresql')
      expect(result.connection.host).toBe('localhost')
      expect(result.connection.port).toBe(5432)
      expect(result.permission).toBe('query-only')
    })

    test('應該解析現有的有效 .dbcli JSON', async () => {
      const configJson = JSON.stringify({
        connection: {
          system: 'mysql',
          host: 'db.example.com',
          port: 3306,
          user: 'admin',
          password: 'secret',
          database: 'production',
        },
        permission: 'read-write',
        schema: {},
        metadata: {
          version: '1.0',
        },
      })

      await Bun.file(TEST_CONFIG_PATH).write(configJson)

      const result = await configModule.read(TEST_CONFIG_PATH)

      expect(result.connection.system).toBe('mysql')
      expect(result.connection.host).toBe('db.example.com')
      expect(result.permission).toBe('read-write')
    })

    test('應該在 JSON 無效時拋出 ConfigError', async () => {
      await Bun.file(TEST_CONFIG_PATH).write('{ invalid json')

      await expect(configModule.read(TEST_CONFIG_PATH)).rejects.toThrow(ConfigError)
    })

    test('應該在模式驗證失敗時拋出 ConfigError', async () => {
      const invalidConfig = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          // 缺少必需欄位
        },
      }

      await Bun.file(TEST_CONFIG_PATH).write(JSON.stringify(invalidConfig))

      await expect(configModule.read(TEST_CONFIG_PATH)).rejects.toThrow(ConfigError)
    })

    test('missing environment references use the shared field-specific resolver', async () => {
      const envName = `DBCLI_TEST_MISSING_${crypto.randomUUID().replaceAll('-', '')}`
      const config = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: { $env: envName },
          database: 'db',
        },
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' },
      }
      await Bun.write(TEST_CONFIG_PATH, JSON.stringify(config))

      await expect(configModule.read(TEST_CONFIG_PATH)).rejects.toThrow(
        new RegExp(`${envName}.*password`, 's')
      )
    })
  })

  describe('validate', () => {
    test('應該接受有效的 DbcliConfig', () => {
      const valid = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: 'pass',
          database: 'db',
        },
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' },
      }

      const result = configModule.validate(valid)
      expect(result.connection.system).toBe('postgresql')
    })

    test('應該在缺少必需欄位時拋出 ConfigError', () => {
      const invalid = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
        },
      }

      expect(() => configModule.validate(invalid)).toThrow(ConfigError)
    })

    test('應該在無效權限值時拋出 ConfigError', () => {
      const invalid = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: '',
          database: 'db',
        },
        permission: 'invalid-permission',
      }

      expect(() => configModule.validate(invalid)).toThrow(ConfigError)
    })
  })

  describe('merge', () => {
    const baseConfig: DbcliConfig = {
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'pass',
        database: 'db',
      },
      permission: 'query-only',
      schema: { table1: 'data' },
      metadata: { version: '1.0', createdAt: '2026-01-01T00:00:00Z' },
      blacklist: { tables: [], columns: {} },
      audit: { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
    }

    test('應該返回新對象（不修改輸入）', () => {
      const updates = { permission: 'read-write' as const }

      const result = configModule.merge(baseConfig, updates)

      expect(result).not.toBe(baseConfig)
      expect(baseConfig.permission).toBe('query-only') // 原始未改變
      expect(result.permission).toBe('read-write')
    })

    test('應該不可變地合併嵌套對象（connection）', () => {
      const updates = {
        connection: { port: 3306 },
      } as Partial<DbcliConfig>

      const result = configModule.merge(baseConfig, updates)

      expect(result.connection).not.toBe(baseConfig.connection)
      expect(result.connection.port).toBe(3306)
      expect(result.connection.user).toBe('user') // 其他欄位保留
      expect(baseConfig.connection.port).toBe(5432) // 原始未改變
    })

    test('應該保留現有的 metadata.createdAt', () => {
      const originalCreatedAt = '2025-01-01T00:00:00Z'
      const config = {
        ...baseConfig,
        metadata: { version: '1.0', createdAt: originalCreatedAt },
      }

      const result = configModule.merge(config, {
        permission: 'admin',
      })

      expect(result.metadata.createdAt).toBe(originalCreatedAt)
    })

    test('應該在沒有 createdAt 時設置新時間戳', () => {
      const config: DbcliConfig = {
        ...baseConfig,
        metadata: { version: '1.0' },
        audit: { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
      }

      const result = configModule.merge(config, {})

      expect(result.metadata.createdAt).toBeDefined()
      expect(typeof result.metadata.createdAt).toBe('string')
    })

    test('應該合併 schema', () => {
      const result = configModule.merge(baseConfig, {
        schema: { table2: 'newdata' },
      })

      // schema 應該被深度合併，而不是替換
      expect(result.schema).toEqual({ table1: 'data', table2: 'newdata' })
    })
  })

  describe('configModule v2 integration', () => {
    const V2_CONFIG_PATH = join(TEST_ROOT, 'v2-dbcli')

    beforeEach(() => {
      mkdirSync(V2_CONFIG_PATH, { recursive: true })
    })

    afterEach(() => {
      rmSync(V2_CONFIG_PATH, { recursive: true, force: true })
    })

    test('should read v2 config and return v1-compatible result', async () => {
      const v2Config = {
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
          },
        },
        schema: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
      }

      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v2Config, null, 2))

      const result = await configModule.read(V2_CONFIG_PATH)

      expect(result.connection.system).toBe('postgresql')
      expect(result.connection.host).toBe('localhost')
      expect(result.permission).toBe('read-write')
    })

    test('v2 missing environment references identify the variable and field', async () => {
      const envName = `DBCLI_TEST_V2_MISSING_${crypto.randomUUID().replaceAll('-', '')}`
      const v2Config = {
        version: 2,
        default: 'local',
        connections: {
          local: {
            system: 'postgresql',
            host: 'localhost',
            port: 5432,
            user: 'dev',
            password: { $env: envName },
            database: 'myapp',
          },
        },
        schema: {},
        metadata: { version: '1.0' },
      }
      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v2Config, null, 2))

      await expect(configModule.read(V2_CONFIG_PATH)).rejects.toThrow(
        new RegExp(`${envName}.*password`, 's')
      )
    })

    test('should read v2 config with connectionName parameter', async () => {
      const v2Config = {
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
          },
          staging: {
            system: 'postgresql',
            host: 'staging.example.com',
            port: 5432,
            user: 'admin',
            password: 'stagingpass',
            database: 'staging_db',
            permission: 'query-only',
          },
        },
        schema: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
      }

      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v2Config, null, 2))

      const result = await configModule.read(V2_CONFIG_PATH, 'staging')

      expect(result.connection.host).toBe('staging.example.com')
      expect(result.permission).toBe('query-only')
    })

    test('refuses an implicit production default but permits an explicit selector', async () => {
      const v2Config = {
        version: 2,
        default: 'production',
        connections: {
          production: {
            system: 'postgresql',
            host: 'prod.example.com',
            port: 5432,
            user: 'admin',
            password: 'secret',
            database: 'app',
            permission: 'query-only',
            environment: 'production',
          },
        },
      }
      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v2Config, null, 2))

      await expect(configModule.read(V2_CONFIG_PATH)).rejects.toThrow(
        /必須明確使用 --use production/
      )

      const explicit = await configModule.read(V2_CONFIG_PATH, 'production')
      expect(explicit.effectiveConnectionName).toBe('production')
      expect(explicit.effectiveEnvironment).toBe('production')
    })

    test('should return per-connection schema from schemas dict (V2)', async () => {
      const v2Config = {
        version: 2,
        default: 'staging',
        connections: {
          staging: {
            system: 'postgresql',
            host: 'staging.db',
            port: 5432,
            user: 'dev',
            password: 'secret',
            database: 'staging_db',
            permission: 'query-only',
          },
          prod: {
            system: 'postgresql',
            host: 'prod.db',
            port: 5432,
            user: 'admin',
            password: 'prodpass',
            database: 'prod_db',
            permission: 'query-only',
          },
        },
        schema: { shared_table: { name: 'shared_table' } },
        schemas: {
          staging: { users: { name: 'users' } },
          prod: { orders: { name: 'orders' } },
        },
        metadata: { version: '2.0' },
        blacklist: { tables: [], columns: {} },
      }

      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v2Config, null, 2))

      const stagingResult = await configModule.read(V2_CONFIG_PATH, 'staging')
      expect(stagingResult.schema).toEqual({ users: { name: 'users' } })

      const prodResult = await configModule.read(V2_CONFIG_PATH, 'prod')
      expect(prodResult.schema).toEqual({ orders: { name: 'orders' } })
    })

    test('should fall back to shared schema when schemas dict has no entry (V2)', async () => {
      const v2Config = {
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
          },
        },
        schema: { legacy_table: { name: 'legacy_table' } },
        schemas: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
      }

      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v2Config, null, 2))

      const result = await configModule.read(V2_CONFIG_PATH)
      expect(result.schema).toEqual({ legacy_table: { name: 'legacy_table' } })
    })

    test('should still read v1 config without breaking', async () => {
      const v1Config = {
        connection: {
          system: 'mysql',
          host: 'db.example.com',
          port: 3306,
          user: 'admin',
          password: 'secret',
          database: 'production',
        },
        permission: 'read-write',
        schema: {},
        metadata: { version: '1.0' },
      }

      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v1Config, null, 2))

      const result = await configModule.read(V2_CONFIG_PATH)

      expect(result.connection.system).toBe('mysql')
      expect(result.connection.host).toBe('db.example.com')
      expect(result.permission).toBe('read-write')
    })

    test('CONFIG-03: V2 .dbcli without audit key gets audit defaults (enabled=true, rotation)', async () => {
      const v2Config = {
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
          },
        },
        schema: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
      }

      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v2Config, null, 2))

      const result = await configModule.read(V2_CONFIG_PATH)

      expect(result.audit.enabled).toBe(true)
      expect(result.audit.rotation.max_bytes).toBe(10_485_760)
      expect(result.audit.rotation.max_entries).toBe(1000)
    })

    test('CONFIG-02: V2 .dbcli with audit.enabled=false preserves false through V2->V1 mapping', async () => {
      const v2Config = {
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
          },
        },
        schema: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
        audit: { enabled: false },
      }

      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v2Config, null, 2))

      const result = await configModule.read(V2_CONFIG_PATH)

      expect(result.audit.enabled).toBe(false)
    })

    test('CONFIG-03: legacy V1 .dbcli without audit key gets audit defaults via zod', async () => {
      const v1Config = {
        connection: {
          system: 'mysql',
          host: 'db.example.com',
          port: 3306,
          user: 'admin',
          password: 'secret',
          database: 'production',
        },
        permission: 'read-write',
        schema: {},
        metadata: { version: '1.0' },
      }

      await Bun.write(`${V2_CONFIG_PATH}/config.json`, JSON.stringify(v1Config, null, 2))

      const result = await configModule.read(V2_CONFIG_PATH)

      expect(result.audit.enabled).toBe(true)
      expect(result.audit.rotation.max_bytes).toBe(10_485_760)
      expect(result.audit.rotation.max_entries).toBe(1000)
    })
  })

  describe('write', () => {
    test('應該寫入有效配置到文件', async () => {
      const config: DbcliConfig = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: 'pass',
          database: 'db',
        },
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
        audit: { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
      }

      await configModule.write(TEST_CONFIG_PATH, config)

      const written = await Bun.file(TEST_CONFIG_PATH).text()
      const parsed = JSON.parse(written)

      expect(parsed.connection.system).toBe('postgresql')
      expect(parsed.permission).toBe('query-only')
    })

    test('應該使用 2 空格縮進格式化 JSON', async () => {
      const config: DbcliConfig = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: 'pass',
          database: 'db',
        },
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
        audit: { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
      }

      await configModule.write(TEST_CONFIG_PATH, config)

      const written = await Bun.file(TEST_CONFIG_PATH).text()

      // 檢查是否有 2 空格縮進（而不是無縮進）
      expect(written).toContain('  "connection"')
      expect(written).toContain('    "system"')
    })

    test('應該在寫入前驗證配置', async () => {
      const invalid = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          // 缺少必需欄位
        },
      }

      await expect(
        configModule.write(TEST_CONFIG_PATH, invalid as unknown as DbcliConfig)
      ).rejects.toThrow(ConfigError)
    })

    test('應該在驗證失敗時拋出 ConfigError', async () => {
      const invalid = {
        connection: {
          system: 'invalid-db',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: '',
          database: 'db',
        },
      }

      await expect(
        configModule.write(TEST_CONFIG_PATH, invalid as unknown as DbcliConfig)
      ).rejects.toThrow(ConfigError)
    })

    test('應該保留 schema refresh metadata', async () => {
      const config: DbcliConfig = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: 'pass',
          database: 'db',
        },
        permission: 'query-only',
        schema: {},
        metadata: {
          version: '1.0',
          schemaLastUpdated: '2026-04-20T00:00:00Z',
          schemaTableCount: 12,
        },
        blacklist: { tables: [], columns: {} },
        audit: { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
      }

      await configModule.write(TEST_CONFIG_PATH, config)

      const written = JSON.parse(await Bun.file(TEST_CONFIG_PATH).text())

      expect(written.metadata.schemaLastUpdated).toBe('2026-04-20T00:00:00Z')
      expect(written.metadata.schemaTableCount).toBe(12)
    })
  })
})
