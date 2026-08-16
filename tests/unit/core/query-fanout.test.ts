import { describe, expect, test } from 'bun:test'
import {
  aggregateFanOutExitCode,
  assertFanOutReadOnlySql,
  runQueryFanOut,
  type ConnectionQueryOutcome,
} from '@/core/query-fanout'
import type { QueryResult } from '@/types/query'

function result(value: string): QueryResult<Record<string, unknown>> {
  return {
    rows: [{ value }],
    rowCount: 1,
    columnNames: ['value'],
  }
}

describe('query fan-out orchestration', () => {
  test('preserves selector order when a later connection finishes first', async () => {
    let releaseSlow!: (value: QueryResult<Record<string, unknown>>) => void
    const slow = new Promise<QueryResult<Record<string, unknown>>>((resolve) => {
      releaseSlow = resolve
    })

    const pending = runQueryFanOut(['slow', 'fast'], async (connection) => {
      if (connection === 'slow') return await slow
      releaseSlow(result('first-selector'))
      return result('second-selector')
    })

    expect(await pending).toEqual([
      { connection: 'slow', status: 'ok', result: result('first-selector') },
      { connection: 'fast', status: 'ok', result: result('second-selector') },
    ])
  })

  test('keeps successful and failed outcomes without cancelling siblings', async () => {
    const outcomes = await runQueryFanOut(['ok', 'broken'], async (connection) => {
      if (connection === 'broken')
        throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
      return result(connection)
    })

    expect(outcomes[0]).toEqual({ connection: 'ok', status: 'ok', result: result('ok') })
    expect(outcomes[1]).toMatchObject({
      connection: 'broken',
      status: 'error',
      error: { code: 'ETIMEDOUT', message: 'timed out', hints: [] },
    })
  })

  test('maps all-success, partial-failure, and all-failure exit codes', () => {
    // Annotated rather than `as const`: the latter makes `hints` a readonly
    // tuple, which `ConnectionQueryOutcome` does not accept, and it was the
    // reason the mixed array below needed a cast.
    const ok: ConnectionQueryOutcome = { connection: 'a', status: 'ok', result: result('a') }
    const failed: ConnectionQueryOutcome = {
      connection: 'b',
      status: 'error',
      error: { message: 'failed', hints: [] },
    }

    expect(aggregateFanOutExitCode([ok])).toBe(0)
    expect(aggregateFanOutExitCode([ok, failed])).toBe(2)
    expect(aggregateFanOutExitCode([failed])).toBe(1)
  })

  test('rejects data-modifying CTEs and EXPLAIN ANALYZE writes', () => {
    for (const sql of [
      'WITH moved AS (DELETE FROM users RETURNING *) SELECT * FROM moved',
      'EXPLAIN ANALYZE DELETE FROM users WHERE id = 1',
      'EXPLAIN (ANALYZE, BUFFERS) UPDATE users SET active = false',
      'SHOW TABLES; DELETE FROM users',
      'DESCRIBE users; DROP TABLE users',
      'SELECT * INTO copied_users FROM users',
      String.raw`SELECT 'x\'; DELETE FROM users; SELECT 'y'`,
    ]) {
      expect(() => assertFanOutReadOnlySql(sql, 'postgresql')).toThrow(/read-only/i)
    }
  })

  test('accepts ordinary read-only SQL classifications', () => {
    for (const sql of [
      'SELECT count(*) FROM users',
      'SHOW TABLES',
      'SHOW CREATE TABLE users',
      'DESCRIBE users',
      'EXPLAIN DELETE FROM users WHERE id = 1',
      'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users',
      'SELECT $$a;b$$ AS value',
      'SELECT $message$DELETE FROM users$message$ AS text',
      String.raw`SELECT E'x\'; DELETE FROM users' AS text`,
      "SELECT 'DELETE; it''s safe' AS text",
    ]) {
      expect(() => assertFanOutReadOnlySql(sql, 'postgresql')).not.toThrow()
    }
  })

  test('does not treat MySQL or MariaDB dollar identifiers as PostgreSQL strings', () => {
    const sql = 'SELECT 1 AS $x$; DELETE FROM users; SELECT 1 AS $x$'
    expect(() => assertFanOutReadOnlySql(sql, 'mysql')).toThrow(/one read-only statement/i)
    expect(() => assertFanOutReadOnlySql(sql, 'mariadb')).toThrow(/one read-only statement/i)
  })

  test('rejects MySQL and MariaDB SELECT INTO file writes', () => {
    for (const dialect of ['mysql', 'mariadb'] as const) {
      expect(() =>
        assertFanOutReadOnlySql("SELECT secret INTO OUTFILE '/tmp/dbcli-leak' FROM users", dialect)
      ).toThrow(/read-only/i)
    }
  })

  test('fails closed on ambiguous backslash-quote strings in every dialect', () => {
    const sql = String.raw`SELECT 'x\'; DELETE FROM users; SELECT 'y'`
    for (const dialect of ['postgresql', 'mysql', 'mariadb'] as const) {
      expect(() => assertFanOutReadOnlySql(sql, dialect)).toThrow(/read-only/i)
    }
  })

  test('rejects MySQL and MariaDB executable-comment and dash-comment smuggling', () => {
    for (const dialect of ['mysql', 'mariadb'] as const) {
      for (const sql of [
        'SELECT 1--x; DELETE FROM users',
        'SELECT 1--\u00a0x; DELETE FROM users',
        'SELECT 1--\ufeffx; DELETE FROM users',
      ]) {
        expect(() => assertFanOutReadOnlySql(sql, dialect)).toThrow(
          /one read-only statement|read-only/i
        )
      }
    }
    expect(() => assertFanOutReadOnlySql('SELECT 1; /*! DELETE FROM users */', 'mysql')).toThrow(
      /one read-only statement|read-only/i
    )
    expect(() => assertFanOutReadOnlySql('SELECT 1; /*M! DELETE FROM users */', 'mariadb')).toThrow(
      /one read-only statement|read-only/i
    )
    expect(() =>
      assertFanOutReadOnlySql(
        "SELECT secret /*!50000INTO OUTFILE '/tmp/dbcli-leak' */ FROM users",
        'mysql'
      )
    ).toThrow(/read-only/i)
    expect(() =>
      assertFanOutReadOnlySql(
        "SELECT secret /*M!100100INTO OUTFILE '/tmp/dbcli-leak' */ FROM users",
        'mariadb'
      )
    ).toThrow(/read-only/i)
  })

  test('ignores SQL-looking text inside MySQL identifiers and hash comments', () => {
    for (const dialect of ['mysql', 'mariadb'] as const) {
      expect(() => assertFanOutReadOnlySql('SELECT 1 AS `a;DELETE`', dialect)).not.toThrow()
      expect(() => assertFanOutReadOnlySql('SELECT 1 # ; DELETE FROM users', dialect)).not.toThrow()
      expect(() =>
        assertFanOutReadOnlySql('SELECT 1 -- ; DELETE FROM users', dialect)
      ).not.toThrow()
      expect(() =>
        assertFanOutReadOnlySql('SELECT 1 /* ; DELETE FROM users */', dialect)
      ).not.toThrow()
    }
  })
})
