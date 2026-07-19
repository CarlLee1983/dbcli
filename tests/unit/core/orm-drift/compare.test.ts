import { describe, expect, test } from 'bun:test'
import { compareNormalized, type DriftEntry } from '@/core/orm-drift/compare'
import { addColumnProposal, proposalsFor, REVIEW_NOTE } from '@/core/orm-drift/proposals'
import type {
  NormalizedColumn,
  NormalizedSchema,
  NormalizedTable,
  NormalizedTableIdentity,
} from '@/core/orm-drift/normalized-schema'

function table(
  identity: NormalizedTableIdentity,
  overrides: Partial<Omit<NormalizedTable, 'identity'>> = {}
): NormalizedTable {
  return {
    identity,
    columns: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  }
}

function schemaWith(tables: NormalizedTable[], defaultSchema?: string): NormalizedSchema {
  return {
    source: 'prisma',
    ...(defaultSchema !== undefined && { defaultSchema }),
    tables,
    unparsed: [],
  }
}

function dbWith(tables: NormalizedTable[], defaultSchema?: string): NormalizedSchema {
  return {
    source: 'db',
    ...(defaultSchema !== undefined && { defaultSchema }),
    tables,
    unparsed: [],
  }
}

function driftEntry(
  overrides: Partial<Omit<DriftEntry, 'proposedCommands'>> = {}
): Omit<DriftEntry, 'proposedCommands'> {
  return {
    category: 'missing_in_db',
    severity: 'error',
    table: 'users',
    object: 'index(email)',
    detail: 'index is absent',
    ...overrides,
  }
}

const users: NormalizedTable = {
  identity: { table: 'users' },
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'email', type: 'text', nullable: false },
    { name: 'age', type: 'integer', nullable: true },
  ],
  indexes: [{ columns: ['email'], unique: true }],
  foreignKeys: [],
}

describe('compareNormalized', () => {
  test('case-distinct DB tables coexist and match exact ORM identities', () => {
    const db = dbWith(
      [
        table(
          { schema: 'public', table: 'users' },
          { columns: [{ name: 'lowercase_only', type: 'text', nullable: false }] }
        ),
        table(
          { schema: 'public', table: 'Users' },
          { columns: [{ name: 'quoted_only', type: 'integer', nullable: false }] }
        ),
      ],
      'public'
    )
    const orm = schemaWith([
      table(
        { table: 'Users' },
        { columns: [{ name: 'quoted_only', type: 'integer', nullable: false }] }
      ),
      table(
        { table: 'users' },
        { columns: [{ name: 'lowercase_only', type: 'text', nullable: false }] }
      ),
    ])

    expect(compareNormalized(orm, db, { ignore: [] }).entries).toEqual([])
  })

  test('case-sensitive ignore does not hide a distinct table', () => {
    const report = compareNormalized(
      schemaWith([]),
      dbWith(
        [table({ schema: 'public', table: 'users' }), table({ schema: 'public', table: 'Users' })],
        'public'
      ),
      { ignore: ['public.Users'] }
    )

    expect(report.entries.find((entry) => entry.table === 'public.Users')?.category).toBe(
      'unmanaged'
    )
    expect(report.entries.find((entry) => entry.table === 'public.users')?.category).toBe(
      'missing_in_orm'
    )
  })

  test('column missing in DB is an error with an exact dry-run add-column proposal', () => {
    const ormColumn: NormalizedColumn = {
      name: 'age',
      type: 'integer',
      nullable: true,
      default: '18',
    }
    const orm = schemaWith([{ ...users, columns: [...users.columns.slice(0, 2), ormColumn] }])
    const db = dbWith([{ ...users, columns: users.columns.slice(0, 2) }])

    const entry = compareNormalized(orm, db, { ignore: [] }).entries.find(
      (candidate) => candidate.object === 'age'
    )

    expect(entry).toMatchObject({ category: 'missing_in_db', severity: 'error' })
    expect(entry?.proposedCommands).toEqual([
      '# dry-run by default; review via migration-review before --execute',
      'dbcli migrate add-column users age integer --nullable --default 18',
    ])
  })

  test('index missing in DB is an error with an exact dry-run add-index proposal', () => {
    const db = dbWith([{ ...users, indexes: [] }])

    const entry = compareNormalized(schemaWith([users]), db, { ignore: [] }).entries.find(
      (candidate) => candidate.object === 'index(email)'
    )

    expect(entry).toMatchObject({ category: 'missing_in_db', severity: 'error' })
    expect(entry?.proposedCommands).toEqual([
      '# dry-run by default; review via migration-review before --execute',
      'dbcli migrate add-index users --columns email --unique',
    ])
  })

  test('duplicate index signatures emit one drift entry', () => {
    const ormTable = table(
      { table: 'users' },
      {
        indexes: [
          { columns: ['email'], unique: true },
          { name: 'duplicate_name', columns: ['email'], unique: true },
        ],
      }
    )
    const report = compareNormalized(schemaWith([ormTable]), dbWith([table({ table: 'users' })]), {
      ignore: [],
    })

    expect(report.entries.filter((entry) => entry.object === 'index(email)')).toHaveLength(1)
  })

  test('entry ordering is stable across input insertion order', () => {
    const forward = compareNormalized(
      schemaWith([table({ table: 'z' }), table({ table: 'a' })]),
      dbWith([]),
      { ignore: [] }
    )
    const reverse = compareNormalized(
      schemaWith([table({ table: 'a' }), table({ table: 'z' })]),
      dbWith([]),
      { ignore: [] }
    )

    expect(forward.entries).toEqual(reverse.entries)
    expect(forward.entries.map((entry) => entry.table)).toEqual(['a', 'z'])
  })

  test('index names are ignored while column order and uniqueness remain meaningful', () => {
    const ordered = {
      ...users,
      indexes: [{ name: 'orm_name', columns: ['email', 'age'], unique: true }],
    }
    const renamed = {
      ...users,
      indexes: [{ name: 'db_name', columns: ['email', 'age'], unique: true }],
    }
    const reordered = {
      ...users,
      indexes: [{ name: 'db_name', columns: ['age', 'email'], unique: true }],
    }

    const renamedReport = compareNormalized(schemaWith([ordered]), dbWith([renamed]), {
      ignore: [],
    })
    const reorderedReport = compareNormalized(schemaWith([ordered]), dbWith([reordered]), {
      ignore: [],
    })

    expect(renamedReport.entries.filter((entry) => entry.object.startsWith('index'))).toHaveLength(
      0
    )
    expect(
      reorderedReport.entries.filter((entry) => entry.object.startsWith('index'))
    ).toHaveLength(2)
  })

  test('DB-only columns and indexes are warnings with escalation proposals', () => {
    const db = dbWith([
      {
        ...users,
        columns: [...users.columns, { name: 'legacy_flag', type: 'boolean', nullable: true }],
        indexes: [...users.indexes, { columns: ['legacy_flag'], unique: false }],
      },
    ])

    const entries = compareNormalized(schemaWith([users]), db, { ignore: [] }).entries.filter(
      (entry) => entry.category === 'missing_in_orm'
    )

    expect(entries.map((entry) => entry.object)).toEqual(['index(legacy_flag)', 'legacy_flag'])
    for (const entry of entries) {
      expect(entry.severity).toBe('warn')
      expect(entry.proposedCommands[0]).toMatch(
        /^# escalate: .+ — run: dbcli skill tasks plan migration-review$/
      )
    }
  })

  test('missing tables use the documented severities and escalation proposals', () => {
    const ormOnly: NormalizedTable = {
      identity: { table: 'orm_only' },
      columns: [],
      indexes: [],
      foreignKeys: [],
    }
    const dbOnly: NormalizedTable = {
      identity: { table: 'db_only' },
      columns: [],
      indexes: [],
      foreignKeys: [],
    }

    const report = compareNormalized(schemaWith([ormOnly]), dbWith([dbOnly]), {
      ignore: [],
    })

    expect(report.entries).toHaveLength(2)
    expect(report.entries.find((entry) => entry.table === 'orm_only')).toMatchObject({
      category: 'missing_in_db',
      severity: 'error',
      object: 'table',
    })
    expect(report.entries.find((entry) => entry.table === 'db_only')).toMatchObject({
      category: 'missing_in_orm',
      severity: 'warn',
      object: 'table',
    })
    expect(
      report.entries.every((entry) => entry.proposedCommands[0]?.startsWith('# escalate:'))
    ).toBe(true)
  })

  test('type-family and nullable mismatches are errors with escalation proposals', () => {
    const db = dbWith([
      {
        ...users,
        columns: [
          users.columns[0]!,
          { name: 'email', type: 'text', nullable: true },
          { name: 'age', type: 'text', nullable: true },
        ],
      },
    ])

    const report = compareNormalized(schemaWith([users]), db, { ignore: [] })

    for (const object of ['email', 'age']) {
      const entry = report.entries.find((candidate) => candidate.object === object)
      expect(entry).toMatchObject({ category: 'mismatch', severity: 'error' })
      expect(entry?.proposedCommands[0]).toStartWith('# escalate:')
    }
  })

  test('same-family spelling, default, and primary-key differences are info escalations', () => {
    const orm = schemaWith([
      {
        ...users,
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: true },
          { name: 'email', type: 'text', nullable: false, default: "'unset'" },
          { name: 'age', type: 'integer', nullable: true },
        ],
      },
    ])
    const db = dbWith([
      {
        ...users,
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: false },
          { name: 'email', type: 'varchar(191)', nullable: false, default: "'active'" },
          { name: 'age', type: 'integer', nullable: true },
        ],
      },
    ])

    const report = compareNormalized(orm, db, { ignore: [] })
    const idEntry = report.entries.find((entry) => entry.object === 'id')
    const emailEntry = report.entries.find((entry) => entry.object === 'email')

    expect(idEntry).toMatchObject({ category: 'mismatch', severity: 'info' })
    expect(idEntry?.detail).toContain('primary key')
    expect(emailEntry).toMatchObject({ category: 'mismatch', severity: 'info' })
    expect(emailEntry?.detail).toContain('type spelling')
    expect(emailEntry?.detail).toContain('default')
    expect(idEntry?.proposedCommands[0]).toStartWith('# escalate:')
    expect(emailEntry?.proposedCommands[0]).toStartWith('# escalate:')
  })

  test('built-in and regex-safe user ignore globs create one uncounted unmanaged entry per table', () => {
    const db = dbWith([
      users,
      {
        identity: { table: '_prisma_migrations' },
        columns: [],
        indexes: [],
        foreignKeys: [],
      },
      {
        identity: { table: 'audit.+[2026]' },
        columns: [],
        indexes: [],
        foreignKeys: [],
      },
      {
        identity: { table: 'audit_other' },
        columns: [],
        indexes: [],
        foreignKeys: [],
      },
    ])

    const report = compareNormalized(schemaWith([users]), db, {
      ignore: ['audit.+[202*]'],
    })
    const unmanaged = report.entries.filter((entry) => entry.category === 'unmanaged')

    expect(unmanaged.map((entry) => entry.table).sort()).toEqual([
      '_prisma_migrations',
      'audit.+[2026]',
    ])
    expect(unmanaged.every((entry) => entry.severity === 'info')).toBe(true)
    expect(report.entries.find((entry) => entry.table === 'audit_other')?.category).toBe(
      'missing_in_orm'
    )
    expect(report.summary).toEqual({ errors: 0, warns: 1, infos: 0, unmanaged: 2 })
  })

  test('summary counts scored severities separately from unmanaged entries', () => {
    const orm = schemaWith([
      {
        ...users,
        columns: [
          ...users.columns,
          { name: 'new_col', type: 'text', nullable: false },
          { name: 'display', type: 'text', nullable: true },
        ],
      },
    ])
    const db = dbWith([
      {
        ...users,
        columns: [
          ...users.columns,
          { name: 'legacy', type: 'text', nullable: true },
          { name: 'display', type: 'varchar(20)', nullable: true },
        ],
      },
      {
        identity: { table: '_prisma_migrations' },
        columns: [],
        indexes: [],
        foreignKeys: [],
      },
    ])

    const report = compareNormalized(orm, db, { ignore: [] })

    expect(report.summary).toEqual({ errors: 1, warns: 1, infos: 1, unmanaged: 1 })
  })

  test('unparsed entries from the ORM and database are merged in source order', () => {
    const orm = schemaWith([users])
    orm.unparsed.push({ location: 'schema.prisma:3', reason: 'unsupported attribute' })
    const db = dbWith([users])
    db.unparsed.push({ location: 'users.generated', reason: 'unsupported expression' })

    expect(compareNormalized(orm, db, { ignore: [] }).unparsed).toEqual([
      { location: 'schema.prisma:3', reason: 'unsupported attribute' },
      { location: 'users.generated', reason: 'unsupported expression' },
    ])
  })
})

describe('proposalsFor', () => {
  const baseEntry: Omit<DriftEntry, 'proposedCommands'> = {
    category: 'mismatch',
    severity: 'info',
    table: 'users',
    object: 'email',
    detail: 'type spelling differs\nreview this safely',
  }

  test('provides the public escalation default and keeps the reason on one line', () => {
    expect(proposalsFor(baseEntry)).toEqual([
      '# escalate: type spelling differs review this safely — run: dbcli skill tasks plan migration-review',
    ])
  })

  test('builds missing-column and missing-index commands through the public interface', () => {
    const column: NormalizedColumn = {
      name: 'nickname',
      type: 'text',
      nullable: false,
    }
    const missingColumn = {
      ...baseEntry,
      category: 'missing_in_db' as const,
      severity: 'error' as const,
      object: 'nickname',
    }
    const missingIndex = {
      ...missingColumn,
      object: 'index(email,age)',
      detail: 'unique index on (email, age) is absent',
    }

    expect(proposalsFor(missingColumn, { kind: 'column', column })).toEqual([
      '# dry-run by default; review via migration-review before --execute',
      'dbcli migrate add-column users nickname text',
    ])
    expect(
      proposalsFor(missingIndex, {
        kind: 'index',
        index: { columns: ['email', 'age'], unique: true },
      })
    ).toEqual([
      '# dry-run by default; review via migration-review before --execute',
      'dbcli migrate add-index users --columns email,age --unique',
    ])
  })

  test('index proposals use structural data, not display text', () => {
    const entry = driftEntry({
      object: 'index(unique index,email)',
      detail: 'display prose says unique index but structure is authoritative',
    })

    expect(
      proposalsFor(entry, {
        kind: 'index',
        index: { columns: ['unique index', 'email,backup'], unique: false },
      })
    ).toEqual([REVIEW_NOTE, `dbcli migrate add-index users --columns 'unique index,email,backup'`])
  })

  test('does not parse an index proposal from display strings without a structural subject', () => {
    const entry = driftEntry({
      object: 'index(email,age)',
      detail: 'unique index on (email, age) is absent',
    })

    expect(proposalsFor(entry)).toEqual([
      '# escalate: unique index on (email, age) is absent — run: dbcli skill tasks plan migration-review',
    ])
  })

  test('proposal arguments are shell-safe while simple tokens remain unchanged', () => {
    expect(
      addColumnProposal('users', {
        name: 'display name',
        type: 'varchar(191)',
        nullable: false,
        default: `x'; $(touch /tmp/pwned)`,
      })[1]
    ).toBe(
      `dbcli migrate add-column users 'display name' 'varchar(191)' --default 'x'"'"'; $(touch /tmp/pwned)'`
    )
    expect(
      addColumnProposal('users', {
        name: 'age',
        type: 'integer',
        nullable: true,
      })[1]
    ).toBe('dbcli migrate add-column users age integer --nullable')
  })

  test('returns no commands for unmanaged entries', () => {
    expect(
      proposalsFor({
        ...baseEntry,
        category: 'unmanaged',
        object: 'table',
      })
    ).toEqual([])
  })

  test('a missing table always escalates even when column context is supplied', () => {
    expect(
      proposalsFor(
        {
          ...baseEntry,
          category: 'missing_in_db',
          severity: 'error',
          object: 'table',
          detail: "table 'users' is absent",
        },
        {
          kind: 'column',
          column: { name: 'id', type: 'integer', nullable: false },
        }
      )
    ).toEqual([
      "# escalate: table 'users' is absent — run: dbcli skill tasks plan migration-review",
    ])
  })
})
