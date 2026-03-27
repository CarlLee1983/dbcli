/**
 * Init 命令集成測試
 *
 * 測試完整的 dbcli init 工作流程，包括：
 * - 環境變數解析
 * - 配置驗證和合併
 * - 預設值
 */

import { describe, test, expect } from 'bun:test'
import { configModule } from '@/core/config'
import { parseEnvDatabase } from '@/core/env-parser'
import { getDefaultsForSystem } from '@/adapters/defaults'
import { AdapterFactory, ConnectionError } from '@/adapters'

describe('Init Command Integration Tests', () => {
  test('應該從 DATABASE_URL 格式解析配置', () => {
    // 驗證：解析 DATABASE_URL
    const result = parseEnvDatabase({
      DATABASE_URL: 'postgresql://testuser:testpass@localhost:5432/testdb'
    })

    expect(result).not.toBeNull()
    expect(result?.system).toBe('postgresql')
    expect(result?.host).toBe('localhost')
    expect(result?.port).toBe(5432)
    expect(result?.user).toBe('testuser')
    expect(result?.password).toBe('testpass')
    expect(result?.database).toBe('testdb')
  })

  test('應該從 DB_* 元件格式解析配置', () => {
    // 驗證：解析 DB_* 元件
    const result = parseEnvDatabase({
      DB_SYSTEM: 'mysql',
      DB_HOST: 'db.example.com',
      DB_PORT: '3306',
      DB_USER: 'admin',
      DB_PASSWORD: 'secret123',
      DB_NAME: 'production'
    })

    expect(result).not.toBeNull()
    expect(result?.system).toBe('mysql')
    expect(result?.host).toBe('db.example.com')
    expect(result?.port).toBe(3306)
    expect(result?.user).toBe('admin')
    expect(result?.password).toBe('secret123')
    expect(result?.database).toBe('production')
  })

  test('應該在沒有 .env 時返回 null', () => {
    // 驗證：沒有配置時返回 null
    const result = parseEnvDatabase({})
    expect(result).toBeNull()
  })

  test('應該支援 RFC 3986 百分比編碼的密碼', () => {
    // 驗證：支援特殊字符
    const result = parseEnvDatabase({
      DATABASE_URL: 'postgresql://user:p%40%24%24w0rd@localhost/db'
    })

    expect(result?.password).toBe('p@$$w0rd')
  })

  test('應該合併配置時保留 createdAt', () => {
    // 設置：創建現有配置
    const existingConfig = {
      connection: {
        system: 'postgresql' as const,
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'pass',
        database: 'db'
      },
      permission: 'query-only' as const,
      schema: {},
      metadata: {
        version: '1.0',
        createdAt: '2026-03-25T00:00:00Z'
      }
    }

    // 合併新值
    const merged = configModule.merge(existingConfig, {
      permission: 'admin'
    })

    // 驗證：createdAt 保留
    expect(merged.metadata?.createdAt).toBe('2026-03-25T00:00:00Z')
    expect(merged.permission).toBe('admin')
  })

  test('應該合併配置時使用不可變語義', () => {
    // 設置：原配置
    const original = {
      connection: {
        system: 'postgresql' as const,
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'pass',
        database: 'db'
      },
      permission: 'query-only' as const,
      schema: {},
      metadata: { version: '1.0' }
    }

    const originalCopy = JSON.stringify(original)

    // 運行：合併
    configModule.merge(original, { permission: 'admin' })

    // 驗證：原配置未改變（不可變語義）
    expect(JSON.stringify(original)).toBe(originalCopy)
  })

  test('應該為不同的資料庫系統提供預設值', () => {
    // PostgreSQL 預設值
    const pgDefaults = getDefaultsForSystem('postgresql')
    expect(pgDefaults.port).toBe(5432)
    expect(pgDefaults.host).toBe('localhost')

    // MySQL 預設值
    const mysqlDefaults = getDefaultsForSystem('mysql')
    expect(mysqlDefaults.port).toBe(3306)
    expect(mysqlDefaults.host).toBe('localhost')

    // MariaDB 預設值
    const mariadbDefaults = getDefaultsForSystem('mariadb')
    expect(mariadbDefaults.port).toBe(3306)
    expect(mariadbDefaults.host).toBe('localhost')
  })

  test('應該驗證有效的配置結構', () => {
    // 驗證：有效配置
    const validConfig = {
      connection: {
        system: 'postgresql' as const,
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'pass',
        database: 'db'
      },
      permission: 'query-only' as const,
      schema: {},
      metadata: { version: '1.0' }
    }

    expect(() => configModule.validate(validConfig)).not.toThrow()
  })

  test('應該拒絕無效的權限級別', () => {
    // 驗證：無效權限
    const invalidConfig = {
      connection: {
        system: 'postgresql' as const,
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'pass',
        database: 'db'
      },
      permission: 'invalid-permission',
      schema: {},
      metadata: { version: '1.0' }
    } as unknown

    expect(() => configModule.validate(invalidConfig)).toThrow()
  })

  test('應該拒絕無效的埠號範圍', () => {
    // 驗證：埠號超出範圍
    const invalidConfig = {
      connection: {
        system: 'postgresql' as const,
        host: 'localhost',
        port: 99999,
        user: 'user',
        password: 'pass',
        database: 'db'
      },
      permission: 'query-only' as const,
      schema: {},
      metadata: { version: '1.0' }
    } as unknown

    expect(() => configModule.validate(invalidConfig)).toThrow()
  })

  test('應該拒絕無效的資料庫系統', () => {
    // 驗證：無效系統
    const invalidConfig = {
      connection: {
        system: 'mongodb' as unknown,
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'pass',
        database: 'db'
      },
      permission: 'query-only' as const,
      schema: {},
      metadata: { version: '1.0' }
    }

    expect(() => configModule.validate(invalidConfig as unknown)).toThrow()
  })

  test('應該支援多個資料庫系統的連接字符串', () => {
    // PostgreSQL
    const pg = parseEnvDatabase({
      DATABASE_URL: 'postgresql://user:pass@host:5432/db'
    })
    expect(pg?.system).toBe('postgresql')

    // MySQL
    const mysql = parseEnvDatabase({
      DATABASE_URL: 'mysql://user:pass@host:3306/db'
    })
    expect(mysql?.system).toBe('mysql')

    // MariaDB
    const mariadb = parseEnvDatabase({
      DATABASE_URL: 'mariadb://user:pass@host:3306/db'
    })
    expect(mariadb?.system).toBe('mariadb')
  })

  test('應該在 DB_* 格式中使用預設埠號', () => {
    // PostgreSQL 預設埠
    const pg = parseEnvDatabase({
      DB_SYSTEM: 'postgresql',
      DB_HOST: 'localhost',
      DB_USER: 'user',
      DB_NAME: 'db'
    })
    expect(pg?.port).toBe(5432)

    // MySQL 預設埠
    const mysql = parseEnvDatabase({
      DB_SYSTEM: 'mysql',
      DB_HOST: 'localhost',
      DB_USER: 'user',
      DB_NAME: 'db'
    })
    expect(mysql?.port).toBe(3306)
  })

  test('init command tests connection with valid credentials', async () => {
    // 跳過測試如果 SKIP_INTEGRATION_TESTS 已設置
    if (process.env.SKIP_INTEGRATION_TESTS === 'true') return

    // 驗證：使用有效的認證建立連接
    const config = {
      system: 'postgresql' as const,
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres'
    }

    const adapter = AdapterFactory.createAdapter(config)
    try {
      await adapter.connect()
      const isHealthy = await adapter.testConnection()
      expect(isHealthy).toBe(true)
    } finally {
      await adapter.disconnect()
    }
  })

  test('init command fails gracefully with invalid credentials', async () => {
    // 跳過測試如果 SKIP_INTEGRATION_TESTS 已設置
    if (process.env.SKIP_INTEGRATION_TESTS === 'true') return

    // 驗證：無效密碼拋出 ConnectionError
    const config = {
      system: 'postgresql' as const,
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'wrong_password',
      database: 'postgres'
    }

    const adapter = AdapterFactory.createAdapter(config)
    try {
      await adapter.connect()
      expect(false).toBe(true) // 不應該到達這裡
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionError)
      const connErr = error as ConnectionError
      expect(connErr.code).toBe('AUTH_FAILED')
      expect(connErr.hints.length).toBeGreaterThan(0)
    }
  })

  test('init command shows connection hints on error', async () => {
    // 跳過測試如果 SKIP_INTEGRATION_TESTS 已設置
    if (process.env.SKIP_INTEGRATION_TESTS === 'true') return

    // 驗證：連接錯誤包含有用的提示
    const config = {
      system: 'postgresql' as const,
      host: '10.255.255.1', // 無法到達的 IP
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
      timeout: 1000
    }

    const adapter = AdapterFactory.createAdapter(config)
    try {
      await adapter.connect()
      expect(false).toBe(true) // 不應該到達這裡
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionError)
      const connErr = error as ConnectionError
      expect(['ECONNREFUSED', 'ETIMEDOUT'].includes(connErr.code)).toBe(true)
      // 驗證提示包含有用的信息
      expect(connErr.hints.length).toBeGreaterThan(0)
      expect(connErr.hints.some(hint => hint.includes('防火牆') || hint.includes('ping') || hint.includes('超時'))).toBe(true)
    }
  })
})
