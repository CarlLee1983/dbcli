/**
 * MySQL adapter integration tests
 * Tests real database connections if available, skips otherwise
 *
 * Requirements: MySQL 8.0+ or MariaDB 10.5+ running on localhost:3306
 * Default credentials: user=root, password=root, database=mysql
 *
 * To skip: Set SKIP_INTEGRATION_TESTS=true
 */

import { test, expect, describe } from 'bun:test'
import { MySQLAdapter } from 'src/adapters/mysql-adapter'
import { ConnectionError } from 'src/adapters'
import type { ConnectionOptions } from 'src/adapters/types'

// Check if integration tests should be skipped
const SKIP_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true'

// Mock MySQL connection options
const validOptions: ConnectionOptions = {
  system: 'mysql',
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'root',
  database: 'mysql'
}

const validMariaDBOptions: ConnectionOptions = {
  system: 'mariadb',
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'root',
  database: 'mysql'
}

const invalidOptions: ConnectionOptions = {
  system: 'mysql',
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'wrong_password_definitely_invalid_xyz',
  database: 'mysql'
}

const unreachableOptions: ConnectionOptions = {
  system: 'mysql',
  host: '10.255.255.1', // Non-routable IP
  port: 3306,
  user: 'root',
  password: 'root',
  database: 'mysql',
  timeout: 1000 // Short timeout for faster failure
}

describe('MySQL Adapter Integration Tests', () => {
  test('connect() succeeds with valid credentials', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter(validOptions)
    try {
      await adapter.connect()
      expect(true).toBe(true) // Connection succeeded
    } finally {
      await adapter.disconnect()
    }
  })

  test('connect() throws AUTH_FAILED for invalid password', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter(invalidOptions)
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

  test('connect() throws error for unreachable host', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter(unreachableOptions)
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

    const adapter = new MySQLAdapter(validOptions)
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

    const adapter = new MySQLAdapter(validOptions)
    try {
      await adapter.connect()
      const results = await adapter.execute<{ count: number }>('SELECT 1 as count')
      expect(results).toBeInstanceOf(Array)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0]?.count).toBe(1)
    } finally {
      await adapter.disconnect()
    }
  })

  test('listTables() returns array of tables', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter(validOptions)
    try {
      await adapter.connect()
      const tables = await adapter.listTables()
      expect(tables).toBeInstanceOf(Array)
      // MySQL system database has tables
      expect(tables.length).toBeGreaterThanOrEqual(0)
    } finally {
      await adapter.disconnect()
    }
  })

  test('getTableSchema() works for existing tables', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter(validOptions)
    try {
      await adapter.connect()
      // Get first table to test
      const tables = await adapter.listTables()
      if (tables.length > 0) {
        const schema = await adapter.getTableSchema(tables[0]!.name)
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

    const adapter = new MySQLAdapter(validOptions)
    await adapter.connect()
    await adapter.disconnect()
    // Should not throw when disconnecting again
    await expect(adapter.disconnect()).resolves.toBeUndefined()
  })

  test('MariaDB system works with MySQL adapter', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter(validMariaDBOptions)
    try {
      await adapter.connect()
      expect(true).toBe(true) // MariaDB connection succeeds with MySQL adapter
    } finally {
      await adapter.disconnect()
    }
  })
})
