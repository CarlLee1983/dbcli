# dbcli `./core` Subpath Export — Implementation Plan (階段一)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `dbcli` 對外暴露一個穩定的 `@carllee1983/dbcli/core` import 入口，使未來的 `dbcli-gui` Bun sidecar 能直接 import 引擎能力（adapter、query、schema、blacklist、config），CLI 行為完全不變。

**Architecture:** 新增一個專屬對外的 public barrel `src/core/public.ts`（不動既有內部 `src/core/index.ts`，避免影響內部 `@/` import）。build 時用 `bun build` 把它打包成 `dist/core.mjs`（`@/` alias 於 bundle 時解析）。`package.json` 加 `exports` map 開出 `./core` 子路徑，並用 `dts-bundle-generator` 產生扁平 `dist/core.d.ts` 提供型別。

**Tech Stack:** Bun（build / test）、TypeScript、`dts-bundle-generator`（型別打包）。

**Scope note:** 本計畫只涵蓋階段一（本 repo 的 core 出口）。階段二（新 repo `dbcli-gui`：Tauri 殼 + Bun sidecar + React 前端）待新 repo 建立後，依其自身 spec→plan 循環另行規劃。對應設計：`docs/specs/2026-06-08-dbcli-gui-design.md`。

**Status:** Implemented — retained as a design record

Historical task checkboxes below describe the original execution plan. The
completion state is established by the evidence at the end of this document.

---

## File Structure

- `src/core/public.ts` — **新增**。對外公開 API barrel，唯一對外契約面。re-export engine/config/safety/types。
- `tests/unit/core-public.test.ts` — **新增**。驗證 public barrel 對外符號存在且型別正確。
- `scripts/build.ts` — **修改**。新增一個 build entry 打包 `dist/core.mjs`；新增一步產生 `dist/core.d.ts`。
- `package.json` — **修改**。新增 `exports` map（`.` 與 `./core`）；devDeps 加 `dts-bundle-generator`；版本 bump 1.27.0 → 1.28.0。
- `CHANGELOG.md` — **修改**。新增 1.28.0 條目。

---

## Task 1: 建立對外 public API barrel + 測試

**Files:**
- Create: `src/core/public.ts`
- Test: `tests/unit/core-public.test.ts`

- [ ] **Step 1: 先寫失敗測試**

`tests/unit/core-public.test.ts`：

```ts
import { test, expect } from 'bun:test'
import * as core from '../../src/core/public'

test('public API 暴露 engine 進入點', () => {
  expect(typeof core.AdapterFactory).toBe('function')
  expect(typeof core.QueryExecutor).toBe('function')
  expect(typeof core.SchemaLayeredLoader).toBe('function')
  expect(core.ConnectionError).toBeDefined()
})

test('public API 暴露 config 解析器', () => {
  expect(typeof core.resolveConnection).toBe('function')
  expect(typeof core.listConnections).toBe('function')
  expect(typeof core.readV2Config).toBe('function')
  expect(typeof core.loadConnectionEnv).toBe('function')
  expect(typeof core.detectConfigVersion).toBe('function')
})

test('public API 暴露 blacklist 安全機制', () => {
  expect(typeof core.BlacklistManager).toBe('function')
  expect(typeof core.BlacklistValidator).toBe('function')
  expect(core.BlacklistError).toBeDefined()
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test tests/unit/core-public.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/public'`。

- [ ] **Step 3: 建立 public barrel**

`src/core/public.ts`：

```ts
/**
 * Public API surface for external consumers (e.g. dbcli-gui sidecar).
 *
 * This is the ONLY contract exported via the `@carllee1983/dbcli/core` subpath.
 * Keep it intentional and stable — internal `src/core/index.ts` is NOT the
 * external contract and may change freely.
 */

// ── Engine ───────────────────────────────────────────────
export { AdapterFactory, ConnectionError } from '@/adapters'
export { QueryExecutor } from '@/core/query-executor'
export { SchemaLayeredLoader } from '@/core/schema-loader'

// ── Config (.dbcli resolution) ───────────────────────────
export {
  resolveConnection,
  listConnections,
  readV2Config,
  loadConnectionEnv,
  detectConfigVersion,
} from '@/core/config-v2'
export type { ResolvedConnection } from '@/core/config-v2'

// ── Safety ───────────────────────────────────────────────
export { BlacklistManager } from '@/core/blacklist-manager'
export { BlacklistValidator, BlacklistError } from '@/core/blacklist-validator'

// ── Types ────────────────────────────────────────────────
export type {
  ConnectionOptions,
  DatabaseAdapter,
  DatabaseSystem,
  TableSchema,
  ColumnSchema,
  ExecutionResult,
} from '@/adapters'
export type { Permission } from '@/types'
export type { DbcliConfig } from '@/utils/validation'
export type { QueryResult } from '@/types/query'
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test tests/unit/core-public.test.ts`
Expected: PASS（3 個測試全綠）。

- [ ] **Step 5: typecheck（確認 re-export 路徑/型別正確）**

Run: `bun run typecheck`
Expected: 無新增錯誤（exit 0）。若報某符號不存在，回 Step 3 對照真實匯出修正。

- [ ] **Step 6: commit**

```bash
git add src/core/public.ts tests/unit/core-public.test.ts
git commit -m "feat: [core] add public API barrel for external consumers"
```

---

## Task 2: build 出 `dist/core.mjs`

**Files:**
- Modify: `scripts/build.ts`（在 CLI bundle 之後、UI build 之前插入）

- [ ] **Step 1: 在 build script 插入 core bundle 步驟**

在 `scripts/build.ts` 第一段 CLI bundle（`await $\`bun build ./src/cli.ts ...\``）之後，緊接著新增：

```ts
// 1b. Bundle core library (no shebang) for the `./core` subpath export.
//     Same externals as the CLI so native drivers stay peer-resolved.
await $`bun build ./src/core/public.ts --outfile dist/core.mjs --target bun --external pg --external mysql2 --external mongodb --external open`
```

- [ ] **Step 2: 執行 build**

Run: `bun run build`
Expected: 終端印出 UI 建置訊息且結束碼 0；`dist/core.mjs` 產生。

- [ ] **Step 3: 確認產物存在且非空**

Run: `test -s dist/core.mjs && echo OK`
Expected: 印出 `OK`。

- [ ] **Step 4: commit**

```bash
git add scripts/build.ts
git commit -m "build: [core] bundle dist/core.mjs from public barrel"
```

---

## Task 3: package.json `exports` map

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 新增 `exports` 欄位**

在 `package.json` 的 `"bin"` 區塊之後（`"license"` 之前）插入：

```jsonc
  "exports": {
    ".": "./dist/cli.mjs",
    "./core": {
      "types": "./dist/core.d.ts",
      "import": "./dist/core.mjs"
    }
  },
```

> 註：`bin` 不受 `exports` 影響，CLI 啟動行為不變。`types` 指向的 `dist/core.d.ts` 於 Task 5 產生；先寫好路徑。

- [ ] **Step 2: 驗證 JSON 合法**

Run: `bun -e "JSON.parse(await Bun.file('package.json').text()); console.log('valid')"`
Expected: 印出 `valid`。

- [ ] **Step 3: 確認 CLI 仍可執行（exports 未破壞 bin）**

Run: `bun run src/cli.ts --version`
Expected: 印出版本字串（例如 `1.27.0`），結束碼 0。

- [ ] **Step 4: commit**

```bash
git add package.json
git commit -m "feat: [core] expose ./core subpath via package exports"
```

---

## Task 4: 端到端 smoke test — import 已建置的 `dist/core.mjs`

**Files:**
- Create: `tests/integration/core-dist-import.test.ts`

- [ ] **Step 1: 寫測試（import 建置產物，非原始碼）**

`tests/integration/core-dist-import.test.ts`：

```ts
import { test, expect, beforeAll } from 'bun:test'
import { existsSync } from 'node:fs'

// 此測試驗證「對外發布的產物」可被 import，等同外部消費者的視角。
// 需先 `bun run build` 產生 dist/core.mjs。

beforeAll(() => {
  if (!existsSync('dist/core.mjs')) {
    throw new Error('dist/core.mjs 不存在 — 請先執行 `bun run build`')
  }
})

test('dist/core.mjs 暴露 engine 進入點', async () => {
  const core = await import('../../dist/core.mjs')
  expect(typeof core.AdapterFactory).toBe('function')
  expect(typeof core.QueryExecutor).toBe('function')
  expect(typeof core.SchemaLayeredLoader).toBe('function')
  expect(typeof core.listConnections).toBe('function')
  expect(typeof core.BlacklistManager).toBe('function')
})
```

- [ ] **Step 2: 確保已建置，然後跑測試**

Run: `bun run build && bun test tests/integration/core-dist-import.test.ts`
Expected: PASS。若報缺少 native driver（pg/mysql2/...），表示 externals 漏列 — 回 Task 2 Step 1 補上對應 `--external`。

- [ ] **Step 3: commit**

```bash
git add tests/integration/core-dist-import.test.ts
git commit -m "test: [core] smoke-test dist/core.mjs external import"
```

---

## Task 5: 產生扁平型別宣告 `dist/core.d.ts`

**Files:**
- Modify: `package.json`（devDeps + build script 串接）
- Modify: `scripts/build.ts`（新增 dts 產生步驟）

- [ ] **Step 1: 安裝 dts-bundle-generator**

Run: `bun add -d dts-bundle-generator`
Expected: `package.json` devDependencies 出現 `dts-bundle-generator`。

- [ ] **Step 2: 手動驗證可產出單一 .d.ts（先確認工具能解析 `@/` alias）**

Run: `bunx dts-bundle-generator -o dist/core.d.ts --project tsconfig.json --no-check src/core/public.ts`
Expected: 產生 `dist/core.d.ts`，內含 `export declare class AdapterFactory`、`export type Permission` 等；不含未解析的 `@/` import。
若工具因 `allowImportingTsExtensions` 報錯：建立 `tsconfig.dts.json`：

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "allowImportingTsExtensions": false, "noEmit": false }
}
```

並改用 `--project tsconfig.dts.json` 重跑。

- [ ] **Step 3: 把 dts 產生步驟寫進 build script**

在 `scripts/build.ts` 的 core bundle（Task 2 的 `1b`）之後新增：

```ts
// 1c. Generate a single flat declaration file for the `./core` subpath.
await $`bunx dts-bundle-generator -o dist/core.d.ts --project tsconfig.json --no-check src/core/public.ts`
```

（若 Step 2 需用 `tsconfig.dts.json`，此處同步改成 `--project tsconfig.dts.json`。）

- [ ] **Step 4: 全量 build 並確認 dts 存在且型別可解析**

Run: `bun run build && test -s dist/core.d.ts && echo OK`
Expected: 印出 `OK`。

- [ ] **Step 5: 驗證型別真的可用（建一個臨時 .ts 引用型別並 typecheck）**

Run:
```bash
printf "import type { Permission, QueryResult } from './dist/core.d.ts'\nconst p: Permission = 'query-only'\nconsole.log(p)\n" > /tmp/dts-check.ts
bunx tsc --noEmit --skipLibCheck /tmp/dts-check.ts && echo TYPES_OK; rm -f /tmp/dts-check.ts
```
Expected: 印出 `TYPES_OK`。

- [ ] **Step 6: commit**

```bash
git add package.json bun.lock scripts/build.ts tsconfig.dts.json 2>/dev/null; git add -A
git commit -m "build: [core] emit dist/core.d.ts for ./core types"
```

---

## Task 6: 版本 bump + CHANGELOG + 發布準備

**Files:**
- Modify: `package.json`（version）
- Modify: `CHANGELOG.md`

- [ ] **Step 1: bump 版本 1.27.0 → 1.28.0**

把 `package.json` 的 `"version": "1.27.0"` 改為 `"version": "1.28.0"`。
（新增對外 API 屬於向下相容的功能新增 → minor bump。package.json 為版本唯一真實來源。）

- [ ] **Step 2: 新增 CHANGELOG 條目**

在 `CHANGELOG.md` 的 `# Changelog` 標頭區塊（"adheres to Semantic Versioning" 那行）之後、`## [1.27.0]` 之前插入：

```markdown
## [1.28.0] - 2026-06-08 - Core Subpath Export

### Added

- **`@carllee1983/dbcli/core` 子路徑匯出。** 新增穩定對外 API barrel（`src/core/public.ts`），透過 `package.json` 的 `exports` map 開出 `./core` 子路徑，並隨套件發布 `dist/core.mjs` 與扁平型別宣告 `dist/core.d.ts`。外部專案（如 `dbcli-gui` 桌面客戶端的 Bun sidecar）可 `import { AdapterFactory, QueryExecutor, SchemaLayeredLoader, listConnections, BlacklistManager } from '@carllee1983/dbcli/core'` 直接重用引擎能力。CLI（`bin`）行為完全不變。
```

- [ ] **Step 3: 全量驗證**

Run: `bun run typecheck && bun test tests/unit/core-public.test.ts tests/integration/core-dist-import.test.ts && bun run build`
Expected: typecheck 0 錯、兩組測試全綠、build 成功。

- [ ] **Step 4: commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: [release] bump version to 1.28.0 (core subpath export)"
```

- [ ] **Step 5: 發布交接（由使用者觸發，非自動）**

階段二的新 repo 要能 `bun add @carllee1983/dbcli` 取得 `./core`，需先發布 1.28.0 到 npm：

```bash
bun run release:check   # 既有發布前檢查
# 確認無誤後由使用者執行： npm publish
```

開發期替代方案（發布前先串接）：在本 repo 跑 `bun link`，於新 repo 跑 `bun link @carllee1983/dbcli`，即可在未發布狀態下 import `./core`。

---

## Self-Review

- **Spec coverage（§6 本 repo 改動）**：`exports` map ✓ Task 3；`dist/core.mjs` build entry ✓ Task 2；補齊對外 re-export（AdapterFactory / QueryExecutor / SchemaLayeredLoader / config-v2 / Blacklist*）✓ Task 1；`files` 已含 `dist/` 故 `.d.ts`/`.mjs` 自動隨發布 ✓（Task 5/6 驗證）。spec 強調的「型別安全」由 Task 5 的 `dist/core.d.ts` 滿足。
- **Placeholder scan**：各 step 均含實際程式碼/指令與預期輸出，無 TBD/TODO。
- **Type/symbol consistency**：barrel 匯出名稱（`AdapterFactory`、`QueryExecutor`、`SchemaLayeredLoader`、`resolveConnection`、`listConnections`、`readV2Config`、`loadConnectionEnv`、`detectConfigVersion`、`BlacklistManager`、`BlacklistValidator`、`BlacklistError`、型別 `ResolvedConnection`/`Permission`/`DbcliConfig`/`QueryResult`/adapter 型別）與 Task 1/4 測試、Task 6 CHANGELOG 文案一致；匯入路徑對齊真實來源（`@/adapters`、`@/core/query-executor`、`@/core/config-v2`、`@/types`、`@/utils/validation`、`@/types/query`）。
- **Scope**：聚焦單一可交付（core 出口），階段二明確劃出另立計畫。

## Completion evidence

- **Completed:** 2026-08-04 closeout.
- **Implementation:** `a8313c6` created the public core barrel; subsequent
  `359d921`, `5e413e3`, `2a067a6`, and `c46b3b2` expanded the additive public
  surface. Built-artifact coverage was added by `269560f` and `01e7830`.
- **Verification:** `bun test tests/unit/core-public.test.ts tests/integration/core-dist-import.test.ts`
  passed 8 tests; `bun run typecheck`, `bun run lint`, and `bun run docs:check`
  passed.
- **Documentation:** The package exports and the separate `dbcli-gui` phase
  boundary remain documented.
- **Known deviations:** The original 1.28.0 release checklist is historical;
  the current package is v1.44.1 and the public surface is broader than the
  initial minimal barrel.
```
