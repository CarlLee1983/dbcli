# TypeORM / Sequelize Support (P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dbcli diff --against-orm` supports TypeORM and Sequelize projects by consuming DDL their own tooling emits (no decorator/AST parsing), with first-class guidance instead of raw errors.

**Architecture:** Zero new parsers. `--orm-format typeorm|sequelize` become documented aliases that route through the P1b DDL adapter but tag `ormSource` and default-ignore each ORM's bookkeeping tables (`typeorm_metadata`, `migrations`, `SequelizeMeta`). The real deliverable is UX: `.ts`/`.js`/decorator inputs get actionable "generate DDL like this" errors, and docs show the exact per-ORM export commands.

**Tech Stack:** consumes P1b interfaces (`parseDdl`, `compareNormalized`, `DEFAULT_IGNORE` behavior). Prerequisite: P1b merged (P2 not required). Follow landed code over plan text if they differ.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-lint-and-orm-drift-design.md` §2 (P3 row): "吃各自 CLI 產出的 DDL,走 ddl.ts 重用" — do NOT write TS/decorator parsers.
- DDL export commands to document (verify current syntax via context7 for `typeorm` and `sequelize` docs during Task 3; these are the expected shapes):
  - TypeORM: `typeorm schema:log -d <datasource>` (prints the sync DDL) → save to a file.
  - Sequelize: `sequelize-cli db:migrate --dry-run` is not universal — document the `queryInterface`-free path instead: run migrations against a scratch DB and `pg_dump --schema-only` / `mysqldump --no-data`, which the DDL adapter already consumes.
- Same repo conventions as P1a/P1b.

---

### Task 1: Format aliases + per-ORM default ignores

**Files:**
- Modify: `src/commands/diff.ts` (`runDrift`: accept `ormFormat: 'typeorm' | 'sequelize'`)
- Modify: `src/core/orm-drift/compare.ts` (accept extra default-ignore list via opts)
- Test: extend `tests/unit/commands/diff-against-orm.test.ts`

**Interfaces:**
- `runDrift(paths, { ormFormat: 'typeorm' | 'sequelize', ... }, config)` → parses via `parseDdl`, sets `report.ormSource` to the alias, and injects ignores: typeorm → `['typeorm_metadata', 'migrations']`, sequelize → `['SequelizeMeta']`.
- `compareNormalized(orm, db, { ignore, extraDefaultIgnore?: string[] })`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/unit/commands/diff-against-orm.test.ts
test('typeorm alias parses DDL and tags ormSource', async () => {
  const { report } = await runDrift(
    ['tests/fixtures/orm-drift/create-tables.sql'],
    { ormFormat: 'typeorm' },
    config as never
  )
  expect(report.ormSource).toBe('typeorm')
})

test('typeorm bookkeeping tables in DB are unmanaged by default', async () => {
  const cfg = {
    ...config,
    schema: {
      ...config.schema,
      typeorm_metadata: { name: 'typeorm_metadata', columns: [], indexes: [] },
    },
  }
  const { report } = await runDrift(
    ['tests/fixtures/orm-drift/create-tables.sql'],
    { ormFormat: 'typeorm' },
    cfg as never
  )
  expect(report.entries.find((e) => e.table === 'typeorm_metadata')?.category).toBe('unmanaged')
})

test('sequelize alias ignores SequelizeMeta', async () => {
  const cfg = {
    ...config,
    schema: { ...config.schema, SequelizeMeta: { name: 'SequelizeMeta', columns: [], indexes: [] } },
  }
  const { report } = await runDrift(
    ['tests/fixtures/orm-drift/create-tables.sql'],
    { ormFormat: 'sequelize' },
    cfg as never
  )
  expect(report.ormSource).toBe('sequelize')
  expect(report.entries.find((e) => e.table === 'SequelizeMeta')?.category).toBe('unmanaged')
})
```

- [ ] **Step 2: Run to verify FAIL, then implement**

In `compare.ts`: change the signature to `opts: { ignore: string[]; extraDefaultIgnore?: string[] }` and build `[...DEFAULT_IGNORE, ...(opts.extraDefaultIgnore ?? []), ...opts.ignore]`.

In `runDrift`:

```ts
const ORM_ALIASES: Record<string, { defaultIgnore: string[] }> = {
  typeorm: { defaultIgnore: ['typeorm_metadata', 'migrations'] },
  sequelize: { defaultIgnore: ['SequelizeMeta'] },
}
// in the per-path format dispatch: typeorm/sequelize route to parseDdl(content, system)
// after merging: if aliased, set merged.source to the alias (cast via OrmSource) and pass
// ORM_ALIASES[alias].defaultIgnore as extraDefaultIgnore into compareNormalized.
```

(`OrmSource` already includes `'typeorm' | 'sequelize'` — defined that way in P1b Task 1 precisely for this phase.)

- [ ] **Step 3: Run** the extended test file + `bun test tests/unit/core/orm-drift` — PASS. Commit:

```bash
git add src/commands/diff.ts src/core/orm-drift/compare.ts tests/unit/commands/diff-against-orm.test.ts
git commit -m "feat: add typeorm/sequelize DDL aliases with bookkeeping-table ignores"
```

---

### Task 2: Guidance errors for source-file inputs

**Files:**
- Modify: `src/commands/diff.ts`
- Test: extend `tests/unit/commands/diff-against-orm.test.ts`

- [ ] **Step 1: Failing tests**

```ts
test('.ts input with typeorm alias explains schema:log', async () => {
  await expect(
    runDrift(['src/entity/User.ts'], { ormFormat: 'typeorm' }, config as never)
  ).rejects.toThrow('typeorm schema:log')
})

test('.js input with sequelize alias explains schema-only dump', async () => {
  await expect(
    runDrift(['models/user.js'], { ormFormat: 'sequelize' }, config as never)
  ).rejects.toThrow('--schema-only')
})
```

- [ ] **Step 2: Implement** — in `runDrift`, before file existence checks, when the path ends in `.ts`/`.js`/`.mjs`/`.cjs`:
  - `ormFormat === 'typeorm'` → throw `Error("TypeORM entities are not parsed directly. Generate DDL first: 'typeorm schema:log -d <datasource>' > schema.sql, then pass schema.sql.")`
  - `ormFormat === 'sequelize'` → throw `Error("Sequelize models are not parsed directly. Apply migrations to a scratch DB and dump DDL ('pg_dump --schema-only' / 'mysqldump --no-data'), then pass the dump file.")`
  - otherwise keep the existing P2 drizzle hint.

- [ ] **Step 3: Run tests** — PASS. Commit: `feat: add typeorm/sequelize source-file guidance errors`

---

### Task 3: Documentation closeout (whole ORM-drift feature)

- [ ] **Step 1:** Verify the documented export commands against current ORM docs (context7: `typeorm`, `sequelize`); correct if drifted.
- [ ] **Step 2:** `assets/SKILL.md` + `assets/SKILL.zh-TW.md`: `diff` row's `--orm-format` list becomes `prisma\|ddl\|json\|drizzle\|typeorm\|sequelize`; add one line: "TypeORM/Sequelize: feed tool-generated DDL (schema:log / schema-only dump); source files are rejected with the exact command to run."
- [ ] **Step 3:** `assets/reference.md`: per-ORM subsection under `--against-orm` — the two export recipes, default-ignored bookkeeping tables, one worked example each.
- [ ] **Step 4:** user docs (en/zh-TW, md/html): a completed "ORM drift" section covering all five input paths (prisma, drizzle, typeorm, sequelize, raw DDL/JSON) — this is the feature's docs closeout, so also re-read the P1b/P2 sections for coherence as one narrative.
- [ ] **Step 5:** `bun run plugin:sync`; `bun test tests/unit/skill-assets tests/contract` (update pins); `bun test` full green. Commit: `docs: close out ORM drift docs with typeorm/sequelize recipes`

## Verification

1. `bun run src/cli.ts diff --against-orm tests/fixtures/orm-drift/create-tables.sql --orm-format typeorm --format table` → report with `ormSource: typeorm`.
2. `.ts` inputs produce the guidance errors, never a parse attempt.
3. Full suite green. Release (1.43.0) is a separate decision.
