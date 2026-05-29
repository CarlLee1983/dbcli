import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { DatabaseAdapter, SqlConnectionOptions } from '@/adapters/types'
import { QueryExecutor } from '@/core/query-executor'
import { ConnectionError } from '@/adapters/types'

const MARIADB_AVAILABLE = !!process.env.TEST_MARIADB_HOST || !!process.env.TEST_MARIADB_DSN

const MARIADB_OPTS: SqlConnectionOptions = {
  system: 'mariadb',
  host: process.env.TEST_MARIADB_HOST || 'localhost',
  port: Number(process.env.TEST_MARIADB_PORT || 3306),
  user: process.env.TEST_MARIADB_USER || 'root',
  password: process.env.TEST_MARIADB_PASSWORD || '',
  database: process.env.TEST_MARIADB_DB || 'test',
}

const PG_AVAILABLE = !!process.env.TEST_POSTGRESQL_HOST

const PG_OPTS: SqlConnectionOptions = {
  system: 'postgresql',
  host: process.env.TEST_POSTGRESQL_HOST || 'localhost',
  port: Number(process.env.TEST_POSTGRESQL_PORT || 5432),
  user: process.env.TEST_POSTGRESQL_USER || 'postgres',
  password: process.env.TEST_POSTGRESQL_PASSWORD || '',
  database: process.env.TEST_POSTGRESQL_DB || 'postgres',
}

describe.skipIf(!MARIADB_AVAILABLE)('P1: error classification (MariaDB)', () => {
  let adapter: DatabaseAdapter

  beforeAll(async () => {
    adapter = AdapterFactory.createSqlAdapter(MARIADB_OPTS)
    await adapter.connect()
  })

  afterAll(async () => {
    if (adapter) await adapter.disconnect()
  })

  test('SHOW TABLES is NOT rejected in query-only mode', async () => {
    const exec = new QueryExecutor(adapter, 'query-only')
    await expect(exec.execute('SHOW TABLES')).resolves.toBeDefined()
  })

  test('SELECT against unknown table → TABLE_NOT_FOUND', async () => {
    const exec = new QueryExecutor(adapter, 'query-only')
    try {
      await exec.execute('SELECT * FROM definitely_does_not_exist_xyz')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionError)
      expect((err as ConnectionError).code).toBe('TABLE_NOT_FOUND')
    }
  })

  test('ANALYZE SELECT is allowed in query-only mode', async () => {
    const exec = new QueryExecutor(adapter, 'query-only')
    await expect(exec.execute('ANALYZE SELECT 1')).resolves.toBeDefined()
  })
})

describe.skipIf(!PG_AVAILABLE)('P1: error classification (PostgreSQL)', () => {
  let adapter: DatabaseAdapter

  beforeAll(async () => {
    adapter = AdapterFactory.createSqlAdapter(PG_OPTS)
    await adapter.connect()
  })

  afterAll(async () => {
    if (adapter) await adapter.disconnect()
  })

  test('SELECT against unknown relation → TABLE_NOT_FOUND', async () => {
    const exec = new QueryExecutor(adapter, 'query-only')
    try {
      await exec.execute('SELECT * FROM definitely_does_not_exist_xyz')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionError)
      expect((err as ConnectionError).code).toBe('TABLE_NOT_FOUND')
    }
  })

  test('EXPLAIN (ANALYZE, BUFFERS) SELECT is allowed in query-only mode', async () => {
    const exec = new QueryExecutor(adapter, 'query-only')
    await expect(exec.execute('EXPLAIN (ANALYZE, BUFFERS) SELECT 1')).resolves.toBeDefined()
  })
})
