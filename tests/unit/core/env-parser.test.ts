/**
 * .env 解析器單元測試
 */

import { describe, test, expect } from 'vitest'
import { parseConnectionUrl, parseEnvDatabase } from '@/core/env-parser'
import { EnvParseError } from '@/utils/errors'

describe('env-parser', () => {
  describe('parseConnectionUrl', () => {
    test('應該解析 PostgreSQL DATABASE_URL', () => {
      const result = parseConnectionUrl('postgresql://user:password@localhost:5432/testdb')

      expect(result.system).toBe('postgresql')
      expect(result.host).toBe('localhost')
      expect(result.port).toBe(5432)
      expect(result.user).toBe('user')
      expect(result.password).toBe('password')
      expect(result.database).toBe('testdb')
    })

    test('應該解析 MySQL DATABASE_URL', () => {
      const result = parseConnectionUrl('mysql://root:pass@localhost:3306/mydb')

      expect(result.system).toBe('mysql')
      expect(result.host).toBe('localhost')
      expect(result.port).toBe(3306)
      expect(result.user).toBe('root')
      expect(result.password).toBe('pass')
      expect(result.database).toBe('mydb')
    })

    test('應該解析 MariaDB DATABASE_URL', () => {
      const result = parseConnectionUrl('mariadb://user:pass@localhost:3306/db')

      expect(result.system).toBe('mariadb')
      expect(result.database).toBe('db')
    })

    test('應該處理百分比編碼的特殊字符（密碼）', () => {
      // p@$$w0rd 編碼為 p%40%24%24w0rd
      const result = parseConnectionUrl('postgresql://user:p%40%24%24w0rd@localhost/db')

      expect(result.password).toBe('p@$$w0rd')
    })

    test('應該處理百分比編碼的特殊字符（用戶名）', () => {
      const result = parseConnectionUrl('mysql://user%21email%40host:pass@localhost/db')

      expect(result.user).toBe('user!email@host')
    })

    test('應該使用預設埠（缺少埠號時）', () => {
      const pgResult = parseConnectionUrl('postgresql://user:pass@localhost/db')
      expect(pgResult.port).toBe(5432)

      const mysqlResult = parseConnectionUrl('mysql://user:pass@localhost/db')
      expect(mysqlResult.port).toBe(3306)
    })

    test('應該在無效 URL 時拋出 EnvParseError', () => {
      expect(() => parseConnectionUrl('not-a-url')).toThrow(EnvParseError)
    })

    test('應該在不認識的協議時拋出 EnvParseError', () => {
      expect(() => parseConnectionUrl('oracle://user:pass@localhost/db')).toThrow(EnvParseError)
    })

    test('應該處理 postgres 協議別名', () => {
      const result = parseConnectionUrl('postgres://user:pass@localhost/db')
      expect(result.system).toBe('postgresql')
    })
  })

  describe('parseEnvDatabase', () => {
    test('應該偵測並解析 DATABASE_URL', () => {
      const env = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' }
      const result = parseEnvDatabase(env)

      expect(result).not.toBeNull()
      expect(result?.system).toBe('postgresql')
      expect(result?.database).toBe('db')
    })

    test('應該在不存在 DATABASE_URL 時回退到 DB_* 元件', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_USER: 'user',
        DB_PASSWORD: 'pass',
        DB_NAME: 'db',
        DB_SYSTEM: 'postgresql'
      }
      const result = parseEnvDatabase(env)

      expect(result).not.toBeNull()
      expect(result?.host).toBe('localhost')
      expect(result?.port).toBe(5432)
      expect(result?.user).toBe('user')
      expect(result?.database).toBe('db')
    })

    test('應該在都未找到時返回 null', () => {
      const env = {}
      const result = parseEnvDatabase(env)

      expect(result).toBeNull()
    })

    test('應該在缺少 DB_USER 時拋出 EnvParseError', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_NAME: 'db'
      }

      expect(() => parseEnvDatabase(env)).toThrow(EnvParseError)
    })

    test('應該在缺少 DB_NAME 時拋出 EnvParseError', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_USER: 'user'
      }

      expect(() => parseEnvDatabase(env)).toThrow(EnvParseError)
    })

    test('DB_SYSTEM 應該預設為 postgresql', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_USER: 'user',
        DB_NAME: 'db'
      }
      const result = parseEnvDatabase(env)

      expect(result?.system).toBe('postgresql')
    })

    test('應該將 DB_PORT 解析為整數', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_USER: 'user',
        DB_NAME: 'db',
        DB_PORT: '3306'
      }
      const result = parseEnvDatabase(env)

      expect(typeof result?.port).toBe('number')
      expect(result?.port).toBe(3306)
    })

    test('DB_PASSWORD 應該預設為空字符串', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_USER: 'user',
        DB_NAME: 'db'
      }
      const result = parseEnvDatabase(env)

      expect(result?.password).toBe('')
    })

    test('應該在無效的 DB_PORT 時拋出 EnvParseError', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_USER: 'user',
        DB_NAME: 'db',
        DB_PORT: 'invalid'
      }

      expect(() => parseEnvDatabase(env)).toThrow(EnvParseError)
    })

    test('應該在超出範圍的 DB_PORT 時拋出 EnvParseError', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_USER: 'user',
        DB_NAME: 'db',
        DB_PORT: '99999'
      }

      expect(() => parseEnvDatabase(env)).toThrow(EnvParseError)
    })
  })
})
