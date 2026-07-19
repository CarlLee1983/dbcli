# dbcli 完整說明文件

<!-- doc-key: overview -->
`dbcli` 是一款安全優先的資料庫 CLI，供人類開發者與 AI 代理（AI Agents）使用。它把 SQL（PostgreSQL、MySQL）、NoSQL（MongoDB）、Key-Value（Redis）與 Search（Elasticsearch）收攏到同一套操作介面，內建權限存取控制、敏感資料黑名單與自動化診斷工作流。

---

## 目錄

1.  [核心理念與安全性](#核心理念與安全性)
2.  [快速入門](#快速入門)
3.  [連線管理](#連線管理)
4.  [指令詳解](#指令詳解)
    *   [探索與發現](#探索與發現)
    *   [查詢與資料操作](#查詢與資料操作)
    *   [Snippet 管理 (儲存的查詢)](#snippet-管理)
    *   [健康度、診斷與修復](#健康度診斷與修復)
    *   [資料驗證 (snapshot, assert)](#資料驗證)
    *   [驗證文物檢視器](#verification-inspect)
    *   [本機觀察型 Proxy](#proxy)
    *   [進階工具 (DDL, Shell, AI Skills)](#進階工具)
5.  [互動式 HTML 儀表板](#互動式-html-儀表板)
6.  [資料庫引擎支援矩陣](#資料庫引擎支援矩陣)
7.  [AI 代理整合與 Antigravity 協議](#ai-代理整合)
8.  [Agent 修復工作流](#agent-修復工作流)
9.  [文件維護與覆蓋範圍](#文件維護與覆蓋範圍)

---

<!-- doc-key: core-philosophy -->
## 核心理念與安全性

`dbcli` 的設計初衷是「安全第一」，特別專注於防止 AI 代理在操作過程中意外洩漏或損壞敏感資料。

*   **權限守衛 (Permission Guard)**：提供四層存取控制（`query-only`、`read-write`、`data-admin`、`admin`）。
*   **黑名單管理器 (Blacklist Manager)**：從所有查詢結果中自動屏蔽敏感資料表與欄位。
*   **查詢風險分析器 (`plan`)**：在不連線資料庫的情況下分析 SQL 風險。
*   **Antigravity 協議**：將工作流程拆分為 **Architect (架構師/規劃)** 與 **Builder (建設者/執行)**，確保行動前必有策略。

---

<!-- doc-key: getting-started -->
## 快速入門

### 安裝方式
```bash
npm install -g @carllee1983/dbcli
# 或使用 Bun
bun install -g @carllee1983/dbcli
```

### 初始化連線
`init` 指令會引導你完成連線設定，它能自動解析現有的 `.env` 檔案。

在幕後，`init` 會在專案的 `./.dbcli/config.json` 寫入一個 `version: 3` 的 binding stub，真正的連線設定與任何憑證則存放在家目錄的 `~/.config/dbcli/projects/<project-name>-<sha1-12>/`。如此可還原的敏感資料不會留在專案工作區，掃描 repo 的工具或 AI agent 也看不到。專案的 `.dbcli/` 只保留 binding 與非敏感快取（schema 快取、稽核記錄、快照、驗證產物）。

```bash
dbcli init
```

使用 `--use-env-refs` 可把機密留在環境變數，不寫進設定檔；CI/CD 環境尤其適用。

---

<!-- doc-key: connection-management -->
## 連線管理

`dbcli` 支援多連線配置 (v2)，讓你在開發 (Local)、測試 (Staging) 與正式 (Production) 環境間切換。

*   **列出所有連線**：`dbcli use --list`
*   **切換預設連線**：`dbcli use <name>`
*   **單次執行覆蓋**：在任何指令後加上 `--use <name>` 參數。
    ```bash
    dbcli query --use staging "SELECT 1"
    ```

---

<!-- doc-key: command-reference -->
## 指令詳解

<!-- doc-key: discovery-exploration -->
### 探索與發現

| 指令 | 說明 |
| :--- | :--- |
| `list` | 列出資料表、集合 (Collections)、鍵 (Keys) 或索引。 |
| `schema [table]` | 顯示特定物件的結構，或掃描整個資料庫並快取元資料。 |
| `inspect` | 為 AI 代理提供唯讀的上下文快照（物件、權限、指令建議）。 |
| `status` | 顯示目前配置的安全摘要（不含機密資訊）。 |

#### `inspect` 給 agent 的輸出

`dbcli inspect` 回傳兩個平行陣列，讓 agent 在第一次呼叫就能定位：

*   **`suggestedCommands`** — 可直接執行的後續指令，依三層排序：
    1.  *Bootstrap（啟動）* — `dbcli schema --refresh`（schema 快取缺失或過期時）與 `dbcli list --format json`。
    2.  *Context-aware（情境感知）* — 由近期活動驅動。當 audit log 偵測到熱門資料表**且**有可用的 task pack 時，建議 `dbcli skill tasks plan analyze-table-perf --param table=<table>`；並依 snippet intent 提供 `dbcli queries suggest <intent>`。
    3.  *Discovery（探索）* — `dbcli skill tasks list`（有 task pack 時）與 `dbcli doctor --format json`。
*   **`hints`** — 人類可讀、不可執行的提示：近期 audit 中最常查詢的資料表、可用 task pack 數量、以及 schema 快取規模與最後刷新時間。在 markdown 輸出會呈現為 `## Hints` 區塊。

兩個陣列在 `--for-agent` / `--brief` 下都會被裁切（hints ≤ 3 條，suggestedCommands 只留最安全的 1 條）。

<!-- doc-key: query-data-operations -->
### 查詢與資料操作

| 指令 | 說明 |
| :--- | :--- |
| `query "<cmd>"` | 執行原生 SQL、MongoDB JSON、Redis 指令或 ES DSL。 |
| `q @snippet` | 執行帶有參數的儲存查詢片段。支援 `--verify` 以執行自動化斷言驗證。 |
| `export` | 將結果匯出為 JSON, CSV, JSONL 或互動式 HTML。 |
| `insert` | 從 JSON 插入資料 (支援 SQL & MongoDB)。支援 `--plan` 風險預檢（SQL、MongoDB、Redis、Elasticsearch）。 |
| `update` | 更新資料，強制要求 `--where` 子句。支援 `--plan` 風險預檢（SQL、MongoDB、Redis、Elasticsearch）。 |
| `delete` | 刪除資料，強制要求 `--where` 子句。支援 `--plan` 風險預檢（SQL、MongoDB、Redis、Elasticsearch）。 |
| `blacklist` | 管理敏感資料屏蔽規則。 |
| `plan "<sql>"` | **靜態分析器**：對 SQL 進行風險分級並給出優化建議。 |
| `lint "<sql>"` | **靜態顧問**：不連線資料庫，回報 SQL 反模式與選用的 rewrite 草稿。 |

#### DML `--plan` 預檢

`insert`、`update`、`delete` 都支援 `--plan`，可以在**不連線資料庫**的情況下，對即將執行的寫入操作執行靜態風險分析。此預檢現已支援 SQL（`postgresql`、`mysql`、`mariadb`）、MongoDB、Redis 與 Elasticsearch。

*   預檢完全是靜態的：不會建立任何 adapter、不會連線資料庫、也不會更新 schema 快取。
*   會套用所選連線的 `permission`、`blacklist` 規則，以及該引擎的 `schema` 快取。
*   `--format text`（預設）輸出人類可讀的結論；`--format json` 輸出完整的 `QueryRiskResult`。
*   分析器回傳 `BLOCK` 時 exit code 仍為 `0` — 代理應該讀取結論，而不是依賴 exit code。設定 / 連線系統 / 無效 DSL 等錯誤才會 exit `1`。
*   `--plan` 與 `--dry-run` 互斥。

各引擎在 MVP 中的保守限制：

| 引擎 | BLOCK 範例 | WARN 範例 |
| :--- | :--- | :--- |
| SQL | UPDATE/DELETE 缺 WHERE、DDL、表黑名單 | Schema 快取缺失、引用黑名單欄位 |
| MongoDB | 空 filter `{}`、`$set`/`$unset` 以外的更新運算子、`$where` | filter 沒有 `_id`、廣泛的 `$in`/`$regex`/`$gte`、schema 缺失 |
| Redis | 通配符 `*` 目標、黑名單 key/欄位 | Pattern 目標（例如 `user:*`）、update 缺欄位資訊 |
| Elasticsearch | update/delete 沒有 `_id`、黑名單 index/欄位 | Insert 沒有 `_id`、schema 缺失 |

`BLOCK` 表示預檢偵測到不安全的意圖。實際執行寫入前仍建議使用 `--dry-run` 再次確認。

範例：

```bash
dbcli insert users --data '{"name":"Alice","email":"a@b.com"}' --plan --format json
dbcli update users --where '{"_id":"abc"}' --set '{"status":"inactive"}' --plan
dbcli delete products --where '{"_id":"abc"}' --plan --format json
dbcli delete 'user:42' --where '' --plan --format json
```

<!-- doc-key: snippet-management -->
### Snippet 管理

儲存的查詢 (Snippets) 讓你能在 Repo 中維護複雜的 SQL。解析優先序為：**Local > Shared > Builtin**。

*   **列出 Snippets**：`dbcli queries list`
*   **關鍵字搜尋**：`dbcli queries search <text>`
*   **意圖建議**：`dbcli queries suggest perf`
*   **建立本地 Snippet**：`dbcli queries new @my/query --local`

<!-- doc-key: diagnostics-recovery -->
### 健康度、診斷與修復

| 指令 | 說明 |
| :--- | :--- |
| `doctor` | 執行環境與連線診斷。 |
| `check [table]` | 分析資料健康度（如孤兒資料、空值、重複項）。 |
| `diff` | 比較 Schema 快照以偵測結構變動。 |
| `report` | 產生完整的健康、容量與效能報告。 |
| `guide <goal>` | 產生特定目標的引導計畫（如：`slow-query`）。 |
| `recover --apply` | **自動化修復**：自動執行上次建議的故障修復計畫。 |
| `audit tail` | **稽核日誌**：讀取 `.dbcli/audit/<conn>.jsonl`（agent-facing JSONL）；使用 `--for-agent --n 10` 取得 session handoff JSON。|
| `--recovery`（支援的指令） | **Recovery ↔ Audit 雙向連結**：`query`、`inspect`、`insert`、`update`、`delete`、`export`、`q`、`schema`、`lint` 失敗時都會寫入互相對應的 `audit.recovery_ref` ↔ `envelope.audit_ref` UUID；用 `audit tail --recovery-ref <id>` 從 envelope 反查 audit entry。|

<!-- doc-key: data-verification -->
### 資料驗證

驗證資料處理結果是否正確 — 擷取結果指紋,再針對指紋、第二個查詢或行內條件斷言不變量。僅支援 SQL 引擎(PostgreSQL / MySQL / MariaDB)。

| 指令 | 說明 |
| :--- | :--- |
| `snapshot <query>` | 擷取**結果指紋**(rowCount + 每欄 null/distinct/min/max/sum + 順序無關的 checksum)。預設檔案 `.dbcli/snapshots/snap-<timestamp>.json`;另有 `--out`、`--rows`、`--stdout`。黑名單欄位在源頭遮罩,快照可安全保存。作為 `assert --against` 的基準。 |
| `assert <query>` | 驗證**不變量**;失敗時 exit 1,除非 `--no-fail`。`--expect "rows>0 \| value==X \| col:c not null \| unique \| between a and b \| >= n"`、`--vs <query> --compare rows\|value`(對帳兩個查詢)、`--against <snapshot> --tolerance <pct>`(對基準的漂移;`0` = 完全相符 checksum)。 |

#### assert --write-verification-artifact

使用 `--write-verification-artifact` 可在 read-back 斷言執行後,將 **結果佐證記錄**（v1 VerificationArtifact JSON）寫入 `.dbcli/verification/`，提供可稽核的持久化軌跡。驗證文物會持續寫入 `<cwd>/.dbcli/verification/`（相對於當前工作目錄），不受 `--config` 檔案位置影響。

**旗標三件組：**

| 旗標 | 必填 | 說明 |
| :--- | :--- | :--- |
| `--write-verification-artifact` | 選用 | 斷言執行後寫入 VerificationArtifact JSON。 |
| `--verification-subject <kind:name>` | 是（啟用旗標時）| 被驗證的標的。允許的 kind：`recovery`、`task-pack`、`assertion`、`migration`、`backfill`、`manual`。 |
| `--verification-summary <text>` | 否 | 可讀的摘要文字。預設值：通過 → "Assertion verified the expected state."；失敗 → "Assertion did not verify the expected state."。 |

**輸出合約：**

- `--format json` — 在 `AssertVerdict` 信封中新增 `verificationArtifactPath` 欄位。
- `--format table` — 額外印出 `Verification artifact: <path>` 那一行。
- 狀態跟隨斷言真值：`--no-fail` 失敗仍會記錄 `not_verified` / 佐證 `exitCode: 1`。

**計畫佐證 vs 結果佐證的區別。** `dbcli skill tasks plan safe-backfill-verify` 產生的計畫 JSON 包含一個 `verification` 區塊，其 `status` 為 `"planned"` — 這是**計畫中**的佐證定義，描述哪項檢查將在執行時進行。最後的 `assert --write-verification-artifact` 步驟才會產生**結果**佐證（`status: verified` 或 `not_verified`）。這兩者是不同的記錄；`"planned"` **不代表**驗證已執行。

> **注意：** 請將 bigint 聚合函數（`count(*)`、`sum()`）轉型為 `::int`，讓 `value ==` 做數值比較 — Postgres 回傳的 bigint 是字串，而 `value ==` 採嚴格相等。

```bash
# 1. 規劃工作流（plan-only，計畫佐證）
dbcli skill tasks plan safe-backfill-verify \
  --param table=orders \
  --param query="UPDATE orders SET status = 1 WHERE status IS NULL" \
  --param verify_query="SELECT count(*)::int FROM orders WHERE status IS NULL" \
  --param expect="value == 0"

# 2. 手動 dry-run 寫入操作
dbcli update orders --where "status IS NULL" --set '{"status": 1}' --dry-run

# 3. 在既有寫入權限下執行寫入
dbcli update orders --where "status IS NULL" --set '{"status": 1}'

# 4. 執行最終斷言並持久化結果佐證
dbcli assert "SELECT count(*)::int FROM orders WHERE status IS NULL" \
  --expect "value == 0" \
  --write-verification-artifact \
  --verification-subject backfill:safe-backfill-verify
```

> `dbcli verify` **執行**驗證情境（safe-backfill、migration、rollback、constraint），永不執行寫入或 DDL。
> `dbcli verification` **檢視與管理**這些情境產生的本機結果文物（位於 `.dbcli/verification/`）。

#### verify safe-backfill

在不執行任何 `UPDATE` 的前提下，驗證安全 backfill 的正確性。預檢模式（預設）執行唯讀防護並印出實際的 after-write 指令；`--after-write` 模式重新執行防護、執行回讀斷言，並寫入驗證文物。

> ⚠️ `verify safe-backfill` 永遠不會執行 backfill 寫入。請先透過一般寫入指令執行已核准的寫入，再執行 `--after-write`。

預檢（Preflight）：

    dbcli verify safe-backfill \
      --table users \
      --query "UPDATE users SET status = 1 WHERE status IS NULL" \
      --verify-query "SELECT count(*)::int AS n FROM users WHERE status IS NULL" \
      --expect "value == 0"

After-write（寫入文物）：

    dbcli verify safe-backfill ... --after-write

檢視結果：`dbcli verification show <artifact-id>`。

預檢也會回顯**預計執行的 update**（你需自行執行的 `--query`），讓印出的內容成為此操作完整、可直接複製的紀錄。

結果狀態：`verified`（回讀符合 `--expect`）、`not_verified`（回讀與 `--expect` 相悖）、`blocked`（防護失敗 — blacklist、schema、plan，或 verify-query 非唯讀）、`indeterminate`（斷言已執行但無法產生可信的結論）。

**防護約束（fail closed）：**

- `--verify-query` 必須是**單純的 `SELECT`**。`EXPLAIN` / `EXPLAIN ANALYZE`、`SHOW`、`DESCRIBE`，以及會寫入資料的 CTE（`WITH … (DELETE … RETURNING) …`）都會被拒絕 — 在 PostgreSQL 上 `EXPLAIN ANALYZE <write>` 會真的執行寫入，因此回讀僅限於絕不會變更資料的語句。
- `--query` 的 **UPDATE 目標必須等於 `--table`**，並以 **schema-aware** 方式比對（`public.users` 不會通過 `--table audit.users`）。對其他資料表的 `UPDATE` 會被阻擋，確保你斷言的回讀對象與實際寫入的資料表一致。
- 持久化的文物僅儲存 verify-query **與 `--expect`** 的**有界、去除字面值的標籤**：字串、數字與 dollar-quoted（`$$…$$`）字面值都會被移除，原始 SQL 及任何內嵌值都不會寫入磁碟。
- 印出的 after-write 指令會做 **shell escaping**，即使 SQL 含有引號也維持正確；並會帶上 `--subject-name`、`--summary` 與非預設的 `--format`。

> 💡 **同一資料表的重複 backfill。** 文物的 subject 名稱預設為資料表（`backfill:<table>`）。當你對同一資料表執行多個不同的 backfill 時，請傳入 `--subject-name <唯一標籤>`，讓每次操作在 `dbcli verification list` 中都能獨立追蹤。

#### verify migration

針對 schema migration 進行預檢或 after-write 驗證。**此指令永遠不會執行 DDL** — 它分析提案的 `ALTER TABLE`、執行唯讀防護，並（在 after-write 模式下）在你於外部套用 migration 後記錄佐證。

> ⚠️ `verify migration` 永不執行 DDL。請先在外部套用 migration，再執行 `--after-write` 記錄佐證。

預檢（Preflight）：

    dbcli verify migration \
      --table users \
      --ddl "ALTER TABLE users ADD COLUMN verified_at TIMESTAMPTZ" \
      --verify-query "SELECT count(*)::int AS n FROM users WHERE verified_at IS NOT NULL" \
      --expect "value == 0"

在外部套用 migration 後：

    dbcli verify migration ... --after-write

| Option | 必填 | 說明 |
| --- | --- | --- |
| `--table <table>` | 是 | Migration 影響的資料表。 |
| `--ddl <sql>` | 是 | 提案的 migration DDL，僅分析，永不執行。MVP 僅接受 `ALTER TABLE`。 |
| `--verify-query <sql>` | 是 | migration 後回讀驗證用的純 `SELECT`。 |
| `--expect <expr>` | 是 | 回讀結果的斷言表達式。 |
| `--after-write` | 否 | 執行 migration 後的斷言並寫入 v1 文物。 |
| `--format <table\|json>` | 否 | 輸出格式，預設 `table`。 |
| `--subject-name <name>` | 否 | 文物 subject 名稱，預設為資料表名稱。 |
| `--summary <text>` | 否 | 選填文物摘要覆寫。 |

預檢回傳 `ready` 或 `blocked` 並印出精確的 after-write 指令；**`ready` 不等於 `verified`** — 只表示防護通過。After-write 將回讀斷言對應至 `verified` / `not_verified` / `indeterminate`，防護失敗則為 `blocked`。MVP 中 `CREATE TABLE`、`DROP TABLE`、`CREATE INDEX` 及多語句 DDL 均會被阻擋。

**支援的 `ALTER TABLE` 目標識別字。** 目標可為 `table`、`schema.table` 或 `catalog.schema.table`。每個區段可為簡單未加引號的名稱（`[A-Za-z_][A-Za-z0-9_]*`），或加引號的識別字 — 雙引號（`"…"`）、反引號（`` `…` ``）或方括號（`[…]`） — 因此含空白或連字號的名稱（如 `"user accounts"` 或 `"tenant-1"."orders"`）皆可接受。無法在此契約下完整解析的目標（未封閉的引號、不支援的跳脫、或超過三個區段）會在 after-write 斷言**之前被阻擋**，原因會明示「目標無法解析」 — 與 `must match --table` 的不符原因有所區別。

#### verify rollback

針對你於外部套用的 rollback 進行預檢或 after-write 驗證 — 可還原 schema migration（`--kind ddl`）或還原資料變更（`--kind dml`）。**此指令永遠不會執行還原語句** — 它分析提案的 `--statement`、執行唯讀防護，並（在 after-write 模式下）在你自行套用 rollback 後記錄佐證。

> ⚠️ `verify rollback` 永不執行 rollback 語句。請先在外部套用 rollback，再執行 `--after-write` 記錄佐證。

Schema rollback 預檢（`--kind ddl`，單一 `ALTER TABLE`）：

    dbcli verify rollback \
      --kind ddl \
      --table users \
      --statement "ALTER TABLE users DROP COLUMN verified_at" \
      --verify-query "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'verified_at'" \
      --expect "value == 0"

資料 rollback 預檢（`--kind dml`，單一 `UPDATE`）：

    dbcli verify rollback \
      --kind dml \
      --table users \
      --statement "UPDATE users SET status = NULL WHERE status = 9" \
      --verify-query "SELECT count(*)::int AS n FROM users WHERE status = 9" \
      --expect "value == 0"

在外部套用 rollback 後：

    dbcli verify rollback --kind <ddl|dml> ... --after-write

| Option | 必填 | 說明 |
| --- | --- | --- |
| `--kind <ddl\|dml>` | 是 | 還原語句種類：`ddl`（單一 `ALTER TABLE`）或 `dml`（單一 `UPDATE`）。 |
| `--table <table>` | 是 | Rollback 影響的資料表。 |
| `--statement <sql>` | 是 | 提案的還原語句，僅分析，永不執行。 |
| `--verify-query <sql>` | 是 | rollback 後回讀驗證用的純 `SELECT`。 |
| `--expect <expr>` | 是 | 回讀結果的斷言表達式。 |
| `--after-write` | 否 | 執行 rollback 後的斷言並寫入 v1 文物。 |
| `--format <table\|json>` | 否 | 輸出格式，預設 `table`。 |
| `--subject-name <name>` | 否 | 文物 subject 名稱，預設為資料表名稱。 |
| `--summary <text>` | 否 | 選填文物摘要覆寫。 |

`--kind` 決定語句須符合哪一種文法，並復用同類 scenario 的防護：`ddl` 復用 `verify migration` 的 `ALTER TABLE` 契約（單一語句、目標須符合 `--table`）；`dml` 復用 `verify safe-backfill` 的 plan 契約（僅 `UPDATE`、須含 `WHERE`、目標須符合 `--table`）。預檢回傳 `ready` 或 `blocked`；**`ready` 不等於 `verified`**。After-write 將回讀斷言對應至 `verified` / `not_verified` / `indeterminate`，防護失敗則為 `blocked`。文物會以既有的 subject kind 記錄此 rollback（`ddl` 為 `migration`，`dml` 為 `backfill`），並標記 `command: verify rollback`。MVP 中 `ddl` 僅支援單一 `ALTER TABLE`、`dml` 僅支援單一 `UPDATE`；尚未支援 `INSERT`／`DELETE` 還原。

#### verify constraint

預檢或 after-write 驗證「**資料完整性不變式是否成立**」 — 外鍵一致性、NOT NULL 覆蓋率、唯一性或自訂違規查詢。**此指令永遠不會執行寫入** — 只執行唯讀 `COUNT(*)` 違規查詢，並（在 after-write 模式下）記錄佐證。

> ⚠️ `verify constraint` 永不執行寫入或 DDL 語句。請在變更前執行 preflight，變更套用後再以 `--after-write` 記錄佐證。

以 `--check` 選擇四種檢查類型：

- `fk` — 統計孤兒列數（子欄位無對應父列）。需提供 `--column` 與 `--references <table.column>`。
- `not-null` — 統計欄位值為 NULL 的列數。`--column` 可重複使用。
- `unique` — 統計欄位值重複的列數。`--column` 可重複使用。
- `custom` — 執行你提供的 `--violation-query <sql>`（唯讀 `SELECT`，回傳單一整數違規筆數）。

FK 預檢（在 migration 前驗證無孤兒 orders）：

    dbcli verify constraint \
      --table orders \
      --check fk \
      --column customer_id \
      --references customers.id

NOT NULL 預檢（驗證欄位已完整填寫）：

    dbcli verify constraint \
      --table users \
      --check not-null \
      --column email

在外部套用變更後：

    dbcli verify constraint --table orders --check fk --column customer_id \
      --references customers.id --after-write

| Option | 必填 | 說明 |
| --- | --- | --- |
| `--table <table>` | 是 | 受檢資料表。 |
| `--check <kind>` | 是 | 限制類型：`fk` \| `not-null` \| `unique` \| `custom`。 |
| `--column <name>` | 是（fk/not-null/unique） | 受檢欄位。`not-null`/`unique` 可重複；`fk` 為子欄位。 |
| `--references <table.column>` | 是（fk） | FK 父查詢的參照 `<table>.<column>`。 |
| `--violation-query <sql>` | 是（custom） | 唯讀 `SELECT`，回傳單一整數違規筆數。 |
| `--allow-preexisting` | 否 | 無回退模式：`count ≤ --baseline` 時視為驗證通過。 |
| `--baseline <n>` | 否 | preflight 量測的基準違規筆數（搭配 `--allow-preexisting`）。 |
| `--after-write` | 否 | 重新計算違規筆數並寫入 v1 文物。 |
| `--format <table\|json>` | 否 | 輸出格式，預設 `table`。 |
| `--subject-name <name>` | 否 | 文物 subject 名稱，預設為資料表名稱。 |
| `--summary <text>` | 否 | 選填文物摘要覆寫。 |

預檢回傳 `ready` 或 `blocked`；**`ready` 不等於 `verified`**。After-write 將違規筆數對應至 `verified`（violations ≤ threshold）或 `not_verified`（violations > threshold）。預設 threshold 為 `0`（嚴格模式）。啟用 `--allow-preexisting` 時，threshold 為 preflight 量測的 `--baseline` 筆數 — 只要 after-write 筆數不超過預既存水準即視為通過。查詢錯誤回傳 `indeterminate`，防護失敗回傳 `blocked`。文物使用 `subject.kind = 'table'`、`command: verify constraint`。MVP：僅限 SQL 引擎；FK 僅支援單一欄位；永不執行寫入。

<!-- doc-key: verification-inspect -->
### verification — 檢視與管理驗證文物

`dbcli verification` 操作寫入於 `<cwd>/.dbcli/verification/` 下的文物。
它不連線資料庫、也不寫入稽核記錄。`list`、`show`、`summary` 為唯讀的檔案系統檢視;
`prune` 為本機生命週期指令,預設為 dry-run,僅在帶上 `--execute --force` 時才刪除檔案。
儲存根目錄為目前工作目錄,與 `--config` 位置無關。

- `dbcli verification list [--format json|table] [--limit <n>] [--status <status>] [--subject <kind[:name]>] [--include-invalid]`
  — 依最新優先列出文物。
- `dbcli verification show <id-or-path> [--format json|table]`
  — 以精確 id、唯一 id 前綴、檔名或路徑印出單筆文物。
- `dbcli verification summary [--format json|table] [--status <status>] [--subject <kind[:name]>] [--latest-only]`
  — 顯示最新狀態、各狀態計數、無效計數及每個 subject 的細分。`--latest-only` 縮小為最新的一筆符合有效文物加上各狀態計數（省略 `subjects` 細分）；無符合文物時以 `0` 退出並回傳 `latest: null`。
- `dbcli verification prune --older-than <Nd> [--format json|table] [--keep-latest <n>] [--status <status>] [--subject <kind[:name]>] [--include-invalid] [--execute --force]`
  — 預覽（dry-run）或依保留條件刪除本機驗證產物檔案。

狀態值：`verified`、`not_verified`、`indeterminate`、`blocked`。
Subject kind：`recovery`、`task-pack`、`assertion`、`migration`、`backfill`、`manual`。

若 `.dbcli/verification/` 目錄不存在，回傳空結果並以 `0` 退出。
`list`/`summary` 執行時會略過格式有誤的檔案（可透過 `--include-invalid` 及 `summary` 的無效計數觀察）；對格式有誤的檔案執行 `show` 時，會以 `1` 退出。

`prune` 預設為 dry-run。`--keep-latest`(預設 20)一律保護最新的 N 筆**有效**文物,
範圍涵蓋所有 subject 與 status,且在套用 `--status`/`--subject` 篩選**之前**先行保護。
只有同時帶上 `--execute` 與 `--force` 時才會刪除,且僅刪除 `.dbcli/verification/`
內符合 `verification-*.json` 的一般檔案;execute 模式的表格輸出會逐一列出已刪除與略過的檔案。

```bash
dbcli verification summary --format json
dbcli verification list --status verified --subject backfill:safe-backfill-verify
dbcli verification show ver_abcd --format json
dbcli verification prune --older-than 30d --format json
dbcli verification prune --older-than 30d --keep-latest 20 --execute --force
```

<!-- doc-key: proxy -->
### dbcli proxy — 本機觀察型 Proxy

本機開發觀察型 Proxy — 將現有應用程式指向 Proxy 埠號，`dbcli` 便會將所有查詢轉發至真實資料庫，同時記錄查詢文字、延遲、位元組數、資料列數及錯誤事件。**這不是正式環境閘道器。** 僅限本機開發環境使用。

#### 快速開始

```bash
# 明確指定上游 / 下游
dbcli proxy mysql --listen 127.0.0.1:3307 --target 127.0.0.1:3306
dbcli proxy postgresql --listen 127.0.0.1:5433 --target 127.0.0.1:5432

# 從具名連線推斷引擎與目標
dbcli proxy --use local --listen 127.0.0.1:3307
```

將應用程式的 DB host/port 改為 `--listen` 位址，憑證維持不變。Proxy 完全透明 — 應用程式的行為與直連相同。

#### 選項

| 選項 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `--listen` | — | 本機監聽位址（例如 `127.0.0.1:3307`）。必填。 |
| `--target` | — | 上游 DB 位址。未指定 `--use` 時必填。 |
| `--events` | `.dbcli/proxy/events.jsonl` | 僅追加的 JSONL 事件日誌路徑。 |
| `--slow-ms` | `1000` | `durationMs` 達到此閾值（毫秒）的查詢會在 `query_completed` 事件中標記 `slow: true`（並印出終端警告）。 |
| `--redact` | `none` | `none` 保留原始 SQL 文字；`literals` 遮罩字串與數字字面值。 |
| `--format` | `text` | 終端輸出格式：`text` 或 `json`。 |

#### 事件日誌（JSONL）

每筆完成的查詢會在事件日誌中附加一個 JSON 物件：

```json
{"version":1,"type":"query_completed","timestamp":"2026-06-04T12:00:00.000Z","engine":"mysql","sessionId":"pxy_1","queryId":"qry_pxy_1_1","client":"127.0.0.1:54321","target":"127.0.0.1:3306","sql":"SELECT * FROM users WHERE id = ?","statement":"SELECT","tables":["users"],"durationMs":4,"requestBytes":42,"responseBytes":318,"rowCount":1,"error":null,"tags":[]}
```

#### 隱私

SQL 文字一律儲存於事件日誌。**結果資料列永不儲存。** 使用 `--redact literals` 可在記錄前遮罩 SQL 中的字串與數字字面值（例如 `WHERE id = ?` 取代 `WHERE id = 42`）。

#### 離線分析事件日誌

`dbcli proxy analyze` — 離線分析擷取的事件日誌(不連 DB)。`--format json|text`、`--top`、`--slow-ms`、`--n-plus-one`、`--no-include-rotated`。輸出總覽、各查詢指紋統計(附 `explain` / `guide missing-index-for` 建議指令)、最慢查詢、錯誤分群、熱點表、N+1 嫌疑。

#### 限制（v1）

- **TLS**：v1 不會解密 TLS。加密連線仍會產生 session 與位元組統計事件，但不會解析或顯示 SQL — 若需要查詢可見度，請在本機分析時停用 SSL。
- **MySQL prepared/binary 協議**：盡力解析；標記為 `prepared_statement`。
- **PostgreSQL extended query 協議**：盡力解析；標記為 `extended_protocol` 或 `parse_partial`。

<!-- doc-key: advanced-tools -->
### 進階工具

| 指令 | 說明 |
| :--- | :--- |
| `shell` | 啟動互動式 REPL，支援 Tab 自動補全與 SQL 高亮。 |
| `migrate <action>` | **DDL 引擎**：建立/修改/刪除資料表與索引。 |
| `skill --install` | 為 AI 代理安裝 `SKILL.md` 指引（Claude, Gemini, Antigravity 等）。 |
| `skill context` | 將快取的 schema、連線與儲存的查詢元資料序列化為 LLM 優化的 XML/JSON/Markdown 格式，以供 AI prompt 注入使用。 |
| `skill tasks` | 管理任務包 (Task Packs) — 專家級的可重複資料庫工作流。 |
| `completion` | 安裝 shell 自動補全 (bash/zsh/fish)。 |

### Shell 自動補全

`dbcli completion <bash|zsh|fish>` 會輸出補全腳本；`dbcli completion --install` 會安裝它。
已安裝的補全支援巢狀子指令，例如 `dbcli queries list --<TAB>`、
`dbcli migrate add-column --<TAB>` 與 `dbcli verify safe-backfill --<TAB>`。
在 option value 或位置參數之後也會維持 leaf command 範圍，例如
`dbcli queries list --format json --<TAB>`。

在 `dbcli shell` 中，指令補全會依照目前的指令範圍運作，因此新增的指令
（`q`、`queries`、`inspect`、`verify`、`proxy`、`snapshot` 等）會自動補全並可被執行。

`dbcli completion --install` 採用標記區塊管理：它只會在 shell 設定檔寫入單一管理區塊，
重新執行時會「取代」該區塊，而不會重複新增。

> **內建任務包 `analyze-table-perf`。** 唯讀（`plan-only`）的 task pack，吃必填的 `table` 參數，依序執行 `blacklist list` → `schema <table> --format json` → `guide index-usage --format json`。`dbcli inspect` 會針對近期活動中最熱門的資料表自動建議它。另也內建多個唯讀套件 — `audit-permissions`、`safe-backfill`、`schema-drift-review` 與 `connection-health`。用 `dbcli skill tasks list` 瀏覽所有 task pack。

> **`safe-backfill-verify` 任務計畫與 `verification` 區塊。** 執行 `dbcli skill tasks plan safe-backfill-verify --format json` 回傳的計畫 JSON 中包含一個 `verification` 區塊，其 `status` 為 `"planned"`。此區塊描述任務執行時將進行的回讀斷言 — 這是**計畫中**的佐證定義，**而非執行結果**。`status: "planned"` **不代表**驗證已執行或通過，僅表示任務計畫知道要在執行時執行哪項驗證。

---

<!-- doc-key: html-dashboards -->
## 互動式 HTML 儀表板

在查詢時加上 `--ui` 旗標，即可在瀏覽器中開啟互動式 React 報表。

```bash
dbcli query "SELECT * FROM daily_metrics" --ui
```

**KPI 與圖表**：在 Snippet 的 Frontmatter 中加入 `visual:` 區塊，即可直接在儀表板中呈現自定義圖表與 KPI。支援的圖表類型為 `line`（折線圖）、`bar`（長條圖）、`area`（區域圖）、`pie`（圓餅圖）四種；指定其他類型會在解析時報錯。

---

<!-- doc-key: engine-support -->
## 資料庫引擎支援矩陣

| 功能 | PostgreSQL/MySQL | MongoDB | Redis | Elasticsearch |
| :--- | :---: | :---: | :---: | :---: |
| 基礎查詢 | ✅ | ✅ | ✅ | ✅ |
| Schema 快取 | ✅ | ✅ | ❌ | ✅ |
| 儲存 Snippets | ✅ | ✅ | ✅ | ✅ |
| 寫入操作 (DML) | ✅ | ✅ | ✅ (透過 query) | ❌ |
| 結構變更 (DDL) | ✅ | ❌ | ❌ | ❌ |
| 互動式 UI | ✅ | ✅ | ✅ | ✅ |
| 查詢大小防護 | ✅ | ✅ | ⚠️（改寫 + 截斷） | ✅ |
| 黑名單強制 | ✅ | ✅ | ⚠️（key glob） | ⚠️ |
| 互動式 Shell（`shell`) | ✅ | ✅ | ✅（單行） | ⚠️（Kibana 風格） |

### MongoDB 寫入規劃器（運算子分層）

| 分層 | 運算子 | 計畫結果 |
|---|---|---|
| SAFE | `$set`、`$unset` | `ALLOW` |
| RENAME | `$rename` | `WARN`（資訊提示；rename 不會外洩資料） |
| ARITHMETIC | `$inc`、`$mul`、`$min`、`$max`、`$currentDate` | `WARN` |
| ARRAY | `$push`、`$pull`、`$pullAll`、`$pop`、`$addToSet` | `WARN` |
| BITWISE | `$bit` | `WARN` |
| BLOCK | `$where`、未知運算子 | `BLOCK` |

執行前使用 `dbcli update --dry-run` 預覽計畫。

### MongoDB 巢狀黑名單

dbcli 設定內的 `blacklist.columns[<collection>]` 接受點分路徑與一個結尾萬用字元：

```json
{
  "blacklist": {
    "columns": {
      "users": ["password", "profile.email", "profile.tokens.*"]
    }
  }
}
```

`profile.tokens.*` 涵蓋 `profile.tokens` 與其所有後裔。萬用字元若不在最後一段會被略過，並在 `dbcli blacklist list` 時提出警告。SQL 連線會忽略含 `.` 或 `*` 的條目。

備註：串流匯出（`dbcli export`）會先緩衝整批列才遮罩。超大匯出建議先以較窄的條件查詢，等待 streaming-aware 遮罩支援。

### MongoDB schema 採樣

`dbcli schema <collection> [--sample-size 100] [--sample-method random|natural]`

- `random`（預設）使用 `$sample`；驅動錯誤時退回自然順序。
- 輸出欄位包含巢狀 dot-path，附帶 `presence`（0..1）以及命中黑名單時的 `redacted: true`。

### MongoDB 儲存查詢

Snippet 位置：`assets/snippets/`（內建）、`.dbcli-shared/queries/`（共用）、`.dbcli/queries/`（本地）。Mongo snippet：

- 檔名以 `.mongodb.sql` 結尾。
- Frontmatter 必須宣告 `engine: mongodb` 與 `operation: find` 或 `operation: aggregate`。`target: <collection>` 提供預設集合，可由 CLI `--collection` 覆蓋。
- 主體為 JSON：`find` 為物件，`aggregate` 為陣列。每個 `{{param}}` 佔位符會以 JSON 編碼——字串會被加引號並轉義，因此被注入成運算子形狀的字串無法逃逸至運算子位置。

執行：`dbcli q @<key>`。

### Redis:大小防護、黑名單與 shell(v1.21.0)

**大小防護** — 無上限的讀取會自動加上界線:

- `SCAN` / `HSCAN` / `SSCAN` / `ZSCAN` 自動補上 `COUNT 1000`(較大的 `COUNT` 會被夾限)。
- `LRANGE` / `ZRANGE` / `ZREVRANGE` 夾限 `stop`,使區間 ≤ 1000;`ZRANGEBYSCORE` 補上 `LIMIT 0 1000`。
- `HGETALL` / `HKEYS` / `HVALS` / `SMEMBERS` / `KEYS` 在 1000 筆截斷。

結果帶有 `warnings[]`:引數被改寫時為 `REDIS_SIZE_REWRITE`,回覆被截斷時為 `REDIS_SIZE_TRUNCATE`。以 `--no-limit`(CLI)或 `.no-limit on`(shell)略過。

```bash
dbcli query "LRANGE jobs 0 -1"            # 夾限至 1000 → REDIS_SIZE_REWRITE
dbcli query "HGETALL bighash" --no-limit  # 完整回覆,不截斷
```

**黑名單** — 規則以 Redis 原生 key glob(`*`、`?`、`[abc]`、`[a-z]`)強制:

```bash
dbcli blacklist table add 'secrets:*'
dbcli query "GET secrets:api_key"   # 拒絕(BlacklistRejection);稽核記錄含 matched_pattern
dbcli query "KEYS secrets:*"        # 拒絕(pattern 與規則重疊)
dbcli list                           # 黑名單 keys 被濾掉
```

**遮罩(Masking,v1.22)** — key glob 黑名單是「拒絕」,遮罩則是「屏蔽」:命中的讀取會回傳 `[REDACTED]`,讓 AI 代理仍能執行指令,但永遠看不到敏感值。在 dbcli 設定中加入選用的 `redis.mask` 區塊:

```json
{
  "redis": {
    "mask": [
      { "keyPattern": "user:*", "fields": ["password", "token"] },
      { "keyPattern": "secret:*" }
    ]
  }
}
```

- `keyPattern` 為 Redis 原生 glob(`*`、`?`、`[abc]`),每條規則套用到它所匹配的 key。
- 有 `fields` → 只遮罩這些 hash 欄位(`HGETALL`、`HGET`、`HMGET`)。
- 無 `fields` → 遮罩整個值(`GET`、`GETRANGE`,以及 hash 的所有欄位)。
- 遮罩涵蓋 `GET` / `GETRANGE` / `HGETALL` / `HGET` / `HMGET` / `HVALS`。
- **拒絕優先於遮罩:** 若某個 key 同時命中 `blacklist` 規則與 `mask` 規則,該指令會直接被拒絕,不會進入遮罩流程。

```bash
dbcli query "GET secret:api_key"   # → { "value": "[REDACTED]" }
dbcli query "HGETALL user:1"        # → password/token 被遮罩,其他欄位保留
```

**Shell** — Redis 連線執行 `dbcli shell` 會開啟單行 REPL,具備歷史、tab 補全(指令 + key 前綴)與 `.no-limit on/off` 切換。指令直接輸入,毋須結尾分號(例如 `GET mykey`)。

### Elasticsearch:互動式 shell（v1.22.0）

Elasticsearch 連線執行 `dbcli shell` 會開啟專屬的 Kibana Dev Tools 風格 REPL。輸入請求行 `<METHOD> /<path>`,接著可選的多行 JSON body,再以**空白行**送出整個區塊。回應以美化後的 JSON 呈現。

```text
es> GET /_cat/indices
        (空白行送出)

es> POST /users/_search
... {
...   "query": { "match_all": {} }
... }
        (空白行送出)
```

- **以讀取為主。** Index 層級黑名單會在前端直接拒絕受保護的 index;任何 `_search` 請求若 body 未指定 `size`,會自動上限為 **1000** 筆 hits。
- **空白行**送出當前區塊;**Ctrl+C** 取消進行中的區塊;**Ctrl+D** 或輸入 `exit` / `quit` 離開 shell。

### Elasticsearch:匯出（v1.22.0）

Elasticsearch 連線執行 `dbcli export` 可將文件匯出為 JSON、JSONL 或 CSV,支援兩種形式:

```bash
# 1. 匯出 search DSL 的命中結果 — 需要 --index
dbcli export '{"query":{"match":{"status":"open"}}}' --index orders --format json

# 2. 透過 match_all + scroll 匯出整個 index — 直接把 index 名稱當作查詢傳入
dbcli export orders --format jsonl --output orders.jsonl
```

- 預設**上限為 1000 筆**。加上 `--no-limit` 可匯出整個 index(整索引形式會以 scroll 分批串流)。
- 在讀取任何文件前,目標 index 會先經過**索引層級黑名單**檢查。
- 每次匯出都會寫入一筆**稽核紀錄**,記錄目標 index、筆數與輸出格式。

---

<!-- doc-key: ai-agent-integration -->
## AI 代理整合

`dbcli` 設計成 AI 代理的「資料庫驅動程式」。

1.  **SKILL.md**：透過 `dbcli skill` 提供 AI 指引，讓代理知道安全的指令路徑。
2.  **修復封包 (Recovery Envelopes)**：當指令失敗時，使用 `--recovery` 獲得機器可讀的 JSON 錯誤及修復建議。
3.  **風險控制**：AI 代理會主動使用 `dbcli plan`、`insert`/`update`/`delete` 的 `--plan` 預檢與 `--dry-run` 來驗證其行為。
4.  **上下文效率**：`inspect --for-agent` 提供精簡的元資料，防止 AI 上下文視窗過載。
5.  **稽核日誌 (Audit Log)**：詳見 [`SKILL.md`](../../../assets/SKILL.md) / [`README §Audit Log`](../../../README.md#audit-log)。
6.  **AI 協作提示注入**：`dbcli skill context` 將連線資訊、schema 快取和儲存查詢元資料序列化為高度壓縮、針對 token 優化的 XML、Markdown 或 JSON 結構，專門設計用於 AI 提示詞注入。
7.  **自我驗證循環**：Snippet 可以定義 `verify` frontmatter 元資料（指定 `query` 與 LHS-運算子-RHS 的 `expects` 斷言）。使用 `dbcli q @name --verify` 執行查詢時，會自動執行主要指令、執行驗證查詢，並驗證傳回資料集的斷言。
8.  **Agent Plugin**：repo root 採用 Ponytail-style plugin layout，包含 `.agents/plugins/marketplace.json`、`.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.cursor-plugin/plugin.json`、`.github/skills/dbcli/` 與 `skills/dbcli/`。若 `dbcli` 未全域安裝，skill 會以 `bunx @carllee1983/dbcli <command>` 作為 fallback 指令前綴。Codex、Claude Code、GitHub Copilot CLI、Antigravity、Cursor 的安裝命令請見 `plugins/dbcli-agent/INSTALL.md`，其中包含提交 Cursor marketplace 審核/索引的步驟。

---

<!-- doc-key: developer-workflows -->
## 開發者工作流

除了臨時查詢，`dbcli` 也針對「開發任務中牽涉資料庫」的常見情境而設計。Agent skill（[`SKILL.md`](../../../assets/SKILL.md)）內建了精簡的流程路由；當你自己操作 `dbcli` 時同樣適用：

- **DB-backed 功能**：編輯程式碼前先把產品/程式語彙對應到真實資料物件（`inspect --for-agent` → `blacklist list` → `schema <object>` → `queries suggest <intent>`）。
- **應用程式資料錯誤**：分離資料庫事實與應用程式推論（`inspect --for-agent` → `audit tail --for-agent` → `schema <object>` → 最小查詢）。
- **ORM 或 migration**：用 live schema 證據支撐 model 與 migration 修改（`schema` → `diff --snapshot` → 用 `migrate add-index`/`add-column` 產生 DDL → `diff --against`）。
- **PR 資料庫風險審查**：檢查變更的 persistence path 中 query、write、migration、export、fixture 與 blacklist 風險。
- **慢 endpoint 或查詢**：在提出 index 前優先使用 read-only diagnostics（`report --section perf` → `lint "<query>"` → `guide missing-index-for "<query>"`；有 proxy log 時用 `proxy analyze`）。
- **安全資料回填**：先界定受影響資料範圍並預覽 mutation（`schema` → count/scope query → `update ... --dry-run` → read-back 或 snippet `--verify`）。
- **環境設定驗證**：不洩漏 secrets 地檢查 config shape 與 connectivity（`status` → `doctor` → `inspect --for-agent --no-connect`）。

以上全部繼承一般安全規則：優先 `--format json`、碰觸敏感資料前先跑 `blacklist list`、用 `schema` 確認名稱、寫入先 dry-run，且絕不列印 credentials 或 blacklisted 值。

---

<!-- doc-key: usage-scenarios -->
## 使用情境速查

上面的開發者工作流是**最小安全路徑**。本節把具體情境對應到明確的指令路徑，依「你怎麼遇到它」分三類:**具名任務**(優先用已發布的 task pack)、**跨領域操作需求**、**特定引擎工作**。以下全部繼承安全基線(`blacklist list` → `schema` → 寫入先 dry-run)。

### A. Task-pack 情境(優先用已發布的 pack,別自己編步驟)

當請求對應到某個具名工作流時,用 pack 來探索與產生計畫,而不是憑記憶拼步驟。所有 pack 都是唯讀 `plan-only`,且仍繼承 blacklist → schema → dry-run 規則。

```bash
dbcli skill tasks list --format json                       # 探索可用 pack
dbcli skill tasks plan <pack> --param k=v --format json    # 產生帶風險標籤的有序計畫
```

| 情境(使用者怎麼說) | 路徑 | Pack |
| --- | --- | --- |
| 「這條 SQL 很慢」(已有語句) | `skill tasks plan diagnose-slow-query --param query="<SQL>"` → `lint "<SQL>"` → `guide missing-index-for "<SQL>"` | `diagnose-slow-query` |
| 「X 表很重/很熱」(已有表名) | `skill tasks plan analyze-table-perf --param table=<table>` | `analyze-table-perf` |
| 「這個 API 端點慢」 | `skill tasks plan slow-endpoint-investigation --param query="<SQL>"`(串接 `proxy` + `explain` + missing-index) | `slow-endpoint-investigation` |
| 全環境效能掃描 | `report --section perf` → `guide slow-query` | _(report + guide,無 pack)_ |
| 「給 agent 寫權限前先稽核」 | `skill tasks plan audit-permissions`(可選 `--param table=<table>` 抽查欄位覆蓋) | `audit-permissions` |
| 「線上 schema 跟 committed cache 一致嗎?」 | `skill tasks plan schema-drift-review --param table=<table>` | `schema-drift-review` |
| 「連線健康嗎?」 | `skill tasks plan connection-health` | `connection-health` |
| 「審這個動到 DB 的 PR」 | `skill tasks plan pr-database-review`;任何 DDL/index 想法先過 `migration-review` 再寫 | `pr-database-review` / `migration-review` |
| 「安全回填 X 欄位」 | `skill tasks plan safe-backfill-verify --param table=<t> --param query="<UPDATE>" --param verify_query="<SELECT count(*)>"` | `safe-backfill` / `safe-backfill-verify` |

Pack 解析順序為 **local > shared > builtin**:`assets/tasks/`(builtin)、`.dbcli-shared/tasks/`(團隊)、`.dbcli/tasks/`(本地覆寫)。計畫不會凌駕 blacklist、schema、dry-run 或確認要求——一次執行一步。

### B. 跨領域情境

- **多環境切換(v2)**:`dbcli use prod` 切換預設;`dbcli query --use staging "<SQL>"` 只覆寫單次呼叫。每個具名連線有**獨立的 schema cache**(`.dbcli/schemas/<conn>/`)——切換後先跑一次 `dbcli schema --use <name>`,否則可能讀到別的連線的欄位。(見 **連線管理**。)
- **CI 中用環境變數參照密鑰**:連線設定本來就存放在 home storage(`~/.config/dbcli/…`),不會寫進專案 `.dbcli/`。`dbcli init --use-env-refs` 更進一步,把憑證存成執行期解析的 `{ "$env": "VAR" }` 參照而非明文。非互動式執行時必須傳入全部五個 `--env-*` 旗標,否則 `init` 會直接報錯——絕不會默默退回明文。
- **驗證不變式或寫入結果**:`snapshot` 建基準 → `assert --against <snap> --tolerance <pct>` 比對;`q @name --verify` 跑 snippet 斷言;`recover --apply --write-verification-artifact` 留下不含機密的證據。(見 **資料驗證**。)
- **本地開發抓 N+1 / 慢查詢**:讓應用程式走 `dbcli proxy <engine> --listen ... --target ...` 收集事件,再用 `dbcli proxy analyze` 離線聚合出 N+1、最慢查詢與熱表發現。(見 **dbcli proxy**。)

### C. 特定引擎情境

- **MongoDB**:schema 採 `$sample` 抽樣(dot-path 帶 `presence` / `redacted`);blacklist 接受 dotted path 與尾端萬用字元(`profile.tokens.*`)。寫入在沒有明確運算子(`$inc` / `$push` / …)時自動包成 `$set`。
- **Redis**:`q @snippet` 只能跑**唯讀**命令;`delete` 涵蓋 `DEL` / `HDEL` / `LREM` / `SREM` / `ZREM`(需 `data-admin`);用 key glob blacklist(`secrets:*`)加上可選的值遮罩保護 key。`query` 沒有 `--dry-run`——安全來自權限閘門;要預覽刪除請用 `delete <key> --dry-run`。
- **Elasticsearch**:用 DSL body 或 Lucene 字串查詢(`--collection <index>`);用 `match_all` scroll `export` 整個 index;`shell` 開啟 Kibana Dev Tools 風格 REPL。

---

<!-- doc-key: agent-recovery-workflow -->
## Agent 修復工作流

> 此處只列出最常見的三個情境與通用流程，完整失敗代碼對照、Multi-turn `--next`、Risk gate 詳細語意、Audit ↔ Envelope 反查請見 [`assets/reference.md` Recovery Cookbook](../../../assets/reference.md#recovery-cookbook-agent-walkthroughs)。

當 `query` / `q` / `insert` / `update` / `delete` / `export` / `schema` / `inspect` / `lint` 帶 `--recovery` 失敗時，stdout 會輸出 `RecoveryEnvelope` JSON，並把同一份內容**原子寫入** `.dbcli/last-recovery.json`。Agent 隨後用 `dbcli recover` 檢視，或 `dbcli recover --apply` 自動執行（預設只跑 `readonly` + `dry-run` 步驟）。

### 情境 1：連線失敗（`CONN_REFUSED`）

```bash
# 1. 失敗時 envelope 同步寫到 stdout 與 .dbcli/last-recovery.json
dbcli query "SELECT 1" --recovery --format json
# → error.code = CONN_REFUSED
#   recovery: [doctor --format json, inspect --for-agent]
#   verify:    doctor --format json

# 2. 兩個步驟都是 readonly，預設 gate 直接通過
dbcli recover --apply --format json
# → finalStatus=ok、verifyStatus=passed → 連線已恢復
```

### 情境 2：黑名單阻擋（`BLACKLIST_TABLE`）

```bash
dbcli query "SELECT * FROM audit_logs" --recovery
# → error.code = BLACKLIST_TABLE
#   recovery: [blacklist list (readonly), blacklist table remove audit_logs (write)]

# 預設 --apply 跑步驟 1，步驟 2 因「動到本地 blacklist」被 gate 擋下 → exit 3
dbcli recover --apply

# 確認真的要解除遮罩：打開 local-write tier（仍不會碰資料庫本體）
dbcli recover --apply --allow-write=readonly-cmd
```

### 情境 3：Schema 快取缺失（`SCHEMA_CACHE_MISSING`）

```bash
# 全新環境或剛切換 v2 named connection 時最常見
dbcli inspect --require-schema-cache --recovery --format json
# → error.code = SCHEMA_CACHE_MISSING
#   recovery: [schema --refresh --force]
#   verify:    inspect --format json （檢查 schemaCache.available === true）

dbcli recover --apply
# v2 多連線時 envelope 會自動帶 --use <name>；每個 connection 各自快取在 .dbcli/schemas/<connection>/
```

### Multi-turn 模式：給有自己 runner 的 agent

當 `--apply` 太粗（plan 含 `interactive` 步驟、或 agent 想逐步審視）：

```bash
# Agent 自己跑 step 1，回報結果換 step 2
dbcli recover --next --after-step 1 --result '{"status":"ok","exitCode":0}'

# stdout 過大時改用檔案（`StepResultSummary` JSON，stdout/stderr 各限末尾 4 KB）
dbcli recover --next --after-step 2 --result @/tmp/r2.json

# 跑完整個 plan 後：dbcli 回傳 kind: "done"
# 注意：--next 不會自動執行 verify，需要時自己再跑一次原失敗指令確認
```

#### 連線錯誤的分支

針對連線類別錯誤（`CONN_REFUSED`、`CONN_AUTH_FAILED`、`CONN_TIMEOUT`、`CONN_HOST_NOT_FOUND`、`CONN_UNKNOWN`），envelope 會額外帶上 `branches` 對應表與 `branchFork` 描述。Agent 執行步驟 1（`dbcli doctor --format json`）後，將其輸出透過 `--result` 傳入；`dbcli recover --next` 會解析 doctor JSON，從四個分支（`doctor-clean`、`doctor-config-missing`、`doctor-auth-error`、`doctor-network-error`）中選出一個，並回傳該分支的第一步。回應會帶 `branchId` 與 `branchDescription`，agent 在後續 `--next` 呼叫應以 `--branch <id>` 回應。

| 旗標 | 行為 |
| :--- | :--- |
| `--branch <id>` | 走訪特定分支。分支發生後的所有 `--next` 呼叫皆需指定。 |

若 doctor JSON 無法解析或沒有關鍵字匹配，`--next` 會回落為線性的 `recovery` 計畫 — 分支永遠不會造成 `--next` 失敗。`--apply` 維持線性走訪 `recovery`，不使用 `branches`。

### Audit ↔ Envelope 反查

每次 `--recovery` 失敗都會雙向寫入對應的 UUID：

```bash
# 從 envelope → audit entry（事後鑑識）
dbcli audit show --recovery-ref "$(jq -r '.id' .dbcli/last-recovery.json)"

# 從 audit entry → envelope（先有 audit hit，要結構化計畫）
dbcli audit tail --for-agent --n 1   # 讀最近一筆，取 recovery_ref
dbcli recover --from /path/to/archived.json   # 跨機器/歸檔重播
```

### `recover --apply` 退出碼速查

| Exit | 意義 |
| :--- | :--- |
| `0` | 全部步驟成功（若有 verify，verify 也通過） |
| `1` | 某一步執行失敗 |
| `2` | envelope 缺失、不存在或格式錯誤 |
| `3` | 所有步驟都被 gate 跳過（widen `--allow-write` 或填上 placeholder 再試） |

### 持久化驗證成果（選用）

在 `recover --apply` 加上 `--write-verification-artifact` 旗標，執行結束後會在 `.dbcli/verification/` 下寫入一份有界的 `VerificationArtifact` JSON：

```bash
dbcli recover --apply --write-verification-artifact
```

**條件與保證：**

- 成果檔案**只在 verify 步驟真正執行後才會寫入** — 若計畫中沒有 verify 步驟，即便有此旗標也不會產生任何檔案。
- 省略旗標時行為完全不變 — 任何情況下都不會寫入檔案。
- 成果檔案**不含指令記錄、憑證或連線密碼** — 僅包含指向式的佐證（指令名稱、步驟參照、結果狀態）。

---

<!-- doc-key: error-classification -->
## 疑難排解與錯誤參考

### 錯誤分類

`dbcli` 區分**連線錯誤**(server 沒起、認證失敗)與 **SQL 錯誤**(語法錯、table/column 不存在)。SQL 錯誤現在會印:

- 具體問題(不再印 "Connection failed")
- 指向正確下一步的 hint(`dbcli list`、`dbcli schema <table>`、`--no-limit`)
- 對 table 不存在,附上 top-3 fuzzy 候選

### Query-only auto-LIMIT 範圍

`dbcli` 會在 `query-only` 模式對 `SELECT` 自動加 `LIMIT 1000`。**不**套用於:

- `SHOW` / `DESCRIBE` 語句(LIMIT 在此非合法語法)
- `EXPLAIN` / `EXPLAIN ANALYZE` / MariaDB `ANALYZE SELECT`

查 `information_schema` 時用 `--no-limit` 關閉。

### Schema cache bootstrap

第一次 `dbcli schema --refresh` 不需 `--force` 即會寫入 cache。後續 refresh 偵測到既有 cache 有 diff 才會要求 `--force`。

---

<!-- doc-key: documentation-maintenance -->
## 文件維護與覆蓋範圍

Markdown (`index.md`) 與精緻版 HTML (`index.html`) 是同一份使用者指南的兩種呈現形式。維護時請把它們視為同一份文件契約。

### 對標規則

1.  **同一次變更必須更新兩種格式**：任何新指令、旗標、工作流程、警告、範例或支援矩陣項目，都必須同時出現在 `docs/user/zh-TW/index.md` 與 `docs/user/zh-TW/index.html`。
2.  **主題順序必須一致**：每個共用主題都以 `<!-- doc-key: ... -->` 標記。不要只在其中一種格式新增主題。
3.  **語意一致，不要求樣式相同**：HTML 可使用卡片、網格、圖示或較短標籤，但必須傳達與 Markdown 相同的必要用法、安全注意事項、範例與限制。
4.  **同步所有支援語言**：英文文件更新時，也要同步更新 `docs/user/zh-TW/index.md` 與 `docs/user/zh-TW/index.html`。
5.  **合併前必須驗證**：執行 `bun run docs:check`，確認每個支援語言的 Markdown/HTML 主題對標。

### 覆蓋範圍檢查表

每次功能或指令行為變更時，請使用此檢查表：

| 範圍 | 必要文件內容 |
| :--- | :--- |
| 安裝與設定 | 套件安裝指令、首次初始化、環境變數建議與機密資訊安全處理。 |
| 連線 | 多連線結構、列出、切換、單次 `--use` 覆蓋與不同環境範例。 |
| 探索 | `list`、`schema`、`inspect`、`status`、輸出格式，以及 AI 代理查詢前應先檢查的時機。 |
| 讀取與寫入 | `query`、`q`、`export`、`insert`、`update`、`delete`、`--dry-run`、寫入保護與安全限制範例。 |
| Snippets | `queries list/search/suggest/new`、解析順序、參數與視覺化 frontmatter。 |
| 診斷與修復 | `doctor`、`check`、`diff`、`report`、`guide`、`recover`、`--recovery` 與安全修復邊界。 |
| 進階工具 | `shell`、`migrate`、`skill --install`、`skill tasks`、`completion` 與支援的權限層級。 |
| 引擎 | PostgreSQL/MySQL/MariaDB、MongoDB、Redis、Elasticsearch 的支援差異與已知限制。 |
| AI 使用 | 必要流程順序：黑名單檢查、schema 確認、dry-run/風險規劃，最後才執行。 |
| HTML 儀表板 | `--ui`、匯出行為、圖表/KPI 設定，以及瀏覽器/報表預期。 |

### 維護流程

```bash
# 1. 編輯每個支援語言的 Markdown 與 HTML。
$EDITOR docs/user/en/index.md docs/user/en/index.html
$EDITOR docs/user/zh-TW/index.md docs/user/zh-TW/index.html

# 2. 驗證主題對標。
bun run docs:check

# 3. 若修改指令行為，請一併執行相關 CLI 測試。
bun test
```

若某個主題刻意只存在於單一格式，不要直接略過檢查。請新增對應的 `doc-key` 區塊並放入等價內容，或記錄為何該主題不是使用者文件內容。

---

*由 Dbcli 文件引擎自動產生。*

## 查詢計畫檢視 — `dbcli explain`

跨 MySQL/MariaDB 與 PostgreSQL 用統一 row schema + severity 標籤呈現查詢計畫。

### 基本用法

```bash
dbcli explain "SELECT * FROM betting_logs WHERE settled_at >= '2026-03-01'"
dbcli explain @analytics/live-summary                 # saved query
dbcli explain --analyze "SELECT ..."                  # MariaDB ANALYZE SELECT / PG EXPLAIN ANALYZE
dbcli explain --format json "..."                     # 純 JSON
dbcli explain --bulk @queries.sql                     # 從檔案批次
dbcli explain --bulk @analytics/*                     # 對 saved query 做 glob
```

### Annotations 規則

| 規則 | 嚴重度 | 觸發條件 |
|---|---|---|
| `full-scan` | 紅 | MySQL `type=ALL` 或 `key=NULL`;PG `Seq Scan` |
| `temp-table` | 黃 | MySQL `Using temporary` |
| `filesort` | 黃 | MySQL `Using filesort`;PG `Sort Method: external merge` |
| `cost-estimate-skew` | 灰 | `--analyze` actual rows / planner rows > 10× |
| `nested-loop-large` | 黃 | PG `Nested Loop` 且 planner rows > 10,000 |

### 注意

- `--analyze` 會實際執行 query，因此 dbcli 只接受結構上已證明唯讀且
  不含明確 function／table-function call 的 `SELECT`／僅含 SELECT 的
  CTE。function 可能有副作用，因此一律視為尚未證明。可能寫入或無法
  確定的 SQL 會在 adapter 執行前被拒絕；這些語句請使用 plain
  `dbcli explain`。
- `dbcli explain` 在 `query-only` permission 即可執行,不需升權。
- EXPLAIN 不會被 auto-LIMIT(自 v1.23 P1)。

<!-- doc-key: lint-command -->
## 靜態 SQL 顧問 — `dbcli lint`

`lint` 可分析 PostgreSQL、MySQL 或 MariaDB SQL，不會開啟資料庫連線、
執行查詢、更新 schema，也不會套用 rewrite。需要 schema 的規則只會讀取
分層 `.dbcli/schemas/` 快取。

### 輸入與選項

```bash
dbcli lint "SELECT * FROM users WHERE email LIKE '%@example.com'"  # inline SQL
dbcli lint @analytics/live-summary                               # saved query
dbcli lint @queries.sql                                          # SQL 檔案
dbcli lint --bulk '@queries/**/*.sql'                            # 檔案系統 glob
dbcli lint --bulk '@analytics/*,@queries.sql' --format markdown  # 混合批次輸入
dbcli --use staging lint @analytics/live-summary --format json   # 命名快取
```

所有 schema 快取都位於 `.dbcli/schemas/` 之下。v2 一律使用
`.dbcli/schemas/<resolved-connection>/`，包含設定的預設連線。根目錄
`.dbcli/schemas/` 只供 v1/legacy 未命名快取使用。全域 selector 必須放在
指令之前：`dbcli --use <conn> lint …`；它會選擇另一個具名 v2 slot。
`lint` 不會退回讀取 `config.schema`，也不會為了補齊缺少的 metadata 而連線。

| 選項 | 預設值 | 行為 |
| :--- | :--- | :--- |
| `--format text\|json\|markdown` | `text` | 選擇文字、機器可讀 JSON 或 Markdown 報告。 |
| `--min-severity info\|warn\|error` | `info` | 隱藏低於所選嚴重度的 findings。 |
| `--no-schema` | 關閉 | 不讀取 schema 快取路徑，並跳過 schema-aware 規則。 |
| `--bulk <input>` | 無 | 解析以逗號分隔的 `@file`、`@glob` 與 `@saved-query` 混合輸入。 |
| `--recovery` | 關閉 | 指令失敗時輸出並儲存已連結的 recovery envelope。 |

### 規則

| 規則 | 嚴重度 | 回報條件 |
| :--- | :--- | :--- |
| `select-star` | warn | 頂層 `SELECT *`；若單一資料表與快取資訊明確，可提供欄位清單草稿。 |
| `unanchored-like` | warn | 以 `%` 開頭的 `LIKE` / `ILIKE` pattern。 |
| `missing-limit-offset` | info | 使用 `OFFSET >= 1000` 的深度分頁；可考慮 keyset pagination。 |
| `non-sargable-where` | warn | Predicate 的欄位側套用了函式或算術運算。 |
| `or-to-union` | info | 不同欄位之間的頂層 `OR`；任何 UNION 替代方案都必須保留 identity 與 multiplicity。 |
| `subquery-to-join` | info | `IN (SELECT …)` 可能適合語意等價的 `EXISTS`，或已證明唯一的 JOIN。 |
| `distinct-groupby-abuse` | warn | 簡單投影欄位完整涵蓋 `GROUP BY` 時，多餘的 `DISTINCT`。 |
| `implicit-cast` | warn | 經 schema 驗證的欄位/常值型別不符，可能讓索引失效。 |
| `not-in-nullable` | warn | `NOT IN` 右側為 NULL 或可能是 nullable：明確的 `NULL`、nullable 的 subquery 投影，或型別資訊已知且可為 NULL 的其他 RHS 運算式。 |

`not-in-nullable` 專門描述 SQL 中右側「NULL 污染 `NOT IN`」的風險。
左側欄位可為 NULL 並不屬於這條規則。若右側是 subquery，應以
`IS NOT NULL` 過濾其投影值；在 correlation 與語意合適時，也可考慮
`NOT EXISTS`。除非 correlation、型別、qualified-column 解析與 rewrite
目標都明確，dbcli 不會自動執行此 rewrite。若 subquery 以直接條件或
`AND` 組合對完全相同的投影運算式套用 `IS NOT NULL`，則不會回報；
位於 `OR` 下或運算式解析不明確時仍保守回報。

解析失敗時，九條規則都會列為 `blocked: parse failed`。使用
`--no-schema` 時，`implicit-cast` 與 `not-in-nullable` 會列為
`blocked: --no-schema`；分層快取不存在時則列為
`blocked: schema cache unavailable (run dbcli schema)`。Finding 可包含
有 confidence 標籤的 SQL 草稿與 shell-safe 驗證指令。只有結構上已證明
唯讀且不含明確 function／table-function call 的 SQL 才會使用
`dbcli explain --analyze`；其他語句會退回 plain `dbcli explain`。若快取
中的 table 或 column 名稱經大小寫折疊後衝突，由於 parser 無法提供可靠的
quote provenance，schema-aware finding 與 rewrite 都會保守略過。兩種
指令都只供回報參考，絕不會自動執行。

## 缺失索引建議 — `dbcli guide missing-index-for`

分析單一 `SELECT`,結合真實的 `EXPLAIN` 計畫與既有索引,建議複合索引。唯讀。

```bash
dbcli guide missing-index-for "SELECT ... FROM betting_logs b JOIN hoster_machines hm ON ..."
dbcli guide missing-index-for @analytics/live-summary
dbcli guide missing-index-for "..." --format json        # yaml(預設) | json | markdown
dbcli guide missing-index-for "..." --min-confidence medium
```

每個候選索引都會帶有 `confidence`(`high` / `medium` / `low`)與 `reason`;此工具不會斷言「你一定要建立」。函式/運算式欄位(例如 `DATE(settled_at)`)以及無法解析的 SQL,會列在 `warnings` 之下。

**限制:** 僅支援單一 `SELECT`(不支援 INSERT/UPDATE/DELETE、stored procedure 或 view 內容)。函式/部分索引只會被標記,不會被建議。超出 node-sql-parser 支援的方言會退回到僅用 EXPLAIN 的啟發式判斷。
