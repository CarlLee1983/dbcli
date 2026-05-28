# v1.23.0 — Source-Driven Performance Review Tooling

**Spec date**: 2026-05-28
**Driver feedback**: `/Users/carl/Dev/CMG/arcade-report/docs/dbcli-feedback-2026-05-28.md`
**Milestone**: v1.23.0
**Status**: Design (awaiting implementation plan)

## Background

外部使用者在 `arcade-report` 專案執行 source-driven 效能審查時（拿 PR 動到的 service 檔 → 列重型 SQL → 跑 EXPLAIN → 整理表格），回饋 8 個 issue 涵蓋兩大主題：

1. **Bug fixes**：query-only mode 過嚴、錯誤訊息分類錯誤誤導排錯方向、schema bootstrap 多一個來回。
2. **新指令需求**：`dbcli explain` 一級指令（含 `--bulk`）、`dbcli guide missing-index-for`、`dbcli inspect` task pack 提示。

本 spec 把 8 個 issue 整合為 v1.23.0 一個 milestone，切分為 P1–P4 共 4 個 phase，每個 phase 各自 feature branch 與 PR。

## Goals

- **不再誤導**：使用者再也不會把 SQL 語法錯或 table 不存在誤認為連線錯。
- **EXPLAIN 提升為一級工具**：直接輸出可貼進 PR 的 markdown，支援批次、自動標籤化問題點。
- **索引建議聚焦到單一 query**：補上 `guide index-usage` 缺的 per-query 視角。
- **Agent step-1 可發現 task packs**：`inspect` 主動提示，不靠 agent 記憶。

## Non-Goals

- 不重寫整體權限模型（P1 只局部放寬 classifier）。
- `dbcli explain --from-diff`：留 v1.24+，本 milestone 不做。
- Mongo / ES / Redis 的 EXPLAIN 對應：本 milestone 不做（無概念對應）。
- Functional / partial index 建議：P3 只警示，不主動推薦。
- 跨方言完整 SQL parser：採用既有 `node-sql-parser`，方言邊界 fallback 為 EXPLAIN 啟發式。

## Phase Overview

| Phase | 主題 | 涵蓋 feedback issue | 預估規模 |
|---|---|---|---|
| **P1** | Error classification & query-only 修正 | #1 SHOW auto-LIMIT、#2 ANALYZE SELECT、#3 Table not found 訊息、#7 schema refresh first-time | 中（~600–800 LOC + tests） |
| **P2** | `dbcli explain` 一級指令 + `--bulk` | #4、#5 | 中-大（~1000–1500 LOC + tests） |
| **P3** | `dbcli guide missing-index-for` 含 SQL parser | #6 | 大（~1500–2000 LOC + tests） |
| **P4** | `dbcli inspect` suggestedCommands 強化 | #8 | 小（~200–300 LOC + tests） |

**Branch 策略**：4 個獨立 feature branch（`feature/v1.23-p1-error-classification`、`feature/v1.23-p2-explain`、`feature/v1.23-p3-missing-index`、`feature/v1.23-p4-inspect-hints`），各自 PR 各自 merge 到 main。Release tag 在 P4 merge 後打 `v1.23.0`，中間每個 phase 完成打 `v1.23.0-alpha.N`/`-beta.N`。

**DB 支援矩陣**：P1/P2/P3 全部支援 MySQL/MariaDB/PostgreSQL。Mongo/ES/Redis 不適用。

**Phase 依賴**：P3 → P2（P3 重用 P2 的 explain runner 拿真實 plan）；其他 phase 互相獨立。

---

## P1 — Error Classification & Query-Only 修正

### P1.1 Issue #1 — SHOW/DESCRIBE 不再被 auto-LIMIT 注入

**現況**：`src/core/query-executor.ts:60-70` 對所有 query-only 語句注入 `LIMIT 1000`，造成 `SHOW INDEX FROM ...` 等語句被 server 拒絕。錯誤又被誤包成 connection error。

**改動**：

```typescript
// src/core/query-executor.ts
const AUTO_LIMIT_TYPES = new Set(['SELECT'])  // 只對 SELECT 套用

if (this.permission === 'query-only' &&
    AUTO_LIMIT_TYPES.has(classification.type) &&
    !executeSql.match(/LIMIT\s+\d+/i) &&
    options?.autoLimit !== false) {
  // 既有邏輯
}
```

`classification` 在前一行 `enforcePermission(sql, this.permission)` 已取得，無需重複 classify。

### P1.2 Issue #2 — `ANALYZE SELECT` / `EXPLAIN ANALYZE` 視為 read-only

**現況**：`src/core/permission-guard.ts` 把 `ANALYZE` 開頭歸為 UNKNOWN，query-only 拒絕執行。錯誤訊息「required: query-only」與當前等級矛盾。

**改動**：`src/core/permission-guard.ts:classifyStatement` 入口新增 MariaDB 變體偵測：

```typescript
export function classifyStatement(sql: string): StatementClassification {
  const normalized = normalizeSQL(sql)
  const stripped = stripCommentsAndStrings(normalized)

  // MariaDB 'ANALYZE SELECT' is a read-only EXPLAIN variant
  if (/^\s*ANALYZE\s+SELECT\b/i.test(stripped)) {
    return {
      type: 'EXPLAIN',
      isDangerous: false,
      keywords: extractAllKeywords(stripped),
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 既有邏輯
}
```

PG 的 `EXPLAIN (ANALYZE, BUFFERS) SELECT ...` 既有 `extractFirstKeyword` 已正確歸為 `EXPLAIN`；補測試驗證。

**UNKNOWN 錯誤訊息**：當 classify 為 UNKNOWN 且權限不允許時，訊息改為：

> 「未識別的 SQL 語句（current level: query-only）。安全策略要求 read-write+ 才能執行未知語句。若這是合法的 read-only 語法，請在 GitHub 開 issue 回報。」

### P1.3 Issue #3 — Table-not-found / SQL syntax error 訊息分流

**現況**：`src/adapters/error-mapper.ts` 把所有 driver 錯誤都 fallback 成 `Connection failed`，並印連線排錯 hint。

**改動**：`mapError` 在現有 fallback 之前加新分類器：

| 分類 | MySQL/MariaDB code | PostgreSQL code | 訊息 |
|---|---|---|---|
| `SQL_SYNTAX_ERROR` | `1064` (ER_PARSE_ERROR) | `42601` | "SQL syntax error: ..." + hint「檢查語法；query-only 可用 `--no-limit`」 |
| `TABLE_NOT_FOUND` | `1146` (ER_NO_SUCH_TABLE) | `42P01` | "Table 'X' not found in database 'Y'" + hint「`dbcli list`」+ fuzzy match 候選 |
| `COLUMN_NOT_FOUND` | `1054` | `42703` | "Column 'X' not found in table 'Y'" + hint「`dbcli schema <table>`」 |

**分流原則**：driver 在連線階段（pool.connect）丟錯 → 既有 ECONNREFUSED/AUTH_FAILED 邏輯。driver 在 execute 階段丟錯 → 新分類器。

**Schema 命令整合**：`src/commands/schema.ts` 捕捉到 `TABLE_NOT_FOUND` 時呼叫既有 `suggestTableName()`（`src/utils/error-suggester.ts`），把 top-3 候選印在 hint 區。

### P1.4 Issue #7 — Schema refresh first-time bootstrap

**現況**：`src/commands/schema.ts:438-442` 對任何 schema diff 都要求 `--force`，第一次（無 cache）也得跑兩次。

**改動**：

```typescript
// src/commands/schema.ts handleSchemaRefresh
const isFirstTime = Object.keys(config.schema || {}).length === 0
if (!options.force && !isFirstTime) {
  console.log('   Use --force to apply changes')
  return
}
if (isFirstTime) {
  console.log('   First-time bootstrap (no existing cache to protect)')
}
// 繼續寫入
```

訊息分流：
- bootstrap：「✅ Schema cache initialised (N tables)」
- update：「✅ Schema updated (N added / M removed / K modified)」

### P1 測試

- `tests/unit/core/query-executor.test.ts`：SHOW/DESCRIBE/EXPLAIN 不被注入 LIMIT
- `tests/unit/core/permission-guard.test.ts`：`ANALYZE SELECT`、`EXPLAIN (ANALYZE, BUFFERS) SELECT` 正確分類為 EXPLAIN
- `tests/unit/adapters/error-mapper.test.ts`：1064 / 42601 / 1146 / 42P01 / 1054 / 42703 各 code 對應正確訊息
- `tests/unit/commands/schema-refresh-bootstrap.test.ts`：first-time 不需 `--force`
- 整合測試（既有 docker compose）：跨 MySQL/MariaDB/PostgreSQL 驗證 P1 端到端

---

## P2 — `dbcli explain` 一級指令 + `--bulk`

### P2.1 指令介面

```bash
# 基本
dbcli explain "SELECT ... FROM betting_logs WHERE ..."

# 對 saved query
dbcli explain @analytics/live-summary --param hosterSpaceId=1

# ANALYZE 變體
dbcli explain --analyze "SELECT ..."

# 輸出格式（預設 markdown）
dbcli explain "..." --format json
dbcli explain "..." --format markdown
dbcli explain "..." --format table

# 批次
dbcli explain --bulk @queries-to-review.sql --format markdown
dbcli explain --bulk @analytics/* --format markdown
```

`--from-diff` 留 v1.24+。

### P2.2 架構

```
src/commands/explain.ts             # CLI handler、flag、bulk 迴圈
src/core/explain/
  ├─ types.ts                       # ExplainRow、ExplainPlan、ExplainAnnotation
  ├─ runner.ts                      # 單條 query → ExplainPlan
  ├─ bulk-runner.ts                 # @file / glob / saved query 展開 + 多筆
  └─ annotate.ts                    # 語意標籤
src/adapters/explain/
  ├─ index.ts                       # adapter-aware dispatcher
  ├─ mysql-mariadb.ts               # EXPLAIN / ANALYZE SELECT → 統一 schema
  └─ postgresql.ts                  # EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) → 統一 schema
src/formatters/explain/
  ├─ markdown.ts                    # | Query | driving | type | key | rows | Extra |
  ├─ json.ts
  └─ table.ts                       # 重用既有 TableFormatter
```

### P2.3 統一 Plan Schema

```typescript
interface ExplainRow {
  queryLabel?: string          // bulk mode 才有
  driving: string              // MySQL table / PG plan node alias
  accessType: string           // MySQL type / PG node-type
  key: string | null           // MySQL key / PG index name
  rows: number                 // 估算列數
  filtered?: number            // MySQL filtered %
  extra: string[]              // Using temporary、Sort Method 等
  cost?: { startup: number, total: number }  // PG only
  annotations: ExplainAnnotation[]
}

interface ExplainAnnotation {
  severity: 'red' | 'yellow' | 'gray'
  rule: 'full-scan' | 'temp-table' | 'filesort' | 'cost-estimate-skew' | 'nested-loop-large'
  message: string
}
```

### P2.4 Annotation 規則

| 規則 | MySQL/MariaDB 觸發 | PostgreSQL 觸發 | 嚴重度 |
|---|---|---|---|
| `full-scan` | `type=ALL` 或 `key=NULL` | `Seq Scan` | red |
| `temp-table` | `Extra` 含 `Using temporary` | `HashAggregate`/`Sort` over derived | yellow |
| `filesort` | `Extra` 含 `Using filesort` | `Sort Method: external merge` | yellow |
| `cost-estimate-skew` | rows vs actual rows 比例 > 10x（需 ANALYZE） | 同樣比例 | gray |
| `nested-loop-large` | `rows > 10000` 且 access type 為 nested-loop 一側 | `Nested Loop` cost > threshold | yellow |

閾值寫成常數集中於 `src/core/explain/annotate.ts` 開頭，方便日後調整或開放 `--annotation-config` flag。

預設 `--format markdown` 用 `**bold**` / `_italic_` / 灰底；`--format table`（ANSI）才上顏色。

### P2.5 PostgreSQL 細節

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` 回傳 JSON tree。`src/adapters/explain/postgresql.ts`：

1. 遞迴展開 `Plans[*]` 為 row-per-node
2. Pick leaf-most relations 當 `driving`
3. Convert `Node Type` → `accessType`（`Seq Scan` → `ALL`、`Index Scan` → `ref`，建對照表）
4. `Index Name` → `key`

### P2.6 `--bulk` 來源解析

| 輸入形式 | 處理 |
|---|---|
| `@queries.sql` | 讀檔、依 `;` 拆分（忽略 comments） |
| `@analytics/*` | Saved-queries glob expansion（重用 `src/core/saved-queries`） |
| `@analytics/live-summary` | 單一 saved query |
| 多個位置參數 | 多條原始 SQL |

含 `*` 視為 glob；否則先查 saved-queries store；找不到才 fallback 當路徑。每條 query 加 `queryLabel`，markdown 輸出時放表格第一欄。

### P2.7 與 P1 的耦合

P1 已把 `ANALYZE SELECT` / `EXPLAIN ANALYZE` 歸為 read-only。`dbcli explain --analyze` 在 query-only mode 可直接執行，不偷偷升級權限。

### P2 測試

- `tests/unit/core/explain/runner.test.ts`：mock adapter、fake EXPLAIN → 驗證 normalize + annotation
- `tests/unit/core/explain/bulk-runner.test.ts`：`@file`、glob、多參數展開
- `tests/unit/adapters/explain/mysql-mariadb.test.ts`：raw EXPLAIN → ExplainRow
- `tests/unit/adapters/explain/postgresql.test.ts`：PG JSON tree → ExplainRow（含遞迴 fixture 集）
- `tests/unit/formatters/explain/markdown.test.ts`：標籤色彩、對齊
- `tests/unit/commands/explain.test.ts`：CLI flag、error path（`--analyze` 對非 SELECT 拒絕）
- 整合測試:真實 MariaDB/PG 各 3 條代表性 query

### P2 風險

- PG plan tree 遞迴展開：先建多種 fixture（subquery、CTE、partition scan、parallel）再開發
- Annotation 閾值需 tune：P2 ship 後若必要快速 patch
- `--bulk` glob 與 saved query 衝突：明確優先序（含 `*` → glob → store → 路徑）

---

## P3 — `dbcli guide missing-index-for` 含 SQL parser

### P3.1 指令介面

```bash
dbcli guide missing-index-for "SELECT ... FROM betting_logs b JOIN hoster_machines hm ..."
dbcli guide missing-index-for @analytics/live-summary
dbcli guide missing-index-for "..." --format yaml      # 預設
dbcli guide missing-index-for "..." --format json
dbcli guide missing-index-for "..." --format markdown
dbcli guide missing-index-for "..." --min-confidence medium
```

### P3.2 SQL Parser

**選用 `node-sql-parser`**：純 TS、支援 MySQL/PostgreSQL/MariaDB 方言、維護活躍、無 native 相依、Bun 相容。

新增 production 相依：`bun add node-sql-parser`。

替代方案皆不採用：
- `pgsql-parser`：PG-only
- 自寫 mini-parser：成本高、風險大（feedback 原文已警示）
- `sql-parser-cst`：AST 過於低階

### P3.3 架構

```
src/core/guide/missing-index/
  ├─ types.ts                    # IndexCandidate、QueryAnalysis、AnalysisWarning
  ├─ analyzer.ts                 # 主控:parse → enrich → score → output
  ├─ sql-extractor.ts            # AST → 結構化 column refs
  ├─ explain-enricher.ts         # 跑 P2 explain 拿真實 plan
  ├─ index-introspector.ts       # information_schema / pg_indexes
  ├─ candidate-builder.ts        # 推複合索引
  ├─ scorer.ts                   # confidence + reason
  └─ warnings.ts                 # 函式索引、type cast 警告

src/formatters/guide/
  ├─ missing-index-yaml.ts
  ├─ missing-index-json.ts
  └─ missing-index-markdown.ts
```

### P3.4 分析流程

```
[1] node-sql-parser → AST
      失敗 → fallback：僅做 EXPLAIN 啟發式 + warning
[2] sql-extractor 抽出每個 table 的：
      - filter columns（WHERE / HAVING）
      - join columns（ON 兩側）
      - order columns（ORDER BY / GROUP BY）
      - functional columns（DATE(x)、UPPER(x) → warning）
[3] explain-enricher：呼叫 P2 explain runner 拿 access type / key / rows / Extra
[4] index-introspector 抓現有索引：
      MySQL/MariaDB: information_schema.STATISTICS
      PostgreSQL: pg_indexes + pg_index
[5] candidate-builder 對每個 table 產候選複合索引
      排序:equality > range > order/group
      覆蓋:JOIN column 後接 WHERE column
[6] scorer：
      high   = type=ALL + 候選完整覆蓋 WHERE+JOIN
      medium = 部分覆蓋 或 既有單列索引可改成複合
      low    = 啟發式推測
[7] warnings 收集（含 parser-limit 提示）
```

### P3.5 輸出範例

```yaml
query: "SELECT ... FROM betting_logs b JOIN hoster_machines hm ..."
candidates:
  - table: betting_logs
    columns: [user_id, settled_at]
    reason: |
      WHERE b.settled_at >= ? 與 JOIN b.user_id = hm.user_id；
      目前 access_type=ref (key=user_id_index)，settled_at 仍需 filter pass。
      複合索引可把 filtered % 從 ~20% 推到接近 100%。
    confidence: high
    existing_index_collision: null
    estimated_rows_reduction: "546 → ~50 (per user × time window)"
  - table: hoster_machines
    columns: [hoster_space_id, user_id]
    reason: |
      hm 走 type=ALL（rows=20），hoster_space_id 過濾後仍需 user_id 給 nested loop join。
    confidence: medium
warnings:
  - rule: functional-expression
    column: settled_at
    detail: |
      GROUP BY DATE(settled_at) 使用函式 → 索引無法避免 filesort。
      考慮 (1) MariaDB generated column + 索引 (2) 改用範圍 WHERE。
  - rule: parser-limit
    detail: window function 在 SELECT clause；分析範圍限於 WHERE/JOIN/ORDER。
```

### P3.6 邊界與限制（明確 docs 揭露）

- 支援單一 SELECT；不分析 INSERT/UPDATE/DELETE 子查詢
- 不分析 stored procedure、view 內 SQL
- functional / partial index 只標 warning，不主動建議（留 v1.24+）
- 跨方言以 node-sql-parser 支援為準；不支援方言走 fallback

### P3 測試

- `tests/unit/core/guide/missing-index/sql-extractor.test.ts`：各種 WHERE/JOIN/ORDER BY pattern
- `tests/unit/core/guide/missing-index/candidate-builder.test.ts`：fixture 進、候選出
- `tests/unit/core/guide/missing-index/scorer.test.ts`：信心度判定
- `tests/unit/core/guide/missing-index/warnings.test.ts`：函式索引 / type cast
- `tests/unit/core/guide/missing-index/analyzer.test.ts`：end-to-end with mocked adapter
- 整合測試:對真實 MariaDB/PG 跑 feedback 文件提到的 live-report query，驗證輸出與人工分析接近

### P3 風險

- node-sql-parser 方言邊界（如 MariaDB `ANALYZE SELECT`、JSON path） → fallback 模式
- 建議「正確性」評估：輸出永遠帶 `confidence` 與 `reason`，不寫「應該建立」斷言
- 效能:對長 query parse + explain + introspect 可能 > 1 秒；加 timeout protection
- PG vs MySQL 索引語意差異（partial / expression）：輸出語法用兩段註記避免混淆

---

## P4 — `dbcli inspect` suggestedCommands 強化

### P4.1 改動範圍

| 檔案 | 改動 |
|---|---|
| `src/core/inspect/suggest-commands.ts` | 主要邏輯：擴展候選命令 |
| `src/core/inspect/types.ts` | `InspectSnapshot` 新增 `hints: string[]` |
| `src/core/inspect/collector.ts` | 收集 `auditRecent`、task pack 數量 |
| `src/core/inspect/render-json.ts` | 序列化 `hints` |
| `src/core/inspect/render-markdown.ts` | human-readable footer |

### P4.2 三層加權邏輯

```typescript
function suggestCommands(snap, opts): string[] {
  const out: string[] = []

  // Tier 1 — bootstrap（既有）
  if (isSql && (!snap.schemaCache.available || snap.schemaCache.stale)) {
    out.push('dbcli schema --refresh')
  }
  out.push('dbcli list --format json')

  // Tier 2 — context-aware（NEW）
  const topTable = snap.auditRecent?.topTables?.[0]
  if (topTable && taskPacksAvailable(snap)) {
    out.push(`dbcli skill tasks plan analyze-table-perf --param table=${topTable}`)
  }

  const topIntent = snap.snippets.intents[0]
  if (topIntent) {
    const prefix = topIntent.intent.split('.')[0]
    out.push(`dbcli queries suggest ${prefix} --format json`)
  }

  // Tier 3 — discovery（NEW）
  if (taskPacksAvailable(snap) && !alreadySeenTaskPacks(snap)) {
    out.push('dbcli skill tasks list')
  }

  out.push('dbcli doctor --format json')

  const cap = opts.brief ? 1 : 5
  return out.slice(0, cap)
}
```

### P4.3 新 `hints` 欄位

`InspectSnapshot` 加 `hints: string[]`，與 `suggestedCommands` 平行。`hints` 是「文字提示」，`suggestedCommands` 是「可執行命令」。

JSON 範例：

```json
{
  "suggestedCommands": [
    "dbcli schema --refresh",
    "dbcli skill tasks plan analyze-table-perf --param table=betting_logs",
    "dbcli skill tasks list"
  ],
  "hints": [
    "Most queried table in last 5 runs: betting_logs",
    "21 task packs available — run `dbcli skill tasks list` to browse",
    "Schema cache: 115 tables, last refreshed 2 hours ago"
  ]
}
```

### P4.4 Human-readable footer

`render-markdown.ts` 在最後加 footer（只在 task pack 存在時）：

```
─────────────────────────────────────
Tip: 21 task packs available.
Run `dbcli skill tasks list` to browse.
─────────────────────────────────────
```

### P4.5 Top-table 抽取

**來源**：既有 audit log（`.dbcli/audit/`）

**演算法**：
1. 讀近 10 條 entries（既有 reader）
2. 對每條抽 `tableName`（重用 `extractTableName` from `engine-hints.ts`）
3. 計數，回傳 top-1

audit 為空 / 全部抽不出表 → 跳過 Tier 2 第一條建議，不報錯。

### P4.6 Task pack 偵測

- `taskPacksAvailable(snap)`：呼叫 `src/core/agent-tasks/` 既有 registry 拿數量
- `alreadySeenTaskPacks(snap)`：偵測最近 audit 是否已有 `dbcli skill tasks` invocation；若有則不再推薦（避免重複）

### P4.7 相容性

- `--brief` 行為不變（仍只回 1 條）
- `--for-agent` JSON shape 向後相容（既有 consumer 只讀 `suggestedCommands`，新增 `hints` 不 break）
- 5 條 cap 維持

### P4 測試

- `tests/unit/core/inspect/suggest-commands.test.ts`：
  - 有 audit + task pack → 推 `analyze-table-perf`
  - 沒 audit → 跳過 Tier 2
  - 已 seen task packs → 不推 `tasks list`
  - `--brief` 仍只回 1 條
- `tests/unit/core/inspect/collector.test.ts`：`auditRecent.topTables` 抽取
- `tests/unit/core/inspect/render-markdown.test.ts`：footer 時機
- 整合測試:JSON shape

### P4 風險

- Audit log 讀取效能：每次 inspect 都讀近 10 條；既有 cache 應已夠用，但需 benchmark gate（> 200ms 不准 merge）
- Task pack registry 載入：若延遲載入，inspect 觸發冷啟動成本 → 加 lightweight count API（只回數字不載入 metadata）

---

## 全體測試與 Release 策略

### 測試門檻

- 各 phase 完成時 unit + integration 全綠
- Coverage 維持專案既定門檻
- P2/P3 額外跑 real-DB 整合測試（docker compose 起 MariaDB + PostgreSQL）

### Backward Compatibility

- P1 全部是放寬或訊息改善，無 breaking
- P2 新增指令，不動現有 `dbcli query "EXPLAIN ..."`
- P3 新增 sub-command，不動 `dbcli guide index-usage`
- P4 既有 `suggestedCommands` shape 不變，只擴內容；新增 `hints` 是 additive

### Release Flow

1. P1 PR → review → merge → tag `v1.23.0-alpha.1`
2. P2 PR → review → merge → tag `v1.23.0-alpha.2`
3. P3 PR → review → merge → tag `v1.23.0-beta.1`
4. P4 PR → review → merge → tag `v1.23.0`
5. Final：`docs/user/{en,zh-TW}/{index.md,index.html}` 同步更新（依專案 mandate）

### 整體風險摘要

| 風險 | 影響 | 緩解 |
|---|---|---|
| `node-sql-parser` 方言邊界 | P3 部分 query 走 fallback | docs 明確揭露；fallback 仍給 EXPLAIN 啟發式 |
| PG plan tree 遞迴複雜度 | P2 開發時程拉長 | 先建 fixture 集再開發 |
| Annotation 閾值需 tune | P2 早期使用者抱怨「黃太多/少」 | 閾值集中常數管理；ship 後快速 patch |
| Audit log 效能 | P4 inspect 變慢 | benchmark gate > 200ms 不准 merge |
| node-sql-parser 套件依賴新增 | 攻擊面、bundle size | 已是廣泛使用套件；P3 PR 含 npm-audit gate |

## Open Questions

- **Annotation 閾值是否做 config**：v1.23 先固定常數；若 ship 後反饋需要再加 `--annotation-config`。
- **`--from-diff` 是否提前到 v1.23 P2.5**：暫不；等 P2 ship 後看實際使用頻率。
- **P3 fallback mode 的輸出格式**：目前設計為「同樣的 schema 但 `candidates=[]`、`warnings` 含 parser-limit」；待 P3 實作時驗證可讀性。
