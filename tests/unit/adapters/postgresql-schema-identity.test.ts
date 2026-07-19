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
): void {
  adapter.execute = async (sql: string, params) => {
    const isForeignKeyQuery =
      sql.includes("constraint_type = 'FOREIGN KEY'") || sql.includes("contype = 'f'")
    if (!isForeignKeyQuery) {
      return { rows: [], affectedRows: 0 }
    }

    const tableName = String(params?.[0])
    const rows = sql.includes('pg_catalog.pg_constraint')
      ? fixture.oidKeyedRows[tableName]
      : fixture.nameJoinedRows[tableName]
    return { rows: rows ?? [], affectedRows: 0 }
  }
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
  installForeignKeyCatalogFixture(adapter, {
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
  installForeignKeyCatalogFixture(adapter, {
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
