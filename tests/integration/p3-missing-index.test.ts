/**
 * v1.23 P3 — missing-index-for integration smoke.
 * Runs against the docker-compose.test.yml MariaDB and PostgreSQL, and skips
 * when they are unreachable — unless REQUIRE_INTEGRATION_SERVICES demands them.
 * (mirrors tests/integration/p2-explain.test.ts). Self-seeds a synthetic table
 * so EXPLAIN enrichment + index introspection are meaningful; no shared fixture.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { DatabaseAdapter, SqlConnectionOptions, SqlDatabaseSystem } from '@/adapters/types'
import { analyzeMissingIndex } from '@/core/guide/missing-index'
import { parseSelect } from '@/core/guide/missing-index/parse-sql'
import { extract } from '@/core/guide/missing-index/sql-extractor'
import { makeIndexIntrospector } from '@/core/guide/missing-index/index-introspector'
import { makeExplainEnricher } from '@/core/guide/missing-index/explain-enricher'
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

const TABLE = 'p3_mi_demo'

async function seed(adapter: DatabaseAdapter, system: SqlDatabaseSystem): Promise<void> {
  await adapter.execute(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => undefined)
  if (system === 'postgresql') {
    await adapter.execute(
      `CREATE TABLE ${TABLE} (id SERIAL PRIMARY KEY, user_id INT, settled_at TIMESTAMP)`
    )
  } else {
    await adapter.execute(
      `CREATE TABLE ${TABLE} (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, settled_at DATETIME)`
    )
  }
  await adapter.execute(`CREATE INDEX idx_${TABLE}_user ON ${TABLE} (user_id)`)
}

async function drop(adapter: DatabaseAdapter): Promise<void> {
  await adapter.execute(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => undefined)
}

function runFor(system: SqlDatabaseSystem, opts: SqlConnectionOptions, available: boolean) {
  describe.skipIf(!available)(`P3: missing-index-for [${system}]`, () => {
    let adapter: DatabaseAdapter
    beforeAll(async () => {
      adapter = AdapterFactory.createSqlAdapter(opts)
      await adapter.connect()
      await seed(adapter, system)
    })
    afterAll(async () => {
      if (adapter) {
        await drop(adapter)
        await adapter.disconnect()
      }
    })

    test('produces a well-formed report for a WHERE + range query', async () => {
      const literal = system === 'postgresql' ? "'2024-01-01'" : '"2024-01-01"'
      const sql = `SELECT * FROM ${TABLE} WHERE user_id = 1 AND settled_at >= ${literal}`
      const report = await analyzeMissingIndex(
        sql,
        {
          system,
          parseSelect,
          extract,
          getExistingIndexes: makeIndexIntrospector(adapter),
          enrich: makeExplainEnricher(system, adapter),
        },
        {}
      )
      expect(report.query).toContain(TABLE)
      expect(Array.isArray(report.candidates)).toBe(true)
      expect(Array.isArray(report.warnings)).toBe(true)
      // The single-column idx_..._user index should be reported as a collision
      // on the composite (user_id, settled_at) candidate when one is produced.
      const candidate = report.candidates.find((c) => c.table === TABLE)
      if (candidate) {
        expect(candidate.columns[0]).toBe('user_id')
      }
    })
  })
}

runFor('mariadb', MARIADB_OPTS, MARIADB_AVAILABLE)
runFor('postgresql', PG_OPTS, PG_AVAILABLE)

// Guard: ensures the file is never a zero-test failure when no DB targets set.
test('p3 integration module loads', () => {
  expect(typeof analyzeMissingIndex).toBe('function')
})
