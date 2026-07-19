import { describe, test, expect } from 'bun:test'
import { parsePrismaSchema } from '@/core/orm-drift/adapters/prisma'

const full = await Bun.file('tests/fixtures/orm-drift/schema.prisma').text()
const partial = await Bun.file('tests/fixtures/orm-drift/partial.prisma').text()

describe('parsePrismaSchema', () => {
  test('maps models to tables honoring @@map and @map', () => {
    const out = parsePrismaSchema(full)
    expect(out.source).toBe('prisma')
    expect(Object.keys(out.tables).sort()).toEqual(['posts', 'users'])
    const users = out.tables.users
    const colNames = users.columns.map((c) => c.name)
    expect(colNames).toEqual(['id', 'email', 'name', 'bio', 'created_at'])
  })

  test('maps types, optionality, pk, unique, native types', () => {
    const users = parsePrismaSchema(full).tables.users
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
    expect(users.indexes).toContainEqual({ name: undefined, columns: ['email'], unique: true })
  })

  test('@@index becomes a composite index with mapped column names', () => {
    const users = parsePrismaSchema(full).tables.users
    expect(users.indexes).toContainEqual({
      name: undefined,
      columns: ['name', 'created_at'],
      unique: false,
    })
  })

  test('relation fields become foreign keys, not columns', () => {
    const posts = parsePrismaSchema(full).tables.posts
    expect(posts.columns.map((c) => c.name)).toEqual(['id', 'title', 'author_id'])
    expect(posts.foreignKeys).toEqual([
      { columns: ['author_id'], refTable: 'users', refColumns: ['id'] },
    ])
  })

  test('list relation fields (Post[]) are skipped silently', () => {
    const users = parsePrismaSchema(full).tables.users
    expect(users.columns.map((c) => c.name)).not.toContain('posts')
  })

  test('unknown field types and attributes land in unparsed, never guessed', () => {
    const out = parsePrismaSchema(partial)
    expect(out.tables.widget.columns.map((c) => c.name)).toEqual(['id', 'meta'])
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

    expect(out.tables.user.columns.map((column) => column.name)).toEqual(['id'])
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

    expect(out.tables.event.columns.map((column) => column.name)).toEqual(['id'])
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

    expect(out.tables.good.columns.map((column) => column.name)).toEqual(['id'])
    expect(out.tables.unclosed).toBeUndefined()
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

    expect(out.tables.invalid.columns).toEqual([])
    expect(out.unparsed).toHaveLength(2)
    expect(out.unparsed.every((entry) => entry.reason.startsWith('blocked:'))).toBe(true)
  })
})
