import { expect, test } from 'bun:test'
import { PostgreSQLAdapter } from '@/adapters/postgresql-adapter'

type ForeignKeyRow = {
  name: string
  columns: string[]
  ref_schema: string
  ref_table: string
  ref_columns: string[]
}

function createAdapter(): PostgreSQLAdapter {
  const adapter = new PostgreSQLAdapter({
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'test',
  })
  ;(adapter as unknown as { pool: object }).pool = {}
  return adapter
}

function installForeignKeyCatalogFixture(
  adapter: PostgreSQLAdapter,
  fixture: {
    oidKeyedRows: Record<string, ForeignKeyRow[]>
    nameJoinedRows: Record<string, ForeignKeyRow[]>
  }
): { foreignKeyQueries: string[] } {
  const foreignKeyQueries: string[] = []
  adapter.execute = async (sql: string, params) => {
    const isForeignKeyQuery =
      sql.includes("constraint_type = 'FOREIGN KEY'") || sql.includes("contype = 'f'")
    if (!isForeignKeyQuery) {
      return { rows: [], affectedRows: 0 }
    }

    foreignKeyQueries.push(sql)
    const tableName = String(params?.[0])
    const rows = sql.includes('pg_catalog.pg_constraint')
      ? fixture.oidKeyedRows[tableName]
      : fixture.nameJoinedRows[tableName]
    return { rows: rows ?? [], affectedRows: 0 }
  }
  return { foreignKeyQueries }
}

function expectRelationallySafeForeignKeyQuery(sql: string): void {
  const normalized = sql.replace(/\s+/g, ' ').trim()

  expect(normalized).toContain('FROM pg_catalog.pg_constraint AS constraint_info')
  expect(normalized).toContain(
    'JOIN pg_catalog.pg_class AS source_table ON source_table.oid = constraint_info.conrelid'
  )
  expect(normalized).toContain(
    'JOIN pg_catalog.pg_class AS referenced_table ON referenced_table.oid = constraint_info.confrelid'
  )
  expect(normalized).toContain(
    'JOIN LATERAL unnest(constraint_info.conkey) WITH ORDINALITY AS source_key(attnum, ordinality) ON TRUE'
  )
  expect(normalized).toContain(
    'JOIN LATERAL unnest(constraint_info.confkey) WITH ORDINALITY AS referenced_key(attnum, ordinality) ON referenced_key.ordinality = source_key.ordinality'
  )
  expect(normalized).toContain(
    'JOIN pg_catalog.pg_attribute AS source_column ON source_column.attrelid = constraint_info.conrelid AND source_column.attnum = source_key.attnum'
  )
  expect(normalized).toContain(
    'JOIN pg_catalog.pg_attribute AS referenced_column ON referenced_column.attrelid = constraint_info.confrelid AND referenced_column.attnum = referenced_key.attnum'
  )
  expect(normalized).toContain(
    'array_agg(source_column.attname ORDER BY source_key.ordinality) as columns'
  )
  expect(normalized).toContain(
    'array_agg(referenced_column.attname ORDER BY source_key.ordinality) as ref_columns'
  )
  expect(normalized).toContain("WHERE constraint_info.contype = 'f'")
  expect(normalized).toContain('source_table.relname = $1')
  expect(normalized).toContain("source_schema.nspname = 'public'")

  const groupBy = normalized.match(/ GROUP BY (.+?) ORDER BY constraint_info\.oid$/)?.[1]
  expect(groupBy).toBeDefined()
  expect(groupBy!.split(',').map((column) => column.trim())[0]).toBe('constraint_info.oid')
  expect(normalized).not.toContain('GROUP BY constraint_info.conname')
  expect(normalized).toMatch(/ORDER BY constraint_info\.oid$/)
}

test('listTables preserves exact catalog schema and table names', async () => {
  const adapter = createAdapter()
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

test('getTableSchema preserves composite foreign-key column pairing and order', async () => {
  const adapter = createAdapter()
  const capture = installForeignKeyCatalogFixture(adapter, {
    oidKeyedRows: {
      memberships: [
        {
          name: 'memberships_user_fk',
          columns: ['tenant_id', 'user_id'],
          ref_schema: 'Tenant',
          ref_table: 'Users',
          ref_columns: ['tenant_id', 'id'],
        },
      ],
    },
    nameJoinedRows: {
      memberships: [
        {
          name: 'memberships_user_fk',
          columns: ['tenant_id', 'tenant_id', 'user_id', 'user_id'],
          ref_schema: 'Tenant',
          ref_table: 'Users',
          ref_columns: ['tenant_id', 'id', 'tenant_id', 'id'],
        },
      ],
    },
  })

  const schema = await adapter.getTableSchema('memberships')

  expect(capture.foreignKeyQueries).toHaveLength(1)
  expectRelationallySafeForeignKeyQuery(capture.foreignKeyQueries[0]!)
  expect(schema.foreignKeys).toEqual([
    {
      name: 'memberships_user_fk',
      columns: ['tenant_id', 'user_id'],
      refSchema: 'Tenant',
      refTable: 'Users',
      refColumns: ['tenant_id', 'id'],
    },
  ])
})

test('getTableSchema isolates reused constraint names by source table identity', async () => {
  const adapter = createAdapter()
  const capture = installForeignKeyCatalogFixture(adapter, {
    oidKeyedRows: {
      orders: [
        {
          name: 'owner_fk',
          columns: ['account_id'],
          ref_schema: 'CRM',
          ref_table: 'Accounts',
          ref_columns: ['id'],
        },
      ],
      audit_orders: [
        {
          name: 'owner_fk',
          columns: ['actor_id'],
          ref_schema: 'Audit',
          ref_table: 'Actors',
          ref_columns: ['id'],
        },
      ],
    },
    nameJoinedRows: {
      orders: [
        {
          name: 'owner_fk',
          columns: ['account_id'],
          ref_schema: 'CRM',
          ref_table: 'Accounts',
          ref_columns: ['id'],
        },
        {
          name: 'owner_fk',
          columns: ['account_id'],
          ref_schema: 'Audit',
          ref_table: 'Actors',
          ref_columns: ['id'],
        },
      ],
      audit_orders: [
        {
          name: 'owner_fk',
          columns: ['actor_id'],
          ref_schema: 'CRM',
          ref_table: 'Accounts',
          ref_columns: ['id'],
        },
        {
          name: 'owner_fk',
          columns: ['actor_id'],
          ref_schema: 'Audit',
          ref_table: 'Actors',
          ref_columns: ['id'],
        },
      ],
    },
  })

  const orders = await adapter.getTableSchema('orders')
  const auditOrders = await adapter.getTableSchema('audit_orders')

  expect(capture.foreignKeyQueries).toHaveLength(2)
  for (const query of capture.foreignKeyQueries) {
    expectRelationallySafeForeignKeyQuery(query)
  }
  expect(orders.foreignKeys).toEqual([
    {
      name: 'owner_fk',
      columns: ['account_id'],
      refSchema: 'CRM',
      refTable: 'Accounts',
      refColumns: ['id'],
    },
  ])
  expect(auditOrders.foreignKeys).toEqual([
    {
      name: 'owner_fk',
      columns: ['actor_id'],
      refSchema: 'Audit',
      refTable: 'Actors',
      refColumns: ['id'],
    },
  ])
})
