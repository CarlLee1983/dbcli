import { describe, expect, mock, test } from 'bun:test'
import { PostgreSQLAdapter } from '@/adapters/postgresql-adapter'
import { MySQLAdapter } from '@/adapters/mysql-adapter'
import { ConnectionError, type ConnectionOptions } from '@/adapters/types'

const base: ConnectionOptions = {
  system: 'postgresql',
  host: 'localhost',
  port: 5432,
  user: 'dbcli',
  password: 'test',
  database: 'test',
}

describe('native query-only adapter boundary', () => {
  test('PostgreSQL uses one physical client for BEGIN, target, and ROLLBACK', async () => {
    const calls: string[] = []
    const client = {
      query: mock(async (sql: string) => {
        calls.push(sql)
        return { rows: sql === 'SELECT 1' ? [{ value: 1 }] : [], rowCount: 1 }
      }),
      release: mock(() => {}),
    }
    const adapter = new PostgreSQLAdapter(base)
    ;(adapter as unknown as { pool: unknown }).pool = { connect: async () => client }

    const result = await adapter.execute<{ value: number }>('SELECT 1', undefined, {
      sqlMode: 'native-read-only',
    })

    expect(result.rows).toEqual([{ value: 1 }])
    expect(calls).toEqual(['BEGIN READ ONLY', 'SELECT 1', 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('PostgreSQL fails closed when BEGIN READ ONLY is rejected', async () => {
    const calls: string[] = []
    const client = {
      query: mock(async (sql: string) => {
        calls.push(sql)
        throw new Error('read-only transactions disabled')
      }),
      release: mock(() => {}),
    }
    const adapter = new PostgreSQLAdapter(base)
    ;(adapter as unknown as { pool: unknown }).pool = { connect: async () => client }

    const error = await adapter
      .execute('SELECT target()', undefined, { sqlMode: 'native-read-only' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as ConnectionError).code).toBe('QUERY_ONLY_BOUNDARY_FAILED')
    expect((error as Error).message).toContain('query-only database boundary')
    expect(calls).toEqual(['BEGIN READ ONLY'])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('PostgreSQL preserves no-code transport failures during boundary setup', async () => {
    const client = {
      query: mock(async () => {
        throw new Error('Connection terminated unexpectedly')
      }),
      release: mock(() => {}),
    }
    const adapter = new PostgreSQLAdapter(base)
    ;(adapter as unknown as { pool: unknown }).pool = { connect: async () => client }

    const error = await adapter
      .execute('SELECT 1', undefined, { sqlMode: 'native-read-only' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as ConnectionError).code).toBe('CONNECTION_LOST')
  })

  test('PostgreSQL reports that the target ran when rollback fails', async () => {
    const client = {
      query: mock(async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('socket closed during rollback')
        return { rows: [], rowCount: 1 }
      }),
      release: mock(() => {}),
    }
    const adapter = new PostgreSQLAdapter(base)
    ;(adapter as unknown as { pool: unknown }).pool = { connect: async () => client }

    const error = await adapter
      .execute('SELECT external_effect()', undefined, { sqlMode: 'native-read-only' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as ConnectionError).code).toBe('CONNECTION_LOST')
    expect((error as ConnectionError).retrySafe).toBe(false)
    expect((error as Error).message).toContain('target completed')
    expect((error as ConnectionError).hints.join(' ')).toContain('target statement ran')
    expect(client.release).toHaveBeenCalledWith(expect.any(Error))
  })

  test.each(['mysql', 'mariadb'] as const)(
    '%s uses one physical connection and rolls back after the target',
    async (system) => {
      const calls: string[] = []
      const db = {
        query: mock(async (sql: string) => {
          calls.push(sql)
          return [[], []]
        }),
        execute: mock(async (sql: string) => {
          calls.push(sql)
          return [[{ value: 1 }], []]
        }),
        destroy: mock(() => {}),
      }
      const adapter = new MySQLAdapter({ ...base, system, port: 3306 })
      ;(adapter as unknown as { db: unknown }).db = db

      const result = await adapter.execute<{ value: number }>('SELECT 1', undefined, {
        sqlMode: 'native-read-only',
      })

      expect(result.rows).toEqual([{ value: 1 }])
      expect(calls).toEqual(['START TRANSACTION READ ONLY', 'SELECT 1', 'ROLLBACK'])
      expect(db.destroy).not.toHaveBeenCalled()
    }
  )

  test('MySQL serializes normal execution behind a query-only transaction', async () => {
    const calls: string[] = []
    let releaseSlow!: () => void
    let markStarted!: () => void
    const slow = new Promise<void>((resolve) => (releaseSlow = resolve))
    const started = new Promise<void>((resolve) => (markStarted = resolve))
    const db = {
      query: mock(async (sql: string) => {
        calls.push(sql)
        return [[], []]
      }),
      execute: mock(async (sql: string) => {
        calls.push(sql)
        if (sql === 'SELECT slow()') {
          markStarted()
          await slow
        }
        return [[], []]
      }),
      destroy: mock(() => {}),
    }
    const adapter = new MySQLAdapter({ ...base, system: 'mysql', port: 3306 })
    ;(adapter as unknown as { db: unknown }).db = db

    const first = adapter.execute('SELECT slow()', undefined, { sqlMode: 'native-read-only' })
    await started
    const second = adapter.execute('INSERT INTO t VALUES (1)', undefined, { sqlMode: 'normal' })
    await Promise.resolve()

    expect(calls).toEqual(['START TRANSACTION READ ONLY', 'SELECT slow()'])
    releaseSlow()
    await Promise.all([first, second])
    expect(calls).toEqual([
      'START TRANSACTION READ ONLY',
      'SELECT slow()',
      'ROLLBACK',
      'INSERT INTO t VALUES (1)',
    ])
  })

  test('MySQL fails closed when START TRANSACTION READ ONLY is rejected', async () => {
    const calls: string[] = []
    const db = {
      query: mock(async (sql: string) => {
        calls.push(sql)
        throw new Error('read-only transactions disabled')
      }),
      execute: mock(async (sql: string) => {
        calls.push(sql)
        return [[], []]
      }),
      destroy: mock(() => {}),
    }
    const adapter = new MySQLAdapter({ ...base, system: 'mysql', port: 3306 })
    ;(adapter as unknown as { db: unknown }).db = db

    const error = await adapter
      .execute('SELECT target()', undefined, { sqlMode: 'native-read-only' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as ConnectionError).code).toBe('QUERY_ONLY_BOUNDARY_FAILED')
    expect(calls).toEqual(['START TRANSACTION READ ONLY'])
  })

  test('MySQL preserves no-code transport failures during boundary setup', async () => {
    const db = {
      query: mock(async () => {
        throw new Error('MySQL server has gone away')
      }),
      execute: mock(async () => [[], []]),
      destroy: mock(() => {}),
    }
    const adapter = new MySQLAdapter({ ...base, system: 'mysql', port: 3306 })
    ;(adapter as unknown as { db: unknown }).db = db

    const error = await adapter
      .execute('SELECT 1', undefined, { sqlMode: 'native-read-only' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as ConnectionError).code).toBe('CONNECTION_LOST')
  })

  test('MySQL discards the connection and suppresses retry after rollback fails', async () => {
    const db = {
      query: mock(async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('socket closed during rollback')
        return [[], []]
      }),
      execute: mock(async () => [[{ value: 1 }], []]),
      destroy: mock(() => {}),
    }
    const adapter = new MySQLAdapter({ ...base, system: 'mysql', port: 3306 })
    ;(adapter as unknown as { db: unknown }).db = db

    const error = await adapter
      .execute('SELECT external_effect()', undefined, { sqlMode: 'native-read-only' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as ConnectionError).code).toBe('CONNECTION_LOST')
    expect((error as ConnectionError).retrySafe).toBe(false)
    expect(db.destroy).toHaveBeenCalledTimes(1)
    expect((adapter as unknown as { db: unknown }).db).toBeNull()
  })

  test('MySQL surfaces cleanup loss even when the target also fails', async () => {
    const db = {
      query: mock(async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('connection lost during rollback')
        return [[], []]
      }),
      execute: mock(async () => {
        throw new Error('routine rejected')
      }),
      destroy: mock(() => {}),
    }
    const adapter = new MySQLAdapter({ ...base, system: 'mysql', port: 3306 })
    ;(adapter as unknown as { db: unknown }).db = db

    const error = await adapter
      .execute('SELECT mutating_routine()', undefined, { sqlMode: 'native-read-only' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as ConnectionError).code).toBe('CONNECTION_LOST')
    expect((error as ConnectionError).retrySafe).toBe(false)
    expect((error as Error).message).toContain('outcome is uncertain')
    expect(db.destroy).toHaveBeenCalledTimes(1)
    expect((adapter as unknown as { db: unknown }).db).toBeNull()
  })

  test.each(['mysql', 'mariadb'] as const)(
    '%s serializes overlapping query-only transactions',
    async (system) => {
      const calls: string[] = []
      let releaseSlow!: () => void
      let markStarted!: () => void
      const slow = new Promise<void>((resolve) => (releaseSlow = resolve))
      const started = new Promise<void>((resolve) => (markStarted = resolve))
      const db = {
        query: mock(async (sql: string) => {
          calls.push(sql)
          return [[], []]
        }),
        execute: mock(async (sql: string) => {
          calls.push(sql)
          if (sql === 'SELECT slow()') {
            markStarted()
            await slow
          }
          return [[{ value: 1 }], []]
        }),
        destroy: mock(() => {}),
      }
      const adapter = new MySQLAdapter({ ...base, system, port: 3306 })
      ;(adapter as unknown as { db: unknown }).db = db

      const first = adapter.execute('SELECT slow()', undefined, { sqlMode: 'native-read-only' })
      await started
      const second = adapter.execute('SELECT mutating_routine()', undefined, {
        sqlMode: 'native-read-only',
      })
      await Promise.resolve()

      expect(calls).toEqual(['START TRANSACTION READ ONLY', 'SELECT slow()'])
      releaseSlow()
      await Promise.all([first, second])
      expect(calls).toEqual([
        'START TRANSACTION READ ONLY',
        'SELECT slow()',
        'ROLLBACK',
        'START TRANSACTION READ ONLY',
        'SELECT mutating_routine()',
        'ROLLBACK',
      ])
    }
  )

  test('normal mode preserves direct execution without transaction setup', async () => {
    const calls: string[] = []
    const pool = {
      query: mock(async (sql: string) => {
        calls.push(sql)
        return { rows: [], rowCount: 1 }
      }),
    }
    const adapter = new PostgreSQLAdapter(base)
    ;(adapter as unknown as { pool: unknown }).pool = pool

    await adapter.execute('INSERT INTO t VALUES (1)', undefined, { sqlMode: 'normal' })

    expect(calls).toEqual(['INSERT INTO t VALUES (1)'])
  })
})
