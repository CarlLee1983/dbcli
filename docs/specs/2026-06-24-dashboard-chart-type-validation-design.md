# Dashboard Chart Type 邊界驗證設計規格

**日期：** 2026-06-24
**狀態：** Implemented — retained as a design record
**Baseline：** dbcli v1.38.1；`--ui` / `--format html` 互動式 HTML dashboard

> **一句話：** `--ui` dashboard 的 `visual.charts[].type` 目前有三個互相矛盾的真實來源，未支援的值（含打錯字）會被**無聲畫成圓餅圖**。本規格把合法 chart type 收斂成單一來源、在解析邊界驗證並報錯、並讓渲染端對未知型別做防禦縱深。

## 1. 問題（有證據）

`--ui` dashboard 由 saved query frontmatter 的 `visual` 區塊驅動。其 chart type
目前存在**三個不一致的真實來源**：

| 來源 | 宣告 / 行為 |
|---|---|
| `src/core/saved-queries/types.ts:55` `VisualChart.type` | 型別為 `'line' \| 'bar' \| 'area' \| 'pie' \| 'scatter'`（5 種，**含 scatter**） |
| `src/core/saved-queries/parser.ts:182-198` `normaliseVisual` | 接受**任何字串**作為 `type`（cast 成 `any`，完全不驗證宣告的 union） |
| `src/ui-template/src/App.tsx:171-317` 渲染端 | 僅顯式渲染 `line` / `bar` / `area`；其餘一律 fallthrough `else → PieChart` |

後果：

1. 任何非 `line/bar/area` 的 `type`——**包含打錯字**（`barr`、`lien`）——會被**無聲地畫成圓餅圖**，不報錯、不提示。
2. 連型別宣告為合法的 **`scatter` 也會被畫成圓餅圖**（渲染端從未實作 scatter）。`pie` 也不是有文件、被驗證的第一級選項，只是 fallthrough 的副作用。
3. 違反專案 coding-style 的「在系統邊界驗證輸入」原則。
4. 本 repo **無任何 chart-type 驗證或測試**；`docs/user/` 亦未列出合法 chart type。

## 2. 目標與非目標

**目標：**
- 合法 chart type 收斂為**單一真實來源**。
- 在**解析邊界**驗證 `type`，未支援者立即報錯（使用者已選定此行為）。
- 渲染端對未知型別做防禦縱深（明確佔位，不再靜默畫成圓餅）。
- `pie` 成為第一級、有文件的選項。

**非目標（YAGNI）：**
- 不新增 `scatter` 或其他圖種的渲染（`scatter` 從未被渲染，本規格將其自合法集合**移除**以讓型別誠實）。
- 不更動 `kpis` 或 `normaliseVisual` 其餘的寬鬆丟棄行為（僅針對 chart `type`）。
- 不把 `visual` 區塊整體改為 zod schema（範圍過大，留待未來）。
- 不更動 `./core` 公開契約（GUI 經 symlink 消費，無關此變更）。

## 3. 單一真實來源

於 `src/core/saved-queries/types.ts` 新增並導出：

```ts
export const SUPPORTED_CHART_TYPES = ['line', 'bar', 'area', 'pie'] as const
export type ChartType = (typeof SUPPORTED_CHART_TYPES)[number]
```

`VisualChart.type` 由 `'line' | 'bar' | 'area' | 'pie' | 'scatter'` 改為
`ChartType`（移除 `scatter`，與渲染端實際能力對齊）。

## 4. 解析邊界驗證（核心改動）

於 `src/core/saved-queries/parser.ts` 的 `normaliseVisual`：

- 維持現有「形狀守衛」：`type` 為 string、`x` 為 string、`y` 為 array 才視為一個
  chart entry；形狀不符者仍**寬鬆丟棄**（不擴大範圍）。
- **新增**：當 entry 形狀合法但 `type` 不在 `SUPPORTED_CHART_TYPES` 內 →
  `throw new SavedQueryError(message, 'PARSE_ERROR')`。
- 錯誤訊息須包含：snippet key、收到的非法 `type` 值、合法 type 清單。範例：
  > `Snippet 'daily_sales' has invalid chart type 'scatter' (supported: line, bar, area, pie)`

理由：邊界 fail-loud，錯誤立即可見，符合 coding-style；`PARSE_ERROR` 為既有 code，
無需擴充 `SavedQueryError` 列舉。

## 5. 渲染防禦縱深

於 `src/ui-template/src/App.tsx` 的 chart 分派：

- 把目前的 fallthrough `else → PieChart` 改為**顯式** `chart.type === 'pie'` 分支。
- 新增最終 `else`：渲染明確的「不支援的圖表類型：`<type>`」佔位卡片，**不再**靜默
  畫成圓餅。

說明：經 §4 驗證後，來自 saved query 的 payload 不會挾帶未知 `type` 到達此分支；此
佔位為**防禦縱深**，保護手工構造或未來其他來源的 payload。`App.tsx` 內部 `Chart`
介面的 `type: string` 維持不變（payload 邊界寬鬆、渲染端自我防禦）。

## 6. 資料流

```
q @snippet --ui
  → 解析 frontmatter（normaliseVisual：§4 驗證 chart type；不合法即 throw 中止）
  → blacklist redaction
  → 注入 window.__DBCLI_PAYLOAD__
  → App.tsx 顯式分派 line/bar/area/pie；未知 → 佔位（§5）
```

## 7. 錯誤處理

- 沿用 `SavedQueryError`（`code: 'PARSE_ERROR'`）。
- 訊息語意化、含 snippet key 與合法清單；不吞錯，原始解析錯誤照既有路徑回報。
- 行為變更說明：先前未知 type 為「靜默畫成圓餅」，現為「解析時報錯中止」。此為刻意
  的破壞性收緊（boundary validation），需在 CHANGELOG 標註。

## 8. 測試策略（TDD）

**parser 單元（`tests/.../parser` 既有套件）：**
- 四個合法 type（`line`/`bar`/`area`/`pie`）皆正常解析、保留於 `visual.charts`。
- 未知 type（`scatter`、`barr` 等錯字）→ throw `SavedQueryError`，`code === 'PARSE_ERROR'`，訊息含合法清單。
- 缺 `x` / `y` 或形狀不符者→仍寬鬆丟棄（不 throw），確認非目標未被波及。

**renderer 單元（`@testing-library/react`，既有 dashboard render 測試）：**
- `type: 'pie'` → 渲染 PieChart（顯式分支）。
- 未知 type 的手工 payload → 顯示「不支援」佔位，且**不**渲染 PieChart。

**型別：** `bun run typecheck` 確認 `VisualChart.type` 收斂後既有用例無破。

## 9. 文件

- `docs/user/en/index.md` + `docs/user/zh-TW/index.md`：於 `visual` schema 區段列出
  合法 chart type（`line` / `bar` / `area` / `pie`）並註明未知型別會在解析時報錯。
- `docs/user/en/index.html` + `docs/user/zh-TW/index.html`：同步（Format Parity）。
- CHANGELOG：記錄行為收緊（未知 chart type 由靜默圓餅改為解析報錯）與 `scatter` 移除。

## 10. 驗收標準

- `SUPPORTED_CHART_TYPES` 為合法集合唯一來源；`VisualChart.type` 由其推導，`scatter` 已移除。
- saved query 帶未知 chart type → `q --ui` / `--format html` 解析時即報 `PARSE_ERROR`，訊息含合法清單。
- 渲染端對未知 type 顯示佔位而非圓餅；`pie` 為顯式分支。
- `bun test`（新增 parser + renderer 測試）、`bun run typecheck`、`bun run lint` 全綠。
- `docs/user/` 四個檔（en/zh-TW × md/html）同步記載合法 chart type。

## Lifecycle closeout

### Current implementation

`SUPPORTED_CHART_TYPES` in `src/core/saved-queries/types.ts` is the single
allow-list. `normaliseVisual` rejects unknown chart types with `PARSE_ERROR`,
while `src/ui-template/src/App.tsx` keeps an explicit `pie` branch and a
defensive unsupported-type placeholder.

### Completion evidence

- Implementation: `dfe5428` and `c623312`.
- Verification: parser and UI smoke tests passed 12 tests during this audit;
  `bun run typecheck` and `bun run lint` also passed.
- Documentation: English and Traditional Chinese Markdown/HTML docs list the
  four supported types and the parse-time failure behavior.

### Known deviations

The renderer still accepts a broad `string` payload type internally so it can
defend against hand-constructed or future payloads; the saved-query parser is
the strict public boundary. This is deliberate defense in depth.
