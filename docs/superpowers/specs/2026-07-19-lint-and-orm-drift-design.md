# SQL Lint 改寫建議 + ORM Schema Drift 比對 — 設計文件

- 日期:2026-07-19
- 狀態:已與使用者確認設計,待實作規劃
- 背景:skill 完善度評估發現兩個缺口 —— (1) 對「SQL 語法改寫」缺乏靜態建議工具
  (`plan` 是風險分類器、`explain` 只供證據);(2) `diff` / `schema-drift-review`
  只比 DB 快照對 DB 快照,無法比對 ORM 定義層(Prisma/Drizzle/TypeORM/Sequelize)
  與實際 DB 的落差。

## 決策摘要

| 議題 | 決策 |
|---|---|
| 規劃範圍 | 兩功能一份設計、分階段出貨 |
| lint 分析深度 | 靜態 + schema-aware(讀本地 schema cache,無 cache 降級純靜態) |
| lint 介面 | 新子指令 `dbcli lint` |
| ORM 支援 | Prisma、Drizzle、TypeORM/Sequelize、通用 DDL/JSON,全走正規化中間格式分層 |
| drift 介面 | 擴充 `dbcli diff --against-orm` |
| 輸出深度 | 報告 + 提案指令(dry-run 形式),永不自動執行 |

## §1 `dbcli lint` — SQL 改寫建議

### 指令介面(對齊 `explain` 的入口形式)

```bash
dbcli lint "<SQL>"                        # 單句
dbcli lint @perf/top-orders               # saved snippet
dbcli lint @file.sql                      # 檔案
dbcli lint --bulk "@queries/*.sql"        # 批次
```

旗標:`--format text|json|markdown`、`--min-severity info|warn|error`、
`--no-schema`(強制純靜態)、`--use <conn>`(選 schema cache)。

### 架構

新增 `src/core/lint/`,規則引擎與規則檔分離:

```
src/core/lint/
  engine.ts          # parse(node-sql-parser v5,既有依賴)→ 逐規則跑 → LintReport
  context.ts         # 載入 schema cache(重用 schema-loader)→ 欄位型別/索引查詢介面
  rules/             # 一檔一規則,實作統一 LintRule 介面
    select-star.ts
    non-sargable-where.ts      # 函數包欄位、前綴 % LIKE、欄位參與運算
    implicit-cast.ts           # schema-aware:字面值型別 vs 欄位型別
    or-to-union.ts
    not-in-nullable.ts         # hybrid:NOT IN 右側靜態 NULL + schema-aware nullable
    missing-limit-offset.ts    # 深分頁 OFFSET → keyset pagination 建議
    unanchored-like.ts
    subquery-to-join.ts
    distinct-groupby-abuse.ts
```

指令層:`src/commands/lint.ts`(入口解析重用 `explain` 的 sql-extractor 模式)。

### 規則介面與輸出

每條規則回傳:

```ts
LintFinding {
  rule: string
  severity: 'info' | 'warn' | 'error'
  message: string
  span: { start: number; end: number }   // 原 SQL 位置
  rewrite?: { sql: string; confidence: 'high' | 'medium' | 'low' }  // 改寫草稿,不保證等價
  verifyCommand?: string   // 已證明唯讀時用 explain --analyze；其餘保守使用 plain explain
  schemaVerified: boolean  // 是否經 schema cache 驗證
}
```

報告層 `LintReport` 含 `findings[]`、`skippedRules[]`(schema-aware 規則因無
cache 跳過時,以 `blocked` 語意註明原因)、`relatedCommands[]`(指向
`guide missing-index-for`、`explain`,風格同 `inspect` 的 `suggestedCommands`)。

### Schema-aware 降級語意

- 有 schema cache → 型別/索引相關規則啟用,`schemaVerified: true`。
- 無 cache 或 `--no-schema` → 純 schema 規則跳過；hybrid 規則仍跑靜態
  NULL/CASE/aggregate 檢查，並把無法執行的 schema 部分列入 `skippedRules`。
- `not-in-nullable` 會以各 SELECT／CTE／derived statement 自己的 scope
  遞迴檢查投影、JOIN `ON`、`WHERE` 與 `HAVING`；qualified outer-join
  null extension 不需 schema cache 即可判定。
- 不連 DB、只讀 `.dbcli/schemas/`;權限需求 `n/a`(同 `plan`)。
- parser 無法可靠保留 identifier quote provenance 時，大小寫折疊後衝突的
  table/column 一律視為無法解析，不因字面 exact match 產生 schema-aware
  finding 或 rewrite。
- `explain --analyze` 驗證只適用於結構上證明為唯讀且不含明確 function /
  table-function call 或 session assignment 的 `SELECT`；function-bearing 或
  assignment SQL 保守使用 plain explain。
- CTE、derived relation、schema/database-qualified relation 不得套用只含
  unqualified table 名稱的 cache facts；無法證明 binding 時不產生
  schema-aware finding 或 high-confidence rewrite。

### 引擎範圍

Phase 1 只支援 postgres/mysql/mariadb(`node-sql-parser` dialect 能力範圍)。
Mongo/Redis/ES 明確回報 not supported。`plan` 維持風險分類職責不變。

## §2 `dbcli diff --against-orm` — ORM schema drift 比對

### 指令介面(擴充既有 `diff`,快照比對行為完全不變)

```bash
dbcli diff --against-orm prisma/schema.prisma        # 副檔名/內容自動偵測格式
dbcli diff --against-orm "migrations/*.sql"          # 任意 DDL 檔(可 glob)
dbcli diff --against-orm schema.json                 # 正規化中間格式(逃生口)
```

旗標:`--orm-format prisma|ddl|json`(偵測失敗時手動指定)、
`--format text|json|markdown`、`--use <conn>`、
`--ignore "<table-glob>"`(排除 ORM 不管的表,如 `_prisma_migrations`)。

### 架構:正規化中間格式為核心

DB 端與 ORM 端都先轉成 `NormalizedSchema` 再比對:

```
ORM 定義 ──▶ 轉接層 ──▶ NormalizedSchema ◀── DB 實際 schema

src/core/orm-drift/
  normalized-schema.ts    # NormalizedSchema 型別 + zod schema(= --against-orm 可直接吃的 JSON)
  from-db.ts              # schema cache / live adapter → NormalizedSchema(重用 schema-loader)
  compare.ts              # NormalizedSchema × NormalizedSchema → DriftReport(擴充 types/schema-diff)
  adapters/
    prisma.ts             # P1:schema.prisma 手寫 parser(不依賴 @prisma/*)
    ddl.ts                # P1:CREATE TABLE/INDEX/ALTER → node-sql-parser
    detect.ts             # 副檔名 + 內容 sniff → 格式判定
    # P2: drizzle.ts — 讀 drizzle-kit generate 的 snapshot JSON(不 parse TS)
    # P3: typeorm.ts / sequelize.ts — 吃各自 CLI 產出的 DDL,重用 ddl.ts
```

### NormalizedSchema 內容

- tables → columns(name、type 正規化到引擎中性型別 + 原始型別並存、nullable、
  default、pk)、indexes(columns、unique)、foreign keys。
- **明確不比**引擎方言型別細節:`varchar(191)` vs Prisma `String` 等預設對映
  採「對映表 + 寬容比對」,對不準的降為 `info` 而非 `error` —— 誤報淹沒真 drift
  是這類工具最大的坑,設計上直接處理。

### Drift 分類(對齊 verified/blocked 詞彙)

| 類別 | 例子 | severity |
|---|---|---|
| `missing_in_db` | ORM 有欄位/索引,DB 沒有 | error(app 會炸) |
| `missing_in_orm` | DB 有欄位,ORM 沒定義 | warn(可能是手動 hotfix 沒回寫) |
| `mismatch` | 型別/nullable/default 不一致 | error 或 info(依寬容表) |
| `unmanaged` | `--ignore` 命中或 ORM 系統表 | 列出但不計分 |

### 報告 + 提案

每筆 drift 附 `proposedCommands`:

- 能用既有 `migrate add-column` / `add-index` 表達的 → 給 dry-run 形式指令。
- 不能表達的(型別變更、drop)→ 給「escalate to human + `migration-review`
  task pack」建議。
- 永不自動執行,同 §1 哲學。

### Prisma parser 範圍(P1 刻意收斂)

- 支援:model、欄位型別、`@id` `@unique` `@default` `@map` `@@map` `@@index`
  `@@unique`、relation 推導 FK。
- 不支援:view、多 schema、`@db.` 以外的 native type 全集。
- 不認識的屬性列入報告 `unparsed`(`blocked` 語意),不猜。

### 權限與連線

預設讀 schema cache(不連 DB,權限 `n/a`);cache 過期或不存在時提示先跑
`dbcli schema`。與 v2 多連線相容(`--use`)。

## §3 整合、測試與出貨規劃

### Task pack 與 skill 整合

- 新增 task pack `orm-drift-review`(SQL 引擎):`blacklist list` → `schema`
  (確保 cache 新鮮)→ `diff --against-orm` → 對 error 級 drift 走
  `migration-review`。plan-only、read-only,與現有 pack 一致。
- `lint` 併入既有流程而非新 pack:`diagnose-slow-query` pack 與
  `guide slow-query` 的步驟中插入 `dbcli lint "<SQL>"`(在 `explain` 之前)。
- 文件更新:SKILL.md Command overview 加兩列;「ORM or migration work」workflow
  擴成 `schema → diff --against-orm → migrate 提案 → migration-review`;
  「Slow endpoint or query」加入 lint;reference.md 加完整旗標區塊。
  依專案慣例同步 `SKILL.zh-TW.md`、`docs/user/en|zh-TW` 的 `index.md` +
  `index.html`、4 個 plugin(`plugin:sync`)。

### 測試策略(TDD,維持全綠 + 80%+)

- lint 規則:一規則一測試檔;每條規則至少「命中 / 不命中 / schema-aware
  有無 cache 兩態」;引擎層測 dialect 路由、`--bulk`、snippet 解析。
- orm-drift:Prisma parser 用 fixture `.prisma`(含 `unparsed` 降級案例);
  compare 用 NormalizedSchema JSON fixture 對測四類 drift;DDL adapter 對
  postgres/mysql 各一組 CREATE/ALTER fixture。
- 內容契約:SKILL.md 新增段落納入既有 skill 內容契約 test。

### 分階段出貨(每階段獨立可發版)

| 階段 | 內容 | 版本(暫定) |
|---|---|---|
| P1a | `dbcli lint`(引擎 + 9 規則 + schema-aware)+ 文件 | 1.40.0 |
| P1b | `diff --against-orm`(NormalizedSchema + Prisma + DDL adapter)+ `orm-drift-review` pack + 文件 | 1.41.0 |
| P2 | Drizzle adapter(drizzle-kit snapshot JSON) | 1.42.0 |
| P3 | TypeORM / Sequelize(CLI 產 DDL → 重用 ddl adapter)+ 文件收尾 | 1.43.0 |

P1a 與 P1b 互不相依;版號以 package.json 實際狀態為準。

### 錯誤處理原則(共用)

- parse 失敗回結構化錯誤;`lint` 與 `diff --against-orm` 納入 `--recovery`
  envelope 名單。
- 不認識的語法一律進 `unparsed` / `skippedRules` 明列,不靜默吞掉。
