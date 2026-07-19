import { describe, expect, test } from 'bun:test'
import { normalizedSchemaZod, typeFamily } from '@/core/orm-drift/normalized-schema'

describe('typeFamily', () => {
  test('maps engine spellings into neutral families', () => {
    expect(typeFamily('integer')).toBe('integer')
    expect(typeFamily('INT')).toBe('integer')
    expect(typeFamily('bigint')).toBe('integer')
    expect(typeFamily('serial')).toBe('integer')
    expect(typeFamily('varchar(255)')).toBe('text')
    expect(typeFamily('character varying(191)')).toBe('text')
    expect(typeFamily('TEXT')).toBe('text')
    expect(typeFamily('numeric(10,2)')).toBe('decimal')
    expect(typeFamily('double precision')).toBe('decimal')
    expect(typeFamily('boolean')).toBe('boolean')
    expect(typeFamily('tinyint(1)')).toBe('boolean')
    expect(typeFamily('timestamp with time zone')).toBe('datetime')
    expect(typeFamily('datetime')).toBe('datetime')
    expect(typeFamily('date')).toBe('date')
    expect(typeFamily('jsonb')).toBe('json')
    expect(typeFamily('uuid')).toBe('uuid')
    expect(typeFamily('bytea')).toBe('binary')
    expect(typeFamily('custom_enum_thing')).toBe('other')
  })
})

describe('normalizedSchemaZod', () => {
  test('accepts a minimal valid document', () => {
    const doc = {
      source: 'json',
      tables: {
        users: {
          name: 'users',
          columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
          indexes: [],
          foreignKeys: [],
        },
      },
      unparsed: [],
    }
    expect(normalizedSchemaZod.parse(doc).tables.users.columns[0].name).toBe('id')
  })

  test('rejects a column without nullable', () => {
    const doc = {
      source: 'json',
      tables: {
        t: {
          name: 't',
          columns: [{ name: 'a', type: 'text' }],
          indexes: [],
          foreignKeys: [],
        },
      },
      unparsed: [],
    }
    expect(() => normalizedSchemaZod.parse(doc)).toThrow()
  })
})
