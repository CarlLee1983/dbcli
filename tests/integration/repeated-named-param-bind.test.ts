/**
 * Issue #197 regression: a `:name` used more than once in a snippet.
 *
 * The unit test in tests/unit/core/saved-queries/binder.test.ts pins the
 * placeholder/value arithmetic. This one pins what the reporter actually hit —
 * mysqld refusing the statement with ER_WRONG_ARGUMENTS because the prepared
 * statement had more `?` than the driver was given values. Only a real server
 * can say that, so it lives here and runs against both MySQL and MariaDB: the
 * error came from MariaDB, and the two do not share an error surface.
 */

import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { MySQLAdapter } from 'src/adapters/mysql-adapter'
import { rewriteToBind } from '@/core/saved-queries/binder'
import type { ConnectionOptions } from 'src/adapters/types'
import {
  shouldSkipTests,
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
  MARIADB_HOST,
  MARIADB_PORT,
  MARIADB_USER,
  MARIADB_PASSWORD,
  MARIADB_DATABASE,
} from './helpers'

const SERVERS: Array<{ label: string; options: ConnectionOptions }> = [
  {
    label: 'mysql',
    options: {
      system: 'mysql',
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
    },
  },
  {
    label: 'mariadb',
    options: {
      system: 'mariadb',
      host: MARIADB_HOST,
      port: MARIADB_PORT,
      user: MARIADB_USER,
      password: MARIADB_PASSWORD,
      database: MARIADB_DATABASE,
    },
  },
]

for (const { label, options } of SERVERS) {
  describe(`repeated :name binds on ${label} (integration)`, () => {
    let skip = false
    let adapter: MySQLAdapter | undefined

    beforeAll(async () => {
      skip = await shouldSkipTests(options)
      if (skip) {
        console.log(`⏭ ${label} not reachable — skipping repeated-param integration test`)
        return
      }
      adapter = new MySQLAdapter(options)
      await adapter.connect()
    })

    afterAll(async () => {
      if (adapter) await adapter.disconnect()
    })

    test('executes the "0 means all rows" shape the issue could not run', async () => {
      if (skip || !adapter) return

      const rewritten = rewriteToBind(
        'SELECT :uid AS uid WHERE :uid = 0 OR :uid > 0',
        { uid: 552 },
        'mysql'
      )
      expect(rewritten.sql.match(/\?/g)?.length).toBe(rewritten.values.length)

      const result = await adapter.execute<{ uid: number }>(rewritten.sql, rewritten.values)
      expect(Number(result.rows[0]?.uid)).toBe(552)
    })
  })
}
