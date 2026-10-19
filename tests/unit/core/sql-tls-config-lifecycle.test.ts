import { expect, test } from 'bun:test'
import { DbcliConfigSchema, DbcliConfigV2Schema } from '@/utils/validation'
import { migrateV1ToV2, upsertConnection } from '@/core/config-v2-mutations'

const sqlTls = { mode: 'verify-full', caPath: '/fixture/ca.pem' }
const connection = {
  system: 'postgresql',
  host: 'localhost',
  port: 5432,
  user: 'reader',
  password: '',
  database: 'fixture',
  sqlTls,
}

test.each(['postgresql', 'mysql', 'mariadb'] as const)(
  'V1 migration and %s profile edits preserve the explicit TLS requirement',
  (system) => {
    const migrated = migrateV1ToV2(
      DbcliConfigSchema.parse({ connection: { ...connection, system } })
    )
    expect(migrated.connections.default).toHaveProperty('sqlTls', sqlTls)
    const edited = upsertConnection(DbcliConfigV2Schema.parse(migrated), {
      name: 'default',
      system,
      host: 'new.example',
      port: 5432,
      user: 'reader',
      database: 'fixture',
    })
    expect(edited.connections.default).toHaveProperty('sqlTls', sqlTls)
  }
)

test.each(['postgresql', 'mysql', 'mariadb'] as const)(
  'changing a TLS profile to supported %s preserves its trust',
  (system) => {
    const config = DbcliConfigV2Schema.parse({ version: 2, connections: { verified: connection } })
    expect(
      upsertConnection(config, {
        name: 'verified',
        system,
        host: 'localhost',
        port: 3306,
        user: 'reader',
        database: 'fixture',
      })
    ).toHaveProperty('connections.verified.sqlTls', sqlTls)
  }
)

test.each([
  null,
  false,
  {},
  { mode: 'require', caPath: '/ca.pem' },
  { mode: 'verify-full', caPath: 'relative.pem' },
  { mode: 'verify-full', caPath: { $env: 'CA' } },
  { mode: 'verify-full', caPath: '/ca.pem', rejectUnauthorized: false },
])('invalid or unrepresentable TLS requirements are rejected in V1 and V2: %j', (sqlTls) => {
  expect(() => DbcliConfigSchema.parse({ connection: { ...connection, sqlTls } })).toThrow()
  expect(() =>
    DbcliConfigV2Schema.parse({ version: 2, connections: { x: { ...connection, sqlTls } } })
  ).toThrow()
})

test('direct MySQL/MariaDB adapter callers cannot silently ignore explicit SQL TLS', async () => {
  const { MySQLAdapter } = await import('@/adapters/mysql-adapter')
  for (const system of ['mysql', 'mariadb'] as const) {
    const adapter = new MySQLAdapter({
      system,
      host: '127.0.0.1',
      port: 1,
      user: 'unused',
      password: '',
      database: 'unused',
      sqlTls: { mode: 'verify-full', caPath: '/missing.pem' },
    })
    await expect(adapter.connect()).rejects.toThrow('SQL TLS')
  }
})

test('all exported adapter factory routes refuse unsupported SQL TLS', async () => {
  const { AdapterFactory } = await import('@/adapters/factory')
  for (const system of ['sqlite', 'redis', 'mongodb', 'elasticsearch'] as const) {
    const options = {
      system,
      host: 'unused',
      port: 1,
      user: 'unused',
      password: '',
      database: 'unused',
      file: '/unused.sqlite',
      sqlTls: { mode: 'verify-full' as const, caPath: '/ca.pem' },
    }
    expect(() => AdapterFactory.createAdapterWithoutRules(options)).toThrow('SQL TLS')
    expect(() =>
      AdapterFactory.createAdapter({ connection: options, blacklist: { tables: [], columns: {} } })
    ).toThrow('SQL TLS')
  }
})
