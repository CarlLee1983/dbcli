# dbcli v1.29 — core config-read entrypoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing config-read surface to `@carllee1983/dbcli/core` so an external consumer (the `dbcli-gui` sidecar) can go from a `.dbcli` project path to a fully-resolved `DbcliConfig` (binding-aware, v1/v2, `{$env}`-expanded) using only public exports.

**Architecture:** Extend the existing public barrel `src/core/public.ts` with three symbols that the `dbcli query`/`schema` commands already rely on internally: a thin `readConfig()` wrapper over `configModule.read`, the `resolveConfigStoragePath` binding-deref helper, and the `DbcliConfigV2` type. No new logic — pure re-export/wrapper. The build (`scripts/build.ts`) already bundles `dist/core.mjs` + `dist/core.d.ts` from this barrel, so new symbols flow through automatically.

**Tech Stack:** Bun, TypeScript, dts-bundle-generator (already wired).

**Why:** Investigation of the `dbcli query` call chain found 1.28.0's `./core` exports are sufficient for the engine (AdapterFactory/QueryExecutor/Blacklist/adapter schema methods) but NOT for config loading. `configModule.read` (`src/core/config.ts:193`), `resolveConfigStoragePath` (`src/core/config-binding.ts:64`), and `type DbcliConfigV2` (`src/utils/validation.ts:256`) are internal. Without them the sidecar would have to reimplement dbcli's binding + `$env` expansion logic. See `docs/specs/2026-06-08-dbcli-gui-design.md`.

---

## File Structure

- `src/core/public.ts` — **modify**. Add `readConfig` wrapper, re-export `resolveConfigStoragePath`, re-export type `DbcliConfigV2`.
- `tests/unit/core-public.test.ts` — **modify**. Extend with assertions for the three new exports + a behavioral check of `readConfig`/`resolveConfigStoragePath` against a temp dir.
- `tests/integration/core-dist-import.test.ts` — **modify**. Add the new runtime symbols to the built-artifact smoke assertions.
- `package.json` — **modify**. Version 1.28.0 → 1.29.0.
- `CHANGELOG.md` — **modify**. New `## [1.29.0]` entry.

No `package.json` `exports` change (the `./core` subpath already covers these).

**Status:** Implemented — retained as a design record

Historical task checkboxes below describe the original execution plan. The
completion state is established by the evidence at the end of this document.

---

## Task 1: Add config-read exports to the public barrel

**Files:**
- Modify: `src/core/public.ts`
- Test: `tests/unit/core-public.test.ts`

- [ ] **Step 1: Write the failing test (extend the existing file)**

Append these tests to `tests/unit/core-public.test.ts` (keep existing tests). Note: the file imports `* as core from '../../src/core/public'` already; add `mkdtemp`/`rm` from node for the behavioral check.

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('public API 暴露 config-read 入口', () => {
  expect(typeof core.readConfig).toBe('function')
  expect(typeof core.resolveConfigStoragePath).toBe('function')
})

test('resolveConfigStoragePath 對無 binding 的路徑回傳原路徑', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dbcli-cfg-'))
  try {
    expect(await core.resolveConfigStoragePath(dir)).toBe(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readConfig 對空目錄回傳預設 config（含 connection + permission）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dbcli-cfg-'))
  try {
    const cfg = await core.readConfig(dir)
    expect(cfg).toBeDefined()
    expect(cfg.connection).toBeDefined()
    expect(typeof cfg.permission).toBe('string')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test tests/unit/core-public.test.ts`
Expected: the three new tests FAIL (`core.readConfig is not a function` / `core.resolveConfigStoragePath is not a function`). Existing tests still pass.

- [ ] **Step 3: Add the exports to `src/core/public.ts`**

Add a new section to `src/core/public.ts` (after the existing `// ── Config (.dbcli resolution) ──` block). The file uses `verbatimModuleSyntax`, so import the `DbcliConfig` type explicitly for the return annotation:

```ts
// ── Config read (unified: binding-aware, v1/v2, {$env}-expanded) ──
import { configModule } from '@/core/config'
import type { DbcliConfig } from '@/utils/validation'

/**
 * Read and fully resolve a `.dbcli` project config: handles project-binding
 * indirection, v1/v2 formats, per-connection `.env` loading and `{$env}`
 * expansion. `path` is the `.dbcli` directory (or legacy file). Returns the
 * default config if none exists. Thin wrapper over the same entrypoint the
 * CLI commands use.
 */
export const readConfig = (path: string, connectionName?: string): Promise<DbcliConfig> =>
  configModule.read(path, connectionName)

export { resolveConfigStoragePath } from '@/core/config-binding'
export type { DbcliConfigV2 } from '@/utils/validation'
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/unit/core-public.test.ts`
Expected: all tests PASS (existing 3 + new 3).

- [ ] **Step 5: typecheck**

Run: `bun run typecheck`
Expected: exit 0, no new errors. (`configModule.read` returns `Promise<DbcliConfig>`, matching the annotation.)

- [ ] **Step 6: Commit**

```bash
git add src/core/public.ts tests/unit/core-public.test.ts
git commit -m "feat: [core] export readConfig + resolveConfigStoragePath + DbcliConfigV2"
```

---

## Task 2: Verify new symbols reach the built artifact + types

**Files:**
- Modify: `tests/integration/core-dist-import.test.ts`

- [ ] **Step 1: Extend the built-artifact smoke test**

In `tests/integration/core-dist-import.test.ts`, add the two new runtime exports to the existing assertion block (the test imports the built `dist/core.mjs` via the ROOT-based absolute path). Add:

```ts
  expect(typeof core.readConfig).toBe('function')
  expect(typeof core.resolveConfigStoragePath).toBe('function')
```

(Place them alongside the existing `expect(typeof core.AdapterFactory)...` assertions, inside the same `test('dist/core.mjs 暴露 engine 進入點', ...)` block. The `beforeAll` already rebuilds `dist`.)

- [ ] **Step 2: Run it**

Run: `bun test tests/integration/core-dist-import.test.ts`
Expected: PASS (the beforeAll rebuild regenerates `dist/core.mjs` with the new symbols).

- [ ] **Step 3: Verify the type surface in the generated declaration**

Run: `bun run build && grep -E "readConfig|resolveConfigStoragePath|DbcliConfigV2" dist/core.d.ts | head`
Expected: lines showing `export declare const readConfig`, `export declare function resolveConfigStoragePath`, and `DbcliConfigV2` are present.

- [ ] **Step 4: Strict external-consumer typecheck (no skipLibCheck)**

Run:
```bash
printf "import { readConfig, resolveConfigStoragePath } from './dist/core'\nimport type { DbcliConfigV2, DbcliConfig } from './dist/core'\nasync function m(){ const c: DbcliConfig = await readConfig('.dbcli'); const s: string = await resolveConfigStoragePath('.dbcli'); const _v: DbcliConfigV2 | undefined = undefined; console.log(typeof c, s, _v) }\nm()\n" > /tmp/cfg-check.ts
bunx tsc --noEmit --strict --moduleResolution bundler --module esnext /tmp/cfg-check.ts; echo "exit=$?"; rm -f /tmp/cfg-check.ts
```
Expected: exit=0, no TS2484, no errors pointing at dist/core's declarations. (Unrelated missing-global errors, if any, are fine.)

- [ ] **Step 5: Commit**

```bash
git add tests/integration/core-dist-import.test.ts
git commit -m "test: [core] assert config-read symbols in built core artifact"
```

---

## Task 3: Version bump + CHANGELOG + full validation

**Files:**
- Modify: `package.json` (version)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version 1.28.0 → 1.29.0**

Change `package.json` `"version": "1.28.0"` to `"version": "1.29.0"`. (Additive, backward-compatible public API → minor bump.)

- [ ] **Step 2: Add CHANGELOG entry**

Insert after the intro header block and before `## [1.28.0]` in `CHANGELOG.md`:

```markdown
## [1.29.0] - 2026-06-08 - Core Config-Read Entrypoint

### Added

- **`@carllee1983/dbcli/core` 新增設定載入入口。** 在 `./core` 子路徑公開 `readConfig(path, connectionName?)`（binding-aware、v1/v2、`{$env}` 展開的統一設定讀取，與 CLI 指令同源）、`resolveConfigStoragePath(path)`（project-binding 解參）與型別 `DbcliConfigV2`。讓外部消費者（如 `dbcli-gui` sidecar）能從 `.dbcli` 專案路徑解出含真實連線資訊的 `DbcliConfig`，不必重寫內部 binding／env 邏輯。CLI 行為不變。
```

- [ ] **Step 3: Full validation**

Run: `bun run typecheck && bun test tests/unit/core-public.test.ts tests/integration/core-dist-import.test.ts && bun run build`
Expected: typecheck exit 0; tests pass; build succeeds with `dist/core.mjs` + `dist/core.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: [release] bump version to 1.29.0 (core config-read entrypoint)"
```

- [ ] **Step 5: Release handoff (human-triggered — do NOT publish)**

After merge, the human runs `bun run release:check` then `npm publish` to make 1.29.0 available to the `dbcli-gui` repo (dev-time alternative: `bun link`). Do NOT run `npm publish`.

---

## Self-Review

- **Spec/gap coverage:** the three investigation gaps — config discovery/load (`readConfig`→`configModule.read`), binding deref (`resolveConfigStoragePath`), and `DbcliConfigV2` type — are all addressed in Task 1. `{$env}` expansion is handled inside `configModule.read`, so `readConfig` covers it transitively (verified by the behavioral test reading a real config path).
- **Placeholder scan:** every step has concrete code/commands + expected output. No TBD.
- **Type/symbol consistency:** `readConfig(path, connectionName?): Promise<DbcliConfig>` matches `configModule.read`'s signature (`config.ts:193`); `resolveConfigStoragePath(path): Promise<string>` matches `config-binding.ts:64`; `DbcliConfigV2` matches `validation.ts:256`. Test/CHANGELOG names align with the exports.
- **Scope:** minimal additive change in the dbcli repo; the sidecar build is a separate plan in the `dbcli-gui` repo.

## Completion evidence

- **Completed:** 2026-08-04 closeout.
- **Implementation:** `359d921` exported `readConfig`,
  `resolveConfigStoragePath`, and `DbcliConfigV2`; `01e7830` added built-artifact
  assertions. The public core surface has since received additional additive
  exports.
- **Verification:** `bun test tests/unit/core-public.test.ts tests/integration/core-dist-import.test.ts`
  passed 8 tests; `bun run typecheck`, `bun run lint`, and `bun run docs:check`
  passed.
- **Documentation:** The public core export and the separate `dbcli-gui`
  follow-up boundary are documented in the package and design records.
- **Known deviations:** The planned 1.29.0 release step is historical; the
  current package is v1.44.1 and release publication remains a human-triggered
  operation.
