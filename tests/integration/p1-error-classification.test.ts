import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { DatabaseAdapter, SqlConnectionOptions } from '@/adapters/types'
import { QueryExecutor } from '@/core/query-executor'
import { ConnectionError } from '@/adapters/types'
import {
  isDbReachable,
  MARIADB_HOST,
  MARIADB_PORT,
  MARIADB_USER,
  MARIADB_PASSWORD,
  MARIADB_DATABASE,
  PG_HOST,
  PG_PORT,
  PG_USER,
  PG_PASSWORD,
  PG_DATABASE,
} from './helpers'

const MARIADB_AVAILABLE = await isDbReachable(MARIADB_HOST, MARIADB_PORT)

const MARIADB_OPTS: SqlConnectionOptions = {
  system: 'mariadb',
  host: MARIADB_HOST,
  port: MARIADB_PORT,
  user: MARIADB_USER,
  password: MARIADB_PASSWORD,
  database: MARIADB_DATABASE,
}

const PG_AVAILABLE = await isDbReachable(PG_HOST, PG_PORT)

const PG_OPTS: SqlConnectionOptions = {
  system: 'postgresql',
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
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
