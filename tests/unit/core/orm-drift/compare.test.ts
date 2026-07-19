import { describe, expect, test } from 'bun:test'
import { compareNormalized, type DriftEntry } from '@/core/orm-drift/compare'
import { proposalsFor } from '@/core/orm-drift/proposals'
import type {
  NormalizedColumn,
  NormalizedSchema,
  NormalizedTable,
} from '@/core/orm-drift/normalized-schema'

function schemaWith(tables: NormalizedSchema['tables']): NormalizedSchema {
  return { source: 'prisma', tables, unparsed: [] }
}

const dbWith = (tables: NormalizedSchema['tables']): NormalizedSchema => ({
  source: 'db',
  tables,
  unparsed: [],
})

const users: NormalizedTable = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'email', type: 'text', nullable: false },
    { name: 'age', type: 'integer', nullable: true },
  ],
  indexes: [{ columns: ['email'], unique: true }],
  foreignKeys: [],
}

describe('compareNormalized', () => {
  test('column missing in DB is an error with an exact dry-run add-column proposal', () => {
    const ormColumn: NormalizedColumn = {
      name: 'age',
      type: 'integer',
      nullable: true,
      default: '18',
    }
    const orm = schemaWith({
      users: { ...users, columns: [...users.columns.slice(0, 2), ormColumn] },
    })
    const db = dbWith({
      users: { ...users, columns: users.columns.slice(0, 2) },
    })

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
    const db = dbWith({ users: { ...users, indexes: [] } })

    const entry = compareNormalized(schemaWith({ users }), db, { ignore: [] }).entries.find(
      (candidate) => candidate.object === 'index(email)'
    )

    expect(entry).toMatchObject({ category: 'missing_in_db', severity: 'error' })
    expect(entry?.proposedCommands).toEqual([
      '# dry-run by default; review via migration-review before --execute',
      'dbcli migrate add-index users --columns email --unique',
    ])
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

    const renamedReport = compareNormalized(
      schemaWith({ users: ordered }),
      dbWith({ users: renamed }),
      {
        ignore: [],
      }
    )
    const reorderedReport = compareNormalized(
      schemaWith({ users: ordered }),
      dbWith({ users: reordered }),
      { ignore: [] }
    )

    expect(renamedReport.entries.filter((entry) => entry.object.startsWith('index'))).toHaveLength(
      0
    )
    expect(
      reorderedReport.entries.filter((entry) => entry.object.startsWith('index'))
    ).toHaveLength(2)
  })

  test('DB-only columns and indexes are warnings with escalation proposals', () => {
    const db = dbWith({
      users: {
        ...users,
        columns: [...users.columns, { name: 'legacy_flag', type: 'boolean', nullable: true }],
        indexes: [...users.indexes, { columns: ['legacy_flag'], unique: false }],
      },
    })

    const entries = compareNormalized(schemaWith({ users }), db, { ignore: [] }).entries.filter(
      (entry) => entry.category === 'missing_in_orm'
    )

    expect(entries.map((entry) => entry.object)).toEqual(['legacy_flag', 'index(legacy_flag)'])
    for (const entry of entries) {
      expect(entry.severity).toBe('warn')
      expect(entry.proposedCommands[0]).toMatch(
        /^# escalate: .+ — run: dbcli skill tasks plan migration-review$/
      )
    }
  })

  test('missing tables use the documented severities and escalation proposals', () => {
    const ormOnly: NormalizedTable = {
      name: 'orm_only',
      columns: [],
      indexes: [],
      foreignKeys: [],
    }
    const dbOnly: NormalizedTable = {
      name: 'db_only',
      columns: [],
      indexes: [],
      foreignKeys: [],
    }

    const report = compareNormalized(
      schemaWith({ orm_only: ormOnly }),
      dbWith({ db_only: dbOnly }),
      {
        ignore: [],
      }
    )

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
    const db = dbWith({
      users: {
        ...users,
        columns: [
          users.columns[0]!,
          { name: 'email', type: 'text', nullable: true },
          { name: 'age', type: 'text', nullable: true },
        ],
      },
    })

    const report = compareNormalized(schemaWith({ users }), db, { ignore: [] })

    for (const object of ['email', 'age']) {
      const entry = report.entries.find((candidate) => candidate.object === object)
      expect(entry).toMatchObject({ category: 'mismatch', severity: 'error' })
      expect(entry?.proposedCommands[0]).toStartWith('# escalate:')
    }
  })

  test('same-family spelling, default, and primary-key differences are info escalations', () => {
    const orm = schemaWith({
      users: {
        ...users,
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: true },
          { name: 'email', type: 'text', nullable: false, default: "'unset'" },
          { name: 'age', type: 'integer', nullable: true },
        ],
      },
    })
    const db = dbWith({
      users: {
        ...users,
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: false },
          { name: 'email', type: 'varchar(191)', nullable: false, default: "'active'" },
          { name: 'age', type: 'integer', nullable: true },
        ],
      },
    })

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
    const db = dbWith({
      users,
      _prisma_migrations: {
        name: '_prisma_migrations',
        columns: [],
        indexes: [],
        foreignKeys: [],
      },
      'audit.+[2026]': {
        name: 'audit.+[2026]',
        columns: [],
        indexes: [],
        foreignKeys: [],
      },
      audit_other: {
        name: 'audit_other',
        columns: [],
        indexes: [],
        foreignKeys: [],
      },
    })

    const report = compareNormalized(schemaWith({ users }), db, {
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
    const orm = schemaWith({
      users: {
        ...users,
        columns: [
          ...users.columns,
          { name: 'new_col', type: 'text', nullable: false },
          { name: 'display', type: 'text', nullable: true },
        ],
      },
    })
    const db = dbWith({
      users: {
        ...users,
        columns: [
          ...users.columns,
          { name: 'legacy', type: 'text', nullable: true },
          { name: 'display', type: 'varchar(20)', nullable: true },
        ],
      },
      _prisma_migrations: {
        name: '_prisma_migrations',
        columns: [],
        indexes: [],
        foreignKeys: [],
      },
    })

    const report = compareNormalized(orm, db, { ignore: [] })

    expect(report.summary).toEqual({ errors: 1, warns: 1, infos: 1, unmanaged: 1 })
  })

  test('unparsed entries from the ORM and database are merged in source order', () => {
    const orm = schemaWith({ users })
    orm.unparsed.push({ location: 'schema.prisma:3', reason: 'unsupported attribute' })
    const db = dbWith({ users })
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

    expect(proposalsFor(missingColumn, column)).toEqual([
      '# dry-run by default; review via migration-review before --execute',
      'dbcli migrate add-column users nickname text',
    ])
    expect(proposalsFor(missingIndex)).toEqual([
      '# dry-run by default; review via migration-review before --execute',
      'dbcli migrate add-index users --columns email,age --unique',
    ])
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
        { name: 'id', type: 'integer', nullable: false }
      )
    ).toEqual([
      "# escalate: table 'users' is absent — run: dbcli skill tasks plan migration-review",
    ])
  })
})
