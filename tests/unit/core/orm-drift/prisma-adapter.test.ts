import { describe, test, expect } from 'bun:test'
import { parsePrismaSchema } from '@/core/orm-drift/adapters/prisma'
import type { NormalizedSchema, NormalizedTable } from '@/core/orm-drift/normalized-schema'

const full = await Bun.file('tests/fixtures/orm-drift/schema.prisma').text()
const partial = await Bun.file('tests/fixtures/orm-drift/partial.prisma').text()

function tableNamed(schema: NormalizedSchema, name: string): NormalizedTable {
  const table = schema.tables.find((candidate) => candidate.identity.table === name)
  expect(table).toBeDefined()
  return table!
}

describe('parsePrismaSchema', () => {
  test('maps models to tables honoring @@map and @map', () => {
    const out = parsePrismaSchema(full)
    expect(out.source).toBe('prisma')
    expect(out.tables.map((table) => table.identity.table).sort()).toEqual(['posts', 'users'])
    expect(out.unparsed).toEqual([])
    const users = tableNamed(out, 'users')
    const colNames = users.columns.map((c) => c.name)
    expect(colNames).toEqual(['id', 'email', 'name', 'bio', 'created_at'])
  })

  test('maps types, optionality, pk, unique, native types', () => {
    const users = tableNamed(parsePrismaSchema(full), 'users')
    const byName = Object.fromEntries(users.columns.map((c) => [c.name, c]))
    expect(byName.id).toMatchObject({
      type: 'integer',
      rawType: 'Int',
      nullable: false,
      primaryKey: true,
    })
    expect(byName.email.nullable).toBe(false)
    expect(byName.name.nullable).toBe(true)
    expect(byName.bio.type).toBe('text')
    expect(byName.created_at.type).toBe('timestamp')
    expect(byName.id.default).toBe('autoincrement()')
    expect(byName.created_at.default).toBe('now()')
    expect(users.indexes).toContainEqual({ name: undefined, columns: ['email'], unique: true })
  })

  test('@@index becomes a composite index with mapped column names', () => {
    const users = tableNamed(parsePrismaSchema(full), 'users')
    expect(users.indexes).toContainEqual({
      name: undefined,
      columns: ['name', 'created_at'],
      unique: false,
    })
  })

  test('relation fields become foreign keys, not columns', () => {
    const posts = tableNamed(parsePrismaSchema(full), 'posts')
    expect(posts.columns.map((c) => c.name)).toEqual(['id', 'title', 'author_id'])
    expect(posts.foreignKeys).toEqual([
      { columns: ['author_id'], refTable: { table: 'users' }, refColumns: ['id'] },
    ])
  })

  test('list relation fields (Post[]) are skipped silently', () => {
    const out = parsePrismaSchema(full)
    const users = tableNamed(out, 'users')
    expect(users.columns.map((c) => c.name)).not.toContain('posts')
    expect(out.unparsed.find((entry) => entry.location === 'User.posts')).toBeUndefined()
  })

  test('unknown field types and attributes land in unparsed, never guessed', () => {
    const out = parsePrismaSchema(partial)
    expect(tableNamed(out, 'Widget').columns.map((c) => c.name)).toEqual(['id', 'meta'])
    const reasons = out.unparsed.map((u) => u.reason)
    expect(out.unparsed.find((u) => u.location === 'Widget.status')?.reason).toContain('blocked:')
    expect(reasons.some((r) => r.includes('@@fulltext'))).toBe(true)
  })

  test('surfaces unsupported views, composite types, and multi-schema constructs', () => {
    const out = parsePrismaSchema(`
      datasource db {
        provider = "postgresql"
        schemas  = ["base", "shop"]
      }
      view UserSummary {
        id Int
      }
      type Address {
        street String
      }
      model User {
        id Int @id
        @@schema("base")
      }
    `)

    expect(tableNamed(out, 'User').columns.map((column) => column.name)).toEqual(['id'])
    expect(out.unparsed.map((entry) => entry.reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('blocked: multi-schema'),
        expect.stringContaining("blocked: unsupported top-level block 'view'"),
        expect.stringContaining("blocked: unsupported top-level block 'type'"),
        expect.stringContaining('@@schema'),
      ])
    )
  })

  test('does not guess columns with unsupported native or field attributes', () => {
    const out = parsePrismaSchema(`
      model Event {
        id        Int      @id
        amount    Decimal  @db.Money
        updatedAt DateTime @updatedAt
      }
    `)

    expect(tableNamed(out, 'Event').columns.map((column) => column.name)).toEqual(['id'])
    expect(out.unparsed).toEqual(
      expect.arrayContaining([
        {
          location: 'Event.amount',
          reason: expect.stringContaining("blocked: unsupported native type '@db.Money'"),
        },
        {
          location: 'Event.updatedAt',
          reason: expect.stringContaining("blocked: unsupported field attribute '@updatedAt'"),
        },
      ])
    )
  })

  test('surfaces malformed and unmatched constructs instead of ignoring them', () => {
    const out = parsePrismaSchema(`
      model Good {
        id Int @id
        broken String @map("unterminated)
        nonsense
      }
      }
      model Unclosed {
        id Int
    `)

    expect(tableNamed(out, 'Good').columns.map((column) => column.name)).toEqual(['id'])
    expect(out.tables.find((table) => table.identity.table === 'Unclosed')).toBeUndefined()
    expect(out.unparsed.length).toBeGreaterThanOrEqual(4)
    expect(out.unparsed.every((entry) => entry.reason.startsWith('blocked:'))).toBe(true)
  })

  test('blocks malformed list modifiers and empty native type arguments', () => {
    const out = parsePrismaSchema(`
      model Invalid {
        ids  Int[]  @id
        code String @db.VarChar()
      }
    `)

    expect(tableNamed(out, 'Invalid').columns).toEqual([])
    expect(out.unparsed).toHaveLength(2)
    expect(out.unparsed.every((entry) => entry.reason.startsWith('blocked:'))).toBe(true)
  })

  test('blocks enum, scalar, and unknown lists while skipping known model lists', () => {
    const out = parsePrismaSchema(`
      model Container {
        id       Int
        related  Related[]
        statuses WidgetStatus[]
        labels   String[]
        missing  MissingType[]
      }
      model Related {
        id Int
      }
      enum WidgetStatus {
        ACTIVE
      }
    `)

    expect(tableNamed(out, 'Container').columns.map((column) => column.name)).toEqual(['id'])
    expect(out.unparsed.find((entry) => entry.location === 'Container.related')).toBeUndefined()
    expect(out.unparsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: 'Container.statuses' }),
        expect.objectContaining({ location: 'Container.labels' }),
        expect.objectContaining({ location: 'Container.missing' }),
      ])
    )
  })

  test('blocks empty elements in index and relation field lists', () => {
    const out = parsePrismaSchema(`
      model Parent {
        id Int @id
      }
      model Child {
        parentId Int
        otherId  Int
        parent   Parent @relation(fields: [parentId,,otherId], references: [id,,id])

        @@index([parentId,,otherId])
        @@unique([parentId,])
      }
    `)

    expect(tableNamed(out, 'Child').indexes).toEqual([])
    expect(tableNamed(out, 'Child').foreignKeys).toEqual([])
    expect(out.unparsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: 'Child.parent' }),
        expect.objectContaining({
          location: 'Child',
          reason: expect.stringContaining("blocked: malformed '@@index'"),
        }),
        expect.objectContaining({
          location: 'Child',
          reason: expect.stringContaining("blocked: malformed '@@unique'"),
        }),
      ])
    )
  })

  test('accepts only compatible native scalar and argument combinations', () => {
    const out = parsePrismaSchema(`
      model NativeTypes {
        text        String   @db.Text
        varchar     String   @db.VarChar(191)
        uuid        String   @db.Uuid
        timestamp   DateTime @db.Timestamptz
        timestampP  DateTime @db.Timestamptz(3)
        date        DateTime @db.Date
        small       Int      @db.SmallInt
        jsonb       Json     @db.JsonB
      }
    `)
    const types = Object.fromEntries(
      tableNamed(out, 'NativeTypes').columns.map((column) => [column.name, column.type])
    )

    expect(types).toEqual({
      text: 'text',
      varchar: 'varchar(191)',
      uuid: 'uuid',
      timestamp: 'timestamp with time zone',
      timestampP: 'timestamp with time zone(3)',
      date: 'date',
      small: 'smallint',
      jsonb: 'jsonb',
    })
    expect(out.unparsed).toEqual([])
  })

  test('blocks incompatible or malformed native declarations without columns', () => {
    const out = parsePrismaSchema(`
      model InvalidNativeTypes {
        textArgs       String   @db.Text(1)
        textScalar     Int      @db.Text
        varcharMissing String   @db.VarChar
        varcharZero    String   @db.VarChar(0)
        timestampNeg   DateTime @db.Timestamptz(-1)
        uuidArgs       String   @db.Uuid(1)
        dateArgs       DateTime @db.Date(1)
        smallScalar    String   @db.SmallInt
        jsonArgs       Json     @db.JsonB(1)
      }
    `)

    expect(tableNamed(out, 'InvalidNativeTypes').columns).toEqual([])
    expect(out.unparsed).toHaveLength(9)
    expect(out.unparsed.every((entry) => entry.reason.startsWith('blocked:'))).toBe(true)
  })

  test('blocks duplicate field and mapped column names before resolving references', () => {
    const out = parsePrismaSchema(`
      model Parent {
        id Int @id
      }
      model Duplicate {
        repeated String
        repeated Int
        firstId  Int @map("parent_id")
        secondId Int @map("parent_id")
        parent   Parent @relation(fields: [firstId], references: [id])

        @@index([repeated])
        @@unique([firstId])
      }
    `)

    expect(tableNamed(out, 'Duplicate').columns).toEqual([])
    expect(tableNamed(out, 'Duplicate').indexes).toEqual([])
    expect(tableNamed(out, 'Duplicate').foreignKeys).toEqual([])
    expect(out.unparsed.map((entry) => entry.reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("blocked: duplicate model field name 'repeated'"),
        expect.stringContaining("blocked: duplicate mapped column name 'parent_id'"),
      ])
    )
  })

  test('maps @@unique and referenced @map column names', () => {
    const out = parsePrismaSchema(`
      model Parent {
        id Int @id @map("parent_id")
      }
      model Child {
        id       Int @id
        parentId Int @map("parent_id")
        parent   Parent @relation(fields: [parentId], references: [id])

        @@unique([id, parentId])
      }
    `)

    expect(tableNamed(out, 'Child').indexes).toContainEqual({
      name: undefined,
      columns: ['id', 'parent_id'],
      unique: true,
    })
    expect(tableNamed(out, 'Child').foreignKeys).toEqual([
      { columns: ['parent_id'], refTable: { table: 'Parent' }, refColumns: ['parent_id'] },
    ])
    expect(out.unparsed).toEqual([])
  })
})
