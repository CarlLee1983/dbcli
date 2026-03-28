/**
 * MySQL adapter integration tests
 * Tests real database connections if available, skips otherwise
 *
 * Connection via env vars (fallback to docker-compose.test.yml defaults):
 *   MYSQL_HOST=localhost MYSQL_PORT=3307 MYSQL_USER=dbcli MYSQL_PASSWORD=testpass MYSQL_DATABASE=dbcli_test
 *
 * To skip: Set SKIP_INTEGRATION_TESTS=true
 */

import { test, expect, describe, beforeAll } from 'bun:test'
import { MySQLAdapter } from 'src/adapters/mysql-adapter'
import { ConnectionError } from 'src/adapters'
import type { ConnectionOptions } from 'src/adapters/types'
import { shouldSkipTests } from '../helpers'

let SKIP_TESTS = false

// Read connection from env vars, fallback to docker-compose defaults
const validOptions: ConnectionOptions = {
  system: 'mysql',
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3307),
  user: process.env.MYSQL_USER || 'dbcli',
  password: process.env.MYSQL_PASSWORD || 'testpass',
  database: process.env.MYSQL_DATABASE || 'dbcli_test'
}

const validMariaDBOptions: ConnectionOptions = {
  ...validOptions,
  system: 'mariadb'
}

const invalidOptions: ConnectionOptions = {
  ...validOptions,
  password: 'wrong_password_definitely_invalid_xyz'
}

const unreachableOptions: ConnectionOptions = {
  system: 'mysql',
  host: '10.255.255.1',
  port: 3306,
  user: 'root',
  password: 'root',
  database: 'mysql',
  timeout: 1000
}

describe('MySQL Adapter Integration Tests', () => {
  beforeAll(async () => {
    SKIP_TESTS = await shouldSkipTests(validOptions)
    if (SKIP_TESTS) {
      console.log('⏭ MySQL not reachable — skipping integration tests')
    }
  })

  test('connect() succeeds with valid credentials', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter(validOptions)
    try {
      await adapter.connect()
      expect(true).toBe(true)
    } finally {
      await adapter.disconnect()
    }
  })

  test('connect() throws AUTH_FAILED for invalid password', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter(invalidOptions)
    try {
      await adapter.connect()
      expect(false).toBe(true)
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
      expect(false).toBe(true)
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionError)
      const connErr = error as ConnectionError
      expect(['ECONNREFUSED', 'ETIMEDOUT'].includes(connErr.code)).toBe(true)
      expect(connErr.hints.length).toBeGreaterThan(0)
    }
  }, 15_000)

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
    await expect(adapter.disconnect()).resolves.toBeUndefined()
  })

  test('MariaDB system works with MySQL adapter', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter(validMariaDBOptions)
    try {
      await adapter.connect()
      expect(true).toBe(true)
    } finally {
      await adapter.disconnect()
    }
  })
})
