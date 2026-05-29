/**
 * v1.23 P2 — explain command integration smoke.
 * Gated on TEST_MARIADB_HOST / TEST_POSTGRESQL_HOST so dev env auto-skips.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { DatabaseAdapter, SqlConnectionOptions } from '@/adapters/types'
import { runQueryExplain } from '@/core/explain/runner'

const MARIADB_AVAILABLE = !!process.env.TEST_MARIADB_HOST
const PG_AVAILABLE = !!process.env.TEST_POSTGRESQL_HOST

const MARIADB_OPTS: SqlConnectionOptions = {
  system: 'mariadb',
  host: process.env.TEST_MARIADB_HOST || 'localhost',
  port: Number(process.env.TEST_MARIADB_PORT || 3306),
  user: process.env.TEST_MARIADB_USER || 'root',
  password: process.env.TEST_MARIADB_PASSWORD || '',
  database: process.env.TEST_MARIADB_DB || 'test',
}

const PG_OPTS: SqlConnectionOptions = {
  system: 'postgresql',
  host: process.env.TEST_POSTGRESQL_HOST || 'localhost',
  port: Number(process.env.TEST_POSTGRESQL_PORT || 5432),
  user: process.env.TEST_POSTGRESQL_USER || 'postgres',
  password: process.env.TEST_POSTGRESQL_PASSWORD || '',
  database: process.env.TEST_POSTGRESQL_DB || 'postgres',
}

describe.skipIf(!MARIADB_AVAILABLE)('P2: explain (MariaDB)', () => {
  let adapter: DatabaseAdapter
  beforeAll(async () => {
    adapter = AdapterFactory.createSqlAdapter(MARIADB_OPTS)
    await adapter.connect()
  })
  afterAll(async () => {
    if (adapter) await adapter.disconnect()
  })

  test('EXPLAIN SELECT 1 returns one row with system mariadb', async () => {
    const plan = await runQueryExplain('mariadb', adapter, 'SELECT 1', {})
    expect(plan.system).toBe('mariadb')
    expect(plan.rows.length).toBeGreaterThan(0)
  })

  test('--analyze (ANALYZE SELECT) returns rows', async () => {
    const plan = await runQueryExplain('mariadb', adapter, 'SELECT 1', { analyze: true })
    expect(plan.rows.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!PG_AVAILABLE)('P2: explain (PostgreSQL)', () => {
  let adapter: DatabaseAdapter
  beforeAll(async () => {
    adapter = AdapterFactory.createSqlAdapter(PG_OPTS)
    await adapter.connect()
  })
  afterAll(async () => {
    if (adapter) await adapter.disconnect()
  })

  test('EXPLAIN (FORMAT JSON) SELECT 1 returns one row', async () => {
    const plan = await runQueryExplain('postgresql', adapter, 'SELECT 1', {})
    expect(plan.system).toBe('postgresql')
    expect(plan.rows.length).toBeGreaterThan(0)
  })

  test('--analyze EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT 1 returns rows', async () => {
    const plan = await runQueryExplain('postgresql', adapter, 'SELECT 1', { analyze: true })
    expect(plan.rows.length).toBeGreaterThan(0)
  })
})
