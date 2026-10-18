import { expect, test } from 'bun:test'
import { MySQLAdapter } from '@/adapters/mysql-adapter'
import { PostgreSQLAdapter } from '@/adapters/postgresql-adapter'

for (const system of ['mysql', 'mariadb', 'postgresql'] as const) {
  const native =
    system === 'postgresql'
      ? { code: '42501', message: 'private denied object' }
      : { code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1142, message: 'private denied object' }
  const create = () => {
    const options = {
      system,
      host: 'localhost',
      port: 1,
      user: 'fixture',
      password: '',
      database: 'fixture',
    }
    return system === 'postgresql' ? new PostgreSQLAdapter(options) : new MySQLAdapter(options)
  }
  for (const operation of ['execute', 'schema', 'list'] as const) {
    test(`${system} ${operation} preserves native authorization at the driver boundary`, async () => {
      const adapter = create()
      const reject = async () => {
        throw native
      }
      Object.assign(
        adapter,
        system === 'postgresql'
          ? { pool: { query: reject } }
          : { db: { execute: reject, query: reject } }
      )
      const result =
        operation === 'execute'
          ? adapter.execute('SELECT id FROM fixture')
          : operation === 'schema'
            ? adapter.getTableSchema('fixture', { namespace: 'fixture' })
            : adapter.listTables()
      await expect(result).rejects.toMatchObject({ code: 'DB_PERMISSION_DENIED' })
    })
  }
  test(`${system} query-only setup refusal keeps boundary-failed precedence`, async () => {
    const adapter = create()
    const calls: string[] = []
    const reject = async (sql: string) => {
      calls.push(sql)
      throw native
    }
    Object.assign(
      adapter,
      system === 'postgresql'
        ? { pool: { connect: async () => ({ query: reject, release: () => {} }) } }
        : { db: { query: reject, execute: reject } }
    )
    await expect(
      adapter.execute('SELECT target()', undefined, { sqlMode: 'native-read-only' })
    ).rejects.toMatchObject({ code: 'QUERY_ONLY_BOUNDARY_FAILED' })
    expect(calls).toHaveLength(1)
    expect(calls).not.toContain('SELECT target()')
  })
}
