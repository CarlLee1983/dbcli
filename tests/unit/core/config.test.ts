/**
 * 配置模組單元測試
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { configModule } from '@/core/config'
import { ConfigError } from '@/utils/errors'
import { DbcliConfig } from '@/utils/validation'
import { existsSync, unlinkSync } from 'fs'
import path from 'path'

// 用於測試的臨時路徑
const TEST_CONFIG_PATH = '/tmp/test.dbcli.json'

describe('configModule', () => {
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
          database: 'production'
        },
        permission: 'read-write',
        schema: {},
        metadata: {
          version: '1.0'
        }
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
          host: 'localhost'
          // 缺少必需欄位
        }
      }

      await Bun.file(TEST_CONFIG_PATH).write(JSON.stringify(invalidConfig))

      await expect(configModule.read(TEST_CONFIG_PATH)).rejects.toThrow(ConfigError)
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
          database: 'db'
        },
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' }
      }

      const result = configModule.validate(valid)
      expect(result.connection.system).toBe('postgresql')
    })

    test('應該在缺少必需欄位時拋出 ConfigError', () => {
      const invalid = {
        connection: {
          system: 'postgresql',
          host: 'localhost'
        }
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
          database: 'db'
        },
        permission: 'invalid-permission'
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
        database: 'db'
      },
      permission: 'query-only',
      schema: { table1: 'data' },
      metadata: { version: '1.0', createdAt: '2026-01-01T00:00:00Z' }
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
        connection: { port: 3306 }
      }

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
        metadata: { version: '1.0', createdAt: originalCreatedAt }
      }

      const result = configModule.merge(config, {
        permission: 'admin'
      })

      expect(result.metadata.createdAt).toBe(originalCreatedAt)
    })

    test('應該在沒有 createdAt 時設置新時間戳', () => {
      const config: DbcliConfig = {
        ...baseConfig,
        metadata: { version: '1.0' }
      }

      const result = configModule.merge(config, {})

      expect(result.metadata.createdAt).toBeDefined()
      expect(typeof result.metadata.createdAt).toBe('string')
    })

    test('應該合併 schema', () => {
      const result = configModule.merge(baseConfig, {
        schema: { table2: 'newdata' }
      })

      // schema 應該被深度合併，而不是替換
      expect(result.schema).toEqual({ table1: 'data', table2: 'newdata' })
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
          database: 'db'
        },
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' }
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
          database: 'db'
        },
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' }
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
          host: 'localhost'
          // 缺少必需欄位
        }
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
          database: 'db'
        }
      }

      await expect(
        configModule.write(TEST_CONFIG_PATH, invalid as unknown as DbcliConfig)
      ).rejects.toThrow(ConfigError)
    })
  })
})
