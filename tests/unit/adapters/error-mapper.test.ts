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
