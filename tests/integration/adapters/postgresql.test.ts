/**
 * PostgreSQL adapter integration tests
 * Tests real database connections if available, skips otherwise
 *
 * Connection via env vars (fallback to docker-compose.test.yml defaults):
 *   PG_HOST=localhost PG_PORT=5433 PG_USER=dbcli PG_PASSWORD=testpass PG_DATABASE=dbcli_test
 *
 * To skip: Set SKIP_INTEGRATION_TESTS=true
 */

import { test, expect, describe, beforeAll } from 'bun:test'
import { PostgreSQLAdapter } from 'src/adapters/postgresql-adapter'
import { ConnectionError } from 'src/adapters'
import type { ConnectionOptions } from 'src/adapters/types'
import { shouldSkipTests } from '../helpers'

let SKIP_TESTS = false

// Read connection from env vars, fallback to docker-compose defaults
const validOptions: ConnectionOptions = {
  system: 'postgresql',
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5433),
  user: process.env.PG_USER || 'dbcli',
  password: process.env.PG_PASSWORD || 'testpass',
  database: process.env.PG_DATABASE || 'dbcli_test',
}

const invalidOptions: ConnectionOptions = {
  ...validOptions,
  password: 'wrong_password_definitely_invalid_xyz',
}

const unreachableOptions: ConnectionOptions = {
  system: 'postgresql',
  host: '10.255.255.1',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'postgres',
  timeout: 1000,
}

describe('PostgreSQL Adapter Integration Tests', () => {
  beforeAll(async () => {
    SKIP_TESTS = await shouldSkipTests(validOptions)
    if (SKIP_TESTS) {
      console.log('⏭ PostgreSQL not reachable — skipping integration tests')
    }
  })

  test('connect() succeeds with valid credentials', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(validOptions)
    try {
      await adapter.connect()
      expect(true).toBe(true)
    } finally {
      await adapter.disconnect()
    }
  })

  test('connect() throws AUTH_FAILED for invalid password', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(invalidOptions)
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

  test('connect() throws ECONNREFUSED or ETIMEDOUT for unreachable host', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(unreachableOptions)
    try {
      await adapter.connect()
      expect(false).toBe(true)
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
      expect(results[0]?.count).toBe(1)
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

    const adapter = new PostgreSQLAdapter(validOptions)
    await adapter.connect()
    await adapter.disconnect()
    await expect(adapter.disconnect()).resolves.toBeUndefined()
  })

  test('disconnect() is safe to call multiple times', async () => {
    if (SKIP_TESTS) return

    const adapter = new PostgreSQLAdapter(validOptions)
    await adapter.connect()
    await adapter.disconnect()
    await adapter.disconnect()
    await adapter.disconnect()
    expect(true).toBe(true)
  })
})
