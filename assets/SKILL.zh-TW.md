---
name: dbcli
description: Database CLI for AI agents with permission-based access control. Use to set up new connections, query, inspect schemas, insert/update/delete, export results, generate DB reports or interactive HTML dashboards, and blacklist sensitive columns/tables. Supports MySQL, PostgreSQL, MariaDB, MongoDB, Redis, and Elasticsearch with multiple named connections per project and custom env files. Trigger when configuring a database connection (`.dbcli` / `.env`), choosing between v1 single and v2 multi-connection layouts, picking auth modes (URI, env refs, Cloud ID, API key), running SQL / MongoDB JSON / Redis commands / Elasticsearch DSL, generating a report/dashboard/HTML UI from raw SQL or saved snippets, exploring table/collection/key/index structures, switching database environments, protecting sensitive data from AI access, or performing automated recovery and guided remediation after command failures. For exhaustive flags and examples, read the sibling `reference.md`.
---

# dbcli

為 AI 代理設計、具權限控管的資料庫 CLI。

如果 `dbcli` 執行檔不在 `PATH` 中，請以 `bunx @carllee1983/dbcli <command>` 作為指令前綴。這是 Codex plugin 安裝時的預期 fallback 方式 — skill 由 plugin 安裝，但 CLI 套件尚未全域安裝。

## 如何使用 dbcli

**安全底線 — 每次操作都要遵守：**

1. `dbcli blacklist list` — 確認敏感資料邊界。
2. `dbcli schema <object> --format json` — 確認真實欄位名稱。**禁止猜測。**
3. 所有寫入：`--dry-run`（SQL / Mongo）→ 實際執行 → `query` 回讀確認。Redis 的 `query`
   **沒有 `--dry-run`**（見 **Redis** 節）；Elasticsearch 為**唯讀**。

**`update` / `delete` 的 `--where` 僅支援等式（SQL）。** 只接受 `col=val` 或
`col1=v1 AND col2=v2`。比較 / 模式運算子（`>`、`>=`、`<`、`!=`、`LIKE`、`IN`）會直接
**報錯**；更危險的是，`OR` 會被**靜默當成值的一部分** — `a=1 OR b=2` 會被解析成
`a = "1 OR b=2"`，比對到錯誤的列（或完全比對不到）。需要範圍或複合條件時，先用
`query` / `export` 撈出目標列的主鍵，再對每個主鍵執行一次
`update` / `delete --where "id=<pk>"`（逐一等式）— 或升級交給人類處理。（MongoDB 的
`--where` 接受完整 JSON filter，不受此限。）

> `report` 與 `guide` 已內嵌 `inspect` 快照 — **不需要**先跑 `dbcli inspect`。只有在需要 audit-recent 脈絡或診斷連線問題時，才手動跑 `dbcli inspect --for-agent`。

**依任務路由：**

| 任務 | 路徑 |
| --- | --- |
| 有名稱的工作流程符合（「診斷慢查詢」、「審計權限」） | `skill tasks list` → `skill tasks plan <pack>` — **優先選用；不要自己組合步驟** |
| 固定診斷目標 | `guide <goal>`（`slow-query` / `capacity` / `health` / `index-usage` / `permissions` / `schema-overview`；`guide --list`） |
| DB report / dashboard / HTML UI | `blacklist list` → `queries search <keywords>` 或 `queries suggest <intent>` → `queries show @<name>` → 瀏覽器：`q @<name> --param k=v --ui`；檔案：`q @<name> --format html > report.html` 或 `export "<SQL>" --format html --output report.html` |
| 設定連線 | 見 **連線設定** |
| 其他情況 | 手動執行指令；參考 **開發者工作流** 速查表 |

慢查詢診斷有三條標準路徑（依已掌握的資訊選擇）：

- 已知慢 SQL → `skill tasks plan diagnose-slow-query --param query="<SQL>"` → `lint "<SQL>"` → `guide missing-index-for "<SQL>"`
- 已知熱點資料表 → `skill tasks plan analyze-table-perf --param table=<table>`
- 全環境掃描 → `report --section perf` → `guide slow-query`

`report --section perf` 已涵蓋 slow-query、index-usage 與 cache-hit 診斷 — 之後只需補上它未涵蓋的 `@diag/*`（`missing-indexes`、`locks`、`connections`、`table-sizes`）。一旦鎖定特定慢語句，`explain --analyze "<SQL>"` 可顯示執行計畫。

**失敗時：** 在 `query` / `q` / `insert` / `update` / `delete` / `export` / `schema` / `inspect` / `lint` / `diff --against-orm` 加上 `--recovery`。指令會把 `RecoveryEnvelope` 輸出到 stdout 並儲存到 `.dbcli/last-recovery.json`；然後用 `dbcli recover` 檢視、`dbcli recover --apply` 在風險門控下執行儲存的計畫。Multi-turn `--next`、連線分支與 post-apply 驗證探針詳見 reference.md §Recovery Cookbook。

回報驗證結果時使用詞彙：`verified`（證據符合）/ `not_verified`（驗證執行但結果矛盾）/ `indeterminate`（執行但證據不明確）/ `blocked`（因 config、權限、schema、placeholder 或安全閘門導致無法執行）。

優先用 `--format json` 取得代理友善的輸出。

## Agent Task Packs

當使用者要求一個資料庫工作流（例如「診斷這個慢查詢」、「審計權限」、「審視長時間執行的操作」），**優先選用已發布的任務模板，而非憑記憶自行組合步驟。**

```bash
dbcli skill tasks list --format json                              # discover
dbcli skill tasks show <task>                                     # inspect
dbcli skill tasks plan <task> --param key=value --format json     # generate plan
```

計畫輸出是一組附帶說明與風險標籤的 dbcli 指令序列。請逐一執行 — 任務計畫**不會**繞過 blacklist、schema、dry-run 或確認等要求。

內建套件（SQL — postgres/mysql）：`diagnose-slow-query`（針對特定 SQL）、`analyze-table-perf`（針對特定資料表；`dbcli inspect` 會針對近期 audit 活動中最熱門的資料表自動建議此套件）、`audit-permissions`、`safe-backfill`、`schema-drift-review`、`orm-drift-review`（ORM 定義與快取 DB schema 比對）、`connection-health`。審查與驗證套件：`pr-database-review`、`migration-review`、`safe-backfill-verify`、`slow-endpoint-investigation`。MongoDB 套件：`mongo-safe-backfill`（以 dry-run 預覽的回填）、`mongo-schema-drift-review`（抽樣 dot-path 漂移）。全部為唯讀 `plan-only` — 選擇符合使用者情境的套件，任何索引 / DDL 提案都應先經 `migration-review` 再寫入。Redis/Elasticsearch 目前尚無套件——請改以 `guide` / `report` 為主。

任務檔放在 `assets/tasks/`（內建）、`.dbcli-shared/tasks/`（共享）與 `.dbcli/tasks/`（本地覆寫）。

## 開發者工作流

當資料庫影響隱含在開發任務中時使用這些流程。**如何使用 dbcli** 中的安全底線仍然適用。

| 情境 | 最小安全路徑 |
| --- | --- |
| DB-backed 功能 | `blacklist list` → `schema <object>` → `queries suggest <intent>` |
| DB report / dashboard request | `blacklist list` → `queries search <keywords>` / `queries suggest <intent>` → `queries show @<name>` → `q @<name> --ui` 或 `--format html` |
| 應用程式資料錯誤 | `audit tail --for-agent --n 10` → `blacklist list` → `schema <object>` → 最小查詢 |
| ORM 或 migration | `schema --format json` → `diff --against-orm <orm-schema>` → 審查 error-level drift → 透過 `migrate` 取得提案（dry-run）→ `migration-review` task pack → 套用後執行 `diff --against <snapshot>`。 |
| PR 資料庫風險審查 | 審查變更的 persistence path，並針對每個重要主張提出具體 `schema`、`plan`、`dry-run`、`report` 或 `guide` 指令。 |
| 慢 endpoint 或查詢 | `report --section perf` → task pack `analyze-table-perf` → `lint "<query>"` → `guide missing-index-for "<query>"`；有 proxy log 時使用 `proxy analyze`。 |
| 安全資料回填 | `blacklist list` → `schema <object>` → count/scope query → `update … --dry-run` → read-back 或 snippet `--verify`。 |
| 環境設定驗證 | `status --format json` → `doctor --format json` → `inspect --for-agent --no-connect`。 |

```bash
dbcli inspect --for-agent --format json
dbcli blacklist list --format json
dbcli schema <object> --format json
dbcli queries suggest <intent> --format json
dbcli queries search <report keywords> --format json
dbcli queries show @<name> --format json
dbcli q @<name> --param k=v --ui
dbcli q @<name> --param k=v --format html > report.html
dbcli export "<SQL>" --format html --output report.html
dbcli audit tail --for-agent --n 10
dbcli diff --snapshot <name>
dbcli diff --against-orm prisma/schema.prisma --format json
dbcli diff --against-orm "migrations/*.sql" --format markdown
dbcli skill tasks plan orm-drift-review --param orm_path=prisma/schema.prisma --format json
dbcli report --section perf --format json
dbcli skill tasks plan analyze-table-perf --param table=<table> --format json
dbcli guide missing-index-for "<query>" --format json
dbcli lint "<SQL>" --format json
dbcli update <object> --where "<bounded predicate>" --set '<json>' --dry-run --format json
dbcli inspect --for-agent --no-connect --format json
```

守門規則：

- 不要猜測 table、collection、key、index 或 field 名稱。先用 `schema` 確認。
- 分離資料庫事實與應用程式推論；回報是哪個 dbcli 輸出影響了結論。
- 寫入與 backfill 必須包含 scope count、dry-run preview、execution command，以及 read-back。
- 不要直接從 performance suggestion 建 index；應轉成經過 review 的 migration。
- 不要列印 credentials、複製的連線字串或 blacklisted 值。
- 持久化佐證：`assert … --write-verification-artifact --verification-subject <kind:name>`；以 `verification summary` / `list` / `show <id>` 檢視。`verify safe-backfill` / `migration` / `rollback --kind <ddl|dml>` / `constraint --check <fk|not-null|unique|custom>` 系列執行 preflight + `--after-write` 驗證，**永不執行寫入**。完整旗標與每個指令的區塊詳見 reference.md。

## Audit Log 使用

跨 session 歷史或失敗鑑識時，優先使用 audit log，而非重新查詢 live DB 狀態。

```bash
dbcli audit tail --for-agent --n 10          # last N entries (JSON envelope, metadata-only)
dbcli audit show <id-prefix>                 # full entry by id prefix (≥4 chars)
dbcli audit show --recovery-ref <env-id>     # find the entry that emitted an envelope
```

`inspect` / `guide` / `recover` agent JSON 內嵌 `audit_recent`（最近 5 筆）— 新 session 立即有歷史。Envelope 的 `audit_ref` 與 audit entry 的 `recovery_ref` 互為雙向指標，可從任一方向 pivot。Audit 預設開啟（`audit.enabled = false` 可關閉）；entry 僅含 metadata（不含 SQL body、`--param` 值或結果 cell），並在約 10 MB / 1000 筆時輪替。完整旗標：reference.md §audit。

## 快速開始

```bash
dbcli init                          # Create .dbcli config (parses .env automatically)
dbcli schema                        # Scan all tables → .dbcli/schemas/
dbcli query "SELECT * FROM users"   # Execute SQL (auto LIMIT 1000)
```

如果 `.dbcli` 尚未存在，請先走下方的 **連線設定** 流程，再碰 `schema` / `query`。

## 連線設定（協助使用者把資料庫接上來）

當使用者問「我要怎麼連到 X?」、「幫我把 dbcli 接到 staging DB」，或 `doctor` / `status` 回報缺失或無效的設定時，依此流程處理。

> **預設「引導」而非「直接執行」。** `init` 會把憑證寫到磁碟。**僅在**使用者明確授權且確認過實際值後再代為執行。
> 如果 `.dbcli` 中已含有 `{"$env": "..."}` 形式的環境變數參照，**不要**為了「把它填好」而重跑 `init` — env-ref 形式是 CI / multi-env 的刻意設計。

### 決策樹（先問再寫）

1. **一個 DB 還是多個環境？** 一個 → v1（單一連線）。多環境 / tenant / replica → v2（`--conn-name <name>`，必要時搭配每個連線專屬的 `--env-file <path>`）。
2. **憑證放在哪裡？**
   - 已在 `.env`（`DATABASE_URL` 或 `DB_HOST` / `DB_PORT` / `DB_USER` /
     `DB_PASSWORD` / `DB_NAME` | `DB_DATABASE`）→ `init` 自動解析。
   - 機密需要排除在 `.dbcli` 之外（CI/CD、multi-env）→ `--use-env-refs`（見下方）。
   - 可以直接放明文 → 傳 `--host` / `--port` / `--user` /
     `--password` / `--name`（與 `--system`）。
3. **要哪一個權限層？** 預設取**最低**夠用的：
   `query-only` → `read-write` → `data-admin` → `admin`。透過 `--permission` 設定
   （預設 `query-only`）。
4. **驗證、不要假設。** init 結束後跑 `dbcli status`（系統 + 權限 + blacklist 摘要、不含憑證）與 `dbcli doctor --format json`（env、設定形狀、連線、schema-cache 年齡、Mongo SRV 路徑）。

### 每個引擎的必備指令

```bash
# PostgreSQL / MySQL / MariaDB (v1, plain values)
dbcli init --system postgresql --host localhost --port 5432 \
  --user app --password '<secret>' --name appdb --permission query-only

# Reuse an existing .env (DATABASE_URL=postgresql://user:pw@host:5432/db)
dbcli init                                                # parses .env in cwd

# MongoDB — full URI (Atlas / replica sets / authSource)
dbcli init --system mongodb \
  --uri "mongodb+srv://user:pw@cluster.example.mongodb.net/mydb?authSource=admin"
# MongoDB — discrete params (no auth = omit --user/--password)
dbcli init --system mongodb --host localhost --port 27017 --name mydb

# Redis — `--name` is the LOGICAL DB INDEX ("0".."15"), not a database name
dbcli init --system redis --host localhost --port 6379 --password '<secret>' --name 0

# Elasticsearch — basic auth, Cloud ID, or API key
dbcli init --system elasticsearch --host localhost --port 9200 \
  --user elastic --password '<secret>'
dbcli init --system elasticsearch \
  --cloud-id "myCluster:dXMtZWFzdC0xLmF3..." --api-key "<base64>"
# Multi-node / custom CA / self-signed: edit `.dbcli` directly to add
# `nodes: [...]`, `protocol: https`, `caPath`, `rejectUnauthorized: false`.
```

### 多連線（v2）

```bash
dbcli init --conn-name staging --env-file .env.staging --permission query-only
dbcli init --conn-name prod    --env-file .env.production --use-env-refs --skip-test
dbcli use --list --format json            # 安全列出 name/env/permission/server/database
dbcli use prod                            # switch default（會持久化 — 單次查詢別用）
dbcli query --use staging "SELECT 1"      # one-shot override on any subcommand
DBCLI_CONNECTION=staging dbcli query "SELECT 1"   # 單次指定，env 版；平行安全
dbcli --use staging,prod query "SELECT count(*) FROM users"   # 唯讀扇出
dbcli init --rename staging:stg           # rename
dbcli init --remove stg                   # remove
```

每個命名連線的 schema cache 存於 `.dbcli/schemas/<connection>/`。在 `schema <table>` 前，每個連線都先跑一次 `dbcli schema --use <name>` — 否則 cache 可能回傳到別的連線欄位。`schema --refresh` / `--reset` 管理 cache（reference.md）。`--skip-test` 跳過 init 時的 TCP 連線測試；使用 `--use-env-refs` 時會自動隱含（`$env` refs 尚無值可連線）。`--system` 在 v2 中為選填 — 若省略，引擎會從 `--env-file` / `.env`（`DATABASE_URL` scheme）推斷，預設為 `postgresql`。

### env-refs（把機密排除在 `.dbcli` 之外）

以 `{ "$env": "VAR" }` 參照形式儲存憑證，在執行時解析，永不以明文存放：

```bash
# Default key names: DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_DATABASE
dbcli init --use-env-refs

# Non-default key names — name each one explicitly (required in CI):
dbcli init --conn-name prod --env-file .env.production --use-env-refs --skip-test \
  --env-host PROD_DB_HOST --env-port PROD_DB_PORT \
  --env-user PROD_DB_USER --env-password PROD_DB_PASSWORD --env-database PROD_DB_NAME
```

在**互動式終端機**中，省略 `--env-*` 旗標會逐一提示輸入 key 名稱（預設如上）— 可輸入非預設名稱如 `PROD_DB_PASSWORD`，它會以 `$env` ref 形式儲存。在**非互動式 / CI** 環境中，**必須**傳齊全部五個 `--env-*` 旗標；否則 `init` 會以錯誤退出 — 不會靜默 fallback 為明文。`--env-file <path>` 是 env 檔路徑，與 `$env` key 名稱無關。

### 常見陷阱

- **MongoDB `mongodb+srv://`** — `dbcli doctor` 回報 SRV 是用原生方式解析還是走 DoH fallback；在執行環境限制 DNS 時很有用。
- **MySQL/Postgres 密碼含 `@` `:` `/`** — 使用 `DATABASE_URL` 時要 percent-encode（`@` → `%40`）；分項的 `--password` 旗標不需編碼。
- **Redis `--name`** — 僅接受 logical DB index 字串；非數字會被拒絕。
- **Elasticsearch TLS** — `caPath` 與 `rejectUnauthorized` 沒有對應旗標；`init` 後直接編輯 `.dbcli` 加上。
- **重跑 `init`** — 沒有 `--force` 拒絕覆寫；千萬不要為了「修好」一個含 `{ "$env": "..." }` 參照的設定而用 `--force`。

完整旗標與邊界案例見 [reference.md](reference.md) `init` 段落。

## 指令總覽 (Command overview)

| Command | Min permission | Summary |
|---------|-----------------|---------|
| `init` | n/a | 建立 `.dbcli`（v1 單一或 v2 多連線，透過 `--conn-name` / `--env-file`）。**通常由真人執行** — 不要為了清掉 `{"$env"}` 參照而重跑；該格式是刻意設計。 |
| `use` | n/a | 顯示 / 切換預設命名連線（僅 v2）。 |
| `list` | query-only+ | 資料表（SQL）、collections（MongoDB）、keys（Redis）或 indices（Elasticsearch）。 |
| `schema` | query-only+ | SQL：單表或全掃描存入 `.dbcli/schemas/`。MongoDB：sampled。ES：flattened mapping。Redis：僅單一 key（type / TTL / size）。支援 `--recovery`。 |
| `query` | query-only+ | SQL、Mongo JSON（`--collection`）、Redis 指令、ES DSL / Lucene（`--collection`）。`--format table\|json\|csv\|html`、`--ui` 開啟瀏覽器互動式 dashboard。`--fields`（欄位投影）、`--truncate`（欄位值寬度）、`-f/--query-file`（從檔案或 stdin 讀查詢）、`--use a,b`（唯讀扇出）。支援 `--recovery`。見 **查詢工作流程旗標**。 |
| `explain` | query-only+ | **(v1.23)** 唯讀查詢計畫並附註解。僅 SQL。單一查詢、`@saved-query`、`@file.sql` 或 `--bulk @glob/*`。`--analyze`（EXPLAIN ANALYZE / MariaDB ANALYZE SELECT）、`--format markdown\|json\|table`。 |
| `lint` | n/a | 靜態 SQL 反模式顧問（不連線 DB）。共 9 條規則，包含透過分層 `.dbcli/schemas/` 快取進行的 schema-aware implicit-cast / NOT IN-nullable 檢查；全域 `--use <conn>` 會選擇命名連線的快取。Finding 可附 rewrite 草稿與受保護的 `explain` 驗證指令；只有已證明唯讀的 SQL 才會加上 `--analyze`，且只回報、絕不執行。`--format text\|json\|markdown`、`--min-severity`、`--no-schema`、`--bulk`。支援 `--recovery`。 |
| `plan` | n/a | 靜態 SQL 風險分析器（`--format text\|json`）；不連線即可分類語句。 |
| `q` | query-only+ | 以 `@name` 執行已儲存 snippet，搭配 `--param k=v`。支援 `--verify` 以執行斷言。 |
| `queries` | n/a | 管理已儲存 snippet：`list` / `show` / `search` / `suggest` / `new` / `edit` / `check` / `delete` / `rename` / `copy` / `import` / `export`。 |
| `insert` / `update` | read-write+ | 僅 SQL 與 MongoDB。JSON `--data` / `--set`；`update` 必填 `--where`；先 `--dry-run`。Redis 寫入透過 `query`。支援 `--recovery`。 |
| `delete` | data-admin+ | 僅 SQL 與 MongoDB；Redis 有基本實作（見 Redis 段落）。必填 `--where`；先 `--dry-run`。支援 `--recovery`。 |
| `export` | query-only+ | SQL、MongoDB 或 **(v1.22)** Elasticsearch（DSL `--index` 或全 index scroll）。Query → `--format json\|jsonl\|csv\|html` 檔案或 stdout。`html` 輸出獨立可互動 dashboard。**寧可失敗也不靜默截斷**：若 auto-limit 會砍掉資料列，匯出直接報錯，必須改用 `--no-limit` 或 `--limit N`。支援 `--recovery`。 |
| `blacklist` | n/a | `list` / `table` / `column` 子指令，從查詢結果中遮蔽敏感資料。 |
| `check` | query-only+ | 僅 SQL（在 MySQL / MariaDB 最佳）。 |
| `diff` | query-only+ | 僅 SQL。儲存 / 比較 schema snapshot。**(P1b)** `--against-orm <path>` 會將 Prisma schema / DDL 檔 / normalized JSON 與本地 schema cache 比對（不連線 DB）：分類為 `missing_in_db`（error）、`missing_in_orm`（warn）、依 tolerance 表判定的 `mismatch`、以及 `unmanaged`，並提供 dry-run `migrate` 提案；出現 error-level drift 時 exit 1。`--orm-format prisma\|ddl\|json\|drizzle\|typeorm\|sequelize`、`--ignore <globs>`、`--format json\|table\|markdown`。Drizzle：請指向 `drizzle/meta/<NNNN>_snapshot.json`（先執行 `drizzle-kit generate`；`.ts` source 會被拒絕並顯示提示）。TypeORM/Sequelize：傳入工具產生的 DDL（`schema:log` / schema-only dump）；source file 會被拒絕，並顯示要執行的精確產生指令。 |
| `snapshot` | query-only+ | **(v1.25)** 僅 SQL。擷取結果指紋（`rowCount` + 每欄 null/distinct/min/max/sum + 順序無關 checksum）。`--out`（預設 `.dbcli/snapshots/snap-<ts>.json`）、`--rows`、`--stdout`、`--format`、`--no-limit`。作為 `assert --against` 的基準。 |
| `assert` | query-only+ | **(v1.25)** 僅 SQL。驗證不變量；失敗時 exit 1，除非 `--no-fail`。`--expect "rows>0\|value==X\|col:c not null\|unique\|between a and b\|>= n"`、`--vs <query> --compare rows\|value`（對帳）、`--against <snapshot> --tolerance <pct>`。 |
| `verification` | n/a | 檢視與管理本機驗證 artifact。`list` / `show <id-or-path>` / `summary` 為唯讀；`prune` 預設 dry-run，僅在 `--execute --force` 時刪除。讀取 `<cwd>/.dbcli/verification/`；不需 DB 連線，不寫入 audit log。 |
| `proxy` | n/a | **(v1.26)** 僅 MySQL/MariaDB/PostgreSQL。本地端開發觀測代理 — 中繼應用程式流量至真實資料庫，並將查詢 / 延遲 / 位元組 / 錯誤事件附加到 `.dbcli/proxy/events.jsonl`。子指令：`mysql` \| `mariadb` \| `postgresql`。`--listen`、`--target`、`--events`、`--slow-ms`（預設 `1000`）、`--redact none\|literals`。僅作觀測。**(v1.27)** `proxy analyze` 離線彙整事件 log 為 JSON / 文字報表（summary、byFingerprint 含 suggestedCommands、slowest、errors、hotTables、N+1）— 若無事件則報錯。 |
| `status` | query-only+ | 安全 JSON / 文字摘要（不含憑證）。 |
| `inspect` | query-only+ | 唯讀脈絡快照（連線、權限、blacklist、物件、snippets、建議指令，以及 **(v1.23)** 人類可讀 `hints`）。`--for-agent` / `--brief` / `--no-connect` / `--require-schema-cache`。支援 `--recovery`。 |
| `report` | query-only+ | 以 `@diag/*` snippet 組成的診斷報告。`--section <health\|capacity\|perf>`（可用逗號組合）、`--brief`、`--for-agent`、`--no-connect`。 |
| `guide` | query-only+ | 針對固定目標產出確定性下一步指令計畫（`slow-query`、`capacity`、`health`、`index-usage`、`permissions`、`schema-overview`）。`--list` 列舉所有目標。**(v1.23)** `guide missing-index-for <query>` 為單一 SELECT 建議複合索引（`--format yaml\|json\|markdown`、`--min-confidence`）。 |
| `recovery` | n/a | 對已知錯誤代碼查詢結構化 `RecoveryEnvelope`（`--code <CODE>` 或 `--list`）。獨立合成器；不需真實失敗。 |
| `recover` | n/a | 檢視（預設）或 `--apply` 執行 `.dbcli/last-recovery.json` 中自動儲存的復原計畫。`--allow-write=readonly-cmd\|write-cmd`、`--no-verify`、`--from <file>`、`--next --after-step <n> --result <json\|@file>` 多輪逐步執行。 |
| `doctor` | n/a | 環境、設定、連線、SRV 診斷（Mongo）、schema cache 年齡。 |
| `completion` | n/a | bash / zsh / fish 腳本。 |
| `upgrade` | n/a | 從 npm 自我更新；每個指令都帶 24h 快取的版本提示。 |
| `shell` | (與 query 同) | 互動式 REPL。SQL 引擎、MongoDB 與 Redis（單行；`.no-limit on/off`）。**(v1.22)** Elasticsearch 開啟 Kibana Dev Tools 風格的 REPL（`<METHOD> /<path>` + 可選 JSON body，空白行送出）。 |
| `skill` | n/a | 產出 / 安裝 AI skill 文件（`--install <claude\|gemini\|antigravity\|copilot\|cursor\|codex\|windsurf>`）；`skill tasks list/show/plan` 提供 Agent Task Packs；`skill context` 提供 LLM 提示詞脈絡載荷（用於注入其他 LLM，正常操作不需要）。 |
| `migrate` | admin | 僅 SQL。**DDL；預設 dry-run** — 需 `--execute`。 |

任何指令都可使用 root 層級的 `dbcli --use <name> <command>`；`query`、`schema`、`list`、`export`、`check` 也接受指令層級的 `--use`。兩種寫法都只把本次目標切到 v2 連線，不改變預設值。`--recovery` 被 `query`、`q`、`insert`、`update`、`delete`、`export`、`schema`、`inspect`、`lint` 與 `diff --against-orm` 支援（見上方**失敗時**）。

**寫入與查詢旗標語意**（SQL / Mongo `insert`/`update`）：

- `--set`（update）/ `--data`（insert）接受 **JSON 物件字串**，而非 SQL 片段：`dbcli update users --where "id=42" --set '{"email":"new@example.com"}'`。MongoDB 中，不含 `$` 運算子的 JSON 會自動包裝為 `$set`；明確傳入的運算子則直接傳遞。`insert --data` 也可從 stdin 讀取物件。
- `--where`（SQL）僅接受 `col=val` 或 `col1=val1 AND col2=val2` — **不**支援完整 SQL（不支援 `>=`、`!=`、`LIKE`、`OR`）。MongoDB 的 `--where` 接受完整 JSON filter（`'{"status":"pending"}'`），若不是合法 JSON 則 fallback 為 `col=val`。
- `--dry-run` 輸出參數化 SQL（使用 `$1` / `?` 佔位符，非真實值）與 `rows_affected: 0`；確認 `status:"success"` 且 SQL 形狀符合預期的 `--where` / `--set` 後再執行。MongoDB 輸出 shell 風格預覽。
- `--recovery` 建議用於自動化 agent pipeline（讓失敗後可執行 `dbcli recover --apply`）；手動一次性寫入可選用。

## 查詢工作流程旗標 (Query workflow flags)

這些旗標的存在，就是為了讓你不必再把輸出 pipe 給 `head` / `jq` / `python3`
才能用。優先用它們，不要事後加工。

| 需求 | 旗標 | 說明 |
|------|------|------|
| 只要某幾個欄位 | `--fields sn,bet,created_at` | SQL 與 MongoDB 皆可。Mongo 會把真正的 `projection` / `$project` 下推給 driver；除非明確指定，否則不回傳 `_id`。結果中不存在的欄位會回傳 `null`，所以看到整欄 null 時先用 `schema` 核對欄位名。 |
| 除了某個巨大欄位以外都要 | `--fields=-raw_response` | 排除形式。include 與 exclude 不能混用。 |
| 某欄位是一大包 JSON | `--truncate 120` | table 輸出**預設**就在 120 字截斷，並標記 `…(+3412 chars)`。`--no-truncate` 可關閉。JSON、CSV、HTML 與 `--ui` 輸出會拒絕明確的截斷旗標。 |
| 查詢含引號 / 換行 / `$regex` | `-f pipeline.json` 或 `-f -` | 從檔案或 stdin 讀查詢；Mongo pipeline 建議用 heredoc。同時給檔案與位置參數會直接報錯，不會靜默擇一。`-f -` 需要 piped input——遇到互動式終端會直接拒絕而不是空等。 |
| 同一查詢跨多個連線 | `--use hub-prod,site-a` | 唯讀扇出。各連線各自出結果，其中一個失敗不會取消其他。exit `0` 全成功、`2` 部分失敗、`1` 全失敗。拒絕寫入、`--recovery`、`--ui`、CSV/HTML。 |
| 單次指定連線 | `DBCLI_CONNECTION=hub-prod dbcli query …` | 環境變數，或在子指令上加 `--use`。優先序：`--use` > `DBCLI_CONNECTION` > 已存的預設值。兩者都不會把預設值寫回磁碟，所以平行的 shell 不會互相干擾。需要 v2 設定——單一連線 (v1) 專案會直接拒絕，而不是靜默改跑那唯一的連線。**不要**為了單次查詢去跑 `dbcli use <name>`。 |

**截斷一律明說，絕不靠推測。** query-only 的 auto-limit 砍掉結果時，table footer
會顯示 `Rows: 1000 (truncated; limit 1000)`，`--format json` 會帶
`metadata.truncated` / `metadata.limit_applied`，CSV 則附加 `#` 註解行。
`Rows: 1000` 沒有標記就代表資料**剛好**是 1000 筆——不要因為數字是整數就推論它被截斷。
`query` 與 `q` snippet（其自身的 1000 筆 guard 也用同樣方式回報）皆適用。
`export` 則是根本拒絕截斷。Redis 被 size guard 裁切的回覆同樣依此回報，每則 size-guard warning 也會印到 stderr。

## 權限等級 (Permission levels)

| Level | Allowed |
|-------|---------|
| query-only | SELECT、list、schema、export |
| read-write | + INSERT、UPDATE |
| data-admin | + DELETE（DML，不含 DDL） |
| admin | + 透過 `migrate` 執行 DDL，以及破壞性操作 |

## MongoDB

- `query` 接受 JSON filter 物件（`find`）或陣列（`aggregate`）；SQL 會被拒絕。`--collection <name>` 在 `query` 上為必填。
- **支援：** `init`、`list`、`schema`（sampled）、`query`、`insert`、`update`、`delete`、`export`、`q`、`status`、`use`、`shell`、`doctor`。**不支援：** `diff`、`migrate`、`check`。
- Schema 由 `$sample` **採樣**（預設 100 份文件，上限 1000；`--sample-method natural` 改用 `find().limit()`）。欄位以 dot-path 呈現（如 `profile.tokens.access`），附帶 `presence`（0..1）與 `redacted` 旗標。
- 寫入：`--set` / `--data` JSON 在無 `$` 運算子時自動包裝為 `$set`；明確傳入的運算子（`$set`/`$inc`/`$push`/…）則直接傳遞。巢狀黑名單接受 dot-path（`profile.email`）與結尾萬用字元（`profile.tokens.*`）。Saved snippet 以 `.mongodb.sql` 結尾（frontmatter `engine: mongodb`，`operation: find|aggregate`）。完整寫入規劃分層與語法：reference.md MongoDB 段落。

## Redis

- `query` 執行單一**白名單內**的 Redis 指令（如 `GET`、`SET`、`HSET`、`DEL`）。完整白名單與每個指令的權限層詳見 reference.md。
- **支援：** `init`、`list`（透過 SCAN 列 keys）、`schema <key>`（type / TTL / size / sample）、`query`、`q`（saved snippet — **僅唯讀命令**）、`delete`（基本實作：`DEL` / `HDEL` / `LREM` / `SREM` / `ZREM`，需 `data-admin`；`query "DEL <key>"` 亦可）、`shell`、`status`、`use`、`doctor`。**不支援：** `schema` 全掃描、`insert`、`update`、`check`、`diff`、`migrate`。
- **權限分層：** 讀取類（`GET`/`HGET`/`SCAN`/…）→ `query-only`；mutator（`SET`/`HSET`/`INCR`/`EXPIRE`/`SETEX`/`RENAME`/…）→ `read-write`；`DEL`/`UNLINK`/`HDEL`/`XDEL` → `data-admin`。白名單外的指令一律拒絕。
- **Redis `query` 無 `--dry-run`** — 寫入安全來自權限門檻與 key 黑名單（命中的讀寫會被拒絕）。如需預覽刪除，請用 `delete <key> --dry-run`。
- `database` 是 logical DB index（預設 `0`）。`dbcli blacklist table add 'secrets:*'` 註冊 key glob；可選的 `redis.mask` 區塊在讀取時遮罩值。大小防護（SCAN/HGETALL 截斷，`--no-limit` 可略過）與遮罩細節：reference.md Redis 段落。

## Elasticsearch

**dbcli 對 Elasticsearch 為唯讀 — 不支援 `insert` / `update` / `delete`。**

```bash
dbcli query '{"query":{"match":{"status":"active"}}}' --collection orders
```

- `query` 接受 DSL（JSON body）或 Lucene query string；`--collection <index>` 為必填。
- **支援：** `init`、`list`（含文件數的索引清單）、`schema [index]`（flattened mapping）、`query`、`export`（v1.22）、`shell`（v1.22）、`status`、`use`、`doctor`。**不支援：** `insert`、`update`、`delete`、`check`、`diff`、`migrate`。
- `export` 接受含 `--index <index>` 的 search DSL，或以 index 名稱作為查詢來透過 `match_all` scroll 整個 index。Query-only 上限 1000 hits；`--no-limit` 放寬至 10,000。
- Schema 會 flatten 巢狀欄位（`a.b.c`），並列出 `.fields` multi-fields。`shell` 開啟 Kibana Dev Tools 風格的 REPL。完整語法與範例：reference.md Elasticsearch 段落。

## Saved queries

執行存放於 repo 中、可重用的參數化 snippet。

| Step | Command |
|------|---------|
| 1. 探索 | `dbcli queries list`（或 `queries search <keywords>` / `queries suggest <intent>`） |
| 2. 檢視 | `dbcli queries show @<name>` |
| 3. 執行 | `dbcli q @<name> --param k=v`（blacklist 永遠強制） |

常見 intent：`perf.slow-query`、`perf.cache-hit`、`capacity.size`、`safety.connections`、`monitor.cluster-health`。

Snippet 從三層解析，**local > shared > builtin**（本地優先）：`builtin`（內建 `@diag/*`，唯讀）/ `.dbcli-shared/queries/`（團隊）/ `.dbcli/queries/`（個人）。透過 `queries new | edit | delete | rename | copy | import | export` 管理本地 snippet。每個 `.sql` 檔在 `-- ---` 區塊中宣告 YAML frontmatter（name、description、engine、params、tags、可選 `intent`、可選 `visual`）。

每個引擎的 body 格式由 `engine` frontmatter 欄位決定：

| Engine            | Body format            | Notes |
|-------------------|------------------------|-------|
| postgres / mysql  | Single SELECT or WITH  | `:name` → driver bind (`$1` / `?`) |
| elasticsearch     | JSON DSL               | `:name` → JSON-aware substitution; `index:` field required |
| redis             | Single Redis command   | `:name` → raw text; **only read commands allowed** |

跨家族的 `engine` 陣列（如 `[postgres, elasticsearch]`）在 parse 階段就被拒絕。

### 內建診斷 snippets

以 `dbcli q @diag/<topic>` 執行（引擎變體依目前連線自動選取）：

| key                     | purpose                                  |
|-------------------------|------------------------------------------|
| `@diag/connections`     | active sessions                          |
| `@diag/long-running`    | queries above `min_seconds` (`--param min_seconds=N`, default 30) |
| `@diag/table-sizes`     | table data/index size with row counts    |
| `@diag/index-usage`     | indexes by scan count                    |
| `@diag/missing-indexes` | tables dominated by sequential scans     |
| `@diag/locks`           | lock-wait chains                         |
| `@diag/db-size`         | database size summary                    |
| `@diag/cache-hit`       | buffer cache hit ratios                  |
| `@diag/es-cluster-health` | document counts per index (ES)         |
| `@diag/redis-key-stats`   | sample SCAN over keyspace (Redis)      |

## 互動式 HTML dashboard

`query`、`q` 與 `export` 可把結果渲染為獨立、自包含的 HTML 報表（內建 React + Recharts 模板）。

```bash
dbcli query "SELECT day, dau FROM dau_daily" --ui          # open in browser
dbcli q @analytics/revenue --param days=30 --ui            # snippet metadata + charts/KPIs
dbcli q @analytics/revenue --param days=30 --format html > report.html
dbcli query "SELECT * FROM orders" --format html > out.html # pipe HTML to stdout
dbcli export "SELECT * FROM orders" --format html --output orders.html
```

`--ui` 隱含 `--format html` 並開啟檔案；`--format html` 單獨使用則寫到 stdout。若已存在 saved snippet，優先用 `q @<name> --ui` / `q @<name> --format html`，因為 snippet metadata 可驅動標題、KPI cards 與圖表。Blacklist 遮蔽在渲染**之前**套用。若要取得 KPI 與圖表而非純 table，請在 snippet frontmatter 加上 `visual:` 區塊（`title`、`kpis[]`、`charts[]`）— 完整 `visual:` schema 見 reference.md。原始 `query` / `export` 呼叫只能渲染 sortable table。

## 常見工作流程

- **除錯異常狀態：** `schema` → `check` → 帶緊湊 `WHERE` 的 `query` → 順著 schema JSON 的 FK 追蹤。證據先於理論。
- **INSERT / UPDATE 之後：** 依照**如何使用 dbcli**的寫入序列（`--dry-run` → 執行 → `query` 回讀）；用 triggers、預設值或 blacklist 解釋落差。
- **Migrations：** `diff --snapshot` → `migrate`（dry-run → `--execute`）→ `diff --against` → 對受影響資料表跑 `check`。DROP 需 `--force`。
- **健康 / 成長：** `check --all`（除非加 `--include-large`，否則略過巨大表）；做 ad-hoc query 前先看 schema 的 `sizeCategory`。
- **從活線 DB 產生程式：** `schema --format json` 餵給 ORM；再用 `dbcli query` 交叉驗證一次。
- **整合事實：** 前 `query` → 跑應用 → 後 `query`。單元測試 mock 不能替代。
- **自然語言請求**（如「把訂單更新為 shipped」）：先決定要 `query` 還是 DML，透過 `schema` 把詞彙映到欄位（值用 enum 資料），尊重 blacklist 與 `sizeCategory`，**寫入永遠先 `--dry-run`**。

## 備註

- Query-only 模式自動補 `LIMIT 1000`；查 `information_schema` 或會被 `LIMIT` 破壞的語句請加 `--no-limit`。
- 被 blacklist 的 table / column 會從查詢輸出中遮蔽。
- `schema` 回報 `estimatedRowCount` 與 `sizeCategory`（small / medium / large / huge）。大 / 巨大表要加 `WHERE` 或 `LIMIT` — 分界值見 reference.md。
- 對 `mongodb+srv://` 連線，`doctor` 會回報 SRV 是用原生解析或走 DoH fallback — 在執行環境限制 DNS 時很有用。
- **全域旗標：** `--config <path>`、`--use <name>`、`-v` / `-vv` / `-q`、`--no-color`（也尊重 `NO_COLOR`）。
