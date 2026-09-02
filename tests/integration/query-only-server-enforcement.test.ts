import { expect, test } from 'bun:test'
import { MySQLAdapter } from '@/adapters/mysql-adapter'
import { PostgreSQLAdapter } from '@/adapters/postgresql-adapter'
import type { ConnectionOptions, DatabaseAdapter } from '@/adapters/types'
import {
  MARIADB_DATABASE,
  MARIADB_HOST,
  MARIADB_PASSWORD,
  MARIADB_PORT,
  MARIADB_USER,
  MYSQL_DATABASE,
  MYSQL_HOST,
  MYSQL_PASSWORD,
  MYSQL_PORT,
  MYSQL_USER,
  PG_DATABASE,
  PG_HOST,
  PG_PASSWORD,
  PG_PORT,
  PG_USER,
  shouldSkipTests,
} from './helpers'

type Fixture = {
  name: string
  options: ConnectionOptions
  adapter: (options: ConnectionOptions) => DatabaseAdapter
  createRoutine: string
  dropRoutine: string
  weakenDefault: string
  invokeRoutine: string
}

const TABLE = 'dbcli_query_only_boundary_fixture'
const ROUTINE = 'dbcli_query_only_boundary_mutate'

const fixtures: Fixture[] = [
  {
    name: 'PostgreSQL',
    options: {
      system: 'postgresql',
      host: PG_HOST,
      port: PG_PORT,
      user: PG_USER,
      password: PG_PASSWORD,
      database: PG_DATABASE,
    },
    adapter: (options) => new PostgreSQLAdapter(options),
    createRoutine:
      `CREATE OR REPLACE FUNCTION ${ROUTINE}() RETURNS integer LANGUAGE plpgsql AS $$ ` +
      `BEGIN INSERT INTO ${TABLE} (value) VALUES (1); RETURN 1; END; $$`,
    dropRoutine: `DROP FUNCTION IF EXISTS ${ROUTINE}()`,
    weakenDefault: 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE',
    invokeRoutine: `SELECT ${ROUTINE}()`,
  },
  {
    name: 'MySQL',
    options: {
      system: 'mysql',
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
    },
    adapter: (options) => new MySQLAdapter(options),
    createRoutine:
      `CREATE FUNCTION ${ROUTINE}() RETURNS INT DETERMINISTIC MODIFIES SQL DATA ` +
      `BEGIN INSERT INTO ${TABLE} (value) VALUES (1); RETURN 1; END`,
    dropRoutine: `DROP FUNCTION IF EXISTS ${ROUTINE}`,
    weakenDefault: 'SET SESSION TRANSACTION READ WRITE',
    invokeRoutine: `SELECT ${ROUTINE}() AS result`,
  },
  {
    name: 'MariaDB',
    options: {
      system: 'mariadb',
      host: MARIADB_HOST,
      port: MARIADB_PORT,
      user: MARIADB_USER,
      password: MARIADB_PASSWORD,
      database: MARIADB_DATABASE,
    },
    adapter: (options) => new MySQLAdapter(options),
    createRoutine:
      `CREATE FUNCTION ${ROUTINE}() RETURNS INT DETERMINISTIC MODIFIES SQL DATA ` +
      `BEGIN INSERT INTO ${TABLE} (value) VALUES (1); RETURN 1; END`,
    dropRoutine: `DROP FUNCTION IF EXISTS ${ROUTINE}`,
    weakenDefault: 'SET SESSION TRANSACTION READ WRITE',
    invokeRoutine: `SELECT ${ROUTINE}() AS result`,
  },
]

async function runRoutineDdl(adapter: DatabaseAdapter, fixture: Fixture, sql: string) {
  if (fixture.options.system === 'postgresql') return adapter.execute(sql)
  if (fixture.options.system === 'mysql') {
    const { default: mysql } = await import('mysql2/promise')
    const root = await mysql.createConnection({
      host: fixture.options.host,
      port: fixture.options.port,
      user: 'root',
      password: process.env.MYSQL_ROOT_PASSWORD ?? 'testpass',
      database: fixture.options.database,
    })
    try {
      return await root.query(sql)
    } finally {
      await root.end()
    }
  }
  // mysql2's prepared-statement protocol cannot create/drop stored routines;
  // use the same connected driver only for fixture setup and cleanup.
  const db = (adapter as unknown as { db: { query(sql: string): Promise<unknown> } }).db
  return db.query(sql)
}

test.each(fixtures)(
  '$name rejects SELECT-invoked persistent writes at the native query-only boundary',
  async (fixture) => {
    if (await shouldSkipTests(fixture.options)) return

    const adapter = fixture.adapter(fixture.options)
    await adapter.connect()
    try {
      await runRoutineDdl(adapter, fixture, fixture.dropRoutine)
      await adapter.execute(`DROP TABLE IF EXISTS ${TABLE}`)
      await adapter.execute(`CREATE TABLE ${TABLE} (value integer NOT NULL)`)
      await runRoutineDdl(adapter, fixture, fixture.createRoutine)

      const safe = await adapter.execute<{ value: number }>('SELECT 1 AS value', undefined, {
        sqlMode: 'native-read-only',
      })
      expect(Number(safe.rows[0]?.value)).toBe(1)

      await adapter
        .execute(fixture.weakenDefault, undefined, { sqlMode: 'native-read-only' })
        .catch(() => undefined)

      const rejected = await adapter
        .execute(fixture.invokeRoutine, undefined, { sqlMode: 'native-read-only' })
        .catch((error: unknown) => error)
      expect(rejected).toBeInstanceOf(Error)
      expect((rejected as Error).message).toMatch(/read.only|25006|1792/i)

      const unchanged = await adapter.execute<{ count: number | string }>(
        `SELECT COUNT(*) AS count FROM ${TABLE}`,
        undefined,
        { sqlMode: 'native-read-only' }
      )
      expect(Number(unchanged.rows[0]?.count)).toBe(0)

      const reused = await adapter.execute<{ value: number }>('SELECT 2 AS value', undefined, {
        sqlMode: 'native-read-only',
      })
      expect(Number(reused.rows[0]?.value)).toBe(2)

      await adapter.execute(`INSERT INTO ${TABLE} (value) VALUES (2)`, undefined, {
        sqlMode: 'normal',
      })
      const normal = await adapter.execute<{ count: number | string }>(
        `SELECT COUNT(*) AS count FROM ${TABLE}`
      )
      expect(Number(normal.rows[0]?.count)).toBe(1)
    } finally {
      await runRoutineDdl(adapter, fixture, fixture.dropRoutine).catch(() => undefined)
      await adapter.execute(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => undefined)
      await adapter.disconnect()
    }
  },
  30_000
)
