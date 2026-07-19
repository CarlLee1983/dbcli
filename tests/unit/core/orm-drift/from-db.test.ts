import { describe, test, expect } from 'bun:test'
import { normalizeDbSchema } from '@/core/orm-drift/from-db'
import type { TableSchema } from '@/adapters/types'

const users: TableSchema = {
  name: 'Users',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
    { name: 'email', type: 'varchar(255)', nullable: true, default: 'NULL' },
  ],
  indexes: [{ name: 'users_email_idx', columns: ['email'], unique: true }],
  foreignKeys: [
    { name: 'fk_org', columns: ['org_id'], refTable: 'orgs', refColumns: ['id'] },
  ],
}

describe('normalizeDbSchema', () => {
  test('converts TableSchema map into NormalizedSchema keyed by lowercase name', () => {
    const out = normalizeDbSchema({ Users: users })
    expect(out.source).toBe('db')
    expect(out.tables.users.name).toBe('Users')
    expect(out.tables.users.columns[0]).toEqual({
      name: 'id',
      type: 'integer',
      rawType: 'INTEGER',
      nullable: false,
      primaryKey: true,
    })
    expect(out.tables.users.indexes[0].unique).toBe(true)
    expect(out.tables.users.foreignKeys[0].refTable).toBe('orgs')
    expect(out.unparsed).toEqual([])
  })

  test('missing indexes/foreignKeys become empty arrays', () => {
    const bare: TableSchema = { name: 't', columns: [] }
    expect(normalizeDbSchema({ t: bare }).tables.t.indexes).toEqual([])
    expect(normalizeDbSchema({ t: bare }).tables.t.foreignKeys).toEqual([])
  })
})
