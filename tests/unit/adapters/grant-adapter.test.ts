import { expect, test } from 'bun:test'
import { MySQLAdapter } from '@/adapters/mysql-adapter'
import { OMITTED_GRANT } from '@/adapters/grant-redaction'

for (const system of ['mysql', 'mariadb'] as const) {
  for (const sqlMode of [undefined, 'native-read-only'] as const) {
    test(`${system} ${sqlMode ?? 'normal'} protects every returned grant cell`, async () => {
      const adapter = new MySQLAdapter({
        system,
        host: 'localhost',
        port: 1,
        user: 'fixture',
        password: '',
        database: 'fixture',
      })
      const rows = [
        {
          'Grants for reader@%':
            "GRANT USAGE ON *.* TO 'reader'@'%' IDENTIFIED BY PASSWORD 'secret-sentinel'",
        },
        { 'Grants for reader@%': 'future secret-sentinel format' },
        { 'Grants for reader@%': { secret: 'secret-sentinel' } },
      ]
      const calls: string[] = []
      Object.assign(adapter, {
        serverVersion: system === 'mysql' ? '8.4.8' : '10.11.6-MariaDB',
        db: {
          query: async (sql: string) => {
            calls.push(sql)
            return [[], []]
          },
          execute: async (sql: string) => {
            calls.push(sql)
            return [rows, []]
          },
        },
      })
      const out = await adapter.execute<Record<string, string>>(
        '/*!50000 SHOW */ GRANTS',
        undefined,
        { sqlMode }
      )
      expect(JSON.stringify(out)).not.toContain('secret-sentinel')
      expect(out.rows).toHaveLength(3)
      expect(Object.keys(out.rows[0]!)).toEqual(['Grants for reader@%'])
      expect(out.rows[0]!['Grants for reader@%']).toContain('[REDACTED]')
      expect(out.rows[1]!['Grants for reader@%']).toBe(OMITTED_GRANT)
      expect(out.rows[2]!['Grants for reader@%']).toBe(OMITTED_GRANT)
      expect(out.affectedRows).toBe(3)
      expect(rows[0]!['Grants for reader@%']).toContain('secret-sentinel')
      expect(calls).toEqual(
        sqlMode
          ? ['START TRANSACTION READ ONLY', '/*!50000 SHOW */ GRANTS', 'ROLLBACK']
          : ['/*!50000 SHOW */ GRANTS']
      )
      const plain = await adapter.execute('SELECT value FROM ordinary', undefined, { sqlMode })
      expect(plain.rows).toBe(rows)
    })
  }
}
test('ambiguous unknown-version input fails before touching the driver', async () => {
  const adapter = new MySQLAdapter({
    system: 'mysql',
    host: 'localhost',
    port: 1,
    user: 'fixture',
    password: '',
    database: 'fixture',
  })
  let called = false
  Object.assign(adapter, {
    db: {
      execute: async () => {
        called = true
        return [[], []]
      },
    },
  })
  await expect(adapter.execute('/*!80408 SHOW GRANTS */')).rejects.toThrow('Cannot safely classify')
  expect(called).toBe(false)
})

for (const system of ['mysql', 'mariadb'] as const) {
  for (const sqlMode of [undefined, 'native-read-only'] as const) {
    test(`${system} ${sqlMode ?? 'normal'} uses actual MariaDB flavor and six-digit comments`, async () => {
      const adapter = new MySQLAdapter({
        system,
        host: 'localhost',
        port: 1,
        user: 'fixture',
        password: '',
        database: 'fixture',
      })
      Object.assign(adapter, {
        serverVersion: '5.5.5-10.11.6-MariaDB',
        db: {
          query: async () => [[], []],
          execute: async () => [
            [
              {
                grant:
                  "GRANT USAGE ON *.* TO 'reader'@'%' IDENTIFIED BY PASSWORD 'secret-sentinel'",
              },
            ],
            [],
          ],
        },
      })
      for (const sql of [
        '/*M! SHOW GRANTS */',
        '/*M!100000SHOW GRANTS */',
        '/*!100000SHOW GRANTS */',
      ]) {
        const out = await adapter.execute(sql, undefined, { sqlMode })
        expect(JSON.stringify(out)).not.toContain('secret-sentinel')
        expect(JSON.stringify(out)).toContain('[REDACTED]')
      }
    })
  }
}
