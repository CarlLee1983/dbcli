# MongoDB Feature Gaps Implementation Plan

> **For agentic workers:** Tasks use checkbox (`- [ ]`) syntax. Each PR section is independently shippable — finish one PR's tasks, run `bun run typecheck && bun test`, commit, ship, then move to the next.

**Goal:** 補齊 `docs/feature-matrix.md` 列出的 MongoDB 功能差距，使 mongo 連線在「日常讀寫 + 安全防護」面與 SQL 連線體驗一致。較重的差距（`check` / `diff` / saved snippets）拆到 P2，獨立 milestone。

**Source of truth:** `docs/feature-matrix.md` 第 12–37 行的 ⚠️/❌ 欄位與「MongoDB limitations summary」段落。

**Tech context:** TypeScript / Bun / commander。MongoDB 走 `src/adapters/mongodb-adapter.ts`，CLI 路由在各 `src/commands/*.ts` 中以 `config.connection.system === 'mongodb'` 分支。

**Out of scope:** `migrate` DDL、shell 內 raw SQL、aggregation 以外的 mongo 原生指令（如 `$out`, `$merge`）— 設計上不適用。

---

## File Map

### Modified Files

| File | Purpose |
|------|---------|
| `src/adapters/mongodb-adapter.ts` | `execute` 接受 limit；`getTableSchema` 接受 sampleSize |
| `src/adapters/types.ts` | `QueryableAdapter.execute` 新增可選第三參數 `{ limit? }` |
| `src/commands/query.ts` | mongo 分支把 `--limit` 傳下去；query-only 自動上限 |
| `src/commands/insert.ts` | mongo 分支：blacklist + dry-run |
| `src/commands/update.ts` | mongo 分支：blacklist + dry-run |
| `src/commands/delete.ts` | mongo 分支：blacklist + dry-run |
| `src/commands/export.ts` | mongo 分支：呼叫 mongo adapter + 共用 formatter |
| `src/commands/schema.ts` | mongo 推斷後寫入 `schemaLastUpdated`；CLI `--sample-size` |
| `src/commands/shell.ts` | mongo 走 `MongoShellAdapter`：lazy fetch 欄位灌入 `columnsByTable` |
| `src/core/blacklist-validator.ts` | 新增 `checkColumnBlacklistOnWrite(table, fields)` |
| `resources/lang/zh-TW/*.json` / `en/*.json` | 新訊息字串（dry-run 預覽、blacklist 寫入錯誤） |

### New Files

| File | Purpose |
|------|---------|
| `src/core/mongo/dry-run-formatter.ts` | 把 insert/update/delete 計劃輸出為 `db.<col>.xxx(...)` 預覽字串 |
| `tests/core/mongo/dry-run-formatter.test.ts` | dry-run 預覽單元測試 |
| `tests/commands/mongo-blacklist.test.ts` | 寫路徑 blacklist 攔截測試 |
| `tests/commands/mongo-export.test.ts` | export 路徑覆蓋（json / csv / jsonl） |

### P2 (future PRs) – 暫不建檔，僅列在文末

---

## PR1 — Safety & Limit Honesty (P0)

**Why first:** 補上「目前已記錄但實際不存在」的兩個保證 — `--limit` 真的限制結果、blacklist 真的防止寫敏感欄位。

### Task 1.1: `QueryableAdapter.execute` 接受 limit

**Files:** `src/adapters/types.ts`, `src/adapters/mongodb-adapter.ts`

- [ ] 在 `QueryableAdapter` 的 `execute` 介面新增可選第三參數 `options?: { limit?: number }`
- [ ] `MongoDBAdapter.execute`：
  - 物件 filter → `collection.find(filter).limit(opts.limit ?? 0).toArray()`（mongo driver `0` 視為無限制）
  - 陣列 pipeline → 若使用者尚未在尾端放 `$limit`，且 `opts.limit` 存在，則 `pipeline.concat([{ $limit: opts.limit }])`；否則沿用原 pipeline
- [ ] 新測試：`tests/adapters/mongodb-adapter.test.ts` 加入「limit 套用於 find」「limit 不覆蓋既有 $limit」「limit 套用於 pipeline 末段」三案例（用 fake driver / mock client）

### Task 1.2: `query --limit` 真正下傳

**Files:** `src/commands/query.ts`

- [ ] `mongoQueryBranch` 把 `options.limit` 傳給 `mongoAdapter.execute(queryStr, [collection], { limit })`
- [ ] 移除「`--limit` 在 mongo 上被忽略」的隱含行為；保留 size guard 的判斷邏輯不變
- [ ] 補測試：`tests/commands/query.mongo.test.ts` — 給 `--limit 3`，期望回傳 ≤3 docs（用 in-memory fake adapter）

### Task 1.3: query-only 自動上限套用於 mongo

**Files:** `src/commands/query.ts`

- [ ] 在 `mongoQueryBranch` 內，若 `config.permission === 'query-only'` 且使用者未指定 `--limit` 與 `--no-limit`，套用預設值（沿用 SQL 路徑現有常數，建議從 `query-executor` 抽出共用 const）
- [ ] 將共用值集中：抽 `DEFAULT_QUERY_ONLY_LIMIT` 到 `src/core/limits.ts`（如已存在則直接 import）
- [ ] 測試：query-only 連線、無 `--limit`，期望結果有上限；`--no-limit` 時不套用

### Task 1.4: 新增 `checkColumnBlacklistOnWrite`

**Files:** `src/core/blacklist-validator.ts`, `tests/core/blacklist-validator.test.ts`

- [ ] 新方法 `checkColumnBlacklistOnWrite(table: string, fields: string[]): void`
  - 若 `fields` 與 `manager.getBlacklistedColumns(table)` 有交集 → 拋 `BlacklistError`，訊息列出衝突欄位
  - override 啟用時走現有 console.error 警告路徑
- [ ] 測試：交集 / 無交集 / override 三案例

### Task 1.5: insert mongo 路徑套用 blacklist

**Files:** `src/commands/insert.ts`

- [ ] mongo 分支在 `enforcePermission` 之後插入：
  - `blacklistValidator.checkTableBlacklist('INSERT', table, [])`
  - `blacklistValidator.checkColumnBlacklistOnWrite(table, Object.keys(data))`
- [ ] `tests/commands/mongo-blacklist.test.ts`：blacklisted table / blacklisted column 兩案例都應 exit 1 並輸出 BlacklistError JSON

### Task 1.6: update mongo 路徑套用 blacklist

**Files:** `src/commands/update.ts`

- [ ] mongo 分支：
  - `checkTableBlacklist('UPDATE', table, [])`
  - 從 `setData` 取出待寫欄位（若有 `$set` 則取 `setData.$set` 的 keys；若有 `$unset` 取那些 keys；其他 operator 暫只檢查 top-level keys）
  - `checkColumnBlacklistOnWrite(table, fields)`
- [ ] 測試：`$set` 含禁寫欄位 → 攔截；replacement doc 含禁寫欄位 → 攔截

### Task 1.7: delete mongo 路徑套用 blacklist

**Files:** `src/commands/delete.ts`

- [ ] mongo 分支：`checkTableBlacklist('DELETE', table, [])`（DELETE 不需檢查欄位 blacklist）
- [ ] 測試：blacklisted table → 攔截

**PR1 Acceptance:**
- [ ] `bun run typecheck && bun test` 全綠
- [ ] 手測：`dbcli query '{}' --collection users --limit 5 --format json` 回傳恰 5 筆
- [ ] 手測：blacklist 設 `users.password` 後，`dbcli insert users --data '{"password":"x"}'` 失敗
- [ ] 更新 `docs/feature-matrix.md`：移除「`--limit` 被忽略」「mongo 寫路徑跳過 blacklist」兩條描述

---

## PR2 — Dry-Run & Export (P1)

**Why second:** 對齊 SQL 工作流。dry-run 是寫入操作的安全網，export 是 mongo 最常見的「我要把資料拿出來」需求。

### Task 2.1: 建立 `MongoDryRunFormatter`

**Files:** `src/core/mongo/dry-run-formatter.ts`, `tests/core/mongo/dry-run-formatter.test.ts`

- [ ] 純函式三隻：`previewInsert(col, doc)` / `previewUpdate(col, filter, updateDoc)` / `previewDelete(col, filter)`
- [ ] 輸出形如 `db.<col>.insertOne(<json>)`，json 用 2-space pretty print
- [ ] 測試：三隻函式對應的 snapshot

### Task 2.2: insert `--dry-run`

**Files:** `src/commands/insert.ts`

- [ ] mongo 分支進入 driver 前判斷 `options.dryRun`，若是則：
  - 輸出與 SQL 路徑同樣結構的 JSON：`{ status, operation, rows_affected: 0, sql: <preview-string>, timestamp }`
  - 不開連線、不執行 `insertOne`
- [ ] 測試：`--dry-run` 不呼叫 driver、輸出包含預覽字串

### Task 2.3: update `--dry-run`

**Files:** `src/commands/update.ts`

- [ ] 同上；preview 字串使用 wrap 過後的 update doc（含自動 `$set`）
- [ ] 測試：`--set '{"a":1}' --dry-run` 預覽含 `{"$set":{"a":1}}`

### Task 2.4: delete `--dry-run`

**Files:** `src/commands/delete.ts`

- [ ] 同上；測試覆蓋 JSON filter 與 `key=value` 兩種輸入

### Task 2.5: `export` mongo 支援

**Files:** `src/commands/export.ts`, `tests/commands/mongo-export.test.ts`

- [ ] 在 `export.ts` 開頭的 mongo 拒絕分支改寫為走專用流程：
  - 必填：`--collection <name>`
  - 選填：`--query <json-filter-or-pipeline>`（沿用 query.ts 的 SQL/JSON 偵測，禁止 SQL 字串）
  - 選填：`--limit`、`--format json|jsonl|csv`（預設 jsonl，因為 mongo doc 結構差異大）
  - 套用 blacklist：表 + 欄位過濾（沿用 read 路徑現有 `filterColumns`）
- [ ] CSV 模式對嵌套欄位用 JSON.stringify 序列化（並輸出 stderr 警告）
- [ ] 測試：json / jsonl / csv 各一案例 + blacklisted column 過濾 + 拒絕 SQL 字串

**PR2 Acceptance:**
- [ ] `bun run typecheck && bun test` 全綠
- [ ] 手測：`dbcli insert users --data '{...}' --dry-run` 顯示預覽且不寫入
- [ ] 手測：`dbcli export --collection orders --format jsonl > orders.jsonl` 可成功匯出
- [ ] 更新 `docs/feature-matrix.md`：`export` 從 ❌ 改 ⚠️/✅；寫路徑加註「支援 `--dry-run`」

---

## PR3 — Schema, Cache, Completion (P1)

**Why third:** 把推斷品質從「夠用」推到「真的可信」，並讓 shell 對 mongo 也友善。

### Task 3.1: `getTableSchema` 接受 `sampleSize`

**Files:** `src/adapters/mongodb-adapter.ts`, `src/adapters/types.ts`

- [ ] `getTableSchema(name, options?: { sampleSize?: number })`，預設 50（不再是 5）
- [ ] 上限保護：`Math.min(options.sampleSize ?? 50, 1000)`
- [ ] 測試：給 sampleSize 採樣行為與欄位 union 結果

### Task 3.2: CLI 暴露 `--sample-size`

**Files:** `src/commands/schema.ts`

- [ ] `schema` 命令新增 `--sample-size <n>`（僅在 mongo 連線下生效，SQL 連線顯示 hint 並忽略）
- [ ] 全表掃描與單表 inspection 都沿用同樣參數
- [ ] 測試：CLI 把參數正確傳到 adapter

### Task 3.3: mongo 寫入 `schemaLastUpdated`

**Files:** `src/commands/schema.ts`（或對應 schema-writer 模組）

- [ ] 找到 SQL 路徑寫 `schemaLastUpdated` 的位置，移除「mongo 例外」分支
- [ ] 確認 `dbcli doctor` 在 mongo 連線下不再印「未追蹤」
- [ ] 測試：scan 後讀回 metadata，`schemaLastUpdated` 為 ISO 字串

### Task 3.4: shell mongo 欄位 completion

**Files:** `src/commands/shell.ts`

- [ ] 在 `isMongoDB` 分支，列完 collections 後：
  - 若 collection 數 ≤ 20，連線中 sequential 對每個 collection 跑 `getTableSchema`，把欄位塞進 `columnsByTable`
  - 若 > 20，僅在第一次 tab completion 觸發某 collection 時 lazy 載入（需新增 hook 或先做最簡單的「啟動時全列」）
- [ ] 測試：mongo shell 啟動後 `columnsByTable[col]` 有對應欄位

**PR3 Acceptance:**
- [ ] `bun run typecheck && bun test` 全綠
- [ ] 手測：`dbcli schema users --sample-size 200` 比預設找到更多欄位
- [ ] 手測：mongo shell 內按 tab 可以補集合的欄位名
- [ ] 更新 `docs/feature-matrix.md`：移除「`schemaLastUpdated` 未追蹤」「completion 不含欄位」描述

---

## P2 — 獨立 milestone（暫不展開步驟）

下列每項都是一個獨立 PR/phase，因設計面較重，等 PR1–PR3 落地後再各自開計劃檔：

- **`MongoHealthChecker`**：替 `check` 命令加 mongo 路由 — null/missing 比例、型別不一致比例、estimated count 統計。需抽 `HealthChecker` 介面，依 system 路由。
- **`diff` for mongo**：基於 inferred schema 快照做欄位增刪 + 型別變化 diff。
- **mongo saved snippets (`q`)**：設計新 snippet 格式（建議 YAML，header `engine: mongodb`、`collection`、`pipeline`/`filter`），新增 loader/parser/runner 分支。

---

## Sequencing & Risk Notes

1. **PR1 → PR2 → PR3** 依序執行；PR2/PR3 不依賴彼此但都需要 PR1 的 blacklist 工具方法（`checkColumnBlacklistOnWrite`）。
2. **介面變更：** Task 1.1 改 `QueryableAdapter.execute` 簽名 — 需要全 repo `grep` 是否有其他呼叫端漏改（目前 `query.ts`、`q.ts` 經過確認），新增 type 參數時用可選參數避免破壞既有呼叫。
3. **測試策略：** mongo 路徑沒有真實 mongo server 就靠 fake/mocked client（沿用既有 mongo adapter 測試做法），所有新增功能都應有單元測試 + 至少一個 command-level 整合測試。
4. **文件同步：** 每個 PR merge 後立即更新 `docs/feature-matrix.md` 對應行，避免新舊狀態漂移。

---

## Definition of Done（整體）

- [ ] PR1 / PR2 / PR3 全部 merge
- [ ] `docs/feature-matrix.md` 中 MongoDB 欄位 ⚠️ 至少減半
- [ ] `bun run typecheck && bun test` 通過
- [ ] CHANGELOG / commit message 標明對齊的 feature-matrix 行
