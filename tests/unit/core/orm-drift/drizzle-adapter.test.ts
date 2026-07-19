import { describe, test, expect } from 'bun:test'
import { parseDrizzleSnapshot, isDrizzleSnapshot } from '@/core/orm-drift/adapters/drizzle'
import type { NormalizedSchema, NormalizedTable } from '@/core/orm-drift/normalized-schema'

const snapshot = JSON.parse(await Bun.file('tests/fixtures/orm-drift/drizzle-snapshot.json').text())

interface MutableIndex extends Record<string, unknown> {
  columns: Array<Record<string, unknown>>
}

function tableNamed(schema: NormalizedSchema, name: string): NormalizedTable {
  const table = schema.tables.find((candidate) => candidate.identity.table === name)
  expect(table).toBeDefined()
  return table!
}

describe('parseDrizzleSnapshot', () => {
  test('maps tables/columns with pk, notNull, default', () => {
    const out = parseDrizzleSnapshot(snapshot)
    expect(out.source).toBe('drizzle')
    const users = tableNamed(out, 'users')
    expect(users.identity).toEqual({ schema: 'public', table: 'users' })
    const byName = Object.fromEntries(users.columns.map((c) => [c.name, c]))
    expect(byName.id).toMatchObject({ type: 'serial', nullable: false, primaryKey: true })
    expect(byName.email.nullable).toBe(false)
    expect(byName.bio).toMatchObject({ nullable: true, default: "''" })
  })

  test('preserves supported primitive column defaults', () => {
    const variants: Array<[string, string | boolean | number, string]> = [
      ['string', "'active'", "'active'"],
      ['true', true, 'true'],
      ['false', false, 'false'],
      ['finite number', 42, '42'],
      ['zero', 0, '0'],
    ]

    for (const [label, value, expected] of variants) {
      const withDefault = structuredClone(snapshot)
      withDefault.tables['public.users'].columns.bio.default = value

      const out = parseDrizzleSnapshot(withDefault)
      expect(
        tableNamed(out, 'users').columns.find((column) => column.name === 'bio')?.default,
        label
      ).toBe(expected)
      expect(
        out.unparsed.some((entry) => entry.location === 'public.users.columns.bio.default'),
        label
      ).toBe(false)
    }
  })

  test('blocks unsupported column defaults and omits their columns', () => {
    const variants: Array<[string, unknown]> = [
      ['null', null],
      ['object', { expression: 'now()' }],
      ['array', ['now()']],
      ['NaN', Number.NaN],
      ['positive infinity', Number.POSITIVE_INFINITY],
      ['negative infinity', Number.NEGATIVE_INFINITY],
    ]

    for (const [label, value] of variants) {
      const withDefault = structuredClone(snapshot)
      withDefault.tables['public.users'].columns.bio.default = value

      const out = parseDrizzleSnapshot(withDefault)
      expect(
        tableNamed(out, 'users').columns.some((column) => column.name === 'bio'),
        label
      ).toBe(false)
      expect(
        out.unparsed.some(
          (entry) =>
            entry.location === 'public.users.columns.bio.default' &&
            entry.reason.startsWith('blocked:')
        ),
        label
      ).toBe(true)
    }
  })

  test('maps structured non-expression indexes and foreign keys', () => {
    const users = tableNamed(parseDrizzleSnapshot(snapshot), 'users')
    expect(users.indexes).toContainEqual({
      name: 'users_email_idx',
      columns: ['email'],
      unique: true,
    })
    expect(users.foreignKeys).toEqual([
      {
        columns: ['org_id'],
        refTable: { table: 'orgs' },
        refColumns: ['id'],
      },
    ])
  })

  test('enums land in unparsed with blocked reason', () => {
    const out = parseDrizzleSnapshot(snapshot)
    expect(
      out.unparsed.some((u) => u.reason.includes('blocked:') && u.location.includes('mood'))
    ).toBe(true)
  })

  test('unsupported snapshot version is blocked without producing managed tables', () => {
    const unsupported = structuredClone(snapshot)
    unsupported.version = '6'

    const out = parseDrizzleSnapshot(unsupported)

    expect(out.tables).toEqual([])
    expect(out.unparsed).toContainEqual({
      location: 'version',
      reason: "blocked: unsupported drizzle snapshot version '6'; only version '7' is supported",
    })
  })

  test('unsupported snapshot dialect is blocked without producing managed tables', () => {
    const unsupported = structuredClone(snapshot)
    unsupported.dialect = 'mysql'

    const out = parseDrizzleSnapshot(unsupported)

    expect(out.tables).toEqual([])
    expect(out.unparsed).toContainEqual({
      location: 'dialect',
      reason:
        "blocked: unsupported drizzle snapshot dialect 'mysql'; only 'postgresql' is supported",
    })
  })

  test('expression indexes are blocked instead of guessed as column indexes', () => {
    const withExpression = structuredClone(snapshot)
    withExpression.tables['public.users'].indexes.users_email_idx.columns = [
      {
        expression: 'lower(email)',
        isExpression: true,
        asc: true,
        nulls: 'last',
      },
    ]

    const out = parseDrizzleSnapshot(withExpression)
    expect(tableNamed(out, 'users').indexes).toEqual([])
    expect(out.unparsed).toContainEqual({
      location: 'public.users.indexes.users_email_idx',
      reason: expect.stringContaining('blocked:'),
    })
  })

  test('indexes with unsupported or unknown semantics are omitted instead of reduced', () => {
    const variants: Array<[string, (index: MutableIndex) => void]> = [
      ['partial predicate', (index) => (index.where = 'email IS NOT NULL')],
      ['non-btree method', (index) => (index.method = 'hash')],
      ['storage parameters', (index) => (index.with = { fillfactor: '70' })],
      ['concurrent creation', (index) => (index.concurrently = true)],
      ['descending order', (index) => (index.columns[0]!.asc = false)],
      ['non-default null order', (index) => (index.columns[0]!.nulls = 'first')],
      ['operator class', (index) => (index.columns[0]!.opclass = 'text_pattern_ops')],
      ['unknown option', (index) => (index.futureIndexOption = true)],
      ['unknown column option', (index) => (index.columns[0]!.futureColumnOption = true)],
    ]

    for (const [label, mutate] of variants) {
      const withUnsupported = structuredClone(snapshot)
      mutate(withUnsupported.tables['public.users'].indexes.users_email_idx)

      const out = parseDrizzleSnapshot(withUnsupported)
      expect(tableNamed(out, 'users').indexes, label).toEqual([])
      expect(
        out.unparsed.some(
          (entry) =>
            entry.location.startsWith('public.users.indexes.users_email_idx') &&
            entry.reason.startsWith('blocked:')
        ),
        label
      ).toBe(true)
    }
  })

  test('columns with unsupported or unknown semantics are omitted instead of reduced', () => {
    const variants: Array<[string, (column: Record<string, unknown>) => void]> = [
      ['schema-qualified type', (column) => (column.typeSchema = 'public')],
      ['generated value', (column) => (column.generated = { type: 'stored', as: "'generated'" })],
      [
        'identity',
        (column) =>
          (column.identity = {
            type: 'always',
            name: 'users_bio_seq',
            schema: 'public',
            increment: '1',
            minValue: '1',
            maxValue: '2147483647',
            startWith: '1',
            cache: '1',
            cycle: false,
          }),
      ],
      ['column uniqueness', (column) => (column.isUnique = true)],
      ['unique constraint name', (column) => (column.uniqueName = 'users_bio_unique')],
      ['nulls-not-distinct uniqueness', (column) => (column.nullsNotDistinct = true)],
      ['unknown option', (column) => (column.futureColumnOption = true)],
    ]

    for (const [label, mutate] of variants) {
      const withUnsupported = structuredClone(snapshot)
      mutate(withUnsupported.tables['public.users'].columns.bio)

      const out = parseDrizzleSnapshot(withUnsupported)
      expect(
        tableNamed(out, 'users').columns.some((column) => column.name === 'bio'),
        label
      ).toBe(false)
      expect(
        out.unparsed.some(
          (entry) =>
            entry.location.startsWith('public.users.columns.bio') &&
            entry.reason.startsWith('blocked:')
        ),
        label
      ).toBe(true)
    }
  })

  test('surfaces every blocked reason when one construct has multiple unsupported semantics', () => {
    const withUnsupported = structuredClone(snapshot)
    const index = withUnsupported.tables['public.users'].indexes.users_email_idx
    index.where = 'email IS NOT NULL'
    index.futureIndexOption = true
    const column = withUnsupported.tables['public.users'].columns.bio
    column.generated = { type: 'stored', as: "'generated'" }
    column.futureColumnOption = true

    const out = parseDrizzleSnapshot(withUnsupported)
    expect(tableNamed(out, 'users').indexes).toEqual([])
    expect(tableNamed(out, 'users').columns.some((candidate) => candidate.name === 'bio')).toBe(
      false
    )
    expect(out.unparsed.map((entry) => entry.location)).toEqual(
      expect.arrayContaining([
        'public.users.indexes.users_email_idx.where',
        'public.users.indexes.users_email_idx.futureIndexOption',
        'public.users.columns.bio.generated',
        'public.users.columns.bio.futureColumnOption',
      ])
    )
  })

  test('foreign keys with unsupported or unknown semantics are omitted instead of reduced', () => {
    const variants: Array<[string, (foreignKey: Record<string, unknown>) => void]> = [
      ['referential action', (foreignKey) => (foreignKey.onDelete = 'cascade')],
      ['unknown option', (foreignKey) => (foreignKey.futureForeignKeyOption = true)],
    ]

    for (const [label, mutate] of variants) {
      const withUnsupported = structuredClone(snapshot)
      mutate(withUnsupported.tables['public.users'].foreignKeys.users_org_fk)

      const out = parseDrizzleSnapshot(withUnsupported)
      expect(tableNamed(out, 'users').foreignKeys, label).toEqual([])
      expect(
        out.unparsed.some(
          (entry) =>
            entry.location.startsWith('public.users.foreignKeys.users_org_fk') &&
            entry.reason.startsWith('blocked:')
        ),
        label
      ).toBe(true)
    }
  })

  test('unsupported and unknown schema fields are surfaced with blocked reasons', () => {
    const withUnsupported = structuredClone(snapshot)
    withUnsupported.tables['public.users'].checkConstraints = {
      users_email_check: { name: 'users_email_check', value: "email <> ''" },
    }
    withUnsupported.views['public.user_emails'] = {
      name: 'user_emails',
      schema: 'public',
      columns: {},
      definition: 'select email from users',
      materialized: false,
      isExisting: false,
    }
    withUnsupported.futureSchemaObjects = {
      'public.widget': { name: 'widget' },
    }

    const out = parseDrizzleSnapshot(withUnsupported)
    expect(out.unparsed).toEqual(
      expect.arrayContaining([
        {
          location: 'public.users.checkConstraints.users_email_check',
          reason: expect.stringContaining('blocked:'),
        },
        {
          location: 'views.public.user_emails',
          reason: expect.stringContaining('blocked:'),
        },
        {
          location: 'futureSchemaObjects',
          reason: expect.stringContaining('blocked:'),
        },
      ])
    )
    expect(out.unparsed.every((entry) => entry.reason.startsWith('blocked:'))).toBe(true)
  })

  test('isDrizzleSnapshot recognizes the shape', () => {
    expect(isDrizzleSnapshot(snapshot)).toBe(true)
    expect(isDrizzleSnapshot({ version: '6', dialect: 'postgresql', tables: {} })).toBe(true)
    expect(isDrizzleSnapshot({ version: '7', dialect: 'mysql', tables: {} })).toBe(true)
    expect(isDrizzleSnapshot({ tables: {} })).toBe(false)
    expect(isDrizzleSnapshot({ source: 'json', tables: {}, unparsed: [] })).toBe(false)
  })
})
