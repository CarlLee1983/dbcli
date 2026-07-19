import { describe, expect, test } from 'bun:test'
import { normalizedSchemaZod, typeFamily } from '@/core/orm-drift/normalized-schema'
import {
  qualifiedTableName,
  resolveTableIdentifier,
  tableIdentityKey,
} from '@/core/orm-drift/table-identity'

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
      tables: [
        {
          identity: { table: 'users' },
          columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
          indexes: [],
          foreignKeys: [],
        },
      ],
      unparsed: [],
    }
    expect(normalizedSchemaZod.parse(doc).tables[0]?.columns[0]?.name).toBe('id')
  })

  test('rejects a column without nullable', () => {
    const doc = {
      source: 'json',
      tables: [
        {
          identity: { table: 't' },
          columns: [{ name: 'a', type: 'text' }],
          indexes: [],
          foreignKeys: [],
        },
      ],
      unparsed: [],
    }
    expect(() => normalizedSchemaZod.parse(doc)).toThrow()
  })

  test('zod accepts exact array identities and requires quote flags when parsed', () => {
    const parsed = normalizedSchemaZod.parse({
      source: 'json',
      defaultSchema: 'public',
      tables: [
        {
          identity: { schema: 'public', table: 'Users' },
          parsedIdentifier: { table: { value: 'Users', quoted: true } },
          columns: [],
          indexes: [],
          foreignKeys: [],
        },
      ],
      unparsed: [],
    })
    expect(parsed.tables[0]?.identity.table).toBe('Users')
    expect(() =>
      normalizedSchemaZod.parse({
        source: 'json',
        tables: [
          {
            identity: { table: 'Users' },
            parsedIdentifier: { table: { value: 'Users' } },
            columns: [],
            indexes: [],
            foreignKeys: [],
          },
        ],
        unparsed: [],
      })
    ).toThrow()
  })

  test('rejects duplicate exact table identities', () => {
    const table = {
      identity: { schema: 'public', table: 'Users' },
      columns: [],
      indexes: [],
      foreignKeys: [],
    }

    expect(() =>
      normalizedSchemaZod.parse({
        source: 'json',
        tables: [table, table],
        unparsed: [],
      })
    ).toThrow(/duplicate table identity 'public\.Users'/)
  })

  test('accepts case-distinct table identities', () => {
    const parsed = normalizedSchemaZod.parse({
      source: 'json',
      tables: [
        {
          identity: { schema: 'public', table: 'users' },
          columns: [],
          indexes: [],
          foreignKeys: [],
        },
        {
          identity: { schema: 'public', table: 'Users' },
          columns: [],
          indexes: [],
          foreignKeys: [],
        },
      ],
      unparsed: [],
    })

    expect(parsed.tables.map((table) => table.identity.table)).toEqual(['users', 'Users'])
  })
})

describe('table identity', () => {
  test('unquoted identifiers fold while quoted identifiers remain exact', () => {
    expect(
      resolveTableIdentifier(
        {
          schema: { value: 'Public', quoted: false },
          table: { value: 'Users', quoted: false },
        },
        'ignored'
      )
    ).toEqual({ schema: 'public', table: 'users' })

    expect(
      resolveTableIdentifier(
        {
          schema: { value: 'Public', quoted: true },
          table: { value: 'Users', quoted: true },
        },
        'ignored'
      )
    ).toEqual({ schema: 'Public', table: 'Users' })
  })

  test('unqualified parsed identifiers use the exact default schema', () => {
    expect(resolveTableIdentifier({ table: { value: 'Users', quoted: false } }, 'public')).toEqual({
      schema: 'public',
      table: 'users',
    })
  })

  test('identity keys do not merge case-distinct or dotted components', () => {
    expect(tableIdentityKey({ schema: 'public', table: 'users' })).not.toBe(
      tableIdentityKey({ schema: 'public', table: 'Users' })
    )
    expect(tableIdentityKey({ schema: 'a.b', table: 'c' })).not.toBe(
      tableIdentityKey({ schema: 'a', table: 'b.c' })
    )
    expect(qualifiedTableName({ schema: 'public', table: 'Users' })).toBe('public.Users')
  })
})
