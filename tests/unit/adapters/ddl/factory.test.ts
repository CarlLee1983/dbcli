import { test, expect, describe } from 'bun:test'
import { DDLGeneratorFactory, PostgreSQLDDLGenerator, MySQLDDLGenerator } from 'src/adapters/ddl'

describe('DDLGeneratorFactory', () => {
  test('creates PostgreSQL generator', () => {
    const gen = DDLGeneratorFactory.create('postgresql')
    expect(gen).toBeInstanceOf(PostgreSQLDDLGenerator)
  })

  test('creates MySQL generator', () => {
    const gen = DDLGeneratorFactory.create('mysql')
    expect(gen).toBeInstanceOf(MySQLDDLGenerator)
  })

  test('creates MariaDB generator (same as MySQL)', () => {
    const gen = DDLGeneratorFactory.create('mariadb')
    expect(gen).toBeInstanceOf(MySQLDDLGenerator)
  })

  test('throws for unsupported system', () => {
    expect(() => DDLGeneratorFactory.create('sqlite' as any)).toThrow('Unsupported')
  })

  test('PG uses double quotes, MySQL uses backticks', () => {
    const pg = DDLGeneratorFactory.create('postgresql')
    const my = DDLGeneratorFactory.create('mysql')

    const pgSql = pg.dropTable('users').sql
    const mySql = my.dropTable('users').sql

    expect(pgSql).toContain('"users"')
    expect(mySql).toContain('`users`')
  })
})
