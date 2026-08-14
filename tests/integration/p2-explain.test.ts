/**
 * v1.23 P2 — explain command integration smoke.
 * Runs against the docker-compose.test.yml MariaDB and PostgreSQL, and skips
 * when they are unreachable — unless REQUIRE_INTEGRATION_SERVICES demands them.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { DatabaseAdapter, SqlConnectionOptions } from '@/adapters/types'
import { runQueryExplain } from '@/core/explain/runner'
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
const PG_AVAILABLE = await isDbReachable(PG_HOST, PG_PORT)

const MARIADB_OPTS: SqlConnectionOptions = {
  system: 'mariadb',
  host: MARIADB_HOST,
  port: MARIADB_PORT,
  user: MARIADB_USER,
  password: MARIADB_PASSWORD,
  database: MARIADB_DATABASE,
}

const PG_OPTS: SqlConnectionOptions = {
  system: 'postgresql',
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
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
