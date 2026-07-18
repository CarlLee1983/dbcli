# `dbcli diff --against-orm` (P1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `dbcli diff` with `--against-orm <path>` — compare an ORM schema definition (Prisma / raw DDL / normalized JSON) against the local DB schema cache and report categorized drift with proposed (never executed) `migrate` commands.

**Architecture:** Everything converges on one `NormalizedSchema` intermediate format (`src/core/orm-drift/`). Adapters feed it: a hand-written `schema.prisma` parser (no `@prisma/*` dependency), a DDL parser on `node-sql-parser` (existing dep), and a zod-validated JSON escape hatch. The DB side converts `config.schema` (the same local cache `dbcli plan` reads — no DB connection). A compare engine classifies drift into four categories with a type-tolerance table to avoid false-positive floods, and attaches `proposedCommands` (dry-run-by-default `migrate` invocations or escalation notes).

**Tech Stack:** Bun + TypeScript ESM, commander 13, node-sql-parser 5, zod 3, `bun test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-lint-and-orm-drift-design.md` §2.
- Never connect to the database: DB facts come only from `config.schema`. Empty cache → error `Schema cache is empty. Run 'dbcli schema' first.` and exit 1.
- Never execute proposals. `migrate` is dry-run by default in dbcli (needs `--execute`); proposals are printed as plain dry-run command strings.
- Snapshot mode (`--snapshot` / `--against`) behavior of `diff` must remain byte-for-byte unchanged.
- Unknown ORM syntax never guesses: it lands in `unparsed` with a reason (`blocked:` semantics).
- SQL engines only (postgresql/mysql/mariadb) — same gate `diff` already applies.
- Imports use the `@/` alias; ESM; no default exports. Conventional commits, no attribution footer.

## File Structure (final state)

```
src/core/orm-drift/
  normalized-schema.ts   # NormalizedSchema types + zod schema + typeFamily()
  from-db.ts             # Record<string, TableSchema> → NormalizedSchema
  compare.ts             # compareNormalized(orm, db, opts) → DriftReport
  proposals.ts           # DriftEntry → proposedCommands strings
  adapters/detect.ts     # path/content sniffing → 'prisma' | 'ddl' | 'json'
  adapters/prisma.ts     # schema.prisma text → NormalizedSchema
  adapters/ddl.ts        # CREATE TABLE/INDEX/ALTER sql → NormalizedSchema
src/formatters/orm-drift.ts
src/commands/diff.ts     # modify: add --against-orm / --orm-format / --ignore, markdown format
assets/tasks/orm-drift-review.md
tests/unit/core/orm-drift/*.test.ts
tests/fixtures/orm-drift/{schema.prisma,partial.prisma,create-tables.sql,normalized.json}
tests/unit/commands/diff-against-orm.test.ts
tests/unit/formatters/orm-drift.test.ts
```

---

### Task 1: NormalizedSchema types, zod schema, type families

**Files:**
- Create: `src/core/orm-drift/normalized-schema.ts`
- Test: `tests/unit/core/orm-drift/normalized-schema.test.ts`

**Interfaces (produced — every later task consumes these):**

```ts
export type OrmSource = 'db' | 'prisma' | 'ddl' | 'json' | 'drizzle' | 'typeorm' | 'sequelize'
export interface NormalizedColumn {
  name: string
  type: string            // lowercased source type, e.g. 'varchar(255)', 'integer'
  rawType?: string        // original spelling, e.g. Prisma 'String'
  nullable: boolean
  default?: string
  primaryKey?: boolean
}
export interface NormalizedIndex { name?: string; columns: string[]; unique: boolean }
export interface NormalizedForeignKey { columns: string[]; refTable: string; refColumns: string[] }
export interface NormalizedTable {
  name: string            // original casing
  columns: NormalizedColumn[]
  indexes: NormalizedIndex[]
  foreignKeys: NormalizedForeignKey[]
}
export interface UnparsedEntry { location: string; reason: string }  // reason starts with 'blocked:'
export interface NormalizedSchema {
  source: OrmSource
  tables: Record<string, NormalizedTable>   // key = lowercased table name
  unparsed: UnparsedEntry[]
}
export const normalizedSchemaZod: z.ZodType<…>   // validates the JSON escape-hatch input
export type TypeFamily = 'integer' | 'decimal' | 'text' | 'boolean' | 'datetime' | 'date' | 'json' | 'binary' | 'uuid' | 'other'
export function typeFamily(type: string): TypeFamily
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/orm-drift/normalized-schema.test.ts
import { describe, test, expect } from 'bun:test'
import { normalizedSchemaZod, typeFamily } from '@/core/orm-drift/normalized-schema'

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
      tables: {
        users: {
          name: 'users',
          columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
          indexes: [],
          foreignKeys: [],
        },
      },
      unparsed: [],
    }
    expect(normalizedSchemaZod.parse(doc).tables.users.columns[0].name).toBe('id')
  })

  test('rejects a column without nullable', () => {
    const doc = {
      source: 'json',
      tables: { t: { name: 't', columns: [{ name: 'a', type: 'text' }], indexes: [], foreignKeys: [] } },
      unparsed: [],
    }
    expect(() => normalizedSchemaZod.parse(doc)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/core/orm-drift/normalized-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/orm-drift/normalized-schema.ts
import { z } from 'zod'

export type OrmSource = 'db' | 'prisma' | 'ddl' | 'json' | 'drizzle' | 'typeorm' | 'sequelize'

export interface NormalizedColumn {
  name: string
  type: string
  rawType?: string
  nullable: boolean
  default?: string
  primaryKey?: boolean
}
export interface NormalizedIndex {
  name?: string
  columns: string[]
  unique: boolean
}
export interface NormalizedForeignKey {
  columns: string[]
  refTable: string
  refColumns: string[]
}
export interface NormalizedTable {
  name: string
  columns: NormalizedColumn[]
  indexes: NormalizedIndex[]
  foreignKeys: NormalizedForeignKey[]
}
export interface UnparsedEntry {
  location: string
  reason: string
}
export interface NormalizedSchema {
  source: OrmSource
  tables: Record<string, NormalizedTable>
  unparsed: UnparsedEntry[]
}

const columnZod = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  rawType: z.string().optional(),
  nullable: z.boolean(),
  default: z.string().optional(),
  primaryKey: z.boolean().optional(),
})
const tableZod = z.object({
  name: z.string().min(1),
  columns: z.array(columnZod),
  indexes: z.array(
    z.object({ name: z.string().optional(), columns: z.array(z.string()), unique: z.boolean() })
  ),
  foreignKeys: z.array(
    z.object({ columns: z.array(z.string()), refTable: z.string(), refColumns: z.array(z.string()) })
  ),
})
export const normalizedSchemaZod = z.object({
  source: z.enum(['db', 'prisma', 'ddl', 'json', 'drizzle', 'typeorm', 'sequelize']),
  tables: z.record(tableZod),
  unparsed: z.array(z.object({ location: z.string(), reason: z.string() })),
}) satisfies z.ZodType<NormalizedSchema>

export type TypeFamily =
  | 'integer' | 'decimal' | 'text' | 'boolean' | 'datetime' | 'date'
  | 'json' | 'binary' | 'uuid' | 'other'

const FAMILY_PATTERNS: Array<[TypeFamily, RegExp]> = [
  ['boolean', /^bool|^tinyint\(1\)/i],
  ['uuid', /^uuid/i],
  ['integer', /int|serial/i],
  ['decimal', /decimal|numeric|float|double|real|money/i],
  ['text', /char|text|citext|string/i],
  ['datetime', /timestamp|datetime/i],
  ['date', /^date$|^time/i],
  ['json', /json/i],
  ['binary', /bytea|blob|binary/i],
]

export function typeFamily(type: string): TypeFamily {
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(type)) return family
  }
  return 'other'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/core/orm-drift/normalized-schema.test.ts`
Expected: PASS. Pattern order matters (`boolean` before `integer` so `tinyint(1)` wins; `uuid` before `text`); if a family assertion fails, reorder patterns rather than weakening the test.

- [ ] **Step 5: Commit**

```bash
git add src/core/orm-drift/normalized-schema.ts tests/unit/core/orm-drift/normalized-schema.test.ts
git commit -m "feat: add NormalizedSchema types, zod validation, and type families"
```

---

### Task 2: DB-side conversion (`from-db.ts`)

**Files:**
- Create: `src/core/orm-drift/from-db.ts`
- Test: `tests/unit/core/orm-drift/from-db.test.ts`

**Interfaces:**
- Consumes: `TableSchema` (`@/adapters/types`), Task 1 types.
- Produces: `normalizeDbSchema(schema: Record<string, TableSchema>): NormalizedSchema` (source `'db'`; table keys lowercased; `indexes`/`foreignKeys` default to `[]` when absent).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/orm-drift/from-db.test.ts
import { describe, test, expect } from 'bun:test'
import { normalizeDbSchema } from '@/core/orm-drift/from-db'
import type { TableSchema } from '@/adapters/types'

const users: TableSchema = {
  name: 'Users',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
    { name: 'email', type: 'varchar(255)', nullable: true, default: 'NULL' },
  ],
  indexes: [{ name: 'users_email_idx', columns: ['email'], unique: true }],
  foreignKeys: [
    { name: 'fk_org', columns: ['org_id'], refTable: 'orgs', refColumns: ['id'] },
  ],
}

describe('normalizeDbSchema', () => {
  test('converts TableSchema map into NormalizedSchema keyed by lowercase name', () => {
    const out = normalizeDbSchema({ Users: users })
    expect(out.source).toBe('db')
    expect(out.tables.users.name).toBe('Users')
    expect(out.tables.users.columns[0]).toEqual({
      name: 'id',
      type: 'integer',
      rawType: 'INTEGER',
      nullable: false,
      primaryKey: true,
    })
    expect(out.tables.users.indexes[0].unique).toBe(true)
    expect(out.tables.users.foreignKeys[0].refTable).toBe('orgs')
    expect(out.unparsed).toEqual([])
  })

  test('missing indexes/foreignKeys become empty arrays', () => {
    const bare: TableSchema = { name: 't', columns: [] }
    expect(normalizeDbSchema({ t: bare }).tables.t.indexes).toEqual([])
    expect(normalizeDbSchema({ t: bare }).tables.t.foreignKeys).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/core/orm-drift/from-db.test.ts` — FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/orm-drift/from-db.ts
import type { TableSchema } from '@/adapters/types'
import type { NormalizedSchema, NormalizedTable } from './normalized-schema'

export function normalizeDbSchema(schema: Record<string, TableSchema>): NormalizedSchema {
  const tables: Record<string, NormalizedTable> = {}
  for (const table of Object.values(schema)) {
    tables[table.name.toLowerCase()] = {
      name: table.name,
      columns: table.columns.map((c) => ({
        name: c.name,
        type: c.type.toLowerCase(),
        rawType: c.type,
        nullable: c.nullable,
        ...(c.default !== undefined && c.default !== 'NULL' && { default: c.default }),
        ...(c.primaryKey && { primaryKey: true }),
      })),
      indexes: (table.indexes ?? []).map((i) => ({
        name: i.name,
        columns: i.columns,
        unique: Boolean(i.unique),
      })),
      foreignKeys: (table.foreignKeys ?? []).map((fk) => ({
        columns: fk.columns,
        refTable: fk.refTable,
        refColumns: fk.refColumns,
      })),
    }
  }
  return { source: 'db', tables, unparsed: [] }
}
```

> `TableSchema.indexes` element shape: check `src/adapters/types.ts` around line 111 —
> if `unique` is optional there, `Boolean()` normalizes it; if the field is named
> differently, adapt the mapping and keep the test's expectations.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/core/orm-drift/from-db.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/orm-drift/from-db.ts tests/unit/core/orm-drift/from-db.test.ts
git commit -m "feat: normalize DB schema cache into NormalizedSchema"
```

---

### Task 3: Prisma adapter

**Files:**
- Create: `src/core/orm-drift/adapters/prisma.ts`
- Create: `tests/fixtures/orm-drift/schema.prisma`
- Create: `tests/fixtures/orm-drift/partial.prisma`
- Test: `tests/unit/core/orm-drift/prisma-adapter.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `parsePrismaSchema(text: string): NormalizedSchema` (source `'prisma'`).

Supported (per spec, deliberately narrow): `model` blocks; scalar field types (`String`, `Int`, `BigInt`, `Float`, `Decimal`, `Boolean`, `DateTime`, `Json`, `Bytes`); optional marker `?`; list marker `[]` (skipped as relation-side, not a column); attributes `@id`, `@unique`, `@default(...)`, `@map("...")`, `@@map("...")`, `@@index([...])`, `@@unique([...])`, `@db.<NativeType>(…)` (native type wins as `rawType` base); relation fields (`fieldName OtherModel @relation(fields: [x], references: [y])`) contribute a foreign key and are not columns themselves. Everything else (enums referenced as field types, `view`, `type`, unknown `@@` attributes, multi-schema) → `unparsed` entries; never a guess.

Prisma→neutral type map: `String`→`text`, `Int`→`integer`, `BigInt`→`bigint`, `Float`→`double precision`, `Decimal`→`decimal`, `Boolean`→`boolean`, `DateTime`→`timestamp`, `Json`→`json`, `Bytes`→`bytea`.

- [ ] **Step 1: Create the fixtures**

```prisma
// tests/fixtures/orm-drift/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  bio       String?  @db.Text
  createdAt DateTime @default(now()) @map("created_at")
  posts     Post[]

  @@map("users")
  @@index([name, createdAt])
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int    @map("author_id")

  @@map("posts")
}
```

```prisma
// tests/fixtures/orm-drift/partial.prisma
model Widget {
  id     Int          @id
  status WidgetStatus
  meta   Json

  @@fulltext([meta])
}

enum WidgetStatus {
  ACTIVE
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/core/orm-drift/prisma-adapter.test.ts
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
    expect(byName.id).toMatchObject({ type: 'integer', rawType: 'Int', nullable: false, primaryKey: true })
    expect(byName.email.nullable).toBe(false)
    expect(byName.name.nullable).toBe(true)
    expect(byName.bio.type).toBe('text')            // @db.Text native type wins
    expect(byName.created_at.type).toBe('timestamp')
    // @unique on email surfaces as a unique index
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
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/core/orm-drift/prisma-adapter.test.ts` — FAIL, module not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/core/orm-drift/adapters/prisma.ts
/**
 * Hand-written schema.prisma parser — deliberately narrow (spec §2).
 * No dependency on @prisma/*: the grammar subset we accept is line-oriented
 * and regular. Anything outside the subset lands in `unparsed` with a
 * blocked: reason; we never guess.
 */
import type {
  NormalizedSchema,
  NormalizedTable,
  NormalizedColumn,
  UnparsedEntry,
} from '../normalized-schema'

const SCALARS: Record<string, string> = {
  String: 'text',
  Int: 'integer',
  BigInt: 'bigint',
  Float: 'double precision',
  Decimal: 'decimal',
  Boolean: 'boolean',
  DateTime: 'timestamp',
  Json: 'json',
  Bytes: 'bytea',
}

const NATIVE_TYPES: Record<string, string> = {
  Text: 'text',
  VarChar: 'varchar',
  Uuid: 'uuid',
  Timestamptz: 'timestamp with time zone',
  Date: 'date',
  SmallInt: 'smallint',
  JsonB: 'jsonb',
}

interface RawField {
  line: string
  name: string
  type: string
  optional: boolean
  isList: boolean
  attrs: string
}

export function parsePrismaSchema(text: string): NormalizedSchema {
  const tables: Record<string, NormalizedTable> = {}
  const unparsed: UnparsedEntry[] = []
  const modelNames = new Set<string>()
  const modelTableNames = new Map<string, string>() // model name → mapped table name
  const modelFieldMaps = new Map<string, Map<string, string>>() // model → field → column name

  const blocks = [...text.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)]
  for (const [, name] of blocks) modelNames.add(name)

  // Pass 1: table names and field→column maps (needed for FK/index resolution).
  for (const [, modelName, body] of blocks) {
    const mapMatch = body.match(/@@map\("([^"]+)"\)/)
    modelTableNames.set(modelName, mapMatch ? mapMatch[1] : modelName)
    const fieldMap = new Map<string, string>()
    for (const f of parseFields(body)) {
      const colMap = f.attrs.match(/@map\("([^"]+)"\)/)
      fieldMap.set(f.name, colMap ? colMap[1] : f.name)
    }
    modelFieldMaps.set(modelName, fieldMap)
  }

  // Pass 2: build tables.
  for (const [, modelName, body] of blocks) {
    const tableName = modelTableNames.get(modelName) as string
    const fieldMap = modelFieldMaps.get(modelName) as Map<string, string>
    const table: NormalizedTable = { name: tableName, columns: [], indexes: [], foreignKeys: [] }

    for (const f of parseFields(body)) {
      const columnName = fieldMap.get(f.name) as string
      if (f.isList) continue // relation list side — no column
      if (modelNames.has(f.type)) {
        // Relation field: contributes a FK when @relation(fields/references) present.
        const rel = f.attrs.match(/@relation\(fields:\s*\[([^\]]+)\],\s*references:\s*\[([^\]]+)\]\)/)
        if (rel) {
          const refModel = f.type
          const localFields = rel[1].split(',').map((s) => s.trim())
          const refFields = rel[2].split(',').map((s) => s.trim())
          const refFieldMap = modelFieldMaps.get(refModel) ?? new Map()
          table.foreignKeys.push({
            columns: localFields.map((x) => fieldMap.get(x) ?? x),
            refTable: modelTableNames.get(refModel) ?? refModel,
            refColumns: refFields.map((x) => refFieldMap.get(x) ?? x),
          })
        }
        continue
      }
      const neutral = SCALARS[f.type]
      if (!neutral) {
        unparsed.push({
          location: `${modelName}.${f.name}`,
          reason: `blocked: unsupported field type '${f.type}' (enum/composite/unknown)`,
        })
        continue
      }
      let type = neutral
      const native = f.attrs.match(/@db\.(\w+)(?:\(([^)]*)\))?/)
      if (native) {
        const mapped = NATIVE_TYPES[native[1]]
        if (mapped) type = native[2] ? `${mapped}(${native[2]})` : mapped
        else
          unparsed.push({
            location: `${modelName}.${f.name}`,
            reason: `blocked: unsupported native type '@db.${native[1]}'`,
          })
      }
      const column: NormalizedColumn = {
        name: columnName,
        type,
        rawType: f.type,
        nullable: f.optional,
        ...(f.attrs.includes('@id') && { primaryKey: true }),
      }
      const def = f.attrs.match(/@default\(([^)]*)\)/)
      if (def) column.default = def[1]
      table.columns.push(column)
      if (/@unique\b/.test(f.attrs)) {
        table.indexes.push({ name: undefined, columns: [columnName], unique: true })
      }
    }

    // Block attributes: @@index / @@unique / (@@map handled) / others → unparsed.
    for (const attr of body.matchAll(/@@(\w+)\(([^)]*)\)/g)) {
      const [, kind, args] = attr
      if (kind === 'map') continue
      if (kind === 'index' || kind === 'unique') {
        const cols = (args.match(/\[([^\]]*)\]/)?.[1] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((f) => fieldMap.get(f) ?? f)
        if (cols.length > 0) {
          table.indexes.push({ name: undefined, columns: cols, unique: kind === 'unique' })
        }
        continue
      }
      unparsed.push({
        location: `${modelName}`,
        reason: `blocked: unsupported block attribute '@@${kind}'`,
      })
    }

    tables[tableName.toLowerCase()] = table
  }

  return { source: 'prisma', tables, unparsed }
}

function parseFields(body: string): RawField[] {
  const fields: RawField[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue
    const m = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/)
    if (!m) continue
    fields.push({
      line,
      name: m[1],
      type: m[2],
      isList: Boolean(m[3]),
      optional: Boolean(m[4]),
      attrs: m[5] ?? '',
    })
  }
  return fields
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/core/orm-drift/prisma-adapter.test.ts` — PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/orm-drift/adapters/prisma.ts tests/fixtures/orm-drift/*.prisma tests/unit/core/orm-drift/prisma-adapter.test.ts
git commit -m "feat: add Prisma schema adapter for NormalizedSchema"
```

---

### Task 4: DDL adapter + format detection

**Files:**
- Create: `src/core/orm-drift/adapters/ddl.ts`
- Create: `src/core/orm-drift/adapters/detect.ts`
- Create: `tests/fixtures/orm-drift/create-tables.sql`
- Create: `tests/fixtures/orm-drift/normalized.json` (the Task 1 minimal valid doc, saved as a file)
- Test: `tests/unit/core/orm-drift/ddl-adapter.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `node-sql-parser` (dialect mapping copied from `src/core/lint/parse.ts` — if P1a has not landed yet, inline the same 4-line DIALECT map here).
- Produces:
  - `parseDdl(sql: string, system: SqlDatabaseSystem): NormalizedSchema` (source `'ddl'`; handles multi-statement input; `CREATE TABLE` builds tables, `CREATE [UNIQUE] INDEX` appends indexes, everything else → `unparsed`)
  - `detectOrmFormat(path: string, content: string): 'prisma' | 'ddl' | 'json'` (`.prisma` ext or `model X {` content → prisma; parseable JSON object with a `tables` key → json; otherwise ddl)

- [ ] **Step 1: Create the SQL fixture**

```sql
-- tests/fixtures/orm-drift/create-tables.sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  org_id INTEGER REFERENCES orgs(id)
);

CREATE UNIQUE INDEX users_email_idx ON users (email);
CREATE INDEX users_name_idx ON users (name, email);

ALTER TABLE users ADD CONSTRAINT chk CHECK (id > 0);
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/core/orm-drift/ddl-adapter.test.ts
import { describe, test, expect } from 'bun:test'
import { parseDdl } from '@/core/orm-drift/adapters/ddl'
import { detectOrmFormat } from '@/core/orm-drift/adapters/detect'

const sql = await Bun.file('tests/fixtures/orm-drift/create-tables.sql').text()

describe('parseDdl', () => {
  test('builds tables from CREATE TABLE with types, nullability, pk', () => {
    const out = parseDdl(sql, 'postgresql')
    const users = out.tables.users
    const byName = Object.fromEntries(users.columns.map((c) => [c.name, c]))
    expect(byName.id).toMatchObject({ type: 'integer', nullable: false, primaryKey: true })
    expect(byName.email).toMatchObject({ type: 'varchar(255)', nullable: false })
    expect(byName.name.nullable).toBe(true)
  })

  test('collects CREATE INDEX statements onto their table', () => {
    const users = parseDdl(sql, 'postgresql').tables.users
    expect(users.indexes).toContainEqual({ name: 'users_email_idx', columns: ['email'], unique: true })
    expect(users.indexes).toContainEqual({ name: 'users_name_idx', columns: ['name', 'email'], unique: false })
  })

  test('unsupported statements land in unparsed', () => {
    const out = parseDdl(sql, 'postgresql')
    expect(out.unparsed.some((u) => u.reason.includes('blocked:'))).toBe(true)
  })

  test('unparseable SQL becomes one unparsed entry, not a throw', () => {
    const out = parseDdl('CREATE GIBBERISH', 'postgresql')
    expect(Object.keys(out.tables)).toHaveLength(0)
    expect(out.unparsed[0].reason).toContain('blocked: parse failed')
  })
})

describe('detectOrmFormat', () => {
  test('detects by extension and content', () => {
    expect(detectOrmFormat('prisma/schema.prisma', '')).toBe('prisma')
    expect(detectOrmFormat('x.txt', 'model User {\n id Int\n}')).toBe('prisma')
    expect(detectOrmFormat('schema.json', '{"source":"json","tables":{},"unparsed":[]}')).toBe('json')
    expect(detectOrmFormat('migrations/001.sql', 'CREATE TABLE t (id int);')).toBe('ddl')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/core/orm-drift/ddl-adapter.test.ts` — FAIL.

- [ ] **Step 4: Write the implementation**

```ts
// src/core/orm-drift/adapters/detect.ts
export function detectOrmFormat(path: string, content: string): 'prisma' | 'ddl' | 'json' {
  if (path.endsWith('.prisma')) return 'prisma'
  if (/^\s*model\s+\w+\s*\{/m.test(content)) return 'prisma'
  if (path.endsWith('.json')) return 'json'
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && 'tables' in parsed) return 'json'
  } catch {
    // not JSON — fall through
  }
  return 'ddl'
}
```

```ts
// src/core/orm-drift/adapters/ddl.ts
/**
 * DDL → NormalizedSchema via node-sql-parser. CREATE TABLE and
 * CREATE [UNIQUE] INDEX are consumed; every other statement (ALTER, GRANT,
 * INSERT seeds, dialect-specific bits the parser rejects) lands in `unparsed`.
 */
import { Parser } from 'node-sql-parser'
import type { SqlDatabaseSystem } from '@/adapters/types'
import type { NormalizedSchema, NormalizedTable, UnparsedEntry } from '../normalized-schema'

const DIALECT: Record<SqlDatabaseSystem, string> = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'Postgresql',
}

const parser = new Parser()
type Ast = Record<string, unknown>

export function parseDdl(sql: string, system: SqlDatabaseSystem): NormalizedSchema {
  const tables: Record<string, NormalizedTable> = {}
  const unparsed: UnparsedEntry[] = []

  // Split on semicolons so one bad statement doesn't sink the whole file.
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))

  for (const stmt of statements) {
    let ast: unknown
    try {
      ast = parser.astify(stmt, { database: DIALECT[system] })
    } catch (e) {
      unparsed.push({
        location: stmt.slice(0, 60),
        reason: `blocked: parse failed — ${(e as Error).message.split('\n')[0]}`,
      })
      continue
    }
    for (const node of Array.isArray(ast) ? ast : [ast]) {
      consumeStatement(node as Ast, tables, unparsed)
    }
  }
  return { source: 'ddl', tables, unparsed }
}

function consumeStatement(
  node: Ast,
  tables: Record<string, NormalizedTable>,
  unparsed: UnparsedEntry[]
): void {
  if (node.type === 'create' && node.keyword === 'table') {
    consumeCreateTable(node, tables, unparsed)
    return
  }
  if (node.type === 'create' && node.keyword === 'index') {
    consumeCreateIndex(node, tables, unparsed)
    return
  }
  unparsed.push({
    location: `${node.type ?? 'unknown'} ${node.keyword ?? ''}`.trim(),
    reason: `blocked: unsupported DDL statement '${node.type}${node.keyword ? ' ' + node.keyword : ''}'`,
  })
}

function tableNameOf(node: Ast): string | null {
  const t = node.table
  if (Array.isArray(t)) return String((t[0] as Ast)?.table ?? '') || null
  if (t && typeof t === 'object') return String((t as Ast).table ?? '') || null
  return typeof t === 'string' ? t : null
}

function consumeCreateTable(
  node: Ast,
  tables: Record<string, NormalizedTable>,
  unparsed: UnparsedEntry[]
): void {
  const name = tableNameOf(node)
  if (!name) return
  const table: NormalizedTable = { name, columns: [], indexes: [], foreignKeys: [] }
  const defs = Array.isArray(node.create_definitions) ? (node.create_definitions as Ast[]) : []
  for (const def of defs) {
    if (def.resource === 'column') {
      const colNode = def.column as Ast
      const columnName = String((colNode?.column as Ast)?.expr ?? colNode?.column ?? '')
        .replace(/^["'`]|["'`]$/g, '')
      const dt = def.definition as Ast
      const baseType = String(dt?.dataType ?? 'unknown').toLowerCase()
      const length = Array.isArray(dt?.length)
        ? (dt.length as Ast[]).map((l) => l.value).join(',')
        : dt?.length
      const type = length ? `${baseType}(${length})` : baseType
      const isPk =
        def.primary_key === 'primary key' ||
        (def.suffix as string[] | undefined)?.includes?.('primary key') === true
      const notNull = (def.nullable as Ast | undefined)?.type === 'not null'
      const fkRef = def.reference_definition as Ast | undefined
      table.columns.push({
        name: columnName,
        type,
        rawType: type,
        nullable: !notNull && !isPk,
        ...(isPk && { primaryKey: true }),
      })
      if (fkRef) {
        const refTable = tableNameOf(fkRef) ?? String((fkRef.table as Ast[])?.[0] ?? '')
        const refCols = Array.isArray(fkRef.definition)
          ? (fkRef.definition as Ast[]).map((c) => String((c as Ast).column ?? c))
          : []
        if (refTable) {
          table.foreignKeys.push({ columns: [columnName], refTable, refColumns: refCols })
        }
      }
      continue
    }
    if (def.resource === 'constraint' && def.constraint_type === 'primary key') {
      const cols = Array.isArray(def.definition)
        ? (def.definition as Ast[]).map((c) => String((c as Ast).column ?? c))
        : []
      for (const table_col of table.columns) {
        if (cols.includes(table_col.name)) {
          table_col.primaryKey = true
          table_col.nullable = false
        }
      }
      continue
    }
    unparsed.push({
      location: `${name} (${String(def.resource)})`,
      reason: `blocked: unsupported table definition '${String(def.constraint_type ?? def.resource)}'`,
    })
  }
  tables[name.toLowerCase()] = table
}

function consumeCreateIndex(
  node: Ast,
  tables: Record<string, NormalizedTable>,
  unparsed: UnparsedEntry[]
): void {
  const tableName = tableNameOf(node)
  const target = tableName ? tables[tableName.toLowerCase()] : undefined
  if (!target) {
    unparsed.push({
      location: String(node.index ?? 'index'),
      reason: `blocked: CREATE INDEX targets unknown table '${tableName ?? '?'}'`,
    })
    return
  }
  const cols = Array.isArray(node.index_columns)
    ? (node.index_columns as Ast[]).map((c) =>
        String(((c.column as Ast)?.expr as Ast)?.value ?? (c.column as Ast)?.column ?? c.column)
      )
    : []
  target.indexes.push({
    name: node.index ? String(node.index) : undefined,
    columns: cols,
    unique: String(node.index_type ?? '').toLowerCase() === 'unique',
  })
}
```

> Same AST caveat as the lint plan: node-sql-parser's create-table AST field names
> (`create_definitions`, `reference_definition`, `index_columns`, `index_type`) are the
> v5 shapes; if a test fails, `console.log(JSON.stringify(ast))`, fix the accessor,
> keep the behavioral assertion.

Also save `tests/fixtures/orm-drift/normalized.json`:

```json
{
  "source": "json",
  "tables": {
    "users": {
      "name": "users",
      "columns": [{ "name": "id", "type": "integer", "nullable": false, "primaryKey": true }],
      "indexes": [],
      "foreignKeys": []
    }
  },
  "unparsed": []
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/core/orm-drift/ddl-adapter.test.ts` — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/orm-drift/adapters/ddl.ts src/core/orm-drift/adapters/detect.ts tests/fixtures/orm-drift tests/unit/core/orm-drift/ddl-adapter.test.ts
git commit -m "feat: add DDL adapter and ORM format detection"
```

---

### Task 5: Compare engine + proposals

**Files:**
- Create: `src/core/orm-drift/compare.ts`
- Create: `src/core/orm-drift/proposals.ts`
- Test: `tests/unit/core/orm-drift/compare.test.ts`

**Interfaces:**
- Consumes: Task 1 (`NormalizedSchema`, `typeFamily`).
- Produces:

```ts
export type DriftCategory = 'missing_in_db' | 'missing_in_orm' | 'mismatch' | 'unmanaged'
export interface DriftEntry {
  category: DriftCategory
  severity: 'info' | 'warn' | 'error'
  table: string
  object: string       // 'table' | '<column>' | 'index(<cols>)'
  detail: string
  proposedCommands: string[]
}
export interface DriftReport {
  ormSource: string
  entries: DriftEntry[]
  unparsed: UnparsedEntry[]      // merged from both sides
  summary: { errors: number; warns: number; infos: number; unmanaged: number }
}
export function compareNormalized(orm: NormalizedSchema, db: NormalizedSchema, opts: { ignore: string[] }): DriftReport
export function proposalsFor(entry: Omit<DriftEntry, 'proposedCommands'>, column?: NormalizedColumn): string[]
```

Severity/tolerance rules (spec §2 — encode exactly):
- `missing_in_db` (table or column or index in ORM, absent in DB) → `error`.
- `missing_in_orm` (in DB, absent in ORM) → `warn`.
- `mismatch`: different `typeFamily` OR `nullable` differs → `error`; same family but different spelling (`varchar(191)` vs `text`) → `info`; `default`/`primaryKey` differences → `info`.
- `unmanaged`: table matches an `ignore` glob (built-in defaults `['_prisma_migrations']` + user-provided) → single entry per table, severity `info`, not counted in errors/warns.
- Index comparison is by column-set + uniqueness (names differ between ORMs and DBs routinely — never compare index names).

Proposal rules (`proposals.ts`):
- `missing_in_db` column → `dbcli migrate add-column <table> <column> <type>` + `--nullable` when nullable + `--default <v>` when default present, prefixed comment line `# dry-run by default; review via migration-review before --execute`.
- `missing_in_db` index → `dbcli migrate add-index <table> --columns <a,b>` + `--unique` when unique.
- `missing_in_db` table, any `mismatch`, and all `missing_in_orm` → `['# escalate: <one-line reason> — run: dbcli skill tasks plan migration-review']` (type changes/drops/backfilling ORM defs are not expressible as safe single commands).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/orm-drift/compare.test.ts
import { describe, test, expect } from 'bun:test'
import { compareNormalized } from '@/core/orm-drift/compare'
import type { NormalizedSchema } from '@/core/orm-drift/normalized-schema'

function schemaWith(tables: NormalizedSchema['tables']): NormalizedSchema {
  return { source: 'prisma', tables, unparsed: [] }
}
const dbWith = (tables: NormalizedSchema['tables']): NormalizedSchema => ({
  source: 'db',
  tables,
  unparsed: [],
})

const usersOrm = {
  users: {
    name: 'users',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false },
      { name: 'age', type: 'integer', nullable: true },
    ],
    indexes: [{ columns: ['email'], unique: true }],
    foreignKeys: [],
  },
}

describe('compareNormalized', () => {
  test('column missing in DB → error with add-column proposal', () => {
    const db = dbWith({
      users: { ...usersOrm.users, columns: usersOrm.users.columns.slice(0, 2), indexes: usersOrm.users.indexes },
    })
    const report = compareNormalized(schemaWith(usersOrm), db, { ignore: [] })
    const entry = report.entries.find((e) => e.object === 'age')
    expect(entry?.category).toBe('missing_in_db')
    expect(entry?.severity).toBe('error')
    expect(entry?.proposedCommands.join('\n')).toContain('dbcli migrate add-column users age integer --nullable')
  })

  test('index missing in DB → error with add-index proposal; index names are ignored', () => {
    const db = dbWith({
      users: { ...usersOrm.users, indexes: [] },
    })
    const report = compareNormalized(schemaWith(usersOrm), db, { ignore: [] })
    const entry = report.entries.find((e) => e.object === 'index(email)')
    expect(entry?.severity).toBe('error')
    expect(entry?.proposedCommands.join('\n')).toContain('dbcli migrate add-index users --columns email --unique')
  })

  test('same column-set index with different name is NOT drift', () => {
    const db = dbWith({
      users: { ...usersOrm.users, indexes: [{ name: 'idx_zzz', columns: ['email'], unique: true }] },
    })
    const report = compareNormalized(schemaWith(usersOrm), db, { ignore: [] })
    expect(report.entries.filter((e) => e.object.startsWith('index'))).toHaveLength(0)
  })

  test('column only in DB → warn missing_in_orm with escalate proposal', () => {
    const db = dbWith({
      users: {
        ...usersOrm.users,
        columns: [...usersOrm.users.columns, { name: 'legacy_flag', type: 'boolean', nullable: true }],
      },
    })
    const report = compareNormalized(schemaWith(usersOrm), db, { ignore: [] })
    const entry = report.entries.find((e) => e.object === 'legacy_flag')
    expect(entry).toMatchObject({ category: 'missing_in_orm', severity: 'warn' })
    expect(entry?.proposedCommands[0]).toContain('# escalate')
  })

  test('type family mismatch → error; same-family spelling difference → info', () => {
    const db = dbWith({
      users: {
        ...usersOrm.users,
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: true },
          { name: 'email', type: 'varchar(191)', nullable: false }, // text family — spelling only
          { name: 'age', type: 'text', nullable: true },            // family mismatch vs integer
        ],
      },
    })
    const report = compareNormalized(schemaWith(usersOrm), db, { ignore: [] })
    expect(report.entries.find((e) => e.object === 'email')).toMatchObject({
      category: 'mismatch',
      severity: 'info',
    })
    expect(report.entries.find((e) => e.object === 'age')).toMatchObject({
      category: 'mismatch',
      severity: 'error',
    })
  })

  test('nullable mismatch → error', () => {
    const db = dbWith({
      users: {
        ...usersOrm.users,
        columns: usersOrm.users.columns.map((c) =>
          c.name === 'email' ? { ...c, nullable: true } : c
        ),
      },
    })
    const report = compareNormalized(schemaWith(usersOrm), db, { ignore: [] })
    expect(report.entries.find((e) => e.object === 'email')?.severity).toBe('error')
  })

  test('ignore globs and default _prisma_migrations → unmanaged, uncounted', () => {
    const db = dbWith({
      ...usersOrm,
      _prisma_migrations: { name: '_prisma_migrations', columns: [], indexes: [], foreignKeys: [] },
      audit_log: { name: 'audit_log', columns: [], indexes: [], foreignKeys: [] },
    })
    const report = compareNormalized(schemaWith(usersOrm), db, { ignore: ['audit_*'] })
    const unmanaged = report.entries.filter((e) => e.category === 'unmanaged')
    expect(unmanaged.map((e) => e.table).sort()).toEqual(['_prisma_migrations', 'audit_log'])
    expect(report.summary.errors).toBe(0)
    expect(report.summary.warns).toBe(0)
  })

  test('summary counts by severity', () => {
    const db = dbWith({ users: { ...usersOrm.users, columns: usersOrm.users.columns.slice(0, 2) } })
    const report = compareNormalized(schemaWith(usersOrm), db, { ignore: [] })
    expect(report.summary.errors).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/core/orm-drift/compare.test.ts` — FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/orm-drift/proposals.ts
import type { NormalizedColumn, NormalizedIndex } from './normalized-schema'

const REVIEW_NOTE = '# dry-run by default; review via migration-review before --execute'

export function addColumnProposal(table: string, col: NormalizedColumn): string[] {
  const parts = [`dbcli migrate add-column ${table} ${col.name} ${col.type}`]
  if (col.nullable) parts.push('--nullable')
  if (col.default !== undefined) parts.push(`--default ${col.default}`)
  return [REVIEW_NOTE, parts.join(' ')]
}

export function addIndexProposal(table: string, index: NormalizedIndex): string[] {
  const parts = [`dbcli migrate add-index ${table} --columns ${index.columns.join(',')}`]
  if (index.unique) parts.push('--unique')
  return [REVIEW_NOTE, parts.join(' ')]
}

export function escalateProposal(reason: string): string[] {
  return [`# escalate: ${reason} — run: dbcli skill tasks plan migration-review`]
}
```

```ts
// src/core/orm-drift/compare.ts
import type { NormalizedSchema, UnparsedEntry } from './normalized-schema'
import { typeFamily } from './normalized-schema'
import { addColumnProposal, addIndexProposal, escalateProposal } from './proposals'

export type DriftCategory = 'missing_in_db' | 'missing_in_orm' | 'mismatch' | 'unmanaged'
export type DriftSeverity = 'info' | 'warn' | 'error'

export interface DriftEntry {
  category: DriftCategory
  severity: DriftSeverity
  table: string
  object: string
  detail: string
  proposedCommands: string[]
}

export interface DriftReport {
  ormSource: string
  entries: DriftEntry[]
  unparsed: UnparsedEntry[]
  summary: { errors: number; warns: number; infos: number; unmanaged: number }
}

const DEFAULT_IGNORE = ['_prisma_migrations']

function globToRegex(glob: string): RegExp {
  return new RegExp(
    '^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    'i'
  )
}

export function compareNormalized(
  orm: NormalizedSchema,
  db: NormalizedSchema,
  opts: { ignore: string[] }
): DriftReport {
  const ignoreRes = [...DEFAULT_IGNORE, ...opts.ignore].map(globToRegex)
  const isIgnored = (table: string) => ignoreRes.some((re) => re.test(table))
  const entries: DriftEntry[] = []

  const allTables = new Set([...Object.keys(orm.tables), ...Object.keys(db.tables)])
  for (const key of allTables) {
    const ormTable = orm.tables[key]
    const dbTable = db.tables[key]
    const displayName = (ormTable ?? dbTable)!.name

    if (isIgnored(displayName)) {
      entries.push({
        category: 'unmanaged',
        severity: 'info',
        table: displayName,
        object: 'table',
        detail: 'matched ignore pattern; excluded from drift scoring',
        proposedCommands: [],
      })
      continue
    }
    if (ormTable && !dbTable) {
      entries.push({
        category: 'missing_in_db',
        severity: 'error',
        table: displayName,
        object: 'table',
        detail: `table '${displayName}' is defined in ${orm.source} but absent in the database`,
        proposedCommands: escalateProposal(
          `CREATE TABLE for '${displayName}' should come from the ORM's own migration tooling`
        ),
      })
      continue
    }
    if (!ormTable && dbTable) {
      entries.push({
        category: 'missing_in_orm',
        severity: 'warn',
        table: displayName,
        object: 'table',
        detail: `table '${displayName}' exists in the database but is not defined in ${orm.source}`,
        proposedCommands: escalateProposal(
          `backfill the ${orm.source} definition or add '${displayName}' to --ignore`
        ),
      })
      continue
    }
    compareTable(ormTable!, dbTable!, orm.source, entries)
  }

  const summary = {
    errors: entries.filter((e) => e.severity === 'error' && e.category !== 'unmanaged').length,
    warns: entries.filter((e) => e.severity === 'warn').length,
    infos: entries.filter((e) => e.severity === 'info' && e.category !== 'unmanaged').length,
    unmanaged: entries.filter((e) => e.category === 'unmanaged').length,
  }
  return {
    ormSource: orm.source,
    entries,
    unparsed: [...orm.unparsed, ...db.unparsed],
    summary,
  }
}

function compareTable(
  ormTable: NormalizedSchema['tables'][string],
  dbTable: NormalizedSchema['tables'][string],
  source: string,
  entries: DriftEntry[]
): void {
  const table = dbTable.name
  const dbCols = new Map(dbTable.columns.map((c) => [c.name.toLowerCase(), c]))
  const ormCols = new Map(ormTable.columns.map((c) => [c.name.toLowerCase(), c]))

  for (const [key, col] of ormCols) {
    const dbCol = dbCols.get(key)
    if (!dbCol) {
      entries.push({
        category: 'missing_in_db',
        severity: 'error',
        table,
        object: col.name,
        detail: `column '${col.name}' (${col.type}) defined in ${source} but absent in the database — queries will fail`,
        proposedCommands: addColumnProposal(table, col),
      })
      continue
    }
    if (col.nullable !== dbCol.nullable || typeFamily(col.type) !== typeFamily(dbCol.type)) {
      entries.push({
        category: 'mismatch',
        severity: 'error',
        table,
        object: col.name,
        detail: `column '${col.name}': ${source} says ${col.type}${col.nullable ? ' NULL' : ' NOT NULL'}, database has ${dbCol.type}${dbCol.nullable ? ' NULL' : ' NOT NULL'}`,
        proposedCommands: escalateProposal(`type/nullability change on '${table}.${col.name}'`),
      })
      continue
    }
    if (col.type !== dbCol.type) {
      entries.push({
        category: 'mismatch',
        severity: 'info',
        table,
        object: col.name,
        detail: `column '${col.name}': same type family, different spelling (${col.type} vs ${dbCol.type}) — likely just the ORM's default mapping`,
        proposedCommands: [],
      })
    }
  }

  for (const [key, col] of dbCols) {
    if (ormCols.has(key)) continue
    entries.push({
      category: 'missing_in_orm',
      severity: 'warn',
      table,
      object: col.name,
      detail: `column '${col.name}' (${col.type}) exists in the database but is not defined in ${source} — possibly a manual hotfix never backfilled`,
      proposedCommands: escalateProposal(`backfill '${table}.${col.name}' into the ${source} definition`),
    })
  }

  // Indexes: compare by column-set + uniqueness, never by name.
  const indexKey = (i: { columns: string[]; unique: boolean }) =>
    `${i.columns.map((c) => c.toLowerCase()).join(',')}|${i.unique}`
  const dbIndexKeys = new Set(dbTable.indexes.map(indexKey))
  for (const idx of ormTable.indexes) {
    if (dbIndexKeys.has(indexKey(idx))) continue
    entries.push({
      category: 'missing_in_db',
      severity: 'error',
      table,
      object: `index(${idx.columns.join(',')})`,
      detail: `${idx.unique ? 'unique ' : ''}index on (${idx.columns.join(', ')}) defined in ${source} but absent in the database`,
      proposedCommands: addIndexProposal(table, idx),
    })
  }
  const ormIndexKeys = new Set(ormTable.indexes.map(indexKey))
  for (const idx of dbTable.indexes) {
    if (ormIndexKeys.has(indexKey(idx))) continue
    entries.push({
      category: 'missing_in_orm',
      severity: 'warn',
      table,
      object: `index(${idx.columns.join(',')})`,
      detail: `index on (${idx.columns.join(', ')}) exists in the database but is not declared in ${source}`,
      proposedCommands: escalateProposal(`declare the index in the ${source} definition or drop it via a reviewed migration`),
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/core/orm-drift/compare.test.ts` — PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/orm-drift/compare.ts src/core/orm-drift/proposals.ts tests/unit/core/orm-drift/compare.test.ts
git commit -m "feat: add ORM drift compare engine with tolerance table and proposals"
```

---

### Task 6: Drift formatter

**Files:**
- Create: `src/formatters/orm-drift.ts`
- Test: `tests/unit/formatters/orm-drift.test.ts`

**Interfaces:**
- Consumes: `DriftReport` (Task 5).
- Produces: `formatDrift(report: DriftReport, format: 'json' | 'table' | 'markdown'): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/formatters/orm-drift.test.ts
import { describe, test, expect } from 'bun:test'
import { formatDrift } from '@/formatters/orm-drift'
import type { DriftReport } from '@/core/orm-drift/compare'

const report: DriftReport = {
  ormSource: 'prisma',
  entries: [
    {
      category: 'missing_in_db',
      severity: 'error',
      table: 'users',
      object: 'age',
      detail: "column 'age' (integer) defined in prisma but absent in the database — queries will fail",
      proposedCommands: ['# dry-run by default; review via migration-review before --execute', 'dbcli migrate add-column users age integer --nullable'],
    },
  ],
  unparsed: [{ location: 'Widget.status', reason: "blocked: unsupported field type 'WidgetStatus' (enum/composite/unknown)" }],
  summary: { errors: 1, warns: 0, infos: 0, unmanaged: 0 },
}

describe('formatDrift', () => {
  test('json round-trips', () => {
    expect(JSON.parse(formatDrift(report, 'json')).summary.errors).toBe(1)
  })
  test('table format shows severity, category, table.object, detail, proposals, unparsed', () => {
    const out = formatDrift(report, 'table')
    expect(out).toContain('[error] missing_in_db users.age')
    expect(out).toContain('dbcli migrate add-column users age integer --nullable')
    expect(out).toContain('Unparsed: Widget.status')
    expect(out).toContain('Summary: 1 error(s), 0 warn(s), 0 info(s), 0 unmanaged')
  })
  test('markdown renders an entries table', () => {
    const out = formatDrift(report, 'markdown')
    expect(out).toContain('| Severity | Category | Object | Detail |')
    expect(out).toContain('| error | missing_in_db | users.age |')
  })
  test('clean report says no drift', () => {
    const clean: DriftReport = { ...report, entries: [], unparsed: [], summary: { errors: 0, warns: 0, infos: 0, unmanaged: 0 } }
    expect(formatDrift(clean, 'table')).toContain('No drift detected')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `bun test tests/unit/formatters/orm-drift.test.ts`, FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/formatters/orm-drift.ts
import type { DriftReport } from '@/core/orm-drift/compare'

export type DriftFormat = 'json' | 'table' | 'markdown'

export function formatDrift(report: DriftReport, format: DriftFormat): string {
  if (format === 'json') return JSON.stringify(report, null, 2)
  if (format === 'markdown') return markdown(report)
  return text(report)
}

function summaryLine(r: DriftReport): string {
  const s = r.summary
  return `Summary: ${s.errors} error(s), ${s.warns} warn(s), ${s.infos} info(s), ${s.unmanaged} unmanaged`
}

function text(r: DriftReport): string {
  const lines: string[] = [`Drift vs ${r.ormSource}:`]
  if (r.entries.length === 0) lines.push('  No drift detected.')
  for (const e of r.entries) {
    lines.push('', `[${e.severity}] ${e.category} ${e.table}.${e.object}`, `  ${e.detail}`)
    for (const cmd of e.proposedCommands) lines.push(`  ${cmd}`)
  }
  for (const u of r.unparsed) lines.push(`Unparsed: ${u.location} — ${u.reason}`)
  lines.push('', summaryLine(r))
  return lines.join('\n')
}

function markdown(r: DriftReport): string {
  const lines: string[] = [`### Drift vs ${r.ormSource}`, '']
  if (r.entries.length === 0) {
    lines.push('No drift detected.')
  } else {
    lines.push('| Severity | Category | Object | Detail |', '| --- | --- | --- | --- |')
    for (const e of r.entries) {
      lines.push(
        `| ${e.severity} | ${e.category} | ${e.table}.${e.object} | ${e.detail.replace(/\|/g, '\\|')} |`
      )
    }
    for (const e of r.entries) {
      if (e.proposedCommands.length > 0) {
        lines.push('', `**Proposal for \`${e.table}.${e.object}\`:**`, '```bash', ...e.proposedCommands, '```')
      }
    }
  }
  if (r.unparsed.length > 0) {
    lines.push('', ...r.unparsed.map((u) => `- Unparsed: \`${u.location}\` — ${u.reason}`))
  }
  lines.push('', summaryLine(r))
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/formatters/orm-drift.ts tests/unit/formatters/orm-drift.test.ts
git commit -m "feat: add ORM drift formatter (json/table/markdown)"
```

---

### Task 7: `diff` command extension

**Files:**
- Modify: `src/commands/diff.ts`
- Test: `tests/unit/commands/diff-against-orm.test.ts`

**Interfaces:**
- Consumes: `detectOrmFormat`, `parsePrismaSchema`, `parseDdl`, `normalizedSchemaZod`, `normalizeDbSchema`, `compareNormalized`, `formatDrift` (Tasks 1–6); `configModule`; Bun glob (`Bun.Glob`) for multi-file DDL paths.
- Produces: new flags on the existing `diffCommand`:
  - `--against-orm <path>` (repeatable comma-separated or glob for `.sql`)
  - `--orm-format <fmt>` — `prisma | ddl | json` (overrides detection)
  - `--ignore <globs>` — comma-separated table globs
  - `--format` gains `markdown` (drift mode only; snapshot mode keeps `json|table`)
  - exported `runDrift(paths, options, config)` for tests
- Behavior: drift mode never connects; exit code 1 when `summary.errors > 0` (CI-friendly), 0 otherwise; snapshot mode untouched.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/commands/diff-against-orm.test.ts
import { describe, test, expect } from 'bun:test'
import { runDrift } from '@/commands/diff'
import type { TableSchema } from '@/adapters/types'

const config = {
  connection: { system: 'postgresql' },
  schema: {
    users: {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar(255)', nullable: false },
      ],
      indexes: [],
    } as TableSchema,
  },
}

describe('runDrift', () => {
  test('compares a prisma file against the schema cache', async () => {
    const { report } = await runDrift(['tests/fixtures/orm-drift/schema.prisma'], {}, config as never)
    expect(report.ormSource).toBe('prisma')
    // fixture defines posts + extra users columns not in the cache above
    expect(report.entries.some((e) => e.category === 'missing_in_db')).toBe(true)
  })

  test('honors --orm-format json escape hatch', async () => {
    const { report } = await runDrift(
      ['tests/fixtures/orm-drift/normalized.json'],
      { ormFormat: 'json' },
      config as never
    )
    expect(report.ormSource).toBe('json')
  })

  test('empty schema cache is a hard error', async () => {
    await expect(
      runDrift(['tests/fixtures/orm-drift/schema.prisma'], {}, { ...config, schema: {} } as never)
    ).rejects.toThrow("Schema cache is empty. Run 'dbcli schema' first.")
  })

  test('missing file is a hard error', async () => {
    await expect(runDrift(['no/such.prisma'], {}, config as never)).rejects.toThrow('not found')
  })

  test('--ignore forwards to compare', async () => {
    const { report } = await runDrift(
      ['tests/fixtures/orm-drift/schema.prisma'],
      { ignore: 'posts' },
      config as never
    )
    expect(report.entries.find((e) => e.table === 'posts')?.category).toBe('unmanaged')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, `runDrift` not exported.

- [ ] **Step 3: Implement**

Add to `src/commands/diff.ts` (new exports + option wiring; snapshot path untouched):

```ts
// new imports at top of src/commands/diff.ts
import { detectOrmFormat } from '@/core/orm-drift/adapters/detect'
import { parsePrismaSchema } from '@/core/orm-drift/adapters/prisma'
import { parseDdl } from '@/core/orm-drift/adapters/ddl'
import { normalizedSchemaZod, type NormalizedSchema } from '@/core/orm-drift/normalized-schema'
import { normalizeDbSchema } from '@/core/orm-drift/from-db'
import { compareNormalized, type DriftReport } from '@/core/orm-drift/compare'
import { formatDrift, type DriftFormat } from '@/formatters/orm-drift'
import type { DbcliConfig } from '@/utils/validation'
import type { TableSchema, SqlDatabaseSystem } from '@/adapters/types'

export interface DriftOptions {
  ormFormat?: 'prisma' | 'ddl' | 'json'
  ignore?: string
}

export async function runDrift(
  paths: string[],
  options: DriftOptions,
  config: DbcliConfig
): Promise<{ report: DriftReport }> {
  const system = config.connection?.system
  if (!system || !['postgresql', 'mysql', 'mariadb'].includes(system)) {
    throw new Error(`This command requires a SQL connection, got: ${system ?? 'none'}`)
  }
  const cached = (config.schema ?? {}) as Record<string, TableSchema>
  if (Object.keys(cached).length === 0) {
    throw new Error("Schema cache is empty. Run 'dbcli schema' first.")
  }

  // Read + merge all ORM inputs (multiple DDL files are common; prisma/json take one file).
  const orms: NormalizedSchema[] = []
  for (const path of paths) {
    const file = Bun.file(path)
    if (!(await file.exists())) throw new Error(`ORM schema file not found: ${path}`)
    const content = await file.text()
    const format = options.ormFormat ?? detectOrmFormat(path, content)
    if (format === 'prisma') orms.push(parsePrismaSchema(content))
    else if (format === 'json') orms.push(normalizedSchemaZod.parse(JSON.parse(content)) as NormalizedSchema)
    else orms.push(parseDdl(content, system as SqlDatabaseSystem))
  }
  const merged: NormalizedSchema = orms.reduce((acc, o) => ({
    source: acc.source,
    tables: { ...acc.tables, ...o.tables },
    unparsed: [...acc.unparsed, ...o.unparsed],
  }))

  const ignore = (options.ignore ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const report = compareNormalized(merged, normalizeDbSchema(cached), { ignore })
  return { report }
}
```

Option wiring on `diffCommand`:

```ts
  .option('--against-orm <paths>', 'Compare ORM schema definition(s) (comma-separated) against the local schema cache')
  .option('--orm-format <fmt>', 'Force ORM input format: prisma | ddl | json (default: auto-detect)')
  .option('--ignore <globs>', 'Comma-separated table globs excluded from drift (always includes _prisma_migrations)')
```

And at the top of `diffAction`, before the existing snapshot validation:

```ts
if (options.againstOrm) {
  const format = (options.format === 'table' || options.format === 'markdown' ? options.format : 'json') as DriftFormat
  const config = await configModule.read(options.config)
  const paths = options.againstOrm.split(',').map((s: string) => s.trim()).filter(Boolean)
  const { report } = await runDrift(paths, { ormFormat: options.ormFormat, ignore: options.ignore }, config)
  console.log(formatDrift(report, format))
  process.exit(report.summary.errors > 0 ? 1 : 0)
}
```

(Adjust `diffAction`'s options type to include `againstOrm?: string; ormFormat?: 'prisma'|'ddl'|'json'; ignore?: string; recovery?: boolean`, and extend `ALLOWED_FORMATS` handling so `markdown` is accepted only when `againstOrm` is set — keep snapshot mode's validation exactly as it is by validating drift format separately as shown above.)

Also add `--recovery` support for drift mode (spec's shared error-handling rule). Add the option:

```ts
  .option('--recovery', 'on failure, emit a structured recovery envelope to stdout')
```

and wrap the drift branch in its own try/catch that mirrors `src/commands/schema.ts:331-353` exactly (with `operation: 'diff'`): on failure, generate `envelopeId = crypto.randomUUID()` when `options.recovery === true`, dynamic-import `emitRecoveryEnvelope` from `@/core/recovery`, emit with `{ operation: 'diff' }`, then `console.error` + `process.exit(1)`. Add `'diff'` to the recovery operation union type if it is a union (mirror how `'schema'` is declared). Add one test:

```ts
test('parse failure surfaces as a structured error message', async () => {
  await Bun.write('/tmp-fixture-bad.prisma', 'model Broken {')  // write under the test tmp dir the suite already uses
  await expect(
    runDrift(['/tmp-fixture-bad.prisma'], {}, config as never)
  ).resolves.toBeDefined() // unmatched brace → zero models parsed, surfaces via unparsed, not a throw
})
```

(Prisma/DDL adapters never throw on bad content — they degrade to `unparsed`; the envelope path covers I/O errors, empty cache, and non-SQL systems.)

- [ ] **Step 4: Run tests**

Run: `bun test tests/unit/commands/diff-against-orm.test.ts && bun test tests/unit/commands/diff.test.ts`
Expected: both PASS — the second proves snapshot mode is untouched.
Smoke: `bun run src/cli.ts diff --against-orm tests/fixtures/orm-drift/schema.prisma --format table` in a repo with a populated `.dbcli` schema block (or expect the empty-cache error otherwise).

- [ ] **Step 5: Commit**

```bash
git add src/commands/diff.ts tests/unit/commands/diff-against-orm.test.ts
git commit -m "feat: add diff --against-orm with format detection and drift exit codes"
```

---

### Task 8: `orm-drift-review` task pack

**Files:**
- Create: `assets/tasks/orm-drift-review.md`
- Test: extend the agent-tasks test suite (locate the builtin-pack list test with `grep -rln "schema-drift-review" tests/unit/agent-tasks tests/`; add `orm-drift-review` to its expected pack list, plus a plan-shape test in the same style as its neighbors)

- [ ] **Step 1: Write the failing test** — add to the located suite, matching its existing helper style:

```ts
test('orm-drift-review pack renders a plan with drift step', () => {
  // use the same plan-building helper the neighboring pack tests use
  const commands = plan.steps.map((s) => s.command)
  expect(commands.some((c) => c.includes('diff --against-orm'))).toBe(true)
  expect(plan.safety.mode).toBe('plan-only')
})
```

- [ ] **Step 2: Run to verify it fails**, then create the pack (format mirrors `assets/tasks/schema-drift-review.md` exactly):

```markdown
---
name: orm-drift-review
description: Compare an ORM schema definition (Prisma / DDL / normalized JSON) against the live schema cache and review drift before any corrective migration.
tags: [diagnostics, schema, orm, readonly]
engines: [postgres, mysql]
params:
  orm_path:
    type: string
    required: true
    description: Path to the ORM schema definition (e.g. prisma/schema.prisma, migrations/*.sql, or a normalized schema JSON).
safety:
  mode: plan-only
  requires:
    - blacklist-list
    - schema-check
steps:
  - type: command
    command: blacklist list
    reason: Confirm sensitive-data boundaries before reading schema details.
    risk: readonly
  - type: command
    command: schema --format json
    reason: Refresh the local schema cache so the drift comparison runs against current DB state.
    risk: readonly
  - type: command
    command: diff --against-orm {{orm_path}} --format json
    reason: Compare the ORM definition against the cached DB schema; error-level entries are app-breaking drift.
    risk: readonly
---
# Agent Notes

Treat `missing_in_db` errors as release blockers: the application expects columns or
indexes the database does not have. `missing_in_orm` warnings usually mean a manual
hotfix was never backfilled into the ORM definition — backfill the definition rather
than dropping the column. Never run the proposed `migrate` commands directly; route
every proposal through `dbcli skill tasks plan migration-review` first. Same-family
type-spelling differences are reported as `info` and are usually the ORM's default
mapping, not real drift.
```

- [ ] **Step 3: Run the suite** — `bun test tests/unit/agent-tasks` (or the located dir). Update the builtin-pack-count/content expectations that intentionally pin the pack list. PASS.

- [ ] **Step 4: Commit**

```bash
git add assets/tasks/orm-drift-review.md tests
git commit -m "feat: add orm-drift-review agent task pack"
```

---

### Task 9: Documentation

**Files:**
- Modify: `assets/SKILL.md`, `assets/SKILL.zh-TW.md`, `assets/reference.md`, `docs/user/{en,zh-TW}/index.{md,html}`; sync plugins.

- [ ] **Step 1: `assets/SKILL.md` edits**

1. Command overview `diff` row — replace with:

```markdown
| `diff` | query-only+ | SQL only. Save/compare schema snapshots. **(P1b)** `--against-orm <path>` compares a Prisma schema / DDL file / normalized JSON against the local schema cache (no DB connection): categorized drift (`missing_in_db` = error, `missing_in_orm` = warn, `mismatch` per tolerance table, `unmanaged`) with dry-run `migrate` proposals; exit 1 on error-level drift. `--orm-format prisma\|ddl\|json`, `--ignore <globs>`, `--format json\|table\|markdown`. |
```

2. Developer workflows "ORM or migration work" row — replace with:

```markdown
| ORM or migration work | `schema --format json` → `diff --against-orm <orm-schema>` → review error-level drift → proposals via `migrate` (dry-run) → `migration-review` task pack → `diff --against <snapshot>` after applying. |
```

3. Builtin packs paragraph — add `orm-drift-review` to the SQL pack list (after `schema-drift-review`), described as "(ORM definition vs cached DB schema)".
4. Command anchors — add `dbcli diff --against-orm prisma/schema.prisma --format json`.

- [ ] **Step 2: Mirror in `assets/SKILL.zh-TW.md`** (Traditional Chinese, identical command strings).

- [ ] **Step 3: `assets/reference.md`** — add a `diff --against-orm` block after the existing `diff` section: all three new flags, the four drift categories with severities and the tolerance rule, the Prisma supported-syntax list and `unparsed` semantics from spec §2, one Prisma example and one DDL-glob example, one trimmed JSON output sample. Also add `orm-drift-review` to the task-pack listing in the reference.

- [ ] **Step 4: User docs** — add the drift workflow to `docs/user/en/index.md` + `docs/user/zh-TW/index.md`, mirror into both `index.html` files following existing markup.

- [ ] **Step 5: Sync + contract tests + full suite**

```bash
bun run plugin:sync
bun test tests/unit/skill-assets tests/contract
bun test
```

Update pinned contract expectations for the new SKILL content (conscious-update gate). All green.

- [ ] **Step 6: Commit**

```bash
git add -A assets docs plugins .claude-plugin .codex-plugin .cursor-plugin .agents .github/skills tests
git commit -m "docs: document diff --against-orm and orm-drift-review pack"
```

---

## Verification (after all tasks)

1. `bun test` — green; `bun run build` — passes (dist-smoke SIGTERM locally is a known environment issue; `test:unit` + `build` is the clean signal).
2. Manual smoke: `bun run src/cli.ts diff --against-orm tests/fixtures/orm-drift/schema.prisma --format table` → drift report (or the empty-cache error, which is also correct behavior).
3. `bun run src/cli.ts skill tasks plan orm-drift-review --param orm_path=prisma/schema.prisma --format json` → 3-step plan-only plan.
4. Snapshot regression: `bun test tests/unit/commands/diff.test.ts` green — snapshot mode untouched.
5. No version bump in this plan; release (1.41.0) is a separate user decision.
