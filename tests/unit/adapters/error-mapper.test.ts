/**
 * Unit tests for error-mapper
 * Tests error categorization and hint generation for all error types
 */

import { test, expect } from 'bun:test'
import { mapError, ConnectionError } from 'src/adapters/error-mapper'
import type { ConnectionOptions } from 'src/adapters/types'

const mockOptions: ConnectionOptions = {
  system: 'postgresql',
  host: 'localhost',
  port: 5432,
  user: 'testuser',
  password: 'testpass',
  database: 'testdb',
}

test('mapError categorizes ECONNREFUSED error', () => {
  const error = { code: 'ECONNREFUSED', message: 'Connection refused' }
  const result = mapError(error, 'postgresql', mockOptions)

  expect(result).toBeInstanceOf(ConnectionError)
  expect(result.code).toBe('ECONNREFUSED')
  expect(result.message).toContain('Cannot connect')
  expect(result.hints).toBeInstanceOf(Array)
  expect(result.hints.length).toBeGreaterThan(0)
})

test('mapError categorizes ETIMEDOUT error', () => {
  const error = { code: 'ETIMEDOUT', message: 'Connection timed out' }
  const result = mapError(error, 'postgresql', mockOptions)

  expect(result.code).toBe('ETIMEDOUT')
  expect(result.message).toContain('timed out')
  expect(result.hints.length).toBeGreaterThan(0)
})

test('mapError categorizes authentication failed error', () => {
  const error = { message: 'FATAL:  role "testuser" does not exist' }
  const result = mapError(error, 'postgresql', mockOptions)

  expect(result.code).toBe('AUTH_FAILED')
  expect(result.message).toContain('Authentication failed')
  expect(result.hints.length).toBeGreaterThan(0)
})

test('mapError categorizes ENOTFOUND error', () => {
  const error = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND localhost' }
  const result = mapError(error, 'postgresql', mockOptions)

  expect(result.code).toBe('ENOTFOUND')
  expect(result.message).toContain('Host not found')
  expect(result.hints.length).toBeGreaterThan(0)
})

test('mapError categorizes unknown error as UNKNOWN', () => {
  const error = { message: 'Some weird database driver error' }
  const result = mapError(error, 'postgresql', mockOptions)

  expect(result.code).toBe('UNKNOWN')
  expect(result.message).toContain('Connection failed')
  expect(result.hints.length).toBeGreaterThan(0)
})

test('ConnectionError extends Error and has required properties', () => {
  const error = mapError({ code: 'ECONNREFUSED' }, 'postgresql', mockOptions)

  expect(error).toBeInstanceOf(Error)
  expect(error.code).toBeDefined()
  expect(error.message).toBeDefined()
  expect(error.hints).toBeInstanceOf(Array)
  expect(error.name).toBe('ConnectionError')
})

test('mapError preserves an already categorized ConnectionError', () => {
  const original = new ConnectionError('SQL_SYNTAX_ERROR', 'SQL syntax error: sentinel', [
    'original hint',
  ])

  const result = mapError(original, 'mysql', {
    ...mockOptions,
    system: 'mysql',
    port: 3306,
  })

  expect(result).toBe(original)
  expect(result.code).toBe('SQL_SYNTAX_ERROR')
  expect(result.message).toBe('SQL syntax error: sentinel')
  expect(result.hints).toEqual(['original hint'])
})

test('mapError works for all database systems', () => {
  const error = { code: 'ECONNREFUSED' }

  const pgResult = mapError(error, 'postgresql', mockOptions)
  const mysqlResult = mapError(error, 'mysql', { ...mockOptions, system: 'mysql', port: 3306 })
  const mariadbResult = mapError(error, 'mariadb', {
    ...mockOptions,
    system: 'mariadb',
    port: 3306,
  })

  expect(pgResult.code).toBe('ECONNREFUSED')
  expect(mysqlResult.code).toBe('ECONNREFUSED')
  expect(mariadbResult.code).toBe('ECONNREFUSED')
})

test('ConnectionError accepts SQL_SYNTAX_ERROR code', () => {
  const err = new ConnectionError('SQL_SYNTAX_ERROR', 'msg', ['hint'])
  expect(err.code).toBe('SQL_SYNTAX_ERROR')
})

test('ConnectionError accepts TABLE_NOT_FOUND code', () => {
  const err = new ConnectionError('TABLE_NOT_FOUND', 'msg', ['hint'])
  expect(err.code).toBe('TABLE_NOT_FOUND')
})

test('ConnectionError accepts COLUMN_NOT_FOUND code', () => {
  const err = new ConnectionError('COLUMN_NOT_FOUND', 'msg', ['hint'])
  expect(err.code).toBe('COLUMN_NOT_FOUND')
})

test('mapError: MySQL ER_PARSE_ERROR (1064) → SQL_SYNTAX_ERROR', () => {
  const error = {
    code: 'ER_PARSE_ERROR',
    errno: 1064,
    message:
      "You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near 'LIMIT 1000' at line 1",
  }
  const result = mapError(error, 'mariadb', { ...mockOptions, system: 'mariadb' })
  expect(result.code).toBe('SQL_SYNTAX_ERROR')
  expect(result.message.toLowerCase()).toContain('sql syntax')
  expect(result.hints.join(' ')).toContain('--no-limit')
})

test('mapError: PostgreSQL syntax_error (42601) → SQL_SYNTAX_ERROR', () => {
  const error = {
    code: '42601',
    message: 'syntax error at or near "FROOM"',
  }
  const result = mapError(error, 'postgresql', mockOptions)
  expect(result.code).toBe('SQL_SYNTAX_ERROR')
  expect(result.message.toLowerCase()).toContain('sql syntax')
})

test('mapError: SQL_SYNTAX_ERROR does NOT include connection-troubleshooting hints', () => {
  const error = { code: 'ER_PARSE_ERROR', errno: 1064, message: 'bad syntax' }
  const result = mapError(error, 'mariadb', { ...mockOptions, system: 'mariadb' })
  const hints = result.hints.join(' ')
  expect(hints).not.toContain('mysql.log')
  expect(hints).not.toContain('host=')
})

test('mapError: MySQL ER_NO_SUCH_TABLE (1146) → TABLE_NOT_FOUND', () => {
  const error = {
    code: 'ER_NO_SUCH_TABLE',
    errno: 1146,
    message: "Table 'station_local.bets' doesn't exist",
  }
  const result = mapError(error, 'mariadb', {
    ...mockOptions,
    system: 'mariadb',
    database: 'station_local',
  })
  expect(result.code).toBe('TABLE_NOT_FOUND')
  expect(result.message).toContain('bets')
  expect(result.message).toContain('station_local')
  expect(result.hints.join(' ')).toContain('dbcli list')
})

test('mapError: PostgreSQL undefined_table (42P01) → TABLE_NOT_FOUND', () => {
  const error = {
    code: '42P01',
    message: 'relation "bets" does not exist',
  }
  const result = mapError(error, 'postgresql', { ...mockOptions, database: 'testdb' })
  expect(result.code).toBe('TABLE_NOT_FOUND')
  expect(result.message).toContain('bets')
  expect(result.hints.join(' ')).toContain('dbcli list')
})

test('mapError: TABLE_NOT_FOUND does NOT include connection-troubleshooting hints', () => {
  const error = { code: 'ER_NO_SUCH_TABLE', errno: 1146, message: "Table 'x.y' doesn't exist" }
  const result = mapError(error, 'mariadb', { ...mockOptions, system: 'mariadb' })
  expect(result.hints.join(' ')).not.toContain('mysql.log')
})

test('mapError: MySQL ER_BAD_FIELD_ERROR (1054) → COLUMN_NOT_FOUND', () => {
  const error = {
    code: 'ER_BAD_FIELD_ERROR',
    errno: 1054,
    message: "Unknown column 'usr_id' in 'where clause'",
  }
  const result = mapError(error, 'mariadb', { ...mockOptions, system: 'mariadb' })
  expect(result.code).toBe('COLUMN_NOT_FOUND')
  expect(result.message).toContain('usr_id')
  expect(result.hints.join(' ')).toContain('dbcli schema')
})

test('mapError: PostgreSQL undefined_column (42703) → COLUMN_NOT_FOUND', () => {
  const error = {
    code: '42703',
    message: 'column "usr_id" does not exist',
  }
  const result = mapError(error, 'postgresql', mockOptions)
  expect(result.code).toBe('COLUMN_NOT_FOUND')
  expect(result.message).toContain('usr_id')
})

// ── code 優先於字串（#40） ─────────────────────────────────────────────────

test('mapError: 帶 code 的錯誤不因訊息含 "user" 被判成認證失敗', () => {
  const error = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "users_email_key"',
  }
  const result = mapError(error, 'postgresql', mockOptions)
  expect(result.code).not.toBe('AUTH_FAILED')
  expect(result.message).toContain('users_email_key')
})

test('mapError: 帶 errno 的 MySQL 重複鍵錯誤不被判成認證失敗', () => {
  const error = {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    message: "Duplicate entry 'a@b.c' for key 'users.email'",
  }
  const result = mapError(error, 'mariadb', { ...mockOptions, system: 'mariadb' })
  expect(result.code).not.toBe('AUTH_FAILED')
  expect(result.message).toContain('Duplicate entry')
})

test('mapError: 表名含 "user" 的 undefined_table 仍分類為 TABLE_NOT_FOUND', () => {
  const error = { code: '42P01', message: 'relation "user_sessions" does not exist' }
  const result = mapError(error, 'postgresql', mockOptions)
  expect(result.code).toBe('TABLE_NOT_FOUND')
  expect(result.message).toContain('user_sessions')
})

test('mapError: 未知 code 的伺服器錯誤不套用連線疑難排解提示', () => {
  const error = { code: '42501', message: 'permission denied for table users' }
  const result = mapError(error, 'postgresql', mockOptions)
  expect(result.code).toBe('UNKNOWN')
  expect(result.message).toContain('permission denied for table users')
  expect(result.message).not.toContain('Connection failed')
  expect(result.hints.join(' ')).not.toContain('host=')
})

test('mapError: PostgreSQL invalid_password (28P01) → AUTH_FAILED', () => {
  const error = { code: '28P01', message: 'password authentication failed for user "testuser"' }
  expect(mapError(error, 'postgresql', mockOptions).code).toBe('AUTH_FAILED')
})

test('mapError: MySQL ER_ACCESS_DENIED_ERROR (1045) → AUTH_FAILED', () => {
  const error = {
    code: 'ER_ACCESS_DENIED_ERROR',
    errno: 1045,
    message: "Access denied for user 'root'@'localhost'",
  }
  expect(mapError(error, 'mysql', { ...mockOptions, system: 'mysql' }).code).toBe('AUTH_FAILED')
})

test('mapError: 訊息含 "timeout" 但帶查詢 code 時不被判成連線逾時', () => {
  const error = { code: '57014', message: 'canceling statement due to statement timeout' }
  const result = mapError(error, 'postgresql', mockOptions)
  expect(result.code).not.toBe('ECONNREFUSED')
  expect(result.message).toContain('statement timeout')
})

test('mapError: 無 code 時字串後備需完整詞組，"user" 不足以判成認證失敗', () => {
  const error = { message: 'unexpected end of user-defined function stream' }
  const result = mapError(error, 'postgresql', mockOptions)
  expect(result.code).toBe('UNKNOWN')
})

test('mapError: 無 code 時 "authentication failed" 仍判成 AUTH_FAILED', () => {
  const error = { message: 'password authentication failed for user "testuser"' }
  expect(mapError(error, 'postgresql', mockOptions).code).toBe('AUTH_FAILED')
})
