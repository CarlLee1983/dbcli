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
  // A concrete mock cannot satisfy `execute`'s `<T>() => ExecutionResult<T>`
  // for every T; it returns the rows this test's caller will ask for.
  adapter.execute = (async (sql: string, params) => {
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
  }) as typeof adapter.execute
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

function installSchemaQueryCapture(adapter: PostgreSQLAdapter): {
  queries: Array<{ sql: string; params: unknown[] | undefined }>
} {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = []

  adapter.execute = (async (sql: string, params) => {
    queries.push({ sql, params })

    if (sql.includes('array_agg(primary_key_column.attname')) {
      return {
        rows: [{ columns: ['tenant_id', 'user_id'] }],
        affectedRows: 0,
      }
    }

    if (sql.includes('COUNT(*) as count')) {
      return { rows: [{ count: 0 }], affectedRows: 0 }
    }

    return { rows: [], affectedRows: 0 }
  }) as typeof adapter.execute

  return { queries }
}

function normalizedQuery(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

test('listTables preserves exact catalog schema and table names', async () => {
  const adapter = createAdapter()
  adapter.execute = (async () => ({
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
  })) as typeof adapter.execute

  expect(await adapter.listTables()).toContainEqual(
    expect.objectContaining({ schema: 'Public', name: 'Users' })
  )
})

test('getTableSchema keeps mixed-case public table identities distinct in every lookup', async () => {
  const adapter = createAdapter()
  const capture = installSchemaQueryCapture(adapter)

  await adapter.getTableSchema('Users')
  await adapter.getTableSchema('users')

  const usersQueries = capture.queries.slice(0, capture.queries.length / 2)
  const lowercaseUsersQueries = capture.queries.slice(capture.queries.length / 2)

  expect(usersQueries.filter(({ params }) => params?.[0] === 'Users')).toHaveLength(
    usersQueries.length - 1
  )
  expect(lowercaseUsersQueries.filter(({ params }) => params?.[0] === 'users')).toHaveLength(
    lowercaseUsersQueries.length - 1
  )
  expect(usersQueries.find(({ sql }) => sql.includes('COUNT(*) as count'))?.sql).toBe(
    'SELECT COUNT(*) as count FROM "public"."Users"'
  )
  expect(lowercaseUsersQueries.find(({ sql }) => sql.includes('COUNT(*) as count'))?.sql).toBe(
    'SELECT COUNT(*) as count FROM "public"."users"'
  )
})

test('getTableSchema isolates reused primary-key names by full information-schema identity', async () => {
  const adapter = createAdapter()
  const capture = installSchemaQueryCapture(adapter)

  await adapter.getTableSchema('Users')

  const query = normalizedQuery(
    capture.queries.find(({ sql }) => sql.includes('is_primary_key'))!.sql
  )

  expect(query).toContain(
    'ON tc.constraint_catalog = kcu.constraint_catalog AND tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name'
  )
  expect(query).toContain('tc.table_catalog = c.table_catalog')
  expect(query).toContain('tc.table_schema = c.table_schema')
  expect(query).toContain('tc.table_name = c.table_name')
  expect(query).toContain('kcu.table_catalog = c.table_catalog')
  expect(query).toContain('kcu.table_schema = c.table_schema')
  expect(query).toContain('kcu.table_name = c.table_name')
  expect(query).toContain('kcu.column_name = c.column_name')
})

test('getTableSchema resolves primary-key order from the exact public table OID', async () => {
  const adapter = createAdapter()
  const capture = installSchemaQueryCapture(adapter)

  const schema = await adapter.getTableSchema('Users')
  const query = normalizedQuery(
    capture.queries.find(({ sql }) => sql.includes('array_agg(primary_key_column.attname'))!.sql
  )

  expect(schema.primaryKey).toEqual(['tenant_id', 'user_id'])
  expect(query).toContain('FROM pg_catalog.pg_index AS index_info')
  expect(query).toContain(
    'JOIN pg_catalog.pg_class AS source_table ON source_table.oid = index_info.indrelid'
  )
  expect(query).toContain(
    'JOIN pg_catalog.pg_namespace AS source_schema ON source_schema.oid = source_table.relnamespace'
  )
  expect(query).toContain(
    'JOIN LATERAL unnest(index_info.indkey) WITH ORDINALITY AS primary_key(attnum, ordinality) ON TRUE'
  )
  expect(query).toContain(
    'JOIN pg_catalog.pg_attribute AS primary_key_column ON primary_key_column.attrelid = source_table.oid AND primary_key_column.attnum = primary_key.attnum'
  )
  expect(query).toContain('array_agg(primary_key_column.attname ORDER BY primary_key.ordinality)')
  expect(query).toContain('source_table.relname = $1')
  expect(query).toContain("source_schema.nspname = 'public'")
  expect(query).not.toContain('::regclass')
})

test('getTableSchema scopes row estimates to the exact public table identity', async () => {
  const adapter = createAdapter()
  const capture = installSchemaQueryCapture(adapter)

  await adapter.getTableSchema('Users')

  const query = normalizedQuery(
    capture.queries.find(({ sql }) => sql.includes('estimated_rows'))!.sql
  )
  expect(query).toContain('FROM pg_catalog.pg_class AS source_table')
  expect(query).toContain(
    'JOIN pg_catalog.pg_namespace AS source_schema ON source_schema.oid = source_table.relnamespace'
  )
  expect(query).toContain('source_table.relname = $1')
  expect(query).toContain("source_schema.nspname = 'public'")
})

test('getTableSchema safely quotes and public-qualifies hostile table names for row counts', async () => {
  const adapter = createAdapter()
  const capture = installSchemaQueryCapture(adapter)

  await adapter.getTableSchema('Users"; DROP TABLE audit_log; --')

  const countQuery = capture.queries.find(({ sql }) => sql.includes('COUNT(*) as count'))
  expect(countQuery).toEqual({
    sql: 'SELECT COUNT(*) as count FROM "public"."Users""; DROP TABLE audit_log; --"',
    params: undefined,
  })
})

test('getTableSchema resolves enum types by exact namespace identity', async () => {
  const adapter = createAdapter()
  const capture = installSchemaQueryCapture(adapter)

  await adapter.getTableSchema('Users')

  const query = normalizedQuery(
    capture.queries.find(({ sql }) => sql.includes('array_agg(e.enumlabel'))!.sql
  )
  expect(query).toContain(
    'JOIN pg_catalog.pg_namespace AS enum_schema ON enum_schema.oid = enum_type.typnamespace'
  )
  expect(query).toContain('enum_schema.nspname = c.udt_schema')
  expect(query).toContain("c.table_schema = 'public'")
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
