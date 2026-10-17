import { expect, test } from 'bun:test'
import { PostgreSQLAdapter } from '@/adapters/postgresql-adapter'
import { MySQLAdapter } from '@/adapters/mysql-adapter'
import { TableSchemaJSONFormatter } from '@/formatters/json-formatter'

function fixture(system: 'postgresql' | 'mysql', fail?: string, present = true) {
  const options = {
    system,
    host: 'localhost',
    port: 1,
    user: 'fixture',
    password: '',
    database: 'default_db',
  }
  const adapter =
    system === 'postgresql' ? new PostgreSQLAdapter(options) : new MySQLAdapter(options)
  const queries: { sql: string; params?: unknown[] }[] = []
  // Only the driver boundary is replaced: all introspection SQL executes normally.
  const rows = (sql: string, params?: unknown[]) => {
    queries.push({ sql, params })
    if (fail && sql.includes(fail)) throw new Error('fixture metadata denied')
    if (sql.includes('relkind as relation_kind'))
      return present ? [{ relation_kind: 'v', estimated_rows: -1 }] : []
    if (sql.includes('TABLE_TYPE as table_type'))
      return present
        ? [{ table_type: 'VIEW', schema_name: 'audit', table_name: 'events', estimated_rows: null }]
        : []
    if (sql.includes('as default_value')) return [{ name: 'id', type: 'integer', nullable: false }]
    return []
  }
  if (system === 'postgresql') {
    Object.assign(adapter, {
      pool: {
        query: async (sql: string, params?: unknown[]) => ({
          rows: rows(sql, params),
          rowCount: 0,
        }),
      },
    })
  } else
    Object.assign(adapter, {
      db: { execute: async (sql: string, params?: unknown[]) => [rows(sql, params), []] },
    })
  return { adapter, queries }
}

for (const system of ['postgresql', 'mysql'] as const) {
  test(`${system} qualified views have explicit presence and unknown count without reading relation data`, async () => {
    const { adapter, queries } = fixture(system)
    const schema = await adapter.getTableSchema('events', { namespace: 'audit' })
    expect(schema).toMatchObject({ name: 'events', schema: 'audit', tableType: 'view' })
    const output = JSON.parse(new TableSchemaJSONFormatter().format(schema))
    expect(output.estimatedRowCount).toBeNull()
    expect(output.sizeCategory).toBeNull()
    expect(output.metadata.rowCount).toBeUndefined()
    expect(queries.some(({ sql }) => sql.includes('COUNT(*)'))).toBe(false)
    expect(queries.every(({ params }) => params?.includes('audit'))).toBe(true)
  })
  test(`${system} missing qualified objects fail instead of returning empty success`, async () => {
    const { adapter } = fixture(system, undefined, false)
    await expect(adapter.getTableSchema('events', { namespace: 'audit' })).rejects.toThrow()
  })
  for (const marker of system === 'postgresql'
    ? ['as default_value', 'contype', 'FROM pg_index', 'index_info.indisprimary']
    : ['as default_value', 'REFERENTIAL_CONSTRAINTS', 'STATISTICS']) {
    test(`${system} metadata failure at ${marker} is not swallowed`, async () => {
      const { adapter } = fixture(system, marker)
      await expect(adapter.getTableSchema('events', { namespace: 'audit' })).rejects.toThrow(
        'fixture metadata denied'
      )
    })
  }
}

test('MySQL metadata preserves comma-containing column identities and primary-key order', async () => {
  const adapter = new MySQLAdapter({
    system: 'mysql',
    host: 'localhost',
    port: 1,
    user: 'fixture',
    password: '',
    database: 'db',
  })
  Object.assign(adapter, {
    db: {
      execute: async (sql: string) => {
        if (sql.includes('information_schema.STATISTICS'))
          return [
            [
              { name: 'PRIMARY', column_name: 'z', is_unique: 1 },
              { name: 'PRIMARY', column_name: 'a,b', is_unique: 1 },
              { name: 'idx', column_name: 'a,b', is_unique: 0 },
            ],
            [],
          ]
        if (sql.includes('REFERENTIAL_CONSTRAINTS'))
          return [
            [
              {
                name: 'fk',
                column_name: 'a,b',
                ref_schema: 'other',
                ref_table: 'parents',
                ref_column: 'x,y',
              },
            ],
            [],
          ]
        if (sql.includes('information_schema.TABLES'))
          return [[{ schema_name: 'db', table_name: 't', table_type: 'BASE TABLE' }], []]
        return [[], []]
      },
    },
  })
  const result = await adapter.getTableSchema('t', { namespace: 'db' })
  expect(result.primaryKey).toEqual(['z', 'a,b'])
  expect(result.indexes).toEqual([{ name: 'idx', columns: ['a,b'], unique: false }])
  expect(result.foreignKeys).toEqual([
    { name: 'fk', columns: ['a,b'], refSchema: 'other', refTable: 'parents', refColumns: ['x,y'] },
  ])
})
