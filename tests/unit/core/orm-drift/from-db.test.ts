import { describe, test, expect } from 'bun:test'
import { normalizeDbSchema } from '@/core/orm-drift/from-db'
import type { TableSchema } from '@/adapters/types'

const users: TableSchema = {
  name: 'Users',
  schema: 'public',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
    { name: 'email', type: 'varchar(255)', nullable: true, default: 'NULL' },
  ],
  indexes: [{ name: 'users_email_idx', columns: ['email'], unique: true }],
  foreignKeys: [
    {
      name: 'fk_org',
      columns: ['org_id'],
      refSchema: 'accounts',
      refTable: 'orgs',
      refColumns: ['id'],
    },
  ],
}

describe('normalizeDbSchema', () => {
  test('converts TableSchema map into exact NormalizedSchema identities', () => {
    const out = normalizeDbSchema({ Users: users }, { defaultSchema: 'public' })
    const table = out.tables[0]!
    expect(out.source).toBe('db')
    expect(out.defaultSchema).toBe('public')
    expect(table.identity).toEqual({ schema: 'public', table: 'Users' })
    expect(table.parsedIdentifier).toBeUndefined()
    expect(table.columns[0]).toEqual({
      name: 'id',
      type: 'integer',
      rawType: 'INTEGER',
      nullable: false,
      primaryKey: true,
    })
    expect(table.indexes[0]?.unique).toBe(true)
    expect(table.foreignKeys[0]?.refTable).toEqual({ schema: 'accounts', table: 'orgs' })
    expect(out.unparsed).toEqual([])
  })

  test('missing indexes/foreignKeys become empty arrays', () => {
    const bare: TableSchema = { name: 't', columns: [] }
    expect(normalizeDbSchema({ t: bare }).tables[0]?.indexes).toEqual([])
    expect(normalizeDbSchema({ t: bare }).tables[0]?.foreignKeys).toEqual([])
  })

  test('preserves case-distinct catalog identities without quote inference', () => {
    const out = normalizeDbSchema(
      {
        lower: { name: 'users', schema: 'public', columns: [] },
        quoted: { name: 'Users', schema: 'public', columns: [] },
      },
      { defaultSchema: 'public' }
    )

    expect(out.defaultSchema).toBe('public')
    expect(out.tables.map((table) => table.identity)).toEqual([
      { schema: 'public', table: 'users' },
      { schema: 'public', table: 'Users' },
    ])
    expect(out.tables.every((table) => table.parsedIdentifier === undefined)).toBe(true)
  })

  test('rejects duplicate exact catalog identities', () => {
    expect(() =>
      normalizeDbSchema({
        first: { name: 'Users', schema: 'public', columns: [] },
        second: { name: 'Users', schema: 'public', columns: [] },
      })
    ).toThrow("duplicate table identity 'public.Users'")
  })

  test('derives the exact default schema when every catalog table agrees', () => {
    const out = normalizeDbSchema({
      users: { name: 'users', schema: 'public', columns: [] },
      posts: { name: 'posts', schema: 'public', columns: [] },
    })

    expect(out.defaultSchema).toBe('public')
  })

  test('explicit default schema wins over catalog derivation', () => {
    const out = normalizeDbSchema(
      {
        users: { name: 'users', schema: 'public', columns: [] },
      },
      { defaultSchema: 'configured' }
    )

    expect(out.defaultSchema).toBe('configured')
  })

  test('does not guess a default schema from zero or multiple catalog schemas', () => {
    expect(
      normalizeDbSchema({ users: { name: 'users', columns: [] } }).defaultSchema
    ).toBeUndefined()
    expect(
      normalizeDbSchema({
        users: { name: 'users', schema: 'public', columns: [] },
        audit: { name: 'audit', schema: 'accounts', columns: [] },
      }).defaultSchema
    ).toBeUndefined()
  })
})
