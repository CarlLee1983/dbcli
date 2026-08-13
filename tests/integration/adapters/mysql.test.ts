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
  database: process.env.MYSQL_DATABASE || 'dbcli_test',
}

const validMariaDBOptions: ConnectionOptions = {
  ...validOptions,
  system: 'mariadb',
}

const invalidOptions: ConnectionOptions = {
  ...validOptions,
  password: 'wrong_password_definitely_invalid_xyz',
}

const unreachableOptions: ConnectionOptions = {
  system: 'mysql',
  host: '10.255.255.1',
  port: 3306,
  user: 'root',
  password: 'root',
  database: 'mysql',
  timeout: 1000,
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
      expect(results.rows).toBeInstanceOf(Array)
      expect(results.rows.length).toBeGreaterThan(0)
      expect(results.rows[0]?.count).toBe(1)
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

// ── 逾時語意（#42） ────────────────────────────────────────────────────────

describe('MySQL statement timeout', () => {
  beforeAll(async () => {
    SKIP_TESTS = await shouldSkipTests(validOptions)
  })

  // 刻意不用 SELECT SLEEP：max_execution_time 確實會中斷它，但 SLEEP 被中斷時
  // 回傳 1 而不是報錯，語句仍然「成功」。要看到逾時錯誤得用真的在算的查詢。
  const SLOW_QUERY =
    'SELECT COUNT(*) FROM information_schema.COLUMNS a ' +
    'JOIN information_schema.COLUMNS b JOIN information_schema.COLUMNS c'

  test('--timeout 讓慢查詢在指定時間內被中止', async () => {
    if (SKIP_TESTS) return

    const adapter = new MySQLAdapter({ ...validOptions, statementTimeout: 500 })
    await adapter.connect()
    const started = Date.now()
    try {
      // driver 的 ER_QUERY_TIMEOUT (3024) 會被 error-mapper 轉成 STATEMENT_TIMEOUT，
      // 訊息是分類後的說法而非 driver 原文。
      await expect(adapter.execute(SLOW_QUERY)).rejects.toThrow(/statement timed out/i)
      expect(Date.now() - started).toBeLessThan(10_000)
    } finally {
      await adapter.disconnect()
    }
  }, 60_000)

  test('預設不設語句上限，跑得比連線逾時久的查詢不會被砍', async () => {
    if (SKIP_TESTS) return

    // 兩表 join 約 10 秒——遠超過 5000ms 的連線逾時預設值，正是先前
    // 「連線逾時被當成語句上限」會砍掉的那種查詢。SELECT SLEEP 不適合：
    // 它被中斷時回傳 1 而非報錯，看不出差別。
    const mediumQuery =
      'SELECT COUNT(*) FROM information_schema.COLUMNS a JOIN information_schema.COLUMNS b'
    const adapter = new MySQLAdapter(validOptions)
    await adapter.connect()
    try {
      const result = await adapter.execute<Record<string, number>>(mediumQuery)
      expect(result.rows).toHaveLength(1)
    } finally {
      await adapter.disconnect()
    }
  }, 120_000)
})
