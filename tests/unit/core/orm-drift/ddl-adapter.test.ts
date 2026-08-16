import { describe, expect, test } from 'bun:test'
import { detectOrmFormat } from '@/core/orm-drift/adapters/detect'
import { parseDdl } from '@/core/orm-drift/adapters/ddl'
import type { NormalizedSchema, NormalizedTable } from '@/core/orm-drift/normalized-schema'

const sql = await Bun.file('tests/fixtures/orm-drift/create-tables.sql').text()

function tableNamed(schema: NormalizedSchema, name: string): NormalizedTable {
  const table = schema.tables.find((candidate) => candidate.identity.table === name)
  expect(table).toBeDefined()
  return table!
}

describe('parseDdl', () => {
  test('builds tables from CREATE TABLE with types, nullability, pk', () => {
    const out = parseDdl(sql, 'postgresql')
    const users = tableNamed(out, 'users')
    const byName = Object.fromEntries(users.columns.map((column) => [column.name, column]))
    expect(byName.id).toMatchObject({ type: 'integer', nullable: false, primaryKey: true })
    expect(byName.email).toMatchObject({ type: 'varchar(255)', nullable: false })
    expect(byName.name!.nullable).toBe(true)
  })

  test('collects CREATE INDEX statements onto their table', () => {
    const users = tableNamed(parseDdl(sql, 'postgresql'), 'users')
    expect(users.indexes).toContainEqual({
      name: 'users_email_idx',
      columns: ['email'],
      unique: true,
    })
    expect(users.indexes).toContainEqual({
      name: 'users_name_idx',
      columns: ['name', 'email'],
      unique: false,
    })
  })

  test('normalizes inline foreign keys', () => {
    expect(tableNamed(parseDdl(sql, 'postgresql'), 'users').foreignKeys).toContainEqual({
      columns: ['org_id'],
      refTable: { table: 'orgs' },
      parsedRefIdentifier: { table: { value: 'orgs', quoted: false } },
      refColumns: ['id'],
    })
  })

  test('unsupported statements land in unparsed', () => {
    const out = parseDdl(sql, 'postgresql')
    expect(out.unparsed.some((entry) => entry.reason.includes('blocked:'))).toBe(true)
  })

  test('unparseable SQL becomes one unparsed entry, not a throw', () => {
    const out = parseDdl('CREATE GIBBERISH', 'postgresql')
    expect(out.tables).toHaveLength(0)
    expect(out.unparsed[0]!.reason).toContain('blocked: parse failed')
  })

  test('preserves a CREATE TABLE after a leading comment', () => {
    const out = parseDdl('-- migration setup\nCREATE TABLE widgets (id INTEGER);', 'postgresql')
    expect(tableNamed(out, 'widgets').columns).toContainEqual({
      name: 'id',
      type: 'integer',
      rawType: 'integer',
      nullable: true,
    })
  })

  test('splits statements without treating semicolons in comments or strings as boundaries', () => {
    const out = parseDdl(
      "-- migration; setup\nCREATE TABLE notes (id INTEGER, body VARCHAR(50) DEFAULT 'keep;this'); CREATE TABLE tags (id INTEGER);",
      'postgresql'
    )
    expect(out.tables.map((table) => table.identity.table)).toEqual(['notes', 'tags'])
    expect(tableNamed(out, 'notes').columns.map((column) => column.name)).toEqual(['id', 'body'])
    expect(tableNamed(out, 'notes').columns.find((column) => column.name === 'body')?.default).toBe(
      "'keep;this'"
    )
  })

  test('continues after an invalid statement', () => {
    const out = parseDdl(
      'CREATE TABLE first_table (id INTEGER); CREATE GIBBERISH; CREATE TABLE last_table (id INTEGER);',
      'postgresql'
    )
    expect(out.tables.map((table) => table.identity.table)).toEqual(['first_table', 'last_table'])
    expect(out.unparsed).toHaveLength(1)
  })

  test.each(['postgresql', 'mysql', 'mariadb'] as const)('uses the %s parser dialect', (system) => {
    const out = parseDdl('CREATE TABLE dialect_test (id INTEGER);', system)
    expect(tableNamed(out, 'dialect_test').columns[0]?.name).toBe('id')
  })

  test('keeps supported columns and blocks unsupported table definitions', () => {
    const out = parseDdl(
      'CREATE TABLE checked_table (id INTEGER, CONSTRAINT positive_id CHECK (id > 0));',
      'postgresql'
    )
    expect(tableNamed(out, 'checked_table').columns.map((column) => column.name)).toEqual(['id'])
    expect(out.unparsed[0]!.reason).toContain('blocked: unsupported table definition')
  })

  test('blocks PostgreSQL partition semantics instead of emitting a regular table', () => {
    const out = parseDdl('CREATE TABLE events (id INTEGER) PARTITION BY RANGE (id);', 'postgresql')

    expect(out.tables).toEqual([])
    expect(out.unparsed).toHaveLength(1)
    expect(out.unparsed[0]).toMatchObject({
      location: 'events',
      reason: expect.stringContaining('blocked: unsupported CREATE TABLE table_options'),
    })
  })

  test.each(['mysql', 'mariadb'] as const)(
    'blocks %s table engine and charset options instead of discarding them',
    (system) => {
      const out = parseDdl(
        'CREATE TABLE events (id INTEGER) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
        system
      )

      expect(out.tables).toEqual([])
      expect(out.unparsed).toHaveLength(1)
      expect(out.unparsed[0]).toMatchObject({
        location: 'events',
        reason: expect.stringContaining('blocked: unsupported CREATE TABLE table_options'),
      })
    }
  )

  test.each(['postgresql', 'mysql', 'mariadb'] as const)(
    'preserves precision and scale for %s numeric types',
    (system) => {
      const out = parseDdl(
        'CREATE TABLE amounts (numeric_value NUMERIC(10,2), decimal_value DECIMAL(12,4));',
        system
      )
      expect(tableNamed(out, 'amounts').columns).toMatchObject([
        { name: 'numeric_value', type: 'numeric(10,2)', rawType: 'numeric(10,2)' },
        { name: 'decimal_value', type: 'decimal(12,4)', rawType: 'decimal(12,4)' },
      ])
      expect(out.unparsed).toHaveLength(0)
    }
  )

  test('preserves PostgreSQL timestamp timezone modifiers', () => {
    const out = parseDdl(
      'CREATE TABLE events (occurred_at TIMESTAMP WITH TIME ZONE);',
      'postgresql'
    )
    expect(tableNamed(out, 'events').columns[0]?.type).toBe('timestamp with time zone')
    expect(out.unparsed).toHaveLength(0)
  })

  test.each(['mysql', 'mariadb'] as const)('preserves %s unsigned type modifiers', (system) => {
    const out = parseDdl('CREATE TABLE counters (value INT UNSIGNED);', system)
    expect(tableNamed(out, 'counters').columns[0]?.type).toBe('int unsigned')
    expect(out.unparsed).toHaveLength(0)
  })

  test.each(['postgresql', 'mysql', 'mariadb'] as const)(
    'maps scalar defaults and column UNIQUE for %s',
    (system) => {
      const out = parseDdl(
        "CREATE TABLE settings (id INTEGER DEFAULT 42 UNIQUE, label VARCHAR(20) DEFAULT 'Hello');",
        system
      )
      expect(tableNamed(out, 'settings').columns).toMatchObject([
        { name: 'id', default: '42' },
        { name: 'label', default: "'Hello'" },
      ])
      expect(tableNamed(out, 'settings').indexes).toContainEqual({
        columns: ['id'],
        unique: true,
      })
      expect(out.unparsed).toHaveLength(0)
    }
  )

  test.each(['postgresql', 'mysql', 'mariadb'] as const)(
    'applies a %s table primary key declared before its column',
    (system) => {
      const out = parseDdl('CREATE TABLE reversed_pk (PRIMARY KEY (id), id INTEGER);', system)
      expect(tableNamed(out, 'reversed_pk').columns[0]).toMatchObject({
        name: 'id',
        nullable: false,
        primaryKey: true,
      })
      expect(out.unparsed).toHaveLength(0)
    }
  )

  test.each(['mysql', 'mariadb'] as const)(
    'blocks %s enum expression types instead of emitting a lossy column',
    (system) => {
      const out = parseDdl("CREATE TABLE choices (id INTEGER, value ENUM('x','y'));", system)
      expect(tableNamed(out, 'choices').columns.map((column) => column.name)).toEqual(['id'])
      expect(out.unparsed.some((entry) => entry.reason.includes('blocked:'))).toBe(true)
    }
  )

  test.each(['mysql', 'mariadb'] as const)(
    'blocks %s generated columns instead of emitting altered semantics',
    (system) => {
      const out = parseDdl(
        'CREATE TABLE generated_values (source INT, derived INT GENERATED ALWAYS AS (source + 1) STORED);',
        system
      )
      expect(tableNamed(out, 'generated_values').columns.map((column) => column.name)).toEqual([
        'source',
      ])
      expect(out.unparsed.some((entry) => entry.reason.includes('generated'))).toBe(true)
    }
  )

  test.each(['postgresql', 'mysql', 'mariadb'] as const)(
    'does not emit a %s partial index as an unconditional index',
    (system) => {
      const out = parseDdl(
        'CREATE TABLE indexed_values (value INTEGER); CREATE INDEX positive_values ON indexed_values (value) WHERE value > 0;',
        system
      )
      expect(tableNamed(out, 'indexed_values').indexes).toHaveLength(0)
      expect(out.unparsed.some((entry) => entry.reason.includes('blocked:'))).toBe(true)
    }
  )

  test('preserves parsed quote state and keeps users and quoted Users distinct', () => {
    const out = parseDdl(
      'CREATE TABLE users (id INTEGER); CREATE TABLE "Users" (id INTEGER);',
      'postgresql'
    )
    expect(out.tables.map((table) => table.identity)).toEqual([
      { table: 'users' },
      { table: 'Users' },
    ])
    expect(out.tables.map((table) => table.parsedIdentifier?.table)).toEqual([
      { value: 'users', quoted: false },
      { value: 'Users', quoted: true },
    ])
  })

  test('resolves unquoted and quoted identifiers independently', () => {
    const out = parseDdl(
      'CREATE TABLE Users (id INTEGER); CREATE TABLE "Users" (id INTEGER);',
      'postgresql'
    )
    expect(out.tables.map((table) => table.identity.table)).toEqual(['users', 'Users'])
  })

  test('preserves quote state for schema-qualified table identities', () => {
    const out = parseDdl(
      'CREATE TABLE Tenant.Users (id INTEGER); CREATE TABLE "Tenant"."Users" (id INTEGER);',
      'postgresql'
    )
    expect(out.tables.map((table) => table.identity)).toEqual([
      { schema: 'tenant', table: 'users' },
      { schema: 'Tenant', table: 'Users' },
    ])
  })

  test('resolves mixed quoted and unquoted schema/table components independently', () => {
    const out = parseDdl(
      'CREATE TABLE Tenant."Users" (id INTEGER); CREATE TABLE "Tenant".Users (id INTEGER);',
      'postgresql'
    )

    expect(out.tables.map((table) => table.identity)).toEqual([
      { schema: 'tenant', table: 'Users' },
      { schema: 'Tenant', table: 'users' },
    ])
    expect(out.tables.map((table) => table.parsedIdentifier)).toEqual([
      {
        schema: { value: 'Tenant', quoted: false },
        table: { value: 'Users', quoted: true },
      },
      {
        schema: { value: 'Tenant', quoted: true },
        table: { value: 'Users', quoted: false },
      },
    ])
  })

  test('preserves quote state for schema-qualified foreign-key targets', () => {
    const out = parseDdl(
      'CREATE TABLE child (parent_id INTEGER REFERENCES "Tenant"."Users"(id));',
      'postgresql'
    )
    const foreignKey = tableNamed(out, 'child').foreignKeys[0]

    expect(foreignKey?.refTable).toEqual({ schema: 'Tenant', table: 'Users' })
    expect(foreignKey?.parsedRefIdentifier).toEqual({
      schema: { value: 'Tenant', quoted: true },
      table: { value: 'Users', quoted: true },
    })
  })

  test('preserves exact targets after IF NOT EXISTS', () => {
    const out = parseDdl('CREATE TABLE IF NOT EXISTS "Users" (id INTEGER);', 'postgresql')

    expect(out.tables[0]?.identity).toEqual({ table: 'Users' })
    expect(out.tables[0]?.parsedIdentifier).toEqual({
      table: { value: 'Users', quoted: true },
    })
  })

  test('preserves exact targets when comments separate target tokens', () => {
    const out = parseDdl(
      'CREATE /* create */ TABLE /* target */ Tenant /* schema */ . /* table */ "Users" (id INTEGER);',
      'postgresql'
    )

    expect(out.tables[0]?.identity).toEqual({ schema: 'tenant', table: 'Users' })
    expect(out.tables[0]?.parsedIdentifier).toEqual({
      schema: { value: 'Tenant', quoted: false },
      table: { value: 'Users', quoted: true },
    })
  })

  test('attaches CREATE INDEX only to the exact quoted target', () => {
    const out = parseDdl(
      'CREATE TABLE users (id INTEGER); CREATE TABLE "Users" (id INTEGER); CREATE INDEX exact_idx ON "Users" (id);',
      'postgresql'
    )

    expect(tableNamed(out, 'users').indexes).toEqual([])
    expect(tableNamed(out, 'Users').indexes).toContainEqual({
      name: 'exact_idx',
      columns: ['id'],
      unique: false,
    })
  })
})

describe('detectOrmFormat', () => {
  test('detects by extension and content', () => {
    expect(detectOrmFormat('prisma/schema.prisma', '')).toBe('prisma')
    expect(detectOrmFormat('x.txt', 'model User {\n id Int\n}')).toBe('prisma')
    expect(detectOrmFormat('schema.json', '{"source":"json","tables":{},"unparsed":[]}')).toBe(
      'json'
    )
    expect(detectOrmFormat('migrations/001.sql', 'CREATE TABLE t (id int);')).toBe('ddl')
  })

  test('prioritizes Prisma extension and content before JSON detection', () => {
    expect(detectOrmFormat('schema.prisma', '{"tables":{}}')).toBe('prisma')
    expect(detectOrmFormat('schema.json', 'model User {\n id Int\n}')).toBe('prisma')
  })

  test('detects JSON with tables by content without relying on an extension', () => {
    expect(detectOrmFormat('schema.txt', '{"tables":{}}')).toBe('json')
    expect(detectOrmFormat('schema.txt', '[]')).toBe('ddl')
  })

  test('detects drizzle snapshots', () => {
    const snapshot = '{"version":"7","dialect":"postgresql","tables":{}}'
    expect(detectOrmFormat('drizzle/meta/0001_snapshot.json', snapshot)).toBe('drizzle')
  })

  test('routes unsupported drizzle snapshot shapes to the fail-closed drizzle parser', () => {
    expect(
      detectOrmFormat(
        'drizzle/meta/0001_snapshot.json',
        '{"version":"6","dialect":"postgresql","tables":{}}'
      )
    ).toBe('drizzle')
    expect(
      detectOrmFormat(
        'drizzle/meta/0001_snapshot.json',
        '{"version":"7","dialect":"mysql","tables":{}}'
      )
    ).toBe('drizzle')
    expect(
      detectOrmFormat('schema.normalized.json', '{"source":"json","tables":[],"unparsed":[]}')
    ).toBe('json')
  })
})
