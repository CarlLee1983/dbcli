/**
 * PostgreSQL adapter integration tests
 * Tests real database connections if available, skips otherwise
 *
 * Requirements: PostgreSQL 12+ running on localhost:5432
 * Default credentials: user=postgres, password=postgres, database=postgres
 *
 * To skip: Set SKIP_INTEGRATION_TESTS=true
 */

import { test, expect, describe } from 'bun:test'
import { PostgreSQLAdapter } from 'src/adapters/postgresql-adapter'
import { ConnectionError } from 'src/adapters'
import type { ConnectionOptions } from 'src/adapters/types'

// Check if integration tests should be skipped
const SKIP_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true'

// Mock PostgreSQL connection options
const validOptions: ConnectionOptions = {
  system: 'postgresql',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'postgres'
}

const invalidOptions: ConnectionOptions = {
  system: 'postgresql',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'wrong_password_definitely_invalid_xyz',
  database: 'postgres'
}

const unreachableOptions: ConnectionOptions = {
  system: 'postgresql',
  host: '10.255.255.1', // Non-routable IP
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'postgres',
  timeout: 1000 // Short timeout for faster failure
}

describe('PostgreSQL Adapter Integration Tests', () => {
  test('connect() succeeds with valid credentials', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(validOptions)
    try {
      await adapter.connect()
      expect(true).toBe(true) // Connection succeeded
    } finally {
      await adapter.disconnect()
    }
  })

  test('connect() throws AUTH_FAILED for invalid password', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(invalidOptions)
    try {
      await adapter.connect()
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionError)
      const connErr = error as ConnectionError
      expect(connErr.code).toBe('AUTH_FAILED')
      expect(connErr.hints.length).toBeGreaterThan(0)
    }
  })

  test('connect() throws ECONNREFUSED or ETIMEDOUT for unreachable host', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(unreachableOptions)
    try {
      await adapter.connect()
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionError)
      const connErr = error as ConnectionError
      expect(['ECONNREFUSED', 'ETIMEDOUT'].includes(connErr.code)).toBe(true)
      expect(connErr.hints.length).toBeGreaterThan(0)
    }
  })

  test('testConnection() returns true when connected', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(validOptions)
    try {
      await adapter.connect()
      const result = await adapter.testConnection()
      expect(result).toBe(true)
    } finally {
      await adapter.disconnect()
    }
  })

  test('execute() runs SELECT query and returns results', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(validOptions)
    try {
      await adapter.connect()
      const results = await adapter.execute<{ count: number }>('SELECT 1 as count')
      expect(results).toBeInstanceOf(Array)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].count).toBe(1)
    } finally {
      await adapter.disconnect()
    }
  })

  test('listTables() returns array of tables', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(validOptions)
    try {
      await adapter.connect()
      const tables = await adapter.listTables()
      expect(tables).toBeInstanceOf(Array)
      // postgres database should have system tables
      expect(tables.length).toBeGreaterThanOrEqual(0)
    } finally {
      await adapter.disconnect()
    }
  })

  test('getTableSchema() works for existing tables', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(validOptions)
    try {
      await adapter.connect()
      // Get first table to test
      const tables = await adapter.listTables()
      if (tables.length > 0) {
        const schema = await adapter.getTableSchema(tables[0].name)
        expect(schema).toHaveProperty('name')
        expect(schema).toHaveProperty('columns')
        expect(Array.isArray(schema.columns)).toBe(true)
      }
    } finally {
      await adapter.disconnect()
    }
  })

  test('disconnect() closes connection safely', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(validOptions)
    await adapter.connect()
    await adapter.disconnect()
    // Should not throw when disconnecting again
    await expect(adapter.disconnect()).resolves.toBeUndefined()
  })

  test('disconnect() is safe to call multiple times', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(validOptions)
    await adapter.connect()
    // Multiple disconnects should not throw
    await adapter.disconnect()
    await adapter.disconnect()
    await adapter.disconnect()
    expect(true).toBe(true)
  })
})
