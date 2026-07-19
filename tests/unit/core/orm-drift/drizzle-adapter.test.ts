import { describe, test, expect } from 'bun:test'
import { parseDrizzleSnapshot, isDrizzleSnapshot } from '@/core/orm-drift/adapters/drizzle'
import type { NormalizedSchema, NormalizedTable } from '@/core/orm-drift/normalized-schema'

const snapshot = JSON.parse(await Bun.file('tests/fixtures/orm-drift/drizzle-snapshot.json').text())

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
    expect(isDrizzleSnapshot({ tables: {} })).toBe(false)
    expect(isDrizzleSnapshot({ source: 'json', tables: {}, unparsed: [] })).toBe(false)
  })
})
