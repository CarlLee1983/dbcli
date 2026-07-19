# Case-Sensitive Schema Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace lowercased ORM-drift table storage with exact schema/table identities, preserve parsed SQL quote state, and complete the outstanding Task 5 proposal/review fixes.

**Architecture:** `NormalizedSchema.tables` becomes an array of tables with explicit exact identities. Parsed SQL identifiers retain quote metadata and resolve through one helper; catalog identities remain exact facts with no inferred quoting. The compare engine uses collision-free exact identity keys, retains structured proposal subjects, deduplicates indexes, shell-quotes generated commands, and emits stable output.

**Tech Stack:** Bun + TypeScript ESM, zod 3, node-sql-parser 5, PostgreSQL `pg`, `bun test`.

## Global Constraints

- Schema storage preserves exact schema and table names returned by the database catalog.
- Unquoted SQL schema/table identifiers fold to lowercase during resolution; quoted identifiers match exactly.
- Quote state comes only from parsed identifier syntax and is never inferred from display text or catalog spelling.
- Quote-aware lookup applies to schema/table identity only; column identifiers remain on the existing P1b contract.
- Unknown or lossy syntax is reported through `unparsed` with `blocked:` semantics; never guess.
- ORM drift never connects to the database and never executes proposed commands.
- Snapshot-mode `dbcli diff --snapshot` / `--against` behavior remains byte-for-byte unchanged.
- Imports use `@/` aliases, ESM, and named exports. Use Bun commands.
- Conventional commits with no attribution footer.

## File Structure

```text
src/core/orm-drift/
  normalized-schema.ts       # exact identity and parsed-identifier types + zod
  table-identity.ts          # resolve/key/display helpers
  from-db.ts                 # cache → array-based NormalizedSchema
  adapters/prisma.ts         # exact Prisma physical identities
  adapters/ddl.ts            # quote-aware parsed table identities
  compare.ts                 # exact identity comparison + stable ordering
  proposals.ts               # structural subjects + shell-safe commands
src/adapters/types.ts        # TableSchema.schema
src/adapters/postgresql-adapter.ts # exact catalog schema propagation
```

---

### Task 1: Migrate Task 1–4 to exact schema/table identity

**Files:**
- Create: `src/core/orm-drift/table-identity.ts`
- Modify: `src/core/orm-drift/normalized-schema.ts`
- Modify: `src/core/orm-drift/from-db.ts`
- Modify: `src/core/orm-drift/adapters/prisma.ts`
- Modify: `src/core/orm-drift/adapters/ddl.ts`
- Modify: `src/adapters/types.ts`
- Modify: `src/adapters/postgresql-adapter.ts`
- Modify: `tests/unit/core/orm-drift/normalized-schema.test.ts`
- Modify: `tests/unit/core/orm-drift/from-db.test.ts`
- Modify: `tests/unit/core/orm-drift/prisma-adapter.test.ts`
- Modify: `tests/unit/core/orm-drift/ddl-adapter.test.ts`
- Modify: `tests/fixtures/orm-drift/normalized.json`
- Create: `tests/unit/adapters/postgresql-schema-identity.test.ts`

**Interfaces:**

```ts
export interface NormalizedTableIdentity {
  schema?: string
  table: string
}

export interface ParsedIdentifierPart {
  value: string
  quoted: boolean
}

export interface ParsedTableIdentifier {
  schema?: ParsedIdentifierPart
  table: ParsedIdentifierPart
}

export interface NormalizedTable {
  identity: NormalizedTableIdentity
  parsedIdentifier?: ParsedTableIdentifier
  columns: NormalizedColumn[]
  indexes: NormalizedIndex[]
  foreignKeys: NormalizedForeignKey[]
}

export interface NormalizedSchema {
  source: OrmSource
  defaultSchema?: string
  tables: NormalizedTable[]
  unparsed: UnparsedEntry[]
}

export function resolveTableIdentifier(
  parsed: ParsedTableIdentifier,
  defaultSchema?: string
): NormalizedTableIdentity
export function tableIdentityKey(identity: NormalizedTableIdentity): string
export function qualifiedTableName(identity: NormalizedTableIdentity): string
```

- [ ] **Step 1: Write failing identity and zod tests**

Add these assertions to `tests/unit/core/orm-drift/normalized-schema.test.ts`:

```ts
import {
  qualifiedTableName,
  resolveTableIdentifier,
  tableIdentityKey,
} from '@/core/orm-drift/table-identity'

test('unquoted identifiers fold while quoted identifiers remain exact', () => {
  expect(
    resolveTableIdentifier(
      { schema: { value: 'Public', quoted: false }, table: { value: 'Users', quoted: false } },
      'ignored',
    ),
  ).toEqual({ schema: 'public', table: 'users' })

  expect(
    resolveTableIdentifier(
      { schema: { value: 'Public', quoted: true }, table: { value: 'Users', quoted: true } },
      'ignored',
    ),
  ).toEqual({ schema: 'Public', table: 'Users' })
})

test('unqualified parsed identifiers use the exact default schema', () => {
  expect(
    resolveTableIdentifier({ table: { value: 'Users', quoted: false } }, 'public'),
  ).toEqual({ schema: 'public', table: 'users' })
})

test('identity keys do not merge case-distinct or dotted components', () => {
  expect(tableIdentityKey({ schema: 'public', table: 'users' })).not.toBe(
    tableIdentityKey({ schema: 'public', table: 'Users' }),
  )
  expect(tableIdentityKey({ schema: 'a.b', table: 'c' })).not.toBe(
    tableIdentityKey({ schema: 'a', table: 'b.c' }),
  )
  expect(qualifiedTableName({ schema: 'public', table: 'Users' })).toBe('public.Users')
})

test('zod accepts exact array identities and requires quote flags when parsed', () => {
  const parsed = normalizedSchemaZod.parse({
    source: 'json',
    defaultSchema: 'public',
    tables: [
      {
        identity: { schema: 'public', table: 'Users' },
        parsedIdentifier: { table: { value: 'Users', quoted: true } },
        columns: [],
        indexes: [],
        foreignKeys: [],
      },
    ],
    unparsed: [],
  })
  expect(parsed.tables[0]?.identity.table).toBe('Users')
  expect(() =>
    normalizedSchemaZod.parse({
      source: 'json',
      tables: [
        {
          identity: { table: 'Users' },
          parsedIdentifier: { table: { value: 'Users' } },
          columns: [],
          indexes: [],
          foreignKeys: [],
        },
      ],
      unparsed: [],
    }),
  ).toThrow()
})
```

- [ ] **Step 2: Write failing DB-cache coexistence tests**

Replace the lowercase-record assertions in `from-db.test.ts` with exact array identity checks:

```ts
test('preserves case-distinct catalog identities without quote inference', () => {
  const out = normalizeDbSchema(
    {
      lower: { name: 'users', schema: 'public', columns: [] },
      quoted: { name: 'Users', schema: 'public', columns: [] },
    },
    { defaultSchema: 'public' },
  )

  expect(out.defaultSchema).toBe('public')
  expect(out.tables.map((table) => table.identity)).toEqual([
    { schema: 'public', table: 'users' },
    { schema: 'public', table: 'Users' },
  ])
  expect(out.tables.every((table) => table.parsedIdentifier === undefined)).toBe(true)
})
```

- [ ] **Step 3: Write failing DDL resolution tests**

Add to `ddl-adapter.test.ts`:

```ts
test('preserves parsed quote state and keeps users and quoted Users distinct', () => {
  const out = parseDdl(
    'CREATE TABLE users (id INTEGER); CREATE TABLE "Users" (id INTEGER);',
    'postgresql',
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
    'postgresql',
  )
  expect(out.tables.map((table) => table.identity.table)).toEqual(['users', 'Users'])
})

test('preserves quote state for schema-qualified table identities', () => {
  const out = parseDdl(
    'CREATE TABLE Tenant.Users (id INTEGER); CREATE TABLE "Tenant"."Users" (id INTEGER);',
    'postgresql',
  )
  expect(out.tables.map((table) => table.identity)).toEqual([
    { schema: 'tenant', table: 'users' },
    { schema: 'Tenant', table: 'Users' },
  ])
})
```

- [ ] **Step 4: Write the PostgreSQL catalog propagation test**

In `postgresql-schema-identity.test.ts`, replace the adapter's public `execute`
method with a row fixture and set a non-null pool sentinel so `listTables` reaches
the catalog mapping:

```ts
import { expect, test } from 'bun:test'
import { PostgreSQLAdapter } from '@/adapters/postgresql-adapter'

test('listTables preserves exact catalog schema and table names', async () => {
  const adapter = new PostgreSQLAdapter({
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'test',
  })
  ;(adapter as unknown as { pool: object }).pool = {}
  adapter.execute = async () => ({
    rows: [
      {
        schema_name: 'Public',
        table_name: 'Users',
        estimated_rows: 0,
        table_type: 'table',
        column_count: 1,
      },
    ],
    affectedRows: 0,
  })

  expect(await adapter.listTables()).toContainEqual(
    expect.objectContaining({ schema: 'Public', name: 'Users' }),
  )
})
```

- [ ] **Step 5: Run RED tests**

Run:

```bash
bun test tests/unit/core/orm-drift/normalized-schema.test.ts \
  tests/unit/core/orm-drift/from-db.test.ts \
  tests/unit/core/orm-drift/ddl-adapter.test.ts \
  tests/unit/adapters/postgresql-schema-identity.test.ts
```

Expected: FAIL because identity types/helpers do not exist and `tables` is still a record.

- [ ] **Step 6: Implement the exact identity primitives**

Create `table-identity.ts`:

```ts
import type {
  NormalizedTableIdentity,
  ParsedIdentifierPart,
  ParsedTableIdentifier,
} from '@/core/orm-drift/normalized-schema'

function resolvePart(part: ParsedIdentifierPart): string {
  return part.quoted ? part.value : part.value.toLowerCase()
}

export function resolveTableIdentifier(
  parsed: ParsedTableIdentifier,
  defaultSchema?: string,
): NormalizedTableIdentity {
  return {
    ...(parsed.schema
      ? { schema: resolvePart(parsed.schema) }
      : defaultSchema !== undefined
        ? { schema: defaultSchema }
        : {}),
    table: resolvePart(parsed.table),
  }
}

export function tableIdentityKey(identity: NormalizedTableIdentity): string {
  return JSON.stringify([identity.schema ?? null, identity.table])
}

export function qualifiedTableName(identity: NormalizedTableIdentity): string {
  return identity.schema === undefined ? identity.table : `${identity.schema}.${identity.table}`
}
```

Update `normalized-schema.ts` and its zod schemas to the interfaces above.
`NormalizedForeignKey.refTable` becomes `NormalizedTableIdentity`, with optional
`parsedRefIdentifier?: ParsedTableIdentifier`.

- [ ] **Step 7: Migrate DB and PostgreSQL catalog normalization**

Add `schema?: string` to `TableSchema`. Change `normalizeDbSchema` to:

```ts
export function normalizeDbSchema(
  schema: Record<string, TableSchema>,
  options: { defaultSchema?: string } = {},
): NormalizedSchema {
  return {
    source: 'db',
    ...(options.defaultSchema !== undefined && { defaultSchema: options.defaultSchema }),
    tables: Object.values(schema).map((table) => ({
      identity: {
        ...(table.schema !== undefined && { schema: table.schema }),
        table: table.name,
      },
      columns: table.columns.map((column) => ({
        name: column.name,
        type: column.type.toLowerCase(),
        rawType: column.type,
        nullable: column.nullable,
        ...(column.default !== undefined &&
          column.default !== 'NULL' && { default: column.default }),
        ...(column.primaryKey && { primaryKey: true }),
      })),
      indexes: (table.indexes ?? []).map((index) => ({
        name: index.name,
        columns: index.columns,
        unique: Boolean(index.unique),
      })),
      foreignKeys: (table.foreignKeys ?? []).map((foreignKey) => ({
        columns: foreignKey.columns,
        refTable: {
          ...(foreignKey.refSchema !== undefined && { schema: foreignKey.refSchema }),
          table: foreignKey.refTable,
        },
        refColumns: foreignKey.refColumns,
      })),
    })),
    unparsed: [],
  }
}
```

Add `refSchema?: string` beside `refTable` in `TableSchema.foreignKeys`. Select
`n.nspname AS schema_name` in PostgreSQL `listTables` and map it to
`TableSchema.schema`. Include `schema: 'public'` in `getTableSchema` while its
catalog queries remain explicitly scoped to `public`; select
`ccu.table_schema AS ref_schema` in the FK query and map it to `refSchema`.

- [ ] **Step 8: Migrate Prisma, DDL, fixtures, and focused tests**

Prisma outputs array tables with exact physical mappings:

```ts
tables.push({
  identity: { table: tableName },
  columns,
  indexes,
  foreignKeys,
})
```

DDL must tokenize the original table target and build a
`ParsedTableIdentifier`; do not derive `quoted` from the AST value. Resolve it
with `resolveTableIdentifier`, retain it as `parsedIdentifier`, and block the
statement if the original target cannot be parsed losslessly. Update table and
index lookup maps to use `tableIdentityKey`.

Use a cursor-based parser with these concrete rules:

```ts
interface IdentifierCursor {
  identifier: ParsedTableIdentifier
  end: number
}

function readIdentifierPart(
  input: string,
  start: number,
): { part: ParsedIdentifierPart; end: number } | null {
  let cursor = start
  while (/\s/.test(input[cursor] ?? '')) cursor += 1
  const quote = input[cursor]

  if (quote === '"' || quote === '`') {
    cursor += 1
    let value = ''
    while (cursor < input.length) {
      const character = input[cursor]
      if (character === quote && input[cursor + 1] === quote) {
        value += quote
        cursor += 2
        continue
      }
      if (character === quote) {
        return value.length > 0
          ? { part: { value, quoted: true }, end: cursor + 1 }
          : null
      }
      value += character
      cursor += 1
    }
    return null
  }

  const match = input.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_$]*/)
  return match
    ? { part: { value: match[0], quoted: false }, end: cursor + match[0].length }
    : null
}

function readTableIdentifier(input: string, start: number): IdentifierCursor | null {
  const first = readIdentifierPart(input, start)
  if (!first) return null
  let cursor = first.end
  while (/\s/.test(input[cursor] ?? '')) cursor += 1
  if (input[cursor] !== '.') return { identifier: { table: first.part }, end: cursor }
  const second = readIdentifierPart(input, cursor + 1)
  if (!second) return null
  return {
    identifier: { schema: first.part, table: second.part },
    end: second.end,
  }
}
```

For `CREATE TABLE`, consume `CREATE TABLE` and optional `IF NOT EXISTS`, then call
`readTableIdentifier`. For `CREATE INDEX`, consume `CREATE`, optional `UNIQUE`,
`INDEX`, one index identifier, `ON`, then call `readTableIdentifier`. Keyword
consumption must be case-insensitive and require a non-identifier boundary.
Validate the resolved parsed target against the AST target; disagreement is a
`blocked:` parse result rather than choosing either representation.

Change `normalized.json` to:

```json
{
  "source": "json",
  "tables": [
    {
      "identity": { "table": "users" },
      "columns": [{ "name": "id", "type": "integer", "nullable": false, "primaryKey": true }],
      "indexes": [],
      "foreignKeys": []
    }
  ],
  "unparsed": []
}
```

Replace all Task 1–4 test record lookups such as `out.tables.users` with
identity-based array lookups.

- [ ] **Step 9: Run GREEN verification**

Run:

```bash
bun test tests/unit/core/orm-drift/normalized-schema.test.ts \
  tests/unit/core/orm-drift/from-db.test.ts \
  tests/unit/core/orm-drift/prisma-adapter.test.ts \
  tests/unit/core/orm-drift/ddl-adapter.test.ts \
  tests/unit/adapters/postgresql-schema-identity.test.ts
bun run typecheck
bunx eslint src/core/orm-drift src/adapters/types.ts src/adapters/postgresql-adapter.ts \
  tests/unit/core/orm-drift tests/unit/adapters/postgresql-schema-identity.test.ts \
  --max-warnings=0
```

Expected: all focused tests pass; typecheck and lint exit 0.

- [ ] **Step 10: Run the full suite and commit**

```bash
bun test
git add src/core/orm-drift src/adapters/types.ts src/adapters/postgresql-adapter.ts \
  tests/unit/core/orm-drift tests/unit/adapters/postgresql-schema-identity.test.ts \
  tests/fixtures/orm-drift/normalized.json
git commit -m "refactor: preserve exact ORM schema identities"
```

---

### Task 2: Complete Task 5 comparison and proposal hardening

**Files:**
- Modify: `src/core/orm-drift/compare.ts`
- Modify: `src/core/orm-drift/proposals.ts`
- Modify: `tests/unit/core/orm-drift/compare.test.ts`

**Interfaces:**

```ts
export type ProposalSubject =
  | { kind: 'column'; column: NormalizedColumn }
  | { kind: 'index'; index: NormalizedIndex }

export function proposalsFor(
  entry: Omit<DriftEntry, 'proposedCommands'>,
  subject?: ProposalSubject,
): string[]
```

- [ ] **Step 0: Replace the compare-test fixtures with array helpers**

Define these helpers at the top of `compare.test.ts` so every later test uses the
new contract:

```ts
function table(
  identity: NormalizedTableIdentity,
  overrides: Partial<Omit<NormalizedTable, 'identity'>> = {},
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
  overrides: Partial<Omit<DriftEntry, 'proposedCommands'>> = {},
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
```

- [ ] **Step 1: Write failing exact-identity comparison tests**

Use array-based schema fixtures and add:

```ts
test('case-distinct DB tables coexist and match exact ORM identities', () => {
  const db = dbWith([
    table({ schema: 'public', table: 'users' }),
    table({ schema: 'public', table: 'Users' }),
  ], 'public')
  const orm = schemaWith([
    table({ table: 'users' }),
    table({ table: 'Users' }),
  ])
  expect(compareNormalized(orm, db, { ignore: [] }).entries).toEqual([])
})

test('case-sensitive ignore does not hide a distinct table', () => {
  const report = compareNormalized(
    schemaWith([]),
    dbWith([table({ schema: 'public', table: 'users' }), table({ schema: 'public', table: 'Users' })], 'public'),
    { ignore: ['public.Users'] },
  )
  expect(report.entries.find((entry) => entry.table === 'public.Users')?.category).toBe('unmanaged')
  expect(report.entries.find((entry) => entry.table === 'public.users')?.category).toBe('missing_in_orm')
})
```

- [ ] **Step 2: Write failing structural proposal and shell-quoting tests**

```ts
test('index proposals use structural data, not display text', () => {
  const entry = driftEntry({
    object: 'index(unique index,email)',
    detail: 'display prose says unique index but structure is authoritative',
  })
  expect(
    proposalsFor(entry, {
      kind: 'index',
      index: { columns: ['unique index', 'email,backup'], unique: false },
    }),
  ).toEqual([
    REVIEW_NOTE,
    `dbcli migrate add-index users --columns 'unique index,email,backup'`,
  ])
})

test('proposal arguments are shell-safe while simple tokens remain unchanged', () => {
  expect(addColumnProposal('users', {
    name: 'display name',
    type: 'varchar(191)',
    nullable: false,
    default: `x'; $(touch /tmp/pwned)`,
  })[1]).toBe(
    `dbcli migrate add-column users 'display name' 'varchar(191)' --default 'x'\"'\"'; $(touch /tmp/pwned)'`,
  )
  expect(addColumnProposal('users', {
    name: 'age',
    type: 'integer',
    nullable: true,
  })[1]).toBe('dbcli migrate add-column users age integer --nullable')
})
```

- [ ] **Step 3: Write failing deduplication and stable-order tests**

```ts
test('duplicate index signatures emit one drift entry', () => {
  const ormTable = table(
    { table: 'users' },
    { indexes: [
      { columns: ['email'], unique: true },
      { name: 'duplicate_name', columns: ['email'], unique: true },
    ] },
  )
  const report = compareNormalized(schemaWith([ormTable]), dbWith([table({ table: 'users' })]), { ignore: [] })
  expect(report.entries.filter((entry) => entry.object === 'index(email)')).toHaveLength(1)
})

test('entry ordering is stable across input insertion order', () => {
  const forward = compareNormalized(schemaWith([table({ table: 'z' }), table({ table: 'a' })]), dbWith([]), { ignore: [] })
  const reverse = compareNormalized(schemaWith([table({ table: 'a' }), table({ table: 'z' })]), dbWith([]), { ignore: [] })
  expect(forward.entries).toEqual(reverse.entries)
  expect(forward.entries.map((entry) => entry.table)).toEqual(['a', 'z'])
})
```

- [ ] **Step 4: Run RED**

Run:

```bash
bun test tests/unit/core/orm-drift/compare.test.ts
```

Expected: FAIL because compare lowercases names, proposals parse display strings,
arguments are unquoted, duplicates are emitted, and order follows insertion.

- [ ] **Step 5: Implement exact identity matching and stable output**

Build maps with `tableIdentityKey`. For an ORM identity without schema, fill only
the missing schema with `db.defaultSchema`; never lowercase stored identity.
Display entries with `qualifiedTableName`. Remove the `i` flag from ignore
regexes. Sort entries by:

```ts
const entryOrder = (left: DriftEntry, right: DriftEntry): number =>
  left.table.localeCompare(right.table) ||
  left.object.localeCompare(right.object) ||
  left.category.localeCompare(right.category) ||
  left.detail.localeCompare(right.detail)
```

Deduplicate index emission with a `Set` of the existing ordered
columns-plus-uniqueness signature.

- [ ] **Step 6: Implement structural proposal subjects and shell quoting**

Use:

```ts
const SAFE_SHELL_ARG = /^[A-Za-z0-9_./:@%+=,-]+$/

export function shellArg(value: string): string {
  if (SAFE_SHELL_ARG.test(value)) return value
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}
```

`addColumnProposal` shell-quotes table, column, type, and default independently.
`addIndexProposal` shell-quotes the table and the single comma-joined columns
argument. `proposalsFor` dispatches only from `ProposalSubject`; it never parses
`entry.object` or `entry.detail`.

- [ ] **Step 7: Run GREEN verification**

```bash
bun test tests/unit/core/orm-drift/compare.test.ts
bun run typecheck
bunx eslint src/core/orm-drift/compare.ts src/core/orm-drift/proposals.ts \
  tests/unit/core/orm-drift/compare.test.ts --max-warnings=0
```

Expected: focused tests pass; typecheck and lint exit 0.

- [ ] **Step 8: Run Task 1–5 regression and full suite**

```bash
bun test tests/unit/core/orm-drift tests/unit/adapters/postgresql-schema-identity.test.ts
bun test
```

Expected: all tests pass; optional external-service skips remain unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/core/orm-drift/compare.ts src/core/orm-drift/proposals.ts \
  tests/unit/core/orm-drift/compare.test.ts
git commit -m "fix: make ORM drift identities and proposals lossless"
```

## Final Verification

```bash
bun test tests/unit/core/orm-drift tests/unit/adapters/postgresql-schema-identity.test.ts
bun run typecheck
bun test
```

The original ORM Drift P1b plan then resumes at Task 6. Task 7 must pass
`defaultSchema: 'public'` to `normalizeDbSchema` for PostgreSQL and retain the
identity-array JSON contract.
