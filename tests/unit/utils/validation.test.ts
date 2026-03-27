/**
 * Zod 驗證模式單元測試
 */

import { describe, test, expect } from 'bun:test'
import {
  DbcliConfigSchema,
  ConnectionConfigSchema,
  PermissionSchema
} from '@/utils/validation'
import { ZodError } from 'zod'

describe('validation', () => {
  describe('ConnectionConfigSchema', () => {
    test('應該接受有效的連接配置', () => {
      const valid = {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'dbuser',
        password: 'dbpass',
        database: 'mydb'
      }

      const result = ConnectionConfigSchema.parse(valid)
      expect(result.system).toBe('postgresql')
      expect(result.port).toBe(5432)
    })

    test('應該要求 system 為允許的值之一', () => {
      const invalid = {
        system: 'oracle',
        host: 'localhost',
        port: 5432,
        user: 'dbuser',
        password: 'dbpass',
        database: 'mydb'
      }

      expect(() => ConnectionConfigSchema.parse(invalid)).toThrow(ZodError)
    })

    test('應該驗證埠號在 1-65535 範圍內', () => {
      const tooLow = {
        system: 'postgresql',
        host: 'localhost',
        port: 0,
        user: 'dbuser',
        password: 'dbpass',
        database: 'mydb'
      }

      expect(() => ConnectionConfigSchema.parse(tooLow)).toThrow(ZodError)

      const tooHigh = {
        system: 'postgresql',
        host: 'localhost',
        port: 99999,
        user: 'dbuser',
        password: 'dbpass',
        database: 'mydb'
      }

      expect(() => ConnectionConfigSchema.parse(tooHigh)).toThrow(ZodError)
    })

    test('應該要求主機名稱', () => {
      const invalid = {
        system: 'postgresql',
        host: '',
        port: 5432,
        user: 'dbuser',
        password: 'dbpass',
        database: 'mydb'
      }

      expect(() => ConnectionConfigSchema.parse(invalid)).toThrow(ZodError)
    })

    test('應該要求用戶名稱', () => {
      const invalid = {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: '',
        password: 'dbpass',
        database: 'mydb'
      }

      expect(() => ConnectionConfigSchema.parse(invalid)).toThrow(ZodError)
    })

    test('應該要求資料庫名稱', () => {
      const invalid = {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'dbuser',
        password: 'dbpass',
        database: ''
      }

      expect(() => ConnectionConfigSchema.parse(invalid)).toThrow(ZodError)
    })

    test('應該允許空密碼字符串', () => {
      const valid = {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'dbuser',
        password: '',
        database: 'mydb'
      }

      const result = ConnectionConfigSchema.parse(valid)
      expect(result.password).toBe('')
    })

    test('應該預設密碼為空字符串', () => {
      const withoutPassword = {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'dbuser',
        database: 'mydb'
      }

      const result = ConnectionConfigSchema.parse(withoutPassword)
      expect(result.password).toBe('')
    })
  })

  describe('PermissionSchema', () => {
    test('應該接受有效的權限值', () => {
      expect(PermissionSchema.parse('query-only')).toBe('query-only')
      expect(PermissionSchema.parse('read-write')).toBe('read-write')
      expect(PermissionSchema.parse('admin')).toBe('admin')
    })

    test('應該拒絕無效的權限值', () => {
      expect(() => PermissionSchema.parse('superuser')).toThrow(ZodError)
      expect(() => PermissionSchema.parse('write-only')).toThrow(ZodError)
    })

    test('應該預設為 query-only', () => {
      const result = PermissionSchema.parse(undefined)
      expect(result).toBe('query-only')
    })
  })

  describe('DbcliConfigSchema', () => {
    test('應該接受完整有效的配置', () => {
      const valid = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'dbuser',
          password: 'dbpass',
          database: 'mydb'
        },
        permission: 'query-only',
        schema: {},
        metadata: {
          version: '1.0'
        }
      }

      const result = DbcliConfigSchema.parse(valid)
      expect(result.connection.system).toBe('postgresql')
      expect(result.permission).toBe('query-only')
    })

    test('應該要求連接對象', () => {
      const invalid = {
        permission: 'query-only'
      }

      expect(() => DbcliConfigSchema.parse(invalid)).toThrow(ZodError)
    })

    test('應該使 schema 和 metadata 為選擇性的', () => {
      const minimal = {
        connection: {
          system: 'mysql',
          host: 'localhost',
          port: 3306,
          user: 'root',
          password: '',
          database: 'db'
        }
      }

      const result = DbcliConfigSchema.parse(minimal)
      expect(result.schema).toBeDefined()
      expect(result.metadata).toBeDefined()
    })

    test('應該使用預設權限 query-only', () => {
      const config = {
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: '',
          database: 'db'
        }
      }

      const result = DbcliConfigSchema.parse(config)
      expect(result.permission).toBe('query-only')
    })

    test('應該在缺少必需的連接欄位時拋出錯誤', () => {
      const invalid = {
        connection: {
          system: 'postgresql',
          host: 'localhost'
          // 缺少 port、user、password、database
        }
      }

      expect(() => DbcliConfigSchema.parse(invalid)).toThrow(ZodError)
    })
  })
})
