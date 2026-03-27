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

test('mapError works for all database systems', () => {
  const error = { code: 'ECONNREFUSED' }

  const pgResult = mapError(error, 'postgresql', mockOptions)
  const mysqlResult = mapError(error, 'mysql', { ...mockOptions, system: 'mysql', port: 3306 })
  const mariadbResult = mapError(error, 'mariadb', { ...mockOptions, system: 'mariadb', port: 3306 })

  expect(pgResult.code).toBe('ECONNREFUSED')
  expect(mysqlResult.code).toBe('ECONNREFUSED')
  expect(mariadbResult.code).toBe('ECONNREFUSED')
})
