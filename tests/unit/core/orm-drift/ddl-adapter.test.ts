import { describe, expect, test } from 'bun:test'
import { detectOrmFormat } from '@/core/orm-drift/adapters/detect'
import { parseDdl } from '@/core/orm-drift/adapters/ddl'

const sql = await Bun.file('tests/fixtures/orm-drift/create-tables.sql').text()

describe('parseDdl', () => {
  test('builds tables from CREATE TABLE with types, nullability, pk', () => {
    const out = parseDdl(sql, 'postgresql')
    const users = out.tables.users
    const byName = Object.fromEntries(users.columns.map((column) => [column.name, column]))
    expect(byName.id).toMatchObject({ type: 'integer', nullable: false, primaryKey: true })
    expect(byName.email).toMatchObject({ type: 'varchar(255)', nullable: false })
    expect(byName.name.nullable).toBe(true)
  })

  test('collects CREATE INDEX statements onto their table', () => {
    const users = parseDdl(sql, 'postgresql').tables.users
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
    expect(parseDdl(sql, 'postgresql').tables.users.foreignKeys).toContainEqual({
      columns: ['org_id'],
      refTable: 'orgs',
      refColumns: ['id'],
    })
  })

  test('unsupported statements land in unparsed', () => {
    const out = parseDdl(sql, 'postgresql')
    expect(out.unparsed.some((entry) => entry.reason.includes('blocked:'))).toBe(true)
  })

  test('unparseable SQL becomes one unparsed entry, not a throw', () => {
    const out = parseDdl('CREATE GIBBERISH', 'postgresql')
    expect(Object.keys(out.tables)).toHaveLength(0)
    expect(out.unparsed[0].reason).toContain('blocked: parse failed')
  })

  test('preserves a CREATE TABLE after a leading comment', () => {
    const out = parseDdl('-- migration setup\nCREATE TABLE widgets (id INTEGER);', 'postgresql')
    expect(out.tables.widgets.columns).toContainEqual({
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
    expect(Object.keys(out.tables)).toEqual(['notes', 'tags'])
    expect(out.tables.notes.columns.map((column) => column.name)).toEqual(['id', 'body'])
  })

  test('continues after an invalid statement', () => {
    const out = parseDdl(
      'CREATE TABLE first_table (id INTEGER); CREATE GIBBERISH; CREATE TABLE last_table (id INTEGER);',
      'postgresql'
    )
    expect(Object.keys(out.tables)).toEqual(['first_table', 'last_table'])
    expect(out.unparsed).toHaveLength(1)
  })

  test.each(['postgresql', 'mysql', 'mariadb'] as const)('uses the %s parser dialect', (system) => {
    const out = parseDdl('CREATE TABLE dialect_test (id INTEGER);', system)
    expect(out.tables.dialect_test.columns[0].name).toBe('id')
  })

  test('keeps supported columns and blocks unsupported table definitions', () => {
    const out = parseDdl(
      'CREATE TABLE checked_table (id INTEGER, CONSTRAINT positive_id CHECK (id > 0));',
      'postgresql'
    )
    expect(out.tables.checked_table.columns.map((column) => column.name)).toEqual(['id'])
    expect(out.unparsed[0].reason).toContain('blocked: unsupported table definition')
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
})
