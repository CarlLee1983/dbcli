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

test('getTableSchema scopes and joins foreign keys by full catalog identity', async () => {
  const adapter = new PostgreSQLAdapter({
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'test',
  })
  ;(adapter as unknown as { pool: object }).pool = {}
  const queries: string[] = []
  adapter.execute = async (sql: string) => {
    queries.push(sql)
    return {
      rows: sql.includes("constraint_type = 'FOREIGN KEY'")
        ? [
            {
              name: 'fk_tenant_user',
              columns: ['user_id'],
              ref_schema: 'Tenant',
              ref_table: 'Users',
              ref_columns: ['id'],
            },
          ]
        : [],
      affectedRows: 0,
    }
  }

  const schema = await adapter.getTableSchema('memberships')
  const fkQuery = queries.find((query) => query.includes("constraint_type = 'FOREIGN KEY'"))
  expect(fkQuery).toBeDefined()
  const normalizedQuery = fkQuery!.replace(/\s+/g, ' ')

  expect(normalizedQuery).toContain('tc.constraint_catalog = kcu.constraint_catalog')
  expect(normalizedQuery).toContain('tc.constraint_schema = kcu.constraint_schema')
  expect(normalizedQuery).toContain('tc.constraint_name = kcu.constraint_name')
  expect(normalizedQuery).toContain('tc.table_catalog = kcu.table_catalog')
  expect(normalizedQuery).toContain('tc.table_schema = kcu.table_schema')
  expect(normalizedQuery).toContain('tc.table_name = kcu.table_name')
  expect(normalizedQuery).toContain('tc.constraint_catalog = ccu.constraint_catalog')
  expect(normalizedQuery).toContain('tc.constraint_schema = ccu.constraint_schema')
  expect(normalizedQuery).toContain('tc.constraint_name = ccu.constraint_name')
  expect(normalizedQuery).toContain("tc.table_schema = 'public'")
  expect(normalizedQuery).toContain(
    'GROUP BY tc.constraint_catalog, tc.constraint_schema, tc.constraint_name, ccu.table_catalog, ccu.table_schema, ccu.table_name'
  )
  expect(schema.foreignKeys).toContainEqual(
    expect.objectContaining({ refSchema: 'Tenant', refTable: 'Users' })
  )
})
