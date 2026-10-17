import { expect, test } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { protectSQLSchema } from '@/commands/schema-protection'
import type { TableSchema } from '@/adapters/types'

const schema: TableSchema = {
  name: 'orders',
  schema: 'audit',
  columns: [
    { name: 'id', type: 'int', nullable: false, primaryKey: true },
    { name: 'secret', type: 'int', nullable: false, primaryKey: true },
    {
      name: 'parent_id',
      type: 'int',
      nullable: false,
      foreignKey: { table: 'parents', column: 'id' },
    },
  ],
  primaryKey: ['id', 'secret'],
  indexes: [{ name: 'secret_index', columns: ['id', 'secret'], unique: true }],
  foreignKeys: [
    {
      name: 'parent_fk',
      columns: ['parent_id'],
      refSchema: 'private',
      refTable: 'parents',
      refColumns: ['id'],
    },
  ],
}
function manager(tables: string[], columns: Record<string, string[]>) {
  return new BlacklistManager({
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 1,
      user: 'test',
      password: '',
      database: 'test',
    },
    permission: 'query-only',
    blacklist: { tables, columns },
  })
}
test('single SQL schema omits entire protected keys and both FK representations', () => {
  const result = protectSQLSchema(schema, manager(['private.parents'], { orders: ['secret'] }))
  expect(result.columns.map((c) => c.name)).toEqual(['id', 'parent_id'])
  expect(result.columns.every((c) => !c.foreignKey && !c.primaryKey)).toBe(true)
  expect(result.primaryKey).toEqual([])
  expect(result.indexes).toEqual([])
  expect(result.foreignKeys).toEqual([])
  expect(result.metadataOmitted).toBe(true)
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(schema.columns).toHaveLength(3)
})
test('qualified and bare rules union with global rules, and target columns protect whole FKs', () => {
  const result = protectSQLSchema(
    schema,
    manager([], { orders: ['id'], 'audit.orders': ['secret'], '*': ['parent_id'] })
  )
  expect(result.columns).toEqual([])
  expect(result.metadataOmitted).toBe(true)
  expect(protectSQLSchema(schema, manager([], { 'private.parents': ['id'] })).foreignKeys).toEqual(
    []
  )
})
test('table blacklist covers either spelling and safe metadata remains visible', () => {
  expect(() => protectSQLSchema(schema, manager(['audit.ord*'], {}))).toThrow()
  expect(() => protectSQLSchema(schema, manager(['ORDERS'], {}))).toThrow()
  expect(protectSQLSchema(schema, manager([], {}))).toEqual(schema)
})

test('expression and partial indexes with incomplete column identities cannot become fake safe constraints', () => {
  const result = protectSQLSchema(
    {
      ...schema,
      indexes: [
        { name: 'secret_expression_idx', columns: ['id'], unique: false, columnsComplete: false },
      ],
    },
    manager([], { orders: ['secret'] })
  )
  expect(result.indexes).toEqual([])
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(result.metadataOmitted).toBe(true)
})
