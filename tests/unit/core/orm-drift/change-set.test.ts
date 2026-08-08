import { describe, expect, test } from 'bun:test'
import {
  normalizeProposedChanges,
  type NormalizedChangeSetInput,
} from '@/core/orm-drift/change-set'
import type { NormalizedSchema, NormalizedTable } from '@/core/orm-drift/normalized-schema'

function table(name: string, overrides: Partial<Omit<NormalizedTable, 'identity'>> = {}): NormalizedTable {
  return {
    identity: { table: name },
    columns: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  }
}

function schema(source: NormalizedSchema['source'], tables: NormalizedTable[]): NormalizedSchema {
  return { source, defaultSchema: 'public', tables, unparsed: [] }
}

function input(
  declared: NormalizedSchema,
  baseline: NormalizedSchema,
  overrides: Partial<Omit<NormalizedChangeSetInput, 'declared' | 'baseline'>> = {}
): NormalizedChangeSetInput {
  return {
    declared,
    baseline,
    scope: { key: 'production:primary', system: 'postgresql', connection: 'primary' },
    origins: { declared: 'dbcli.design.json', baseline: '.dbcli/schema.json' },
    ...overrides,
  }
}

describe('normalizeProposedChanges', () => {
  test('labels a declared-only table as a proposed addition with its declared origin', () => {
    const changeSet = normalizeProposedChanges(
      input(
        schema('design', [
          table('accounts', {
            columns: [{ name: 'email', type: 'text', nullable: false }],
          }),
        ]),
        schema('db', [])
      )
    )

    expect(changeSet.changes).toMatchObject([
      {
        operation: 'add',
        objectKind: 'table',
        subject: { scopeKey: 'production:primary', schema: 'public', table: 'accounts' },
        source: { declared: 'dbcli.design.json#public.accounts' },
      },
    ])
    expect(changeSet.coverage).toEqual({ level: 'declared', gaps: [] })
  })

  test('labels a declared-only column in a matched table as a proposed addition', () => {
    const changeSet = normalizeProposedChanges(
      input(
        schema('design', [
          table('accounts', {
            columns: [{ name: 'email', type: 'text', nullable: false }],
          }),
        ]),
        schema('db', [table('accounts')])
      )
    )

    expect(changeSet.changes).toMatchObject([
      {
        operation: 'add',
        objectKind: 'column',
        subject: { schema: 'public', table: 'accounts', column: 'email' },
      },
    ])
  })

  test('treats an omitted declared schema as the baseline default schema', () => {
    const changeSet = normalizeProposedChanges(
      input(
        schema('design', [table('accounts')]),
        schema('db', [{ ...table('accounts'), identity: { schema: 'public', table: 'accounts' } }])
      )
    )

    expect(changeSet.changes).toEqual([])
  })

  test('treats an omitted foreign-key reference schema as the baseline default schema', () => {
    const declared = schema('design', [
      table('accounts', {
        foreignKeys: [
          {
            columns: ['owner_id'],
            refTable: { table: 'owners' },
            refColumns: ['id'],
          },
        ],
      }),
    ])
    const baseline = schema('db', [
      table('accounts', {
        foreignKeys: [
          {
            columns: ['owner_id'],
            refTable: { schema: 'public', table: 'owners' },
            refColumns: ['id'],
          },
        ],
      }),
    ])

    expect(normalizeProposedChanges(input(declared, baseline)).changes).toEqual([])
  })

  test('reversing declared and baseline labels the object as a removal', () => {
    const changeSet = normalizeProposedChanges(
      input(schema('design', []), schema('db', [table('accounts')]))
    )

    expect(changeSet.changes).toMatchObject([
      {
        operation: 'remove',
        objectKind: 'table',
        subject: { schema: 'public', table: 'accounts' },
      },
    ])
  })

  test('emits a directional column modification with before and after values', () => {
    const changeSet = normalizeProposedChanges(
      input(
        schema('design', [
          table('accounts', {
            columns: [{ name: 'email', type: 'text', nullable: false }],
          }),
        ]),
        schema('db', [
          table('accounts', {
            columns: [{ name: 'email', type: 'varchar', nullable: true, default: "'unknown'" }],
          }),
        ])
      )
    )

    expect(changeSet.changes).toMatchObject([
      {
        operation: 'modify',
        objectKind: 'column',
        changedFields: ['type', 'nullable', 'default'],
        before: { name: 'email', type: 'varchar', nullable: true, default: "'unknown'" },
        after: { name: 'email', type: 'text', nullable: false },
      },
    ])
  })

  test('uses every declared scope component in the identity so changes cannot collapse', () => {
    const declared = schema('design', [table('accounts')])
    const baseline = schema('db', [])

    const primary = normalizeProposedChanges(
      input(declared, baseline, {
        scope: { key: 'production', system: 'postgresql', connection: 'primary', catalog: 'app' },
      })
    )
    const replica = normalizeProposedChanges(
      input(declared, baseline, {
        scope: { key: 'production', system: 'postgresql', connection: 'replica', catalog: 'app' },
      })
    )
    const archiveCatalog = normalizeProposedChanges(
      input(declared, baseline, {
        scope: { key: 'production', system: 'postgresql', connection: 'primary', catalog: 'archive' },
      })
    )

    expect(primary.changes[0]?.id).not.toBe(replica.changes[0]?.id)
    expect(primary.changes[0]?.id).not.toBe(archiveCatalog.changes[0]?.id)
    expect(primary.changes[0]?.subject.scopeKey).toBe('production')
    expect(replica.changes[0]?.subject.scopeKey).toBe('production')
  })

  test('keeps schema-qualified table identities separate', () => {
    const baseline = schema('db', [])
    const publicTable = normalizeProposedChanges(
      input(schema('design', [{ ...table('accounts'), identity: { schema: 'public', table: 'accounts' } }]), baseline)
    )
    const auditTable = normalizeProposedChanges(
      input(schema('design', [{ ...table('accounts'), identity: { schema: 'audit', table: 'accounts' } }]), baseline)
    )

    expect(publicTable.changes[0]?.id).not.toBe(auditTable.changes[0]?.id)
  })

  test('rejects identities that collide after the baseline default schema is applied', () => {
    const declared = schema('design', [
      table('accounts'),
      { ...table('accounts'), identity: { schema: 'public', table: 'accounts' } },
    ])

    expect(() => normalizeProposedChanges(input(declared, schema('db', [])))).toThrow(
      "duplicate resolved table identity 'public.accounts' in declared schema"
    )
  })

  test('orders equivalent shuffled inputs deterministically', () => {
    const declared = schema('design', [
      table('zebra', { columns: [{ name: 'z', type: 'integer', nullable: false }] }),
      table('accounts', { columns: [{ name: 'a', type: 'text', nullable: false }] }),
    ])
    const shuffled = schema('design', [...declared.tables].reverse())
    const baseline = schema('db', [])

    expect(normalizeProposedChanges(input(declared, baseline))).toEqual(
      normalizeProposedChanges(input(shuffled, baseline))
    )
  })

  test('records unparsed, ignored, and index-name loss as explicit coverage gaps', () => {
    const declared = schema('design', [
      table('accounts', { indexes: [{ name: 'accounts_email', columns: ['email'], unique: true }] }),
      table('ignored_table'),
    ])
    declared.unparsed.push({ location: '$.models[0].policies', reason: 'blocked: policies' })
    const baseline = schema('db', [
      table('accounts', { indexes: [{ name: 'different_name', columns: ['email'], unique: true }] }),
      table('ignored_table'),
    ])

    const changeSet = normalizeProposedChanges(input(declared, baseline, { ignore: ['public.ignored_table'] }))

    expect(changeSet.changes).toEqual([])
    expect(changeSet.coverage.level).toBe('partial')
    expect(changeSet.coverage.gaps).toContainEqual(
      expect.objectContaining({
        kind: 'unsupported',
        side: 'declared',
        location: '$.models[0].policies',
      })
    )
    expect(changeSet.coverage.gaps).toContainEqual(
      expect.objectContaining({
        kind: 'unmanaged',
        side: 'comparison',
        subject: expect.objectContaining({ table: 'ignored_table' }),
      })
    )
    expect(changeSet.coverage.gaps).toContainEqual(
      expect.objectContaining({ kind: 'lossy', side: 'comparison', location: 'dbcli.design.json' })
    )
  })
})
