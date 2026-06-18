---
name: dbcli
description: 為 AI 代理設計、具權限控管的資料庫 CLI。可用於建立連線、查詢、檢視 schema、insert/update/delete、匯出結果,以及對敏感欄位/資料表設定 blacklist。支援 MySQL、PostgreSQL、MariaDB、MongoDB、Redis 與 Elasticsearch,並可在單一專案中管理多個命名連線與自訂 env 檔。當需要設定資料庫連線(`.dbcli` / `.env`)、在 v1 單一連線與 v2 多連線格式之間選擇、挑選認證方式(URI、env 參照、Cloud ID、API key)、執行 SQL / MongoDB JSON / Redis 指令 / Elasticsearch DSL、探索表格 / collection / key / index 結構、切換資料庫環境、保護敏感資料免受 AI 存取,或在指令失敗後執行自動化復原與引導修復時,觸發此 skill。完整旗標與範例請閱讀同層的 `reference.md`。
---

**Languages:** [English](./SKILL.md) | [繁體中文](./SKILL.zh-TW.md)

# dbcli

為 AI 代理設計、具權限控管的資料庫 CLI。

## AI 代理工作流程(依序執行)

0. `dbcli skill context --format xml` — LLM 提示詞脈絡載荷：將連線中介資料、Schema 快取和已儲存查詢序列化為高度壓縮的 XML/JSON 結構以進行 Prompt 注入。
1. `dbcli inspect --for-agent` — 有界快照:連線、權限、blacklist、物件、snippets、建議的下一個指令。
2. `dbcli report --format json` — 使用內建 snippets 產出診斷報告(health / capacity / perf)。
3. `dbcli guide <goal> --format json` — 針對固定目標產出確定性的下一步指令計畫(`slow-query`、`capacity`、`health`、`index-usage`、`permissions`、`schema-overview`)。執行 `dbcli guide --list` 查看所有目標。
4. `dbcli recovery --code <CODE>` — 針對已知錯誤代碼(如 `CONN_REFUSED`、`PERMISSION_DENIED`、`SNIPPET_NOT_FOUND`)查詢結構化的復原指令。把 `--recovery` 傳給 `dbcli query` / `dbcli q`,失敗時可直接得到 `RecoveryEnvelope`。在 v1.16.0 中,`--recovery` 旗標也被 `dbcli insert`、`dbcli update`、`dbcli delete`、`dbcli export`、`dbcli schema` 與 `dbcli inspect` 支援(後者另新增 `--require-schema-cache` 對應 `SCHEMA_CACHE_MISSING` 路徑)。
   - **v1.17.0** `dbcli recover` 讀取由先前 `--recovery` 失敗自動寫入的信封(`.dbcli/last-recovery.json`)。可單純檢視(預設 Markdown),或用 `--apply` 在風險門控下執行儲存的計畫。
   - **v1.17.0** `dbcli recover --apply` 預設只執行 `risk=readonly` 與 `risk=dry-run` 步驟。可用 `--allow-write=readonly-cmd` 開放一層門控(執行本機端寫入,如 `blacklist remove`),或 `--allow-write=write-cmd`(也允許異動所連資料庫的步驟)。`--from <file>` 指定外部信封,取代自動儲存的那一個。`--format json` 輸出彙整後的機器可讀結果。
   - 退出碼:`0` 成功、`1` 步驟失敗、`2` 信封缺失或格式錯誤、`3` 所有步驟皆被跳過(請開啟 `--allow-write` 或修正 interactive / placeholder)。
   - 代理應遵守的 GuideStep 可選欄位:
     - `interactive: true` — 步驟需要 TTY(`dbcli init` 家族)。`dbcli recover --apply` 會以 `skipped:interactive` 略過。
     - `dbWrite: true` — 步驟會異動所連資料庫。鎖定最高風險層;保留給未來的寫入端復原步驟。
     - `placeholders: ['<token>', ...]` — 代理必須在 `--apply` 執行前替換這些 token,否則會以 `skipped:placeholder` 略過。
   - **v1.17.0 P4 Verification(驗證)。** `--apply` 主要計畫結束後,dbcli 會多跑 **一個唯讀步驟**(`envelope.verify`),偵測原始失敗是否已修復。輸出新增 `verifyResult`(執行的步驟)與 `verifyStatus`:
     - `passed` — 驗證器以 0 退出,且(適用時)符合預期的 JSON 形狀。
     - `failed` — 驗證器以非零退出或逾時。
     - `indeterminate` — 驗證器以 0 退出,但啟發式判斷無法確認修復(JSON 解析失敗、欄位缺失、門控略過)。
     Verify **僅在** `finalStatus === 'ok'` 時執行。傳 `--no-verify` 可略過。啟發式刻意輕量;正確性重要時,代理仍應自行對原始失敗操作再驗證一次。

驗證結果詞彙:只有在必要證據符合預期時才使用 `verified`;檢查已執行但結果違反預期時使用
`not_verified`;檢查已執行但證據不足或模糊時使用 `indeterminate`;因 config、權限、schema、
placeholder 或安全閘門導致驗證無法執行時使用 `blocked`。

   - **v1.17.0 P2 Multi-turn `--next`(多輪逐步執行)。** 當 `--apply` 顆粒度過粗(interactive 卡住、計畫需要逐步檢視,或代理希望用自有工具驅動復原)時,可逐步執行步驟並向 dbcli 詢問下一步:

     ```bash
     # 代理從信封讀取 step 1,執行後向 dbcli 取得 step 2:
     dbcli recover --next --after-step 1 --result '{"status":"ok","exitCode":0}'
     # 回傳 NextResult 信封:
     # {
     #   "schemaVersion": 1,
     #   "kind": "step",
     #   "errorCode": "BLACKLIST_TABLE",
     #   "cursor": 2,
     #   "totalSteps": 3,
     #   "step": { "order": 2, "command": "dbcli inspect --for-agent", ... }
     # }
     # 最後一步結束後,dbcli 回傳 kind: "done"。
     ```

     `--result` 接受 inline JSON `StepResultSummary`,或 `@<path>` 從檔案讀取。`stdoutSummary` 與 `stderrSummary` 各上限 4 KB — 請先把結果截到 **最後** 4 KB 再傳入。`--next` 與 `--apply` 互斥。每次呼叫獨立(不持久化 cursor)— 代理自行追蹤 `--after-step`。

     **連線錯誤分支。** 針對 `CONN_*` 代碼，envelope 會額外帶 `branches` 與 `branchFork`。步驟 1（`dbcli doctor --format json`）即為分支點：把 doctor JSON 透過 `--result.stdoutSummary` 傳入，`--next` 會挑選四個分支之一（`doctor-clean` / `doctor-config-missing` / `doctor-auth-error` / `doctor-network-error`）。NextResult 會帶 `branchId` 與 `branchDescription`；後續呼叫必須以 `--branch <id>` 走訪該分支。解析失敗或關鍵字不匹配時回落為線性 `recovery`。`--apply` 不使用 `branches`。
5. `dbcli blacklist list` — 敏感資料邊界。
6. `dbcli schema <table> --format json` — 取得真實欄位名稱(SQL / Mongo / ES)或 `schema <key>`(Redis)。**禁止猜測。**
7. 在允許的權限範圍內執行 `query` / `insert` / `update` / `delete` / `export`。
8. 所有寫入:`--dry-run`(SQL / Mongo)→ 實際執行 → `query` 回讀確認。
   - **v1.21.0 自我驗證循環（Self-Verification Loops）**：如果 snippet 在其 frontmatter 中定義了 `verify` 區塊，使用 `dbcli q @name --verify` 來執行該 snippet，即可自動跑完主要變更、執行驗證查詢並驗證斷言。

代理友善的輸出請優先用 `--format json`。

## Agent Task Packs(代理任務套件)

當使用者要求一個資料庫工作流(例如「診斷這個慢查詢」、「審計權限」、「審視長時間執行的操作」),優先選用已發布的任務模板,而非憑記憶自行組合步驟。

```bash
dbcli skill tasks list --format json                              # 探索
dbcli skill tasks show <task>                                     # 檢視
dbcli skill tasks plan <task> --param key=value --format json     # 產生計畫
```

計畫輸出是一組附帶說明與風險標籤的 dbcli 指令序列。請逐一執行 — 任務計畫**不會**繞過 blacklist、schema、dry-run 或確認等要求。

內建套件:`diagnose-slow-query` 與 **(v1.23)** `analyze-table-perf` — 後者是 read-only 的 `plan-only` 套件,需帶入必填的 `table` 參數,依序執行 `blacklist list` → `schema <table> --format json` → `guide index-usage`。`dbcli inspect` 會針對近期 audit 活動中最熱門的資料表自動建議 `analyze-table-perf`。其他唯讀套件:`audit-permissions`、`safe-backfill`、`schema-drift-review`、`connection-health` — 用 `dbcli skill tasks list` 瀏覽完整清單。

審查與驗證套件:`pr-database-review`(評估 PR 變更的查詢、遷移與 blacklist 風險)、
`migration-review`(擷取變更前 schema 並預覽 DDL)、`safe-backfill-verify`(backfill 規劃
搭配 read-back `assert`),以及 `slow-endpoint-investigation`(串接 `proxy analyze` →
`explain` → `guide missing-index-for`)。全部為唯讀 `plan-only` — 先選擇符合使用者情境的
套件再行動,任何索引/DDL 提案都應先經 `migration-review` 再寫入。

任務檔放在 `assets/tasks/`(內建)、`.dbcli-shared/tasks/`(共享)與 `.dbcli/tasks/`(本地覆寫)。

## 開發者工作流

當資料庫影響隱含在開發任務中時使用這些流程。保留一般 dbcli 安全規則：優先使用 `--format json`，碰觸敏感資料前先跑 `blacklist list`，用 `schema` 確認名稱，寫入先 dry-run，失敗後使用 `--recovery` / `recover`。

| 情境 | 使用 dbcli 的目的 | 最小安全路徑 |
| --- | --- | --- |
| DB-backed 功能 | 編輯程式碼前先把產品/程式語彙對應到真實資料物件。 | `inspect --for-agent` -> `blacklist list` -> `schema <object>` -> `queries suggest <intent>` |
| 應用程式資料錯誤 | 分離資料庫事實與應用程式推論。 | `inspect --for-agent` -> `audit tail --for-agent --n 10` -> `blacklist list` -> `schema <object>` -> 最小查詢/snippet |
| ORM 或 migration | 用 live schema 證據支撐 model 與 migration 修改。 | `schema --format json` -> `diff --snapshot <name>` -> 用 `migrate add-index`/`add-column` 產生 DDL(預覽 SQL)-> `diff --against <snapshot>` |
| PR 資料庫風險審查 | 檢查 query、write、migration、export、fixture 與 blacklist 風險。 | 審查變更的 persistence path，並針對每個重要主張提出具體 `schema`、`plan`、`dry-run`、`report` 或 `guide` 指令。 |
| 慢 endpoint 或查詢 | 在提出 index 前優先使用 read-only diagnostics。 | `report --section perf` -> task pack `analyze-table-perf` -> `guide missing-index-for "<query>"`；有 proxy log 時使用 `proxy analyze`。 |
| 安全資料回填 | 先界定受影響資料範圍並預覽 mutation。 | `blacklist list` -> `schema <object>` -> count/scope query -> `update ... --dry-run` -> read-back 或 snippet `--verify`。 |
| 環境設定驗證 | 不洩漏 secrets 地檢查 config shape 與 connectivity。 | `status --format json` -> `doctor --format json` -> `inspect --for-agent --no-connect --format json`。 |

可直接複製的指令錨點：

```bash
dbcli inspect --for-agent --format json
dbcli blacklist list --format json
dbcli schema <object> --format json
dbcli queries suggest <intent> --format json
dbcli audit tail --for-agent --n 10
dbcli schema --format json
dbcli diff --snapshot <name>
dbcli migrate add-index <table>
dbcli diff --against <snapshot>
dbcli report --section perf --format json
dbcli skill tasks plan analyze-table-perf --param table=<table> --format json
dbcli guide missing-index-for "<query>" --format json
dbcli proxy analyze --format json
dbcli query "<count/scope query>" --format json
dbcli update <object> --where "<bounded predicate>" --set '<json>' --dry-run --format json
dbcli status --format json
dbcli doctor --format json
dbcli inspect --for-agent --no-connect --format json
```

開發者工作流守門規則：

- 不要猜測 table、collection、key、index 或 field 名稱。先用 `schema` 確認，再編寫依賴這些名稱的程式碼。
- 分離資料庫事實與應用程式推論。回報是哪個 dbcli 輸出影響了程式修改或 review 結論。
- 寫入與 backfill 必須包含 scope count、dry-run preview、execution command，以及 read-back 或 snippet verification。
- 不要直接從 performance suggestion 建 index；應轉成經過 review 的 migration。
- 不要列印 credentials、複製的連線字串或 blacklisted 值。

完整旗標、每個指令的可貼上範例、`migrate` DDL、互動式 `shell` 與 MongoDB / Redis / ES 教學在 [reference.md](reference.md)(安裝時與本檔放在一起)。

## Audit Log 使用

當需要跨 session 或事後 forensics 重建工具歷史時,請優先使用 audit log,而非從零開始查詢 DB 狀態。

**情境 1 — Session handoff(接手前一個 agent 的工作):**

```bash
dbcli audit tail --for-agent --n 10           # 最近 10 筆(JSON envelope)
dbcli audit tail --all --for-agent --n 20     # 跨連線合併(D4)
```

取回 agent-facing JSON envelope,包含 `session_id` / `engine` / `command` / `target` / `success`,協助新 agent 快速掌握前一段工作脈絡。技術細節:metadata-only,**不**包含原始 SQL body / cell 值 / params(D3 鎖定)。

**情境 2 — Forensics(重建失敗現場):**

```bash
dbcli recover --format json                   # 觀察 audit_recent 嵌入 + recovery_ref
dbcli audit show <id-prefix>                  # 完整單筆 entry(≥4 字元 prefix)
dbcli audit show --recovery-ref <envelope-id> # 反向找出觸發 envelope 的 audit entry
```

`inspect` / `guide` / `recover` / `recover --apply` 的 agent JSON 內嵌 `audit_recent: AuditEntryBrief[]`(最近 5 筆),無須額外呼叫 audit CLI 即可看到歷史脈絡。Envelope 的 `audit_ref` 與 audit entry 的 `recovery_ref` 互為雙向指標。

**完整雙向覆蓋(v1.20.1+):** `recovery_ref` / `audit_ref` 雙向連結已在所有支援 `--recovery` 的指令上佈線:`query`、`inspect`、`insert`、`update`、`delete`、`export`、`q`、`schema`。Agent 可透過 `dbcli audit tail --recovery-ref <id>` 從 envelope 反查 audit entry(反方向用 `dbcli audit show --recovery-ref <id>`)。v1.20.0 中 6 個 DML/DDL 指令的部分覆蓋缺口已於 v1.20.1 關閉。

詳細指令參考:[`reference.md`](./reference.md) §audit(英文)。完整 agent 復原 walkthrough(各錯誤碼 end-to-end 情境、`--next` 多輪逐步、envelope ⇄ audit pivot、risk gate cheat sheet)見 [`reference.md`](./reference.md) §Recovery Cookbook(英文)。

## 快速開始

```bash
dbcli init                          # 建立 .dbcli 設定(自動解析 .env)
dbcli schema                        # 掃描所有資料表 → .dbcli/schemas/
dbcli query "SELECT * FROM users"   # 執行 SQL(自動加上 LIMIT 1000)
```

如果 `.dbcli` 尚未存在,請先走下方的 **連線設定** 流程,再碰 `schema` / `query`。

## 連線設定(協助使用者把資料庫接上來)

當使用者問「我要怎麼連到 X?」、「幫我把 dbcli 接到 staging DB」,或 `doctor` / `status` 回報缺失或無效的設定時,依此流程處理。

> **預設「引導」而非「直接執行」。** `init` 會把憑證寫到磁碟。**僅在** 使用者明確授權且確認過實際值後再代為執行。
> 如果 `.dbcli` 中已含有 `{"$env": "..."}` 形式的環境變數參照,**不要** 為了「把它填好」而重跑 `init` — env-ref 形式是 CI / multi-env 的刻意設計。

### 決策樹(先問再寫)

1. **一個 DB 還是多個環境?** 一個 → v1(單一連線)。多環境 / tenant / replica → v2(`--conn-name <name>`,必要時搭配每個連線專屬的 `--env-file <path>`)。
2. **憑證放在哪裡?**
   - 已在 `.env`(`DATABASE_URL` 或 `DB_HOST` / `DB_PORT` / `DB_USER` /
     `DB_PASSWORD` / `DB_NAME` | `DB_DATABASE`)→ `init` 自動解析。
   - 機密需要排除在 `.dbcli` 之外(CI/CD、multi-env)→ 使用 `--use-env-refs`,
     並搭配 `--env-host` / `--env-port` / `--env-user` / `--env-password` / `--env-database`。
   - 可以直接放明文 → 傳 `--host` / `--port` / `--user` / `--password` / `--name`(與 `--system`)。
3. **要哪一個權限層?** 預設取**最低**夠用的:
   `query-only` → `read-write` → `data-admin` → `admin`。透過 `--permission` 設定。
4. **驗證、不要假設。** init 結束後跑 `dbcli status`(系統 + 權限 + blacklist 摘要、不含憑證)與 `dbcli doctor --format json`(env、設定形狀、連線、schema-cache 年齡、Mongo SRV 路徑)。

### 每個引擎的必備指令

```bash
# PostgreSQL / MySQL / MariaDB(v1,明文值)
dbcli init --system postgresql --host localhost --port 5432 \
  --user app --password '<secret>' --name appdb --permission query-only

# 重用既有 .env(DATABASE_URL=postgresql://user:pw@host:5432/db)
dbcli init                                                # 解析 cwd 的 .env

# MongoDB — 完整 URI(Atlas / replica sets / authSource)
dbcli init --system mongodb \
  --uri "mongodb+srv://user:pw@cluster.example.mongodb.net/mydb?authSource=admin"
# MongoDB — 分項參數(無認證 = 省略 --user / --password)
dbcli init --system mongodb --host localhost --port 27017 --name mydb

# Redis — `--name` 是 LOGICAL DB INDEX("0".."15"),不是資料庫名稱
dbcli init --system redis --host localhost --port 6379 --password '<secret>' --name 0

# Elasticsearch — basic auth、Cloud ID 或 API key
dbcli init --system elasticsearch --host localhost --port 9200 \
  --user elastic --password '<secret>'
dbcli init --system elasticsearch \
  --cloud-id "myCluster:dXMtZWFzdC0xLmF3..." --api-key "<base64>"
# Multi-node / 自訂 CA / 自簽:請直接編輯 `.dbcli`,加上
# `nodes: [...]`、`protocol: https`、`caPath`、`rejectUnauthorized: false`。
```

### Multi-connection(v2 多連線)

```bash
dbcli init --conn-name staging --env-file .env.staging --permission query-only
dbcli init --conn-name prod    --env-file .env.production --use-env-refs --skip-test
dbcli use --list                          # 顯示所有連線,* 標示預設
dbcli use prod                            # 切換預設
dbcli query --use staging "SELECT 1"      # 單次覆寫
dbcli init --rename staging:stg           # 重新命名
dbcli init --remove stg                   # 移除
```

每個連線的 schema cache 存於 `.dbcli/schemas/<connection>/`。在 `schema <table>` 前,每個連線都先跑一次 `dbcli schema --use <name>` — 否則 cache 可能回傳到其他連線的欄位。

### env-refs(把機密排除在 `.dbcli` 之外)

```bash
dbcli init --use-env-refs \
  --env-host DB_HOST --env-port DB_PORT \
  --env-user DB_USER --env-password DB_PASSWORD --env-database DB_NAME
```

會以 `{ "$env": "DB_HOST" }` 等形式存入,並在執行時解析。搭配 `--env-file <path>`(v2)讓每個連線有自己的 env 檔。

### 常見陷阱

- **MongoDB `mongodb+srv://`** — `dbcli doctor` 會回報 SRV 是用原生方式解析還是走 DoH fallback;在執行環境限制 DNS 時很有用。
- **MySQL/Postgres 密碼含 `@` `:` `/`** — 使用 `DATABASE_URL` 時要 percent-encode(`@` → `%40`);分項的 `--password` 旗標不需編碼。
- **Redis `--name`** — 僅接受 logical DB index 字串;非數字會被拒絕。
- **Elasticsearch TLS** — `caPath` 與 `rejectUnauthorized` 沒有對應旗標;`init` 後直接編輯 `.dbcli` 加上。
- **重跑 `init`** — 沒有 `--force` 拒絕覆寫;千萬不要為了「修好」一個含 `{ "$env": "..." }` 參照的設定而用 `--force`。

完整旗標與邊界案例見 [reference.md](reference.md) `init` 段落。

## 指令總覽 (Command overview)

| 指令 | 最低權限 | 摘要 |
|---------|-----------------|---------|
| `init` | n/a | 建立 `.dbcli`(v1 單一或 v2 多連線,透過 `--conn-name` / `--env-file`)。**通常由真人執行** — 不要為了清掉 `{"$env"}` 參照而重跑;該格式是刻意設計。 |
| `use` | n/a | 顯示 / 切換預設命名連線(僅 v2)。 |
| `list` | query-only+ | 資料表(SQL)、collections(MongoDB)、keys(Redis)或 indices(Elasticsearch)。 |
| `schema` | query-only+ | SQL:單表或全掃描存入 `.dbcli/schemas/`。MongoDB:sampled。ES:flattened mapping。Redis:僅單一 key(type / TTL / size)。支援 `--recovery`。 |
| `query` | query-only+ | SQL、Mongo JSON(`--collection`)、Redis 指令、ES DSL / Lucene(`--collection`)。`--format table\|json\|csv\|html`、`--ui` 開啟瀏覽器互動式 dashboard。支援 `--recovery`。 |
| `explain` | query-only+ | **(v1.23)** 唯讀查詢計畫並附註解。僅 SQL。單一查詢、`@saved-query`、`@file.sql` 或 `--bulk @glob/*`。`--analyze`(EXPLAIN ANALYZE / MariaDB ANALYZE SELECT)、`--format markdown\|json\|table`。 |
| `plan` | n/a | 靜態 SQL 風險分析器(`--format text\|json`);不連線即可分類語句。 |
| `q` | query-only+ | 以 `@name` 執行已儲存 snippet，搭配 `--param k=v`。支援 `--verify` 以執行斷言。 |
| `queries` | n/a | 管理已儲存 snippet:`list` / `show` / `search` / `suggest` / `new` / `edit` / `check` / `delete` / `rename` / `copy` / `import` / `export`。 |
| `insert` / `update` | read-write+ | 僅 SQL 與 MongoDB。JSON `--data` / `--set`;`update` 必填 `--where`;先 `--dry-run`。Redis 寫入透過 `query`。支援 `--recovery`。 |
| `delete` | data-admin+ | 僅 SQL 與 MongoDB。必填 `--where`;先 `--dry-run`。支援 `--recovery`。 |
| `export` | query-only+ | 僅 SQL 與 MongoDB。Query → `--format json\|jsonl\|csv\|html` 檔案或 stdout。`html` 輸出獨立可互動 dashboard。支援 `--recovery`。 |
| `blacklist` | n/a | `list` / `table` / `column` 子指令,從查詢結果中遮蔽敏感資料。 |
| `check` | query-only+ | 僅 SQL(在 MySQL / MariaDB 最佳)。 |
| `diff` | query-only+ | 僅 SQL。儲存 / 比較 schema snapshot。 |
| `snapshot` | query-only+ | **(v1.25)** 僅 SQL。擷取結果指紋(`rowCount` + 每欄 null/distinct/min/max/sum + 順序無關 checksum)。`--out`(預設 `.dbcli/snapshots/snap-<ts>.json`)、`--rows`、`--stdout`、`--format`、`--no-limit`。作為 `assert --against` 的基準。 |
| `assert` | query-only+ | **(v1.25)** 僅 SQL。驗證不變量;失敗時 exit 1,除非 `--no-fail`。`--expect "rows>0\|value==X\|col:c not null\|unique\|between a and b\|>= n"`、`--vs <query> --compare rows\|value`(對帳)、`--against <snapshot> --tolerance <pct>`。 |
| `proxy` | n/a | **(v1.26)** 僅 MySQL/MariaDB/PostgreSQL。本地端開發觀測代理 — 中繼應用程式流量至真實資料庫,並將查詢 / 延遲 / 位元組 / 錯誤事件附加到 `.dbcli/proxy/events.jsonl`。子指令:`mysql` \| `mariadb` \| `postgresql`。`--listen`、`--target`、`--events`(預設 `.dbcli/proxy/events.jsonl`)、`--slow-ms`(預設 `1000`)、`--redact none\|literals`(預設 `none`)。僅作觀測,不改寫或封鎖。 |
| `status` | query-only+ | 安全 JSON / 文字摘要(不含憑證)。 |
| `inspect` | query-only+ | 唯讀脈絡快照(連線、權限、blacklist、物件、snippets、建議指令)。`--for-agent` / `--no-connect` / `--require-schema-cache`。支援 `--recovery`。 |
| `report` | query-only+ | 以 `@diag/*` snippet 組成的診斷報告(health / capacity / perf)。`--section`、`--brief`、`--for-agent`、`--no-connect`。 |
| `guide` | query-only+ | 針對固定目標產出確定性下一步指令計畫(`slow-query`、`capacity`、`health`、`index-usage`、`permissions`、`schema-overview`)。`--list` 列舉所有目標。 |
| `recovery` | n/a | 對已知錯誤代碼查詢結構化 `RecoveryEnvelope`(`--code <CODE>` 或 `--list`)。獨立合成器;不需真實失敗。 |
| `recover` | n/a | 檢視(預設)或 `--apply` 執行 `.dbcli/last-recovery.json` 中自動儲存的復原計畫。`--allow-write=readonly-cmd\|write-cmd`、`--no-verify`、`--from <file>`、`--next --after-step <n> --result <json\|@file>` 多輪逐步執行。 |
| `doctor` | n/a | 環境、設定、連線、SRV 診斷(Mongo)、schema cache 年齡。 |
| `completion` | n/a | bash / zsh / fish 腳本。 |
| `upgrade` | n/a | 從 npm 自我更新;每個指令都帶 24h 快取的版本提示。 |
| `shell` | (與 query 同) | 互動式 REPL。支援 SQL 引擎、MongoDB 與 Redis(單行;`.no-limit on/off`)。 |
| `skill` | n/a | 產出 / 安裝 AI skill 文件（`--install <claude\|gemini\|antigravity\|copilot\|cursor\|codex\|windsurf>`）；`skill tasks list/show/plan` 提供 Agent Task Packs；`skill context` 提供 LLM 提示詞脈絡載荷。 |
| `migrate` | admin | 僅 SQL。**DDL;預設 dry-run** — 需 `--execute` 才會真的執行。 |

任何子指令上的 `--use <name>` 都會把目標切到對應的 v2 連線,但不改變預設值。
`--recovery` 被 `query`、`q`、`insert`、`update`、`delete`、`export`、`schema` 與 `inspect` 支援;失敗時這些指令會把 `RecoveryEnvelope` JSON 輸出到 stdout、抑制人類可讀的 stderr 訊息,並原子性地把信封寫入 `.dbcli/last-recovery.json` 供 `dbcli recover` 使用。

## 權限等級 (Permission levels)

| 等級 | 允許的操作 |
|-------|---------|
| query-only | SELECT、list、schema、export |
| read-write | + INSERT、UPDATE |
| data-admin | + DELETE(DML,不含 DDL) |
| admin | + 透過 `migrate` 執行 DDL,以及破壞性操作 |

## Multi-connection(v2 多連線)

- 每個命名連線都有自己的 schema 目錄:`.dbcli/schemas/<connection>/`。
- 在 `schema <table>` 之前,每個連線都先跑一次 `dbcli schema --use <name>` — 否則 cache 可能回傳到別的連線欄位。
- `schema --refresh` / `--reset` 管理 cache;詳見 reference.md。

## MongoDB

- 用 JSON filter 物件(`find`)或 JSON 陣列(`aggregate`);SQL 會被拒絕。`query` 必填 `--collection <name>`。
- **支援:** `init`、`list`、`schema`(sampled)、`query`、`insert`、`update`、`delete`、`export`、`q`(saved queries)、`status`、`use`、`shell`、`doctor`、`upgrade`、`completion`。
- **不支援:** `diff`、`migrate`、`check`。
- Schema 由 `$sample` **採樣**（預設 100 份文件，上限 1000）。可加 `--sample-method natural` 改用 `find().limit()`。欄位以 dot-path 呈現（如 `profile.tokens.access`），附帶 `presence`（0..1）與命中黑名單時的 `redacted: true`。
- **寫入規劃器分層：** `$set`/`$unset` → `ALLOW`；`$rename` → `WARN`（資訊提示）；`$inc`/`$mul`/`$min`/`$max`/`$currentDate` → `WARN`；`$push`/`$pull`/`$pullAll`/`$pop`/`$addToSet` → `WARN`；`$bit` → `WARN`；`$where` 與未知運算子 → `BLOCK`。
- **巢狀黑名單：** `blacklist.columns[<collection>]` 接受點分路徑（`profile.email`）與結尾萬用字元（`profile.tokens.*`）；中間萬用字元會在 `dbcli blacklist list` 警告並略過。讀取路徑會將命中值取代為字串字面值 `[REDACTED]`。
- **儲存查詢：** snippet 檔名以 `.mongodb.sql` 結尾。Frontmatter 必填 `engine: mongodb` 與 `operation: find` 或 `operation: aggregate`。`target: <collection>` 為預設集合，可由 `--collection` 覆蓋。主體為 JSON（`find` 為物件、`aggregate` 為陣列）；`{{param}}` 佔位符會 JSON 編碼。
- 完整語法與範例見 reference.md MongoDB 段落。

## Redis

- 指令式執行;`query` 跑白名單內的 Redis 指令(例如 `GET`、`HSET`、`DEL`)。
- **支援:** `init`、`list`(透過 SCAN 列 keys)、`schema <key>`(type / TTL / size / sample)、`query`、`shell`、`status`、`use`、`doctor`、`upgrade`、`completion`。
- **不支援:** `schema` 全掃描、`insert`、`update`、`delete`、`export`、`check`、`diff`、`migrate`、`q`。
  寫入請走 `query "DEL <key>"` 等 — 同樣經過權限門檻。
- 權限分層對應指令:讀取類 → `query-only`;mutator(`SET`、`HSET`、...)→ `read-write`;`DEL` / `UNLINK` → `data-admin`。
- `database` 欄位是 logical DB index(預設 `0`);`list` 透過 SCAN 最多回傳 100 000 個 keys。
- **大小防護(size guard):** `SCAN`/`HSCAN`/`SSCAN`/`ZSCAN` 自動補上 `COUNT 1000`;`LRANGE`/`ZRANGE` 夾限 `stop`;`ZRANGEBYSCORE` 補上 `LIMIT 0 1000`;`HGETALL`/`HKEYS`/`HVALS`/`SMEMBERS`/`KEYS` 在 1000 筆截斷。結果帶有 `warnings[]`(`REDIS_SIZE_REWRITE` / `REDIS_SIZE_TRUNCATE`)。以 `--no-limit`(CLI)或 `.no-limit on`(shell)略過。
- **黑名單:** `dbcli blacklist add 'secrets:*'` 註冊 Redis 原生 key glob。命中規則的讀寫會被拒絕(`BlacklistRejection`,稽核記錄含 `metadata.matched_pattern`);與規則重疊的 `KEYS`/`SCAN MATCH` 會被拒絕;未重疊的列舉會濾掉黑名單 keys。
- **Shell:** Redis 連線執行 `dbcli shell` 會開啟單行 REPL(歷史、指令與 key 前綴 tab 補全、`.no-limit on/off`)。
- 詳見 reference.md Redis 段落。

## Elasticsearch

- DSL(JSON body)或 Lucene query string;`query` 必填 `--collection <index>`。
- **支援:** `init`、`list`(含文件數的索引清單)、`schema [index]`(flattened mapping)、`query`、`status`、`use`、`doctor`、`upgrade`、`completion`。
- **不支援:** `insert`、`update`、`delete`、`export`、`check`、`diff`、`migrate`、`q`。
  專屬寫入子指令尚未開放 — 若叢集允許,可用 `query` 或外部工具。
- Query-only 模式上限 1000 hits;`--no-limit` 也僅放寬到 10 000。
- Schema 會 flatten 巢狀欄位(`a.b.c`),並列出 `.fields` multi-fields。
- 詳見 reference.md Elasticsearch 段落。

## Saved queries(已儲存查詢)

執行可重用、帶參數的 SELECT 片段,存於你的 repo。

| 步驟 | 指令 |
|------|---------|
| 1. 探索 | `dbcli queries list` |
| 2. 檢視 | `dbcli queries show @<name>` |
| 3. 執行 | `dbcli q @<name> --param k=v` |

### 不知道要跑哪一個 query 時

1. `dbcli queries search <keywords>` — 自然關鍵字、fuzzy 排序
2. `dbcli queries suggest <intent>` — 依類別瀏覽
   常見 intent:perf.slow-query、perf.cache-hit、capacity.size、
                   safety.connections、monitor.cluster-health
3. 找到後:`dbcli q @<name>`(blacklist 永遠強制)

Snippet 從三層解析,**local > shared > builtin**(本地優先):
- `builtin` — 內建於 dbcli(例如 `@diag/*`);執行時唯讀
- `.dbcli-shared/queries/` — 已 commit、團隊共享
- `.dbcli/queries/` — 已 gitignore、個人覆寫

管理本地 snippets 透過 `queries new | edit | delete | rename | copy | import | export`
(見 reference.md)。用 `copy` / `import` 把 builtin 或 shared snippet fork 到本地層編輯。

每個 `.sql` 檔可在 `-- ---` 區塊中宣告 YAML frontmatter
(name、description、engine、params、tags、可選 `intent`、可選 `visual`)。
`visual:` 區塊驅動互動式 dashboard(見下方「互動式 HTML dashboard」)。
機器可讀契約見 `dbcli queries show @<name> --format json`。

### 每個引擎的 body 格式

每個 snippet 的 body 格式由 `engine` frontmatter 欄位決定:

| 引擎              | Body 格式               | 備註 |
|-------------------|------------------------|-------|
| postgres / mysql  | 單一 SELECT 或 WITH    | `:name` → driver bind(`$1` / `?`) |
| elasticsearch     | JSON DSL               | `:name` → JSON-aware 取代;必填 `index:` |
| redis             | 單一 Redis 指令         | `:name` → raw text;僅允許讀取指令 |

跨家族的 `engine` 陣列(例如 `[postgres, elasticsearch]`)在 parse 階段就被拒絕。

### 內建診斷 snippets

dbcli 內附現成的診斷查詢。用 `dbcli q @diag/<topic>` 執行:

| key                     | 用途                                      |
|-------------------------|-------------------------------------------|
| `@diag/connections`     | 活躍 session                              |
| `@diag/long-running`    | 超過 `min_seconds`(預設 30)的查詢       |
| `@diag/table-sizes`     | 帶 row 數的 table data / index 大小       |
| `@diag/index-usage`     | 依 scan 次數排序的索引                    |
| `@diag/missing-indexes` | 以 sequential scan 為主的資料表            |
| `@diag/locks`           | lock-wait chain                            |
| `@diag/db-size`         | 資料庫大小摘要                             |
| `@diag/cache-hit`       | buffer cache 命中率                        |
| `@diag/es-cluster-health` | 每個 index 的文件數(ES 連線) |
| `@diag/redis-key-stats`   | keyspace 上的 SCAN 取樣(Redis 連線) |

依目前連線自動挑選引擎變體。把同名檔案放到 `.dbcli-shared/queries/`
或 `.dbcli/queries/` 即可覆寫任何一個。

## 互動式 HTML dashboard

`query`、`q` 與 `export` 可把結果渲染為獨立、自包含的 HTML 報表,由內建的 React + Recharts 模板(`assets/ui-template.html`)驅動,
經由硬化的 `window.__DBCLI_PAYLOAD__ = {...}` 區塊注入(`<` 會被跳脫以中和 `</script>` payload)。

```bash
# 在瀏覽器中開啟(先寫到 temp 檔,再 `open` / `xdg-open` / `start`)
dbcli query "SELECT day, dau FROM dau_daily" --ui
dbcli q @analytics/revenue --param days=30 --ui

# 把 HTML pipe 到 stdout(CI 產出、email、靜態主機)
dbcli query "SELECT * FROM orders" --format html > orders.html

# 匯出到檔案(與 json / jsonl / csv 可互換)
dbcli export "SELECT * FROM orders" --format html --output orders.html
```

`--ui` 隱含 `--format html` 並開啟檔案;`--format html` 單獨使用則寫到 stdout。Blacklist 遮蔽在渲染**之前**套用 — dashboard 永遠看不到被遮蔽的欄位。

### Snippet `visual:` 區塊

要在結果中得到 KPI 與圖表(而非僅 sortable table),請在 snippet 的 frontmatter 加上 `visual:` 區塊。column 名稱必須存在於結果列中。

```sql
-- ---
-- name: Revenue Trend
-- engine: postgres
-- params:
--   days: { type: int, default: 30 }
-- visual:
--   title: Revenue (last :days days)
--   kpis:
--     - { label: Total Revenue,  value_column: total_revenue, format: currency }
--     - { label: Orders,         value_column: order_count,   format: number   }
--     - { label: Conversion,     value_column: conv_rate,     format: percent  }
--   charts:
--     - { type: line, title: Daily Revenue, x: day, y: [revenue] }
--     - { type: bar,  title: By Channel,    x: channel, y: [revenue, refunds] }
-- ---
SELECT ...
```

- `kpis[].format`:`currency` / `number` / `percent`(省略即顯示原值)。
- `charts[].type`:`line` / `bar` / `area` / `pie` / `scatter`。
- 不走 snippet 的原始 `query` 指令只能渲染 sortable / filterable table — 沒有 `visual:` 可掛載。

## 常見工作流程

- **除錯異常狀態:** `schema` → `check` → 帶緊湊 `WHERE` 的 `query` → 順著 schema JSON 的 FK 追蹤。證據先於理論。
- **INSERT / UPDATE 之後:** `--dry-run` → 實際執行 → `query` 回讀;用 triggers、預設值或 blacklist 解釋落差。
- **Migrations:** `diff --snapshot` → `migrate`(dry-run → `--execute`)→ `diff --against` → 對受影響資料表跑 `check`。DROP 需 `--force`。
- **健康 / 成長:** `check --all`(除非加 `--include-large`,否則略過巨大表);做 ad-hoc query 前先看 schema 的 `sizeCategory`。
- **從活線 DB 產生程式:** `schema --format json` 餵給 ORM;再用 `dbcli query` 交叉驗證一次。
- **整合事實:** 前 `query` → 跑應用 → 後 `query`。單元測試 mock 不能替代。
- **自然語言請求**(例如「把訂單更新為 shipped」):先決定要 `query` 還是 DML,透過 `schema` 把詞彙映到欄位(值用 enum),尊重 blacklist 與 `sizeCategory`,**寫入永遠先 `--dry-run`**。

## 備註

- Query-only 模式自動補 `LIMIT 1000`;查 `information_schema` 或會被 `LIMIT` 破壞的語句請加 `--no-limit`。
- 被 blacklist 的 table / column 會從查詢輸出中遮蔽。
- `schema` 回報 `estimatedRowCount` 與 `sizeCategory`(small / medium / large / huge)。大 / 巨大表要加 `WHERE` 或 `LIMIT` — 分界值見 reference.md。
- 對 `mongodb+srv://` 連線,`doctor` 會回報 SRV 是用原生解析或走 DoH fallback — 在執行環境限制 DNS 時很有用。
- **全域旗標:** `--config <path>`、`--use <name>`、`-v` / `-vv` / `-q`、`--no-color`(也尊重 `NO_COLOR`)。
