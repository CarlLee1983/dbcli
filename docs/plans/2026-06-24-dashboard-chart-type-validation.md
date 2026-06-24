# Dashboard Chart Type 邊界驗證 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `--ui` dashboard 的 `visual.charts[].type` 有單一合法集合、在解析邊界對未知型別報錯，並讓渲染端對未知型別顯示明確佔位而非靜默畫成圓餅。

**Architecture:** 於 `types.ts` 立 `SUPPORTED_CHART_TYPES` 為單一真實來源並推導 `VisualChart.type`（移除從未渲染的 `scatter`）；`parser.ts` 的 `normaliseVisual` 在形狀守衛通過後驗證 `type`，非法即 `throw SavedQueryError(PARSE_ERROR)`；`App.tsx` 用自有的可渲染清單做防禦縱深佔位。最後同步 `docs/user/` 四檔與 CHANGELOG。

**Tech Stack:** TypeScript、Bun test、React + recharts（ui-template 為獨立 bundle）、`@testing-library/react` + happy-dom。

## Global Constraints

- 預設使用 Bun：`bun test`、`bun run typecheck`、`bun run lint`（勿用 node/jest/vite）。
- 合法 chart type 唯一來源為 `SUPPORTED_CHART_TYPES = ['line', 'bar', 'area', 'pie']`（移除 `scatter`）。
- 解析時未知 type → `throw new SavedQueryError(message, 'PARSE_ERROR', input.file)`；訊息須含 snippet key、收到的非法值、合法清單。
- 不新增 scatter/其他圖種渲染；不更動 `kpis` 與 `normaliseVisual` 其餘寬鬆丟棄行為；不更動 `./core` 公開契約。
- 文件四檔對等：`docs/user/{en,zh-TW}/index.md` 與 `index.html` 皆須同步。
- 不在本計畫 bump `package.json` 版本：版本號為釋出時決策（見 versioning 慣例），CHANGELOG 以 `## [Unreleased]` 區段記錄。
- 提交訊息格式：`<type>: [scope] subject`。

---

### Task 1: 單一來源 + 解析邊界驗證（core）

**Files:**
- Modify: `src/core/saved-queries/types.ts:54-59`（`VisualChart` 前新增常數與型別、改 `type` 欄位）
- Modify: `src/core/saved-queries/parser.ts:133`（call site 傳入 `input`）與 `normaliseVisual` 函式（約 `parser.ts:160-205`）
- Test: `tests/unit/core/saved-queries/visual-parser.test.ts`

**Interfaces:**
- Produces: `export const SUPPORTED_CHART_TYPES = ['line', 'bar', 'area', 'pie'] as const`；`export type ChartType = (typeof SUPPORTED_CHART_TYPES)[number]`（皆於 `src/core/saved-queries/types.ts`）。
- Consumes: 既有 `SavedQueryError`（`types.ts`，constructor `(message: string, code, file?: string)`）、`ParseInput`（`parser.ts`，含 `key`、`file`）。

- [ ] **Step 1: 寫失敗測試**

在 `tests/unit/core/saved-queries/visual-parser.test.ts` 末尾追加：

```ts
test('parseSavedQuery accepts all four supported chart types', () => {
  for (const type of ['line', 'bar', 'area', 'pie']) {
    const input: ParseInput = {
      key: `@chart-${type}`,
      file: 'test.sql',
      source: 'local',
      text: `-- ---
-- visual:
--   charts:
--     - type: "${type}"
--       x: "day"
--       y: ["revenue"]
-- ---
SELECT 1`,
    }
    const { query } = parseSavedQuery(input)
    expect(query.meta.visual?.charts?.[0]?.type).toBe(type)
  }
})

test('parseSavedQuery throws on an unsupported chart type with the supported list', () => {
  const input: ParseInput = {
    key: '@bad-chart',
    file: 'test.sql',
    source: 'local',
    text: `-- ---
-- visual:
--   charts:
--     - type: "scatter"
--       x: "day"
--       y: ["revenue"]
-- ---
SELECT 1`,
  }
  expect(() => parseSavedQuery(input)).toThrow(/invalid chart type 'scatter'/)
  expect(() => parseSavedQuery(input)).toThrow(/line, bar, area, pie/)
})

test('parseSavedQuery throws on a chart type typo', () => {
  const input: ParseInput = {
    key: '@typo-chart',
    file: 'test.sql',
    source: 'local',
    text: `-- ---
-- visual:
--   charts:
--     - type: "barr"
--       x: "day"
--       y: ["revenue"]
-- ---
SELECT 1`,
  }
  expect(() => parseSavedQuery(input)).toThrow(/invalid chart type 'barr'/)
})

test('parseSavedQuery still drops shape-invalid charts without throwing', () => {
  const input: ParseInput = {
    key: '@shape-invalid',
    file: 'test.sql',
    source: 'local',
    text: `-- ---
-- visual:
--   charts:
--     - type: "line"
--       x: "day"
-- ---
SELECT 1`,
  }
  const { query } = parseSavedQuery(input)
  expect(query.meta.visual?.charts).toBeUndefined()
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `bun test tests/unit/core/saved-queries/visual-parser.test.ts`
Expected: 新增的 4 個測試失敗（未知 type 目前不 throw、被收進 charts）。

- [ ] **Step 3: 立單一來源型別**

在 `src/core/saved-queries/types.ts`，把現有：

```ts
export interface VisualChart {
  type: 'line' | 'bar' | 'area' | 'pie' | 'scatter'
  title?: string
  x: string
  y: string[]
}
```

改為：

```ts
export const SUPPORTED_CHART_TYPES = ['line', 'bar', 'area', 'pie'] as const

export type ChartType = (typeof SUPPORTED_CHART_TYPES)[number]

export interface VisualChart {
  type: ChartType
  title?: string
  x: string
  y: string[]
}
```

- [ ] **Step 4: parser 匯入新符號**

在 `src/core/saved-queries/parser.ts` 既有對 `./types` 的 import 加入 `SUPPORTED_CHART_TYPES` 與 `ChartType`（type-only 用 `import type`）。例如既有具名匯入處追加：

```ts
import { SavedQueryError, SUPPORTED_CHART_TYPES } from './types'
import type { ChartType } from './types'
```

（若 `SavedQueryError` 原本就在某個 import 行，合併即可；勿重複宣告。）

- [ ] **Step 5: call site 傳入 input**

把 `src/core/saved-queries/parser.ts:133`：

```ts
  const visual = normaliseVisual(raw.visual)
```

改為：

```ts
  const visual = normaliseVisual(raw.visual, input)
```

- [ ] **Step 6: normaliseVisual 加驗證**

把 `normaliseVisual` 簽章與 charts 迴圈改為（保留其餘不動）：

```ts
function normaliseVisual(value: unknown, input: ParseInput): any {
  if (value === undefined || value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>

  const title = typeof raw.title === 'string' ? raw.title : undefined

  const kpis: any[] = []
  if (Array.isArray(raw.kpis)) {
    for (const item of raw.kpis) {
      if (typeof item === 'object' && item !== null) {
        const k = item as Record<string, unknown>
        if (typeof k.label === 'string' && typeof k.value_column === 'string') {
          kpis.push({
            label: k.label,
            value_column: k.value_column,
            format: typeof k.format === 'string' ? k.format : undefined,
          })
        }
      }
    }
  }

  const charts: any[] = []
  if (Array.isArray(raw.charts)) {
    for (const item of raw.charts) {
      if (typeof item === 'object' && item !== null) {
        const c = item as Record<string, unknown>
        if (typeof c.type === 'string' && typeof c.x === 'string' && Array.isArray(c.y)) {
          if (!SUPPORTED_CHART_TYPES.includes(c.type as ChartType)) {
            throw new SavedQueryError(
              `Snippet '${input.key}' has invalid chart type '${c.type}' (supported: ${SUPPORTED_CHART_TYPES.join(', ')})`,
              'PARSE_ERROR',
              input.file
            )
          }
          charts.push({
            type: c.type,
            title: typeof c.title === 'string' ? c.title : undefined,
            x: c.x,
            y: c.y.map(String),
          })
        }
      }
    }
  }

  return {
    title,
    kpis: kpis.length > 0 ? kpis : undefined,
    charts: charts.length > 0 ? charts : undefined,
  }
}
```

- [ ] **Step 7: 執行測試確認通過**

Run: `bun test tests/unit/core/saved-queries/visual-parser.test.ts`
Expected: 全數 PASS（含原有 3 個既有測試與新增 4 個）。

- [ ] **Step 8: 型別檢查**

Run: `bun run typecheck`
Expected: 0 error（`VisualChart.type` 收斂後既有用例無破）。

- [ ] **Step 9: Commit**

```bash
git add src/core/saved-queries/types.ts src/core/saved-queries/parser.ts tests/unit/core/saved-queries/visual-parser.test.ts
git commit -m "feat: [dashboard] validate chart type at parse boundary

立 SUPPORTED_CHART_TYPES 單一來源（移除未渲染的 scatter），normaliseVisual 對未知 type throw PARSE_ERROR（訊息含 snippet key 與合法清單）；形狀不符仍寬鬆丟棄。"
```

---

### Task 2: 渲染端防禦縱深（ui-template）

**Files:**
- Modify: `src/ui-template/src/App.tsx`（`COLORS` 常數附近新增可渲染清單；`src/ui-template/src/App.tsx:169-318` 的 chart 容器加守衛）
- Test: `tests/integration/ui-render-smoke.test.tsx`

**Interfaces:**
- Consumes: 既有 `App` default export、`window.__DBCLI_PAYLOAD__` 形狀（`meta.visual.charts: { type: string; title?: string; x: string; y: string[] }[]`）。
- Produces: 無對外新介面（純渲染行為）。

> 說明：ui-template 是獨立 bundle，**不**匯入 core 的 `SUPPORTED_CHART_TYPES`（避免把 core runtime 拉進 UI bundle）；此處自有一份等值清單，為刻意的防禦縱深複製。

- [ ] **Step 1: 寫失敗測試**

在 `tests/integration/ui-render-smoke.test.tsx` 末尾追加：

```tsx
test('App shows an unsupported-chart placeholder instead of a pie chart for unknown types', () => {
  setPayload({
    meta: {
      name: 'Unknown Chart',
      visual: { charts: [{ type: 'scatter', title: 'Scatter', x: 'a', y: ['b'] }] },
    },
    rows: [{ a: 1, b: 2 }],
  })

  render(<App />)
  expect(screen.getByText(/Unsupported chart type/i)).toBeDefined()
})

test('App renders a pie chart type without throwing', () => {
  setPayload({
    meta: {
      name: 'Pie',
      visual: { charts: [{ type: 'pie', title: 'Share', x: 'cat', y: ['val'] }] },
    },
    rows: [{ cat: 'A', val: 5 }],
  })

  expect(() => render(<App />)).not.toThrow()
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `bun test tests/integration/ui-render-smoke.test.tsx`
Expected: 「unsupported-chart placeholder」測試失敗（目前未知 type 靜默渲染為 PieChart，找不到佔位文字）。

- [ ] **Step 3: 新增可渲染清單常數**

在 `src/ui-template/src/App.tsx` 的 `const COLORS = [...]` 那一行之後新增：

```ts
const RENDERABLE_CHART_TYPES = ['line', 'bar', 'area', 'pie']
```

- [ ] **Step 4: 在 chart 容器加守衛與佔位**

把 `src/ui-template/src/App.tsx:169-171` 的：

```tsx
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    {chart.type === 'line' ? (
```

改為（新增外層守衛，原 `ResponsiveContainer` 整段內容保持不變，僅縮排不必更動）：

```tsx
                <div className="flex-1 min-h-0">
                  {RENDERABLE_CHART_TYPES.includes(chart.type) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    {chart.type === 'line' ? (
```

並把原本 `ResponsiveContainer` 的收尾 `src/ui-template/src/App.tsx`（`</ResponsiveContainer>` 後、`</div>` 前，約第 318-319 行）：

```tsx
                    )}
                  </ResponsiveContainer>
                </div>
```

改為：

```tsx
                    )}
                  </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-slate-400">
                      Unsupported chart type: {chart.type}
                    </div>
                  )}
                </div>
```

> 結果：未知 type 不再進入 `ResponsiveContainer`，而 `ResponsiveContainer` 內三元鏈最後的 `else` 自此只會在 `chart.type === 'pie'` 時抵達（其餘已被外層守衛濾除），等同顯式 pie 分支。

- [ ] **Step 5: 執行測試確認通過**

Run: `bun test tests/integration/ui-render-smoke.test.tsx`
Expected: 全數 PASS（含既有兩個 smoke 測試與新增兩個）。

- [ ] **Step 6: 型別檢查**

Run: `bun run typecheck`
Expected: 0 error。

- [ ] **Step 7: Commit**

```bash
git add src/ui-template/src/App.tsx tests/integration/ui-render-smoke.test.tsx
git commit -m "fix: [dashboard] show placeholder for unknown chart types instead of silent pie

ui-template 以自有可渲染清單守衛 chart 容器，未知 type 顯示明確佔位；pie 成為三元鏈顯式 else 分支。"
```

---

### Task 3: 文件與 CHANGELOG 同步

**Files:**
- Modify: `docs/user/zh-TW/index.md:511`
- Modify: `docs/user/en/index.md:579`
- Modify: `docs/user/zh-TW/index.html:559`
- Modify: `docs/user/en/index.html:559`
- Modify: `CHANGELOG.md`（檔首新增 `## [Unreleased]` 區段）

**Interfaces:**
- Consumes: Task 1 的合法清單事實（`line` / `bar` / `area` / `pie`，未知型別解析時報錯）。
- Produces: 無程式介面。

- [ ] **Step 1: 更新 zh-TW Markdown**

把 `docs/user/zh-TW/index.md:511`：

```md
**KPI 與圖表**：在 Snippet 的 Frontmatter 中加入 `visual:` 區塊，即可直接在儀表板中呈現自定義圖表（折線圖、長條圖、圓餅圖等）。
```

改為：

```md
**KPI 與圖表**：在 Snippet 的 Frontmatter 中加入 `visual:` 區塊，即可直接在儀表板中呈現自定義圖表與 KPI。支援的圖表類型為 `line`（折線圖）、`bar`（長條圖）、`area`（區域圖）、`pie`（圓餅圖）四種；指定其他類型會在解析時報錯。
```

- [ ] **Step 2: 更新 en Markdown**

把 `docs/user/en/index.md:579`：

```md
**KPIs & Charts**: Add a `visual:` block to your snippet's frontmatter to render custom charts (line, bar, pie, etc.) and KPIs directly in the dashboard.
```

改為：

```md
**KPIs & Charts**: Add a `visual:` block to your snippet's frontmatter to render custom charts and KPIs directly in the dashboard. Supported chart types are `line`, `bar`, `area`, and `pie`; any other type is rejected at parse time.
```

- [ ] **Step 3: 更新 zh-TW HTML**

把 `docs/user/zh-TW/index.html:559`：

```html
            <p>豐富的視覺化組件（圖表、KPI）可透過 Snippet frontmatter 中的 <code>visual:</code> 區塊進行設定。</p>
```

改為：

```html
            <p>豐富的視覺化組件（圖表、KPI）可透過 Snippet frontmatter 中的 <code>visual:</code> 區塊進行設定。支援的圖表類型為 <code>line</code>、<code>bar</code>、<code>area</code>、<code>pie</code> 四種；指定其他類型會在解析時報錯。</p>
```

- [ ] **Step 4: 更新 en HTML**

把 `docs/user/en/index.html:559`：

```html
            <p>Rich visualizations (charts, KPIs) can be configured via the <code>visual:</code> block in snippet frontmatter.</p>
```

改為：

```html
            <p>Rich visualizations (charts, KPIs) can be configured via the <code>visual:</code> block in snippet frontmatter. Supported chart types are <code>line</code>, <code>bar</code>, <code>area</code>, and <code>pie</code>; any other type is rejected at parse time.</p>
```

- [ ] **Step 5: 新增 CHANGELOG 區段**

在 `CHANGELOG.md` 的 `# Changelog` 前言區塊之後、`## [1.38.1]` 之前，插入：

```md
## [Unreleased]

### Changed

- **`--ui` dashboard chart type 改為解析時驗證。** Saved query 的 `visual.charts[].type` 現以單一合法集合 `line` / `bar` / `area` / `pie` 驗證；指定未支援的類型（含打錯字）會在解析時拋出 `SavedQueryError`（`PARSE_ERROR`），訊息列出合法清單。先前的行為是把任何未知類型**靜默畫成圓餅圖**。型別宣告中從未被渲染的 `scatter` 一併移除。

### Fixed

- **未知 chart type 不再靜默偽裝成圓餅圖。** dashboard 渲染端對非可渲染類型顯示明確的「Unsupported chart type」佔位，而非 fallthrough 成 `PieChart`。
```

- [ ] **Step 6: 全量測試與 lint**

Run: `bun test && bun run typecheck && bun run lint`
Expected: 全綠（確認文件變更未波及程式、全套件通過）。

- [ ] **Step 7: Commit**

```bash
git add docs/user/zh-TW/index.md docs/user/en/index.md docs/user/zh-TW/index.html docs/user/en/index.html CHANGELOG.md
git commit -m "docs: [dashboard] document supported chart types and parse-time validation

docs/user 四檔（en/zh-TW × md/html）列出 line/bar/area/pie 並說明未知類型解析時報錯；CHANGELOG 新增 Unreleased 區段記錄行為收緊與 scatter 移除。"
```

---

## Self-Review

**1. Spec coverage：**
- §3 單一來源 → Task 1 Step 3。✅
- §4 解析邊界驗證 → Task 1 Step 5-6 + 測試 Step 1。✅
- §5 渲染防禦縱深（pie 顯式 + 佔位）→ Task 2 Step 3-4。✅
- §6 資料流（解析中止）→ Task 1（throw 傳播自 `parseSavedQuery`）。✅
- §7 錯誤處理（`SavedQueryError` PARSE_ERROR、含 key 與清單）→ Task 1 Step 6。✅
- §8 測試（parser 四型/未知/錯字/形狀不符；renderer pie/未知）→ Task 1 Step 1、Task 2 Step 1。✅
- §9 文件（四檔 + CHANGELOG）→ Task 3。✅
- §10 驗收（測試/typecheck/lint 全綠）→ Task 3 Step 6。✅

**2. Placeholder 掃描：** 無 TBD/TODO；每個程式步驟含實際程式碼。版本號刻意不動（釋出時決策），以 `## [Unreleased]` 具體呈現，非佔位。✅

**3. 型別一致性：** `SUPPORTED_CHART_TYPES` / `ChartType` 於 Task 1 定義並於 parser 使用；`RENDERABLE_CHART_TYPES`（renderer 自有副本）名稱於 Task 2 一致；`SavedQueryError(message, 'PARSE_ERROR', input.file)` 三參數與 `parser.ts:120` 既有用法一致；`normaliseVisual(value, input)` 簽章與 call site（Step 5）一致。✅
