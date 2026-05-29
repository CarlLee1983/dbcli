/**
 * v1.23 P3 — missing-index-for integration smoke.
 * Gated on TEST_MARIADB_HOST / TEST_POSTGRESQL_HOST so dev env auto-skips
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
