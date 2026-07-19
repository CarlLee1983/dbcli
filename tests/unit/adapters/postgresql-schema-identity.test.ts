import { expect, test } from 'bun:test'
import { PostgreSQLAdapter } from '@/adapters/postgresql-adapter'

test('listTables preserves exact catalog schema and table names', async () => {
  const adapter = new PostgreSQLAdapter({
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'test',
  })
  ;(adapter as unknown as { pool: object }).pool = {}
  adapter.execute = async () => ({
    rows: [
      {
        schema_name: 'Public',
        table_name: 'Users',
        estimated_rows: 0,
        table_type: 'table',
        column_count: 1,
      },
    ],
    affectedRows: 0,
  })

  expect(await adapter.listTables()).toContainEqual(
    expect.objectContaining({ schema: 'Public', name: 'Users' })
  )
})
