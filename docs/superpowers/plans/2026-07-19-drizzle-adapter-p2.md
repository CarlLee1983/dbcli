# Drizzle Adapter (P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dbcli diff --against-orm` accepts Drizzle schemas via the snapshot JSON that `drizzle-kit generate` writes under `drizzle/meta/` — no TypeScript AST parsing.

**Architecture:** One new adapter `src/core/orm-drift/adapters/drizzle.ts` maps a drizzle-kit snapshot document (`{version, dialect, tables: {"public.users": {...}}}`) into `NormalizedSchema`; `detect.ts` learns to recognize the snapshot shape. Everything downstream (compare, proposals, formatter, CLI) is P1b machinery, untouched.

**Tech Stack:** Bun + TypeScript ESM; consumes P1b's `NormalizedSchema` / `detectOrmFormat` interfaces exactly as defined in `docs/superpowers/plans/2026-07-19-orm-drift-p1b.md` Task 1/4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-lint-and-orm-drift-design.md` §2 (P2 row) — read the snapshot JSON, do NOT parse `.ts` schema files.
- Prerequisite: P1b merged. If P1b's landed interfaces differ from its plan, follow the landed code.
- Unknown snapshot fields → `unparsed` with `blocked:` reason; never guess. A `.ts` path passed as `--against-orm` → clear error telling the user to run `drizzle-kit generate` and point at `drizzle/meta/<NNNN>_snapshot.json`.
- Same repo conventions as P1a/P1b (aliases, ESM, conventional commits).

---

### Task 1: Snapshot fixture + drizzle adapter

**Files:**
- Create: `src/core/orm-drift/adapters/drizzle.ts`
- Create: `tests/fixtures/orm-drift/drizzle-snapshot.json`
- Test: `tests/unit/core/orm-drift/drizzle-adapter.test.ts`

**Interfaces:**
- Produces: `parseDrizzleSnapshot(json: unknown): NormalizedSchema` (source `'drizzle'`), `isDrizzleSnapshot(json: unknown): boolean`.

- [ ] **Step 1: Create the fixture** (shape of drizzle-kit pg snapshot v7; verify against the currently documented shape via context7 for `drizzle-kit` before finalizing — adjust field names to what current drizzle-kit actually emits, keeping the test's behavioral assertions):

```json
{
  "version": "7",
  "dialect": "postgresql",
  "tables": {
    "public.users": {
      "name": "users",
      "schema": "public",
      "columns": {
        "id": { "name": "id", "type": "serial", "primaryKey": true, "notNull": true },
        "email": { "name": "email", "type": "varchar(255)", "primaryKey": false, "notNull": true },
        "bio": { "name": "bio", "type": "text", "primaryKey": false, "notNull": false, "default": "''" }
      },
      "indexes": {
        "users_email_idx": { "name": "users_email_idx", "columns": ["email"], "isUnique": true }
      },
      "foreignKeys": {
        "users_org_fk": {
          "name": "users_org_fk",
          "tableFrom": "users",
          "columnsFrom": ["org_id"],
          "tableTo": "orgs",
          "columnsTo": ["id"]
        }
      }
    }
  },
  "enums": { "public.mood": { "name": "mood", "values": ["happy"] } }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/core/orm-drift/drizzle-adapter.test.ts
import { describe, test, expect } from 'bun:test'
import { parseDrizzleSnapshot, isDrizzleSnapshot } from '@/core/orm-drift/adapters/drizzle'

const snapshot = JSON.parse(await Bun.file('tests/fixtures/orm-drift/drizzle-snapshot.json').text())

describe('parseDrizzleSnapshot', () => {
  test('maps tables/columns with pk, notNull, default', () => {
    const out = parseDrizzleSnapshot(snapshot)
    expect(out.source).toBe('drizzle')
    const users = out.tables.users
    const byName = Object.fromEntries(users.columns.map((c) => [c.name, c]))
    expect(byName.id).toMatchObject({ type: 'serial', nullable: false, primaryKey: true })
    expect(byName.email.nullable).toBe(false)
    expect(byName.bio).toMatchObject({ nullable: true, default: "''" })
  })

  test('maps indexes and foreign keys', () => {
    const users = parseDrizzleSnapshot(snapshot).tables.users
    expect(users.indexes).toContainEqual({ name: 'users_email_idx', columns: ['email'], unique: true })
    expect(users.foreignKeys).toEqual([{ columns: ['org_id'], refTable: 'orgs', refColumns: ['id'] }])
  })

  test('enums land in unparsed with blocked reason', () => {
    const out = parseDrizzleSnapshot(snapshot)
    expect(out.unparsed.some((u) => u.reason.includes('blocked:') && u.location.includes('mood'))).toBe(true)
  })

  test('isDrizzleSnapshot recognizes the shape', () => {
    expect(isDrizzleSnapshot(snapshot)).toBe(true)
    expect(isDrizzleSnapshot({ tables: {} })).toBe(false)
    expect(isDrizzleSnapshot({ source: 'json', tables: {}, unparsed: [] })).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify FAIL**, then implement:

```ts
// src/core/orm-drift/adapters/drizzle.ts
/**
 * drizzle-kit snapshot JSON → NormalizedSchema. We consume the generated
 * snapshot (drizzle/meta/NNNN_snapshot.json), never the .ts schema source.
 */
import type { NormalizedSchema, NormalizedTable, UnparsedEntry } from '../normalized-schema'

type Json = Record<string, unknown>

export function isDrizzleSnapshot(json: unknown): boolean {
  const doc = json as Json | null
  return Boolean(
    doc &&
      typeof doc === 'object' &&
      'dialect' in doc &&
      'version' in doc &&
      typeof doc.tables === 'object'
  )
}

export function parseDrizzleSnapshot(json: unknown): NormalizedSchema {
  const doc = json as Json
  const tables: Record<string, NormalizedTable> = {}
  const unparsed: UnparsedEntry[] = []

  for (const [key, raw] of Object.entries((doc.tables as Json) ?? {})) {
    const t = raw as Json
    const name = String(t.name ?? key.split('.').pop())
    const table: NormalizedTable = { name, columns: [], indexes: [], foreignKeys: [] }

    for (const col of Object.values((t.columns as Json) ?? {})) {
      const c = col as Json
      table.columns.push({
        name: String(c.name),
        type: String(c.type).toLowerCase(),
        rawType: String(c.type),
        nullable: c.notNull !== true && c.primaryKey !== true,
        ...(c.primaryKey === true && { primaryKey: true }),
        ...(c.default !== undefined && { default: String(c.default) }),
      })
    }
    for (const idx of Object.values((t.indexes as Json) ?? {})) {
      const i = idx as Json
      table.indexes.push({
        name: i.name ? String(i.name) : undefined,
        columns: Array.isArray(i.columns) ? i.columns.map(String) : [],
        unique: i.isUnique === true,
      })
    }
    for (const fk of Object.values((t.foreignKeys as Json) ?? {})) {
      const f = fk as Json
      table.foreignKeys.push({
        columns: Array.isArray(f.columnsFrom) ? f.columnsFrom.map(String) : [],
        refTable: String(f.tableTo ?? ''),
        refColumns: Array.isArray(f.columnsTo) ? f.columnsTo.map(String) : [],
      })
    }
    tables[name.toLowerCase()] = table
  }

  for (const key of Object.keys((doc.enums as Json) ?? {})) {
    unparsed.push({ location: key, reason: 'blocked: drizzle enums are not compared (P2 scope)' })
  }
  return { source: 'drizzle', tables, unparsed }
}
```

- [ ] **Step 4: Run to verify PASS**, then commit:

```bash
git add src/core/orm-drift/adapters/drizzle.ts tests/fixtures/orm-drift/drizzle-snapshot.json tests/unit/core/orm-drift/drizzle-adapter.test.ts
git commit -m "feat: add drizzle snapshot adapter for NormalizedSchema"
```

---

### Task 2: Wire into detection + CLI

**Files:**
- Modify: `src/core/orm-drift/adapters/detect.ts` (return type gains `'drizzle'`)
- Modify: `src/commands/diff.ts` (`runDrift` dispatch + `--orm-format` enum + `.ts` guard)
- Test: extend `tests/unit/core/orm-drift/ddl-adapter.test.ts` (detect cases) and `tests/unit/commands/diff-against-orm.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// append to the detect describe-block in ddl-adapter.test.ts
test('detects drizzle snapshots and rejects .ts sources', () => {
  const snap = '{"version":"7","dialect":"postgresql","tables":{}}'
  expect(detectOrmFormat('drizzle/meta/0001_snapshot.json', snap)).toBe('drizzle')
})

// append to diff-against-orm.test.ts
test('drizzle snapshot path flows end-to-end', async () => {
  const { report } = await runDrift(['tests/fixtures/orm-drift/drizzle-snapshot.json'], {}, config as never)
  expect(report.ormSource).toBe('drizzle')
})

test('.ts schema file gets a drizzle-kit hint, not a parse attempt', async () => {
  await expect(runDrift(['src/db/schema.ts'], {}, config as never)).rejects.toThrow('drizzle-kit generate')
})
```

- [ ] **Step 2: Implement**

In `detect.ts`: import `isDrizzleSnapshot`; in the JSON branch, return `'drizzle'` when `isDrizzleSnapshot(parsed)` before the generic `'tables' in parsed` json check. Update the return type union to `'prisma' | 'ddl' | 'json' | 'drizzle'`.

In `runDrift` (diff.ts): before reading, guard `path.endsWith('.ts')` → `throw new Error("Drizzle/TypeORM TypeScript sources are not parsed directly. Run 'drizzle-kit generate' and pass drizzle/meta/<NNNN>_snapshot.json (or export DDL) instead.")`. Add a `format === 'drizzle'` branch calling `parseDrizzleSnapshot(JSON.parse(content))`. Extend the `--orm-format` help string to `prisma | ddl | json | drizzle`.

- [ ] **Step 3: Run** `bun test tests/unit/core/orm-drift tests/unit/commands/diff-against-orm.test.ts` — PASS. Commit:

```bash
git add src/core/orm-drift/adapters/detect.ts src/commands/diff.ts tests
git commit -m "feat: wire drizzle snapshot detection into diff --against-orm"
```

---

### Task 3: Documentation

- [ ] **Step 1:** `assets/SKILL.md` + `assets/SKILL.zh-TW.md`: in the `diff` row change `--orm-format prisma\|ddl\|json` to `prisma\|ddl\|json\|drizzle` and append "Drizzle: point at `drizzle/meta/<NNNN>_snapshot.json` (run `drizzle-kit generate` first; `.ts` sources are rejected with a hint)."
- [ ] **Step 2:** `assets/reference.md`: extend the `--against-orm` block with the drizzle input row + one example; note enums land in `unparsed`.
- [ ] **Step 3:** user docs both languages/formats; `bun run plugin:sync`; `bun test tests/unit/skill-assets tests/contract` (update pinned expectations); `bun test` full green.
- [ ] **Step 4: Commit** `docs: document drizzle snapshot support for diff --against-orm`

## Verification

`bun run src/cli.ts diff --against-orm tests/fixtures/orm-drift/drizzle-snapshot.json --format table` → drift report with `ormSource: drizzle`. Release (1.42.0) is a separate decision.
