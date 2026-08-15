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
    *   [證據包](#evidence-packs)
    *   [本機觀察型 Proxy](#proxy)
    *   [QueryLens](#querylens)
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

*   **權限守衛 (Permission Guard)**：提供四層存取控制（`query-only`、`read-write`、`data-admin`、`admin`）。語句以「實際會做什麼」判定，而非開頭關鍵字：`admin` 以下拒絕多語句 SQL（因為只有第一句會決定權限判定）；saved snippet 只要含任何寫入或 DDL 關鍵字即拒絕，因此 data-modifying CTE 與 `SELECT … INTO` 無法躲在 `SELECT`／`WITH` 開頭後面；MongoDB `$out`／`$merge` 在 `query` 需要 `data-admin`，在 snippet 與 `export` 一律拒絕。 Elasticsearch 的請求以「影響範圍」判定，而非它指名的資源：刪除單一文件是 `data-admin`，刪除 index、萬用字元、`_all`、template 或 alias，以及改寫 `_mapping`／`_settings`，都是 `admin`——也就是 `DROP TABLE` 需要的層級。
*   **黑名單管理器 (Blacklist Manager)**：從所有查詢結果中自動屏蔽敏感資料表與欄位。判定涵蓋語句參照到的**每一張**表，不只排在最前面那張：`JOIN`、逗號、`UNION` 或子查詢帶進來的黑名單表一樣會被擋下，`query` / `export` / `q` / `report` / shell 皆同。遮罩以所有被參照的表的欄位規則聯集計算 —— JOIN 結果的欄位名不帶表限定，無法反推歸屬，因此從嚴。表名列舉刻意過度回報：語句中每個非保留字的識別字都算候選，所以欄位名或別名若與黑名單資料表同名，該語句會被擋（訊息會指出命中的名稱）。Elasticsearch 的 `--index` 是運算式（逗號清單、萬用字元、`_all`、date math、跨叢集限定），會正規化後逐一比對，萬用字元在可能命中黑名單 index 時拒絕；ES shell 依伺服器實際路由的路徑逐段檢查、檢查 request body 指名的 index（`_mget` / `_bulk` / `terms` lookup），並從回應中移除受保護欄位；無法界定 index 的請求（`GET /_search` 等）在有黑名單時一律拒絕。遮罩比對的是回傳欄位名，`SELECT password_hash AS x` 這類改名仍會回傳該值 —— **資料表層級的項目可強制執行，欄位層級的項目是顯示過濾，不是存取控制**。
*   **查詢風險分析器 (`plan`)**：在不連線資料庫的情況下分析 SQL 風險。
*   **Antigravity 協議**：將工作流程拆分為 **Architect (架構師/規劃)** 與 **Builder (建設者/執行)**，確保行動前必有策略。

`permission`、blacklist、dry-run 與 agent skill 是縱深防禦，不能取代資料庫授權。
自主 agent 只能取得最小權限的資料庫憑證；若一個 process 能修改自己的設定，它也能提高
dbcli 宣告的 permission，或改用其他 client。

---

<!-- doc-key: getting-started -->
## 快速入門

### 安裝方式
```bash
bun install -g @carllee1983/dbcli
# 或使用 npm
npm install -g @carllee1983/dbcli
```

dbcli 執行於 Bun 1.3.3+。npm 與 npx 可作為發布通道，但安裝後的 `dbcli` 執行檔需要
`PATH` 上有 Bun；只有 `./agent-core` 這個 subpath export 能被純 Node 程序 import。

單獨執行 `dbcli --version` 或 `dbcli -V` 時會使用輕量 launcher，不載入資料庫 driver；其他指令仍會照常載入完整 command runtime。

### 初始化連線
`init` 指令會引導你完成連線設定，它能自動解析現有的 `.env` 檔案。若是 MongoDB，`init` 會逐欄詢問連線資訊（Host、是否為 SRV、Port、User、Password、`authSource`，最後是可選的 `replicaSet` / `tls`）——完整欄位列表與 `--uri` 進階備援請見下方[資料庫引擎支援矩陣](#資料庫引擎支援矩陣)一節的「MongoDB 連線設定」。

在幕後，`init` 會在專案的 `./.dbcli/config.json` 寫入一個 `version: 3` 的 binding stub，真正的連線設定與任何憑證則存放在家目錄的 `~/.config/dbcli/projects/<project-name>-<sha1-12>/`。如此可還原的敏感資料不會留在專案工作區，掃描 repo 的工具或 AI agent 也看不到。專案的 `.dbcli/` 只保留 binding 與非敏感快取（schema 快取、稽核記錄、快照、驗證產物）。

若要讓多個專案共用連線，請使用明確的全域 scope。它會把 v2 registry 儲存在 `~/.config/dbcli/config.json`，且不會建立專案 binding：

```bash
dbcli --global init --conn-name shared --system postgresql \
  --host db.example.com --port 5432 --user app --password '<secret>' \
  --name appdb --skip-test --no-interactive --force
dbcli --global use --list --format json
dbcli --global status --format json
```

Root 層級的 `--global` 必須放在指令之前。全域 registry 與專案 registry 彼此獨立；未帶 `--global` 時仍使用目前專案的 registry。全域檔案與 home storage 的專案設定一樣，會使用 integrity record 與私有檔案權限保護。

```bash
dbcli init
```

使用 `--use-env-refs` 可把機密留在環境變數，不寫進設定檔；CI/CD 環境尤其適用。執行時若被引用的變數不存在，dbcli 會 fail closed，並在錯誤中指出變數與設定欄位；空字串仍與變數不存在有所區別。

---

<!-- doc-key: connection-management -->
## 連線管理

`dbcli` 支援多連線配置 (v2)，讓你在開發 (Local)、測試 (Staging) 與正式 (Production) 環境間切換。

使用 `--global` 可在不依賴目前專案的情況下管理或執行 user-level registry 的具名連線：

```bash
dbcli --global use --list
dbcli --global use shared
dbcli --global query "SELECT 1"
```

未帶 `--global` 時，`dbcli` 仍會解析目前專案的 `.dbcli` binding。明確指定 scope 可避免在不相關的專案中意外選到全域連線。

Root-level `--timeout <ms>` 可針對單次執行覆寫連線 timeout（整數，100～600000；必須放在指令之前，
與 `--global`、`--use` 同樣是 root-level flag）。它會覆寫連線設定中的 `timeout` 欄位；兩者都沒設定
時，各 adapter 沿用內建的 5000ms 預設值。這個覆寫只在本次建立連線時套用，不會寫回 `config.json`；
要永久生效請在連線設定裡寫 `timeout` 欄位。Elasticsearch 是把 timeout 套用在每個 request 上，
而不是整條連線一次性生效。當預設值太緊時很實用，例如 MongoDB 跨 VPN 或連 Atlas：

```bash
dbcli --timeout 20000 --use <conn> list
```

連線逾時與語句逾時是兩個獨立的上限。`--timeout` 會同時收緊兩者，所以 `--timeout 3000` 也會中止
跑超過 3 秒的 SQL。只想調整「一句查詢能跑多久」時，用 root-level `--statement-timeout <ms>`
（整數，0～3600000；`0` 表示取消上限）或連線設定的 `statementTimeout` 欄位。兩者都沒設定時
dbcli 不設語句上限，交給伺服器自己的設定——跑六秒的分析查詢不會再因為連線逾時預設五秒而被砍掉：

```bash
# 連不上要快速失敗，但報表查詢可以跑兩分鐘
dbcli --timeout 2000 --statement-timeout 120000 query "SELECT ... FROM big_table"
```

*   **列出所有連線**：`dbcli use --list`；agent 與 script 可用
    `dbcli use --list --format json` 取得不含憑證的連線清單。
*   **切換預設連線**：`dbcli use <name>`
*   **單次執行覆蓋**：全域 selector 可放在任何指令之前；`query`、`schema`、
    `list`、`export`、`check` 也支援放在指令之後。
    ```bash
    dbcli --use staging query "SELECT 1"
    dbcli query --use staging "SELECT 1"
    ```
*   **環境變數 selector**：單次 process 可設定 `DBCLI_CONNECTION`，例如
    `DBCLI_CONNECTION=staging dbcli query "SELECT 1"`。前後空白會移除，空值則視為未設定。

選擇優先序為明確的 `--use`、`DBCLI_CONNECTION`、最後才是設定檔預設連線。
單次 selector 不會修改持久化的預設連線。如果 root 與指令層級的 `--use` 值不同，
dbcli 會直接回報衝突，不會靜默挑選其中一個。Selector 需要 v2 設定：單連線
（v1）專案沒有具名連線可選，因此在 v1 下給 `--use` 或 `DBCLI_CONNECTION` 會被
拒絕，而不是靜默改跑那唯一的連線。
若把 `--use` 放在不支援指令層級寫法的指令後面，dbcli 會維持拒絕並印出可直接
複製的 root-level 寫法，例如 `dbcli --use <connection> status`。

若要提供明確且不含機密的環境標籤，可在 v2 的具名連線上設定可選的
`environment` 欄位，例如 `"environment": "production"`。
`dbcli use --list --format json` 會回傳每個連線的名稱、環境標籤（或 `null`）、權限、
系統、伺服器／資料庫識別與預設標記；由環境變數提供的識別欄位會是 `null`，只有 URI
的 MongoDB 與只有 Cloud ID 的 Elasticsearch 也會以 `null` 取代預設占位值。它刻意不
輸出 user、password、URI、Cloud ID、API key 或環境變數名稱。拼錯連線 selector 時，
dbcli 會提示相近的既有名稱。
在 v2 中，實際選取的連線名稱會保留到指令執行期間，因此 audit 記錄會路由到該連線
自己的 audit stream。

#### 正式環境與自動化防護

標示為 `environment: "production"` 的連線，若要設成持久化預設值會預設拒絕，必須重複
輸入完全相同的名稱明確確認：

```bash
dbcli use production --confirm-production production
```

此確認只適用於變更持久化預設值；單次的 `--use production` 仍是明確選取，且不會修改
設定。在 agent mode（`DBCLI_AGENT_MODE=1`）中，設定、權限與憑證的變更一律被拒絕。人類或
管理員必須在關閉 agent mode 的獨立 process 執行核准流程；dbcli 不接受同一個 process 的
環境變數作為核准。受信任的寫入會維護 config integrity record，並在作業系統支援時設定
安全檔案權限；agent 讀取遇到缺失、替換、非一般檔案或竄改的 record 時會 fail closed。
agent mode 也會拒絕 legacy 單檔 `.dbcli` 設定；請先由人類／管理員流程遷移到 V2 home storage。
若要防護同一 OS 使用者的惡意 process，請將 `DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR` 設為由 host
保護或唯讀掛載的目錄，讓 detached digest 不會和工作區檔案一起被替換。

每筆 audit entry 都會從解析後的連線寫入非機密的 `metadata.connection_name` 與
`metadata.environment`，絕不記錄連線憑證或 endpoint secret。

### 唯讀 query fan-out

明確指定逗號分隔的 `--use`，即可對多個具名連線執行同一個唯讀 query。
Root 層級與指令層級寫法效果相同：

```bash
dbcli --use primary,staging query "SELECT count(*) FROM users" --format json
dbcli query --use primary,staging "SELECT count(*) FROM users"
```

連線名稱會移除前後空白，結果則維持 selector 的順序；空白或重複名稱會被拒絕。
只指定一個名稱時仍走既有的單連線路徑。Fan-out 只會由明確的 `--use` 啟用：
`DBCLI_CONNECTION` 仍代表一個完整的連線名稱，不會依逗號拆分。兩種 `--use` 寫法
都不會修改持久化的預設連線。

在任何 adapter 建立連線前，dbcli 會先載入並驗證所有選定的連線配置。SQL fan-out
只允許唯讀分類（`SELECT`、`SHOW`、`DESCRIBE`、`EXPLAIN`）；MongoDB 允許 filter
object 與唯讀 aggregation pipeline，但拒絕頂層 `$out` 或 `$merge` stage；
Elasticsearch 只允許 search。Redis 不支援 fan-out。多連線 query 也會拒絕
`--recovery`、`--ui`、CSV 與 HTML 輸出；請使用 `--format table`（預設）或
`--format json`。

每個連線都會獨立使用自己的 adapter、blacklist 過濾、row-limit／截斷 metadata、
audit entry、計時與 disconnect；其中一個連線失敗不會取消或隱藏其他結果。JSON
會依序回傳 `results` array，每個連線都有標示清楚的 `ok` 或 `error` outcome；
table 則依各自 schema 顯示獨立且具連線標籤的區段。全部成功時 aggregate exit code
為 `0`，成功與失敗混合時為 `2`，全部失敗或執行前拒絕請求時為 `1`。

### 密碼輪替

`dbcli password` 只變更單一連線的密碼，其他設定完全不動——專為密碼會定期
自動輪替的環境設計。

```bash
dbcli password                       # 遮蔽輸入，輪替預設連線
dbcli password prod                  # 遮蔽輸入，輪替 'prod'
rotate-secret | dbcli password prod --stdin   # 非互動，密碼不會留在 shell 歷史
dbcli password prod --password "$NEW" --skip-test --format json
```

密碼寫到哪裡是從設定檔讀出來的，不是用猜的：若連線的 `password` 是
`{ "$env": "NAME" }`，就會改寫該連線 `envFile` 裡的 `NAME`。連線沒宣告
`envFile` 時，輪替會順便把 `envFile`（`.env.local`）記錄進該連線設定——不
記錄的話讀取端根本不會載入那個檔案。若連線目前仍是明文密碼，會一次性
轉換成 `{ "$env": "DBCLI_<CONN>_PASSWORD" }`，之後的輪替就只會動 env 檔。
值會以加引號的形式寫入（`NAME="..."`），密碼首尾的空白因此能原樣保留。

v1 設定則會改寫 `.env.local` 裡的 `DBCLI_PASSWORD`，與 v1 的讀取邏輯一致。
若 v1 設定的密碼來自其他環境變數（不是 `DBCLI_PASSWORD`），指令會直接
報錯說明：v1 沒有 per-connection env 檔，dbcli 寫任何檔案都無法讓那個
變數有值，請直接更新環境變數，或升級到 v2。

預設會先用新密碼實際連線驗證，通過才會寫入檔案，避免輪替失敗卻留下壞掉的
憑證。資料庫連不到時可用 `--skip-test` 跳過驗證。env 檔在 POSIX 系統上會以
`0600` 權限寫入（Windows 沒有對應的權限位元，檔案沿用所在目錄的 ACL），
密碼不會被回顯或寫進 log。

**選項：** `[connection]`、`--stdin`、`--password <value>`（會留在 shell
歷史與行程列表中，建議優先用 `--stdin`）、`--skip-test`、
`--format <text|json>`。

在 `DBCLI_AGENT_MODE=1` 下，和其他憑證變更一樣會被擋下。

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

`dbcli blacklist list --format json` 會在 stdout 輸出一個 machine-readable 文件，包含
`tables`、`columns` 與 `warnings`；不合法的 MongoDB blacklist path 會放進結構化的
`warnings` 陣列，不會把人類可讀診斷混入 stdout。

在 PostgreSQL 中，`schema` 全程使用精確的 `public` catalog identity：完整的 catalog/schema/table join 可避免重複使用的 constraint 名稱污染另一張表，複合 foreign key 欄位會維持宣告順序，複合 primary key 的順序來自精確 table OID 與 index ordinality，estimate 也限定於精確的 `public` relation。Row count 會同時 qualify 並 quote `"public"` 與精確 table name，內嵌 quote 會被 escape，因此混合大小寫或含標點的 identifier 仍可安全區分；被參照 schema/table 的 catalog 原始拼字也會保留。

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
| `query [sql] [-f, --query-file <path>] [--fields <list>]` | 執行 SQL、MongoDB JSON、Redis 指令或 ES DSL；SQL 與 MongoDB 可選擇投影結果欄位。 |
| `q @snippet` | 執行帶有參數的儲存查詢片段。支援 `--verify` 以執行自動化斷言驗證。 |
| `export` | 將結果匯出為 JSON, CSV, JSONL 或互動式 HTML。 |
| `insert` | 從 JSON 插入資料 (支援 SQL & MongoDB)。支援 `--plan` 風險預檢（SQL、MongoDB、Redis、Elasticsearch）。 |
| `update` | 更新資料，強制要求 `--where` 子句。支援 `--plan` 風險預檢（SQL、MongoDB、Redis、Elasticsearch）。 |
| `delete` | 刪除資料，強制要求 `--where` 子句。支援 `--plan` 風險預檢（SQL、MongoDB、Redis、Elasticsearch）。 |
| `blacklist` | 管理敏感資料屏蔽規則。 |
| `plan "<sql>"` | **靜態分析器**：對 SQL 進行風險分級並給出優化建議。 |
| `lint "<sql>"` | **靜態顧問**：不連線資料庫，回報 SQL 反模式與選用的 rewrite 草稿。 |

#### 寫入確認閘門（2.0.0）

所有寫入都會經過兩級閘門。第一級是一個問題，第二級是一道沒有旗標可以繞過的拒絕。

**第一級——一般寫入。** INSERT、帶 WHERE 的 UPDATE / DELETE、CREATE、ALTER。在互動終端下，dbcli 會先印出它把這句理解成什麼，再問你要不要執行；`--yes` 可以跳過。非互動執行（stdout 被導向、CI、agent）根本不會看到這個問題，`--format json` 即使在終端下也會關掉它。

**第二級——收不回來的寫入。** 沒有 WHERE 的 UPDATE / DELETE、DROP、TRUNCATE、SQL parser 讀不懂的語句、一個字串裡塞了多句語句，以及 `dbcli update` / `dbcli delete` 中 `--where` 沒有命中主鍵或唯一索引的情況。dbcli 會要求你打出目標資料表的名稱，**沒有任何旗標可以跳過**，`--yes` 與 `--force` 都不行。當現場沒有人時，dbcli 直接拒絕：退出碼 1、什麼都不會送到資料庫，訊息會點名 `reason=no_where`、`reason=ddl_destruction`、`reason=unparseable`、`reason=multiple_statements` 、`reason=non_unique_where` 或 `reason=multi_table`。

**接了另一張表的寫入一律第二級，不管 WHERE 寫什麼。** 這種寫入會動到幾列取決於資料而不是語句：`DELETE p FROM p JOIN o ON p.id = o.ref WHERE o.x > 0` 在一組資料上刪了 5 列中的 2 列，在另一組上刪光 2000 列。join 的 ON 一定會提到目標表，所以它什麼也證明不了。這會讓 `UPDATE … FROM`、`UPDATE … JOIN … SET` 與多表 `DELETE` 這些標準寫法對無人看管的呼叫端被拒——把另一張表改寫成 WHERE 裡的子查詢，或改在有人可以確認的地方執行。

**單表寫入的 WHERE 必須是在講那張表。** 只存在於子查詢裡的 WHERE 不算：`UPDATE p SET c = (SELECT max(x) FROM o WHERE o.id = 1)` 有 WHERE，但改寫每一列。回頭指向目標表的相關參照則算數，所以 `DELETE FROM t WHERE EXISTS (SELECT 1 FROM o WHERE o.tid = t.id)` 是普通寫入，同一句改成裡面寫 `WHERE o.id = 1` 就會刪光整張表，屬第二級。這是下界而不是保證——`WHERE id IS NOT NULL` 提到了目標表，卻依然動到每一列。

**逃生路徑寫在語句裡，不是寫在旗標上。** 要在無人看管下執行全表寫入，就把意圖寫進 SQL——補上 `WHERE 1=1` 或 `LIMIT`。這是刻意的設計：對已經有 WHERE 的語句再接一個 `WHERE 1=1` 是語法錯誤，所以「乾脆全部都加上去」會立刻壞掉，養不成習慣；旗標的性質剛好相反。DROP 與 TRUNCATE 沒有子句可加：能不能執行由連線的 `permission` 層級決定，而打字確認仍然必須由人完成。

**`dbcli shell` 只接第二級，不接第一級。** shell 裡的每一句都是人手打的，逐句 y/N 會變成反射動作；但沒有 WHERE 的 DELETE、DROP、TRUNCATE 一樣要打出資料表名稱。打錯只會印出「已取消」並回到提示符——連線、緩衝區與歷史都還在，行程不會結束。按 Ctrl-C 則是收回這個提問：什麼都不會執行，接下來打的那一行會被當成語句，而不是被吃成確認答案。以管線餵進來的輸入（`dbcli shell < script.sql`）沒有人能回答，該句會被拒絕，其餘的行照跑。Redis、MongoDB 與 Elasticsearch 的 shell 不受影響，寫入仍由連線 permission 把關。在 shell 裡以子指令形式打的 dbcli 指令（`query "..."`、`\delete ...`）跑在沒有 stdin 的獨立行程裡，沒有辦法提問，所以第二級語句會被拒絕，訊息會請你回到 `dbcli>` 提示符直接打。

**名稱與 SQL 關鍵字相同的子指令需要 `\` 前綴。** `delete users --where id=1` 會被當成 SQL——shell 就是拿來打 SQL 的，`DELETE FROM users WHERE …` 一定要能照打——所以它會等分號而不是執行子指令。要呼叫子指令請打 `\delete users --where id=1`。`insert`、`update`、`explain` 同理——與 SQL 關鍵字同名的子指令就這四個；前綴對每一個子指令都有效，所以要記的是一條規則而不是一張清單。語句還在累積時，`.quit` 與 `.clear` 依然有效、Ctrl-C 可取消——它們原本會被吃進緩衝區，讓 shell 看起來像當掉。

子指令跑在自己的行程裡且沒有 stdin，所以它原本的確認提問會讀到 EOF 而取消：在 shell 裡 `\insert`、`\update`、`\delete` 需要加 `--force`，或者直接在提示符打 SQL——那裡才答得了。第二級的確認不受影響：它會在子行程裡被拒絕，並請你回到提示符，因為表名只有在那裡打得出來。

每一次第二級判定都會寫進稽核紀錄——放行、取消、拒絕都記——所以這道閘門有沒有擋到東西是可以量測的，不是靠印象。`dbcli audit write-gate` 就是那個量測：第二級被觸及幾次、依哪一條判準、以及最後怎麼被回答。如果數字是零，該檢討的是判準，不是閘門。

```bash
# 拒絕：沒有 WHERE，也沒有人能確認
dbcli query "UPDATE users SET banned = 1" --format json
# → 退出碼 1、reason=no_where，什麼都沒送到資料庫

# 放行：意圖已經寫在語句裡
dbcli query "UPDATE users SET banned = 1 WHERE 1=1" --format json

# 一般寫入，無人看管或直接跳過提問
dbcli query "UPDATE users SET banned = 1 WHERE id = 3" --yes

# 條件欄位不唯一的結構化刪除：第二級
dbcli delete users --where "status=active"
```

#### 從 positional、檔案或 stdin 讀取 query

`dbcli query [sql] [-f, --query-file <path>]` 必須且只能指定一個 query 來源：

*   Positional query 文字，例如 `dbcli query "SELECT 1"`。
*   UTF-8 檔案，例如 `dbcli query --query-file ./queries/active-users.sql`。
*   以 `--query-file -` 從 stdin 讀取。

未提供來源，或同時提供 positional 文字與 `--query-file` 都會報錯。dbcli 讀取來源後會移除一個開頭的 UTF-8 BOM 與前後空白；處理後若為空內容，則會拒絕執行。`--query-file -` 需要 piped input：當 stdin 是互動式終端時，dbcli 會立即拒絕，而不是無提示地空等輸入。

透過 stdin 傳入多行 SQL，就不需要把整段內容 escape 成單一 shell argument：

```bash
dbcli query --query-file - <<'SQL'
SELECT id, email
FROM users
WHERE status = 'active'
ORDER BY id;
SQL
```

MongoDB filter 與 aggregation pipeline 也使用相同的檔案／stdin 來源。如果 `pipeline.json` 包含下列 pipeline，兩種寫法都不必處理 `user's event` 中對 shell 不友善的 apostrophe：

```json
[{"$match":{"message":{"$regex":"user's event"}}}]
```

```bash
dbcli query --collection raw_logs --query-file ./pipeline.json

dbcli query --collection raw_logs --query-file - <<'JSON'
[{"$match":{"message":{"$regex":"user's event"}}}]
JSON
```

#### 被動慢查詢提示

`query` 與 `q` 會觀察已完成查詢所回傳的執行時間。預設門檻為 `1000ms`；跨過門檻時，table 輸出會附上 `Performance hint`，JSON 輸出則會在 `metadata.performanceAdvisory` 提供結構化資訊。快速查詢的輸出維持不變，因此正常查詢不會反覆收到建議。

```bash
# 查詢花費 250ms 以上時才提示後續檢視方式
dbcli query "SELECT * FROM events WHERE account_id = 42" --slow-ms 250

# 為這次 invocation 關閉被動提示
dbcli q @daily-active-users --slow-ms 0
```

此提示不會執行 `EXPLAIN`、讀取 schema，也不會發出第二個資料庫請求。在 PostgreSQL、MySQL、MariaDB 與 Redis 上，它建議不會修改資料的下一步：`dbcli guide slow-query --format markdown`；更深入的診斷應在檢閱該指引與相關 query 後才執行。MongoDB 與 Elasticsearch 沒有對應該目標的診斷 snippet，因此提示只陳述耗時，不會指向一個查不到東西的指令。

#### 使用 `--fields` 投影欄位

`--fields` 可將 SQL 或 MongoDB query 結果縮減為需要的欄位。使用 inclusion list 保留欄位，輸出順序會依照指定順序：

```bash
dbcli query "SELECT * FROM events" --fields id,name,created_at
dbcli query '{}' --collection raw_logs --fields station_code,bet,win,created_at
```

在每個欄位前加上 `-` 即可排除欄位。為了讓開頭的 hyphen 明確屬於 option value，請使用可攜的 `=` 寫法：

```bash
dbcli query "SELECT * FROM events" --fields=-raw_response,-request_payload
dbcli query '{}' --collection raw_logs --fields=-raw_response,-request_payload
```

每次執行只能使用 inclusion 或 exclusion 其中一種語法，不可混用。空白 list、空白項目與重複 path 都會被拒絕。支援 `profile.name` 這類 dotted path；inclusion 輸出會遵循指定順序。MongoDB inclusion 預設排除 `_id`，只有明確指定 `_id` 時才會保留。結果中不存在的欄位會回傳 `null` 而非報錯，因此拼錯的欄位名會得到一整欄 null——在把「全 null」解讀成有意義之前，先用 `dbcli schema` 核對欄位名。

SQL 會在 query 執行完畢後對回傳 rows 套用 projection。MongoDB 會將 projection 下推至 `find` 或 aggregation pipeline 以減少傳輸資料量，之後再於 blacklist masking 完成後正規化回傳 rows。Redis 與 Elasticsearch query 不支援 `--fields`。

Blacklist 仍是最終權限邊界：`--fields` 無法顯示受保護欄位；field projection 只是調整結果形狀的便利功能，不是 security boundary。

#### 寫入結果

`insert`、`update` 或 `delete` 在互動終端完成後，dbcli 會以自然語句摘要實際結果：受影響的列數與資料表、沒有符合資料、取消、dry-run 或失敗；只有真正執行的操作才會顯示耗時。stdout 被重新導向或透過 pipe 傳遞時，仍維持供腳本使用的穩定 JSON result envelope。在終端中使用 `--format json` 也可明確保留該 envelope。SQL、MongoDB 與 Redis 使用相同的 outcome 詞彙；dry-run 會回報 `dry_run`，不再回報 `success`。

真的改動到資料的寫入，摘要還會說明如何取回先前的值——就這三個指令而言只有備份一途：寫入成功之後 dbcli 不保留任何自動還原機制。失敗時改為指出 `--recovery`，也就是產生回復計畫、供 `dbcli recover` 讀取的旗標。沒有造成任何改動的結局（取消、dry-run、沒有符合的列）不會提到還原，因為沒有東西需要還原。

失敗同樣是散文，並且寫到 stderr、退出碼 `1`——不論是 blacklist 拒絕、`--set` 格式錯誤，或資料庫退回的語句。`--format` 在這三個指令只接受 `text` 或 `json`，其他值會在連線之前就被拒絕，而不是悄悄當成 `text`。

沒有加 `--force` 的寫入所詢問的確認內容——產生的 SQL、參數、刪除的危險警告，以及 `y/n` 問句——一律寫到 **stderr**，不寫 stdout。終端機兩個串流都看得到，所以手動執行時外觀不變；而擷取 stdout 的腳本無論有沒有 `--force`，拿到的都只會是一份 JSON 文件。dry-run 與取消都不會對資料庫送出任何寫入，但兩者仍會連線並讀取資料表 schema——因為它們要顯示的 SQL 沒有欄位清單就組不出來；完全不連線的預檢請改用 `--plan`。MongoDB 與 Redis 的寫入也會問同一個問題——它們是由指令直接送出而非經過 SQL executor，過去完全不問就執行——所以 `cancelled` 現在在每個引擎都可能出現。它們的提示顯示的是 dry-run 會印出的那段語句，沒有參數區塊，因為那些語句的值本來就寫在裡面。

`--recovery` 同時改變 `insert` / `update` / `delete` 失敗時寫到 stdout 的內容：失敗時 recovery envelope 會取代 JSON result envelope，而不是接在它後面，因此解析 stdout 的呼叫端無論如何都只會拿到一份文件。沒有加這個旗標時，失敗仍然是印出 `status: "error"` 的 result envelope 並以 `1` 退出。

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
| `doctor` | 執行環境與連線診斷；JSON 的設定缺失錯誤會包含結構化 remediation 指令與風險等級。`doctor --format json --remediation` 會為 blacklist 覆蓋、schema 更新與大型資料表提供僅供候選的計畫。SQL 大型資料表候選會先使用 `dbcli plan`；MongoDB/Elasticsearch 候選先以 `dbcli schema` 預檢，再由人工確認 bounded `dbcli query`。Doctor 不會自動變更設定、blacklist 規則或資料庫資料。 |
| `check [table]` | 分析資料健康度（如孤兒資料、空值、重複項）。 |
| `diff` | 比較 Schema 快照，或透過 `--against-orm` 將 ORM 定義與本地 SQL schema cache 比對。 |
| `report` | 產生完整的健康、容量與效能報告。 |
| `guide <goal>` | 產生特定目標的引導計畫（如：`slow-query`）。 |
| `recover --apply` | **自動化修復**：自動執行上次建議的故障修復計畫。 |
| `audit tail` | **稽核日誌**：讀取 `.dbcli/audit/<conn>.jsonl`（agent-facing JSONL）；使用 `--for-agent --n 10` 取得 session handoff JSON。|
| `audit write-gate` | **閘門量測**：第二級寫入閘門被觸及幾次、依哪一條判準，以及放行／取消／拒絕各幾次。|
| `--recovery`（支援的指令） | **Recovery ↔ Audit 雙向連結**：`query`、`inspect`、`insert`、`update`、`delete`、`export`、`q`、`schema`、`lint` 失敗時都會寫入互相對應的 `audit.recovery_ref` ↔ `envelope.audit_ref` UUID；用 `audit show --recovery-ref <id>` 從 envelope 反查 audit entry。|

`doctor` 也會回報 runtime identity（launcher/source、runtime 與 package version），並在
bundled runtime 與 package version 不一致時標示，提供明確的 `dbcli upgrade` remediation。
機器可讀指令（`--format json` 與其他非人類格式、`--for-agent` 或 `--recovery`）會保持
stdout 僅含 payload：update 與 skill-update notice 都會被抑制。人類可讀 notice 則寫到
stderr，且每個 CLI session 同類提示只會出現一次。

#### Source-to-SQL backfill artifact

`backfill artifact` 將刻意受限的 JSON source catalog 轉為可檢閱、僅 dry-run 的 artifact；
它不會連線或寫入任一資料庫。Catalog 必須有 `table`、非空的 `keyColumns`、`rows`、
`verifyQuery` 與 `expect`，且最多只接受 1,000 筆 row。使用具名 v2 連線，讓 artifact
記錄不含機密的 source/target identity 與兩者差異：

Target connection 必須是 PostgreSQL、MySQL 或 MariaDB；source identity 可以描述其他引擎。

```bash
dbcli backfill artifact --source ./backfill.json \
  --source-use staging --target-use production
```

Artifact 會包含產生的 `UPDATE`、每個 statement 的 `plan` 指令、blacklist/schema preflight
指令、read-back 的 `verify safe-backfill` 指令與 rollback hint。請先檢閱；套用任何 SQL
是另一個需要明確人工確認的流程。使用 `--stdout` 輸出 JSON，或以 `--out <path>` 指定
artifact 路徑。

#### ORM 定義漂移

`diff --against-orm` 會將應用程式 schema 與既有 SQL schema cache 比對。比對本身只讀 cache：不連線資料庫、不更新 cache，也不執行提案。若在意資料新鮮度，先執行 `schema --format json`；cache 為空時會 exit `1` 並要求執行 `dbcli schema`。

五種輸入路徑涵蓋所有支援的格式：

| 輸入路徑 | 傳入內容 |
| :--- | :--- |
| Prisma | 一個 `schema.prisma` 檔。 |
| Drizzle | 執行 `drizzle-kit generate` 產生的一個 PostgreSQL drizzle-kit v7 snapshot。 |
| TypeORM | `schema:log` 產生的 DDL；不解析 entity source file。 |
| Sequelize | 對 scratch database 套用 migration 後取得的 schema-only dump；不解析 model source file。 |
| 可攜式 schema | Raw PostgreSQL/MySQL/MariaDB DDL（可多檔或 glob），或一個 normalized JSON 檔。 |

```bash
dbcli skill tasks plan orm-drift-review --param orm_path=prisma/schema.prisma --format json
dbcli diff --against-orm prisma/schema.prisma --format json

drizzle-kit generate
dbcli diff --against-orm drizzle/meta/0001_snapshot.json --orm-format drizzle --format table

bunx typeorm schema:log -d <path/to/datasource> > schema.sql
dbcli diff --against-orm schema.sql --orm-format typeorm --format table

# 先將專案的 Sequelize config 指向空的 scratch database
bunx sequelize-cli db:migrate
pg_dump --schema-only <scratch-database> > schema.sql
# MySQL 則改用：
mysqldump --no-data <database> > schema.sql
dbcli diff --against-orm schema.sql --orm-format sequelize --format json

dbcli diff --against-orm "migrations/*.sql" --orm-format ddl --format markdown
dbcli diff --against-orm schema.normalized.json --orm-format json --format table
dbcli diff --against-orm prisma/schema.prisma --recovery --format json
```

`--against-orm` 可重複使用，也接受逗號分隔路徑。DDL family 輸入（raw DDL 加上 `typeorm`、`sequelize` alias）支援真實 filesystem glob 與多檔；路徑會去重並以 deterministic order 排列，再當成單一共享且有序的 context 解析，所以後一檔案的 index 可連到前一檔案宣告的 table。Prisma、normalized JSON 與 Drizzle 都只接受一個檔案。Drizzle 輸入必須是 `drizzle/meta/<NNNN>_snapshot.json` 的 PostgreSQL drizzle-kit v7 snapshot。TypeORM `schema:log` 會輸出 `schema:sync` 將執行但不會實際套用的 SQL。Sequelize CLI 沒有通用的 `db:migrate --dry-run`，因此必須先對 scratch database 執行 migration，再用 `pg_dump --schema-only` 或 `mysqldump --no-data` 匯出。TypeORM entity 與 Sequelize model（`.ts`、`.js`、`.mjs` 或 `.cjs`）不會被解析；dbcli 會拒絕它們，並顯示精確的產生步驟。用 `--orm-format prisma|ddl|json|drizzle|typeorm|sequelize` 覆寫偵測；TypeORM alias 預設忽略 `typeorm_metadata` 與 `migrations`，Sequelize alias 預設忽略 `SequelizeMeta`。`--ignore <globs>` 可加入逗號分隔且大小寫敏感的 qualified table pattern，並以 `--format json|table|markdown` 選擇輸出。ORM 有而 DB 沒有的是 error `missing_in_db`；只有 DB 有的是 warn `missing_in_orm`；型別 family 不相容或 nullability 不同是 error-level `mismatch`；同 family 型別拼字、default 與 primary-key 差異是 info。忽略的資料表會列為 `unmanaged`，但不計分。只有計分後的 error 會決定 drift exit code：有 error 時 exit `1`，只有 warning、info、`unmanaged` 或 `unparsed` 時 exit `0`；操作失敗仍會 exit `1`，並可由 `--recovery` 包裝。

Schema 與 table storage 會精確保留且大小寫敏感。PostgreSQL 的 `users` 與 `"Users"` 可並存。解析 DDL 時，未引用的 `Users` 會折成 `users`，而引用的 `"Users"` 只會解析成 `Users`；quote state 來自 parsed identifier，絕不從顯示文字的大小寫推測。Qualified name 的顯示與 ignore 也區分大小寫。重複的 exact 或 resolved identity 會 fail closed。不支援的 Prisma/DDL/Drizzle construct 會以 `blocked:` 原因出現在 `unparsed`，包含 Drizzle enum 與其他不支援的 snapshot construct。Drizzle column default 只接受 snapshot 中的 string、boolean 或有限 number；不支援的 default 會阻擋並省略該 column。PostgreSQL `PARTITION BY` 以及 MySQL/MariaDB 的 table engine、charset 與其他 table option 都不支援：它們會產生 `blocked:` 項目，且不建立 managed table。Normalized JSON 也要求每個 `unparsed.reason` 都以 `blocked:` 開頭。Index 依結構化欄位與 uniqueness 比對、去重；drift entry 會依 table/object/category/detail 的 Unicode code-point order 決定性排序，不受 locale 影響。

提案是 shell-safe 文字，預設仍是 dry-run。安全且未 qualified 的欄位/index 新增可產生 `migrate`；schema-qualified 或 CLI 無法無損表達的 index target 會升級至 `migration-review`，不會輸出損壞指令。Table、column 或 type positional 若以 `-` 開頭也會升級；以 dash 開頭的 option value 則使用 option-safe attached syntax，例如 `--default=-1` 或 `--columns=--config,email`。擷取 dry-run DDL，並把兩個精確值分別作為單一 quoted parameter 傳入：

```sh
dbcli skill tasks plan migration-review \
  --param "table=${exact_table}" \
  --param "ddl=${captured_ddl}"
```

完成審查前絕不加上 `--execute`。

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
| `--evidence-receipt <path>` | 選用 | 在 verdict、audit 嘗試與可選 artifact 確定後，原子寫入不含 SQL 或 rows 的安全 assert provenance。 |

`evidence compose` 可用 `--receipt <path>` 參照該明確且 workspace-contained 的 receipt；provenance 不是執行核准。
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

在 `--after-write` 執行完成後，可加入 `--evidence-receipt <工作區相對路徑>`，原子寫入連結至結果文物的安全 provenance receipt。receipt 不含 SQL、rows、credentials 或使用者路徑；它只記錄 provenance，**不代表**核准執行。預檢模式沒有已執行的結果文物，因此不支援 receipt。receipt outcome（`succeeded`/`failed`）與情境 status（`verified`、`not_verified`、`indeterminate` 或 `blocked`）分開；task-pack 的 `planned` evidence 仍僅限計畫。

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

<!-- doc-key: evidence-packs -->
### evidence — 建立離線證據包

`dbcli evidence` 把既有的 verification artifact 與 audit entry 收斂為可供審閱或交接的、
工作區內 canonical JSON 證據包。它不會連線資料庫，也不會把 SQL、target、audit metadata、
verification summary 或憑證複製進包內。Claim 是外部提供的陳述，會被明確標示；它不是 dbcli 的
驗證裁決。

- `dbcli evidence compose --claims <file> [--verification <selector...>] [--audit <selector...>] [--receipt <path...>] --output <path> [--format json|markdown]`
  — 解析一或多個既有參照並寫入新證據包。claims 檔案是只含 `subject` 與 `claims` 的 JSON；每個
  claim 都含 `id` 與自然語言 `text`。Claim 文字不得含 SQL、憑證、錯誤內容或黑名單識別字。
  輸出必須留在目前工作區內，且絕不覆寫既有檔案。
- `dbcli evidence validate --file <path> [--format json|markdown]`
  — 驗證 SHA-256 integrity digest，並檢查來源證據是否仍可取得。已保留的 pack 若對應的
  audit/artifact 之後輪替、清除或消失，會回傳 `references: "source-expired"` 並以 `1` 退出；
  但仍可 render。
- `dbcli evidence render --file <path> [--format json|markdown]`
  — 驗證目前的黑名單政策後，不重讀原始參照就輸出有效 pack，因此來源的保留期屆滿後仍可供
  歷史審閱。

```bash
dbcli evidence compose --claims ./claims.json --verification ver_abcd --audit 1a2b \
  --receipt .dbcli/evidence/verify-receipt.json \
  --output .dbcli/evidence/review.json
dbcli evidence validate --file .dbcli/evidence/review.json --format json
dbcli evidence render --file .dbcli/evidence/review.json
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
dbcli --use local proxy --listen 127.0.0.1:3307
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

`dbcli proxy analyze` — 離線分析擷取的事件日誌(不連 DB)。`--format json|text`、`--top`、`--slow-ms`、`--n-plus-one`、`--no-include-rotated`。輸出總覽、各查詢指紋統計、最慢查詢、錯誤分群、熱點表、N+1 嫌疑。

每個可行動的區塊都附帶機器可讀的後續步驟,讓 AI agent 能從「診斷」直接推進到「修正」:

*   **SELECT 熱點 / N+1** — `suggestedCommands` 提供 `dbcli explain "<sql>"` 與 `dbcli guide missing-index-for "<sql>"`。
*   **錯誤(errors)** — `suggestedCommands` 提供 `dbcli schema <table>`(最多前 3 個表),並附 `hints` 提醒先核對表名/欄名再修正——切勿臆測欄名。
*   **N+1 嫌疑** — `hints` 建議將重複查詢批次化(JOIN / `IN (...)`)或快取結果。

建議流程:跑 `proxy analyze` 後,逐一針對每個發現讀其 `hints`、執行其 `suggestedCommands` 蒐集 schema/查詢計畫證據,再套用修正。text 格式會把這些彙整成 `SUGGESTED COMMANDS` 與 `HINTS` 區段;JSON 格式則把建議附在各發現上。建議僅以字串輸出——`proxy analyze` 不會自動執行。若 proxy 啟動時帶了 `--redact literals`,範例 SQL 會含 `?` 佔位符;執行指令前請先填回真實值。

#### 限制（v1）

- **TLS**：v1 不會解密 TLS。加密連線仍會產生 session 與位元組統計事件，但不會解析或顯示 SQL — 若需要查詢可見度，請在本機分析時停用 SSL。
- **MySQL prepared/binary 協議**：盡力解析；標記為 `prepared_statement`。
- **PostgreSQL extended query 協議**：盡力解析；標記為 `extended_protocol` 或 `parse_partial`。

<!-- doc-key: querylens -->
### QueryLens — Proxy 查詢分析

QueryLens 是 `dbcli proxy analyze` 的可分享 Markdown 報告格式，可將 proxy 事件日誌轉為本機查詢分析報告；它不是完整的資料庫協定分析器。

分析時不需要資料庫連線，也不需要 dbcli connection 設定：它只讀取磁碟上的 JSONL 檔案。QueryLens Markdown 報告會在分析前遮罩 SQL literal；擷取時也請使用 literal 遮罩，避免事件檔本身保留應用程式的值。

#### 快速開始

```bash
# 1. 擷取已遮罩的本機開發流量 JSONL 日誌。
dbcli proxy mysql --listen 127.0.0.1:3307 --target 127.0.0.1:3306 \
  --events .dbcli/proxy/events.jsonl --redact literals

# 2. 在本機產生 QueryLens Markdown 報告；不會連線至資料庫。
dbcli proxy analyze \
  --events .dbcli/proxy/events.jsonl --format markdown

# 若要供其他工具或 CI 步驟使用，保留既有 proxy JSON 報告。
dbcli proxy analyze \
  --events .dbcli/proxy/events.jsonl --format json
```

執行應用程式時，將它指向 proxy 的 `--listen` 位址。停止 proxy 後，請在 repository root 對產生的日誌執行分析指令。

#### 分析選項

| 選項 | 說明 |
| :--- | :--- |
| `--events <path>` | proxy JSONL 事件日誌的路徑。 |
| `--format markdown\|json\|text` | `markdown` 產生已遮罩的 QueryLens 報告；JSON 與 text 保持既有 proxy 分析輸出。 |
| `--top <n>` | 將排名發現限制為前 *n* 項。 |
| `--slow-ms <ms>` | 報告判定慢查詢使用的時間門檻。 |
| `--n-plus-one <n>` | 判定 N+1 候選項目使用的重複次數門檻。 |
| `--no-include-rotated` | 只分析指定日誌，不納入輪替後的同層日誌。 |

QueryLens 只會分析它能讀取的 proxy 事件；請勿把結果視為已完整擷取所有資料庫協定或查詢形式的證據。將發現當作調查線索，修改正式程式碼前仍應確認查詢、schema 或執行計畫。

<!-- doc-key: advanced-tools -->
### 進階工具

| 指令 | 說明 |
| :--- | :--- |
| `shell` | 啟動互動式 REPL，支援 Tab 自動補全與 SQL 高亮。 |
| `migrate <action>` | **DDL 引擎**：建立/修改/刪除資料表與索引。具破壞性的動作若未加 `--force` 會在 stderr 詢問確認，拒絕時回報 `status: "cancelled"`。 |
| `skill --install` | 為 AI 代理安裝 `SKILL.md` 指引（Claude, Gemini, Antigravity 等）。 |
| `skill context` | 將快取的 schema、連線與儲存的查詢元資料序列化為 LLM 優化的 XML/JSON/Markdown 格式，以供 AI prompt 注入使用。 |
| `semantic validate` / `semantic context` / `semantic search` / `semantic drift` / `semantic migrate` / `semantic draft validate` | 驗證、輸出、搜尋、檢查漂移、僅輸出遷移後的可版控業務語彙，或安全驗證明確提交的不受信任 query draft；只對照本機快取、已經 blacklist 過濾的 semantic 證據。離線且唯讀。 |
| `contract validate` / `contract context` / `contract search` / `contract drift` | 驗證、輸出、搜尋或檢查可選的已審閱 `dbcli.contracts.json` 是否仍符合 semantic 證據。離線且唯讀；普通 agent context 只會納入 approved 契約。 |
| `design init` / `design validate` / `design render` / `design diff` / `design propose` | 明確建立本機 starter 檔，驗證或輸出可版控的 SQL 資料庫設計，與本機 SQL schema cache 或本機 ORM 定義比較，並產出只供審查的變更計畫。不會執行 DDL 或暗中寫入設計檔。 |
| `impact assess` | 將設計變更相對於本機 schema cache 或 ORM artifact 的已知影響寫成離線報告；不會連線、執行 SQL，亦不會宣稱覆蓋完整。 |
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

> **業務語意脈絡。** 在專案根目錄放置可檢閱的 `dbcli.semantic.json`，描述業務模型、可見欄位、別名、relationship 與由 saved query 支援的 metric。可在不連線資料庫的情況下驗證：
>
> ```bash
> dbcli semantic validate --format json
> dbcli semantic context --format json
> dbcli semantic search purchases --kind model --format json
> dbcli semantic drift --format json
> dbcli semantic migrate --to 2 --format json
> dbcli skill context --format json
> ```
>
> **如何被主動發現。** 已安裝的 dbcli skill 會在需求含有業務別名、metric、反覆使用的術語或 relationship/join 意圖時，要求 agent 先檢查 `skill context`。若存在已驗證的 `semantic` 區塊，就以它作為受治理詞彙；否則退回已過濾 blacklist 的 schema，並告知你這項可選能力能讓後續需求保持一致。除非你明確要求，dbcli 不會建立或修改 `dbcli.semantic.json`。
>
> v1 持續相容；v2 新增已宣告且可見 model 欄位間的 relationship。驗證器會拒絕不存在於快取可見 schema 的資料表或欄位（包含 blacklist 的物件），以及 `query` 並非可用 `@saved-query` 的 metric。`semantic search <terms...>` 為離線且 deterministic 的搜尋；可用 `--kind` 與 `--limit 1-100`（預設 20）。它只輸出受治理的 metadata，並從自由文字結果移除 blacklist 名稱。`semantic drift` 在 `stale`、`invalid` 或 schema cache 不可用時以非零結束；`migrate --to 2` 只輸出 JSON，絕不寫回來源檔。
>
> **語意契約。** 在 semantic 檔旁加入可選、可檢閱的 `dbcli.contracts.json`，為受治理的業務術語補上 owner 與描述性的 evidence expectation。檔案必須使用版本 `1`、canonical contract name、canonical `model:` / `field:` / `relationship:` / `metric:` subject、`draft`、`approved` 或 `deprecated` status，以及 `none`、`receipt-required` 或 `verification-required` evidence policy；不得包含 SQL、憑證、受保護識別字或可執行規則。
>
> ```bash
> dbcli contract validate --format json
> dbcli contract context --format json
> dbcli contract search customer --format json
> dbcli contract drift --format json
> ```
>
> 這些指令不會連線或執行查詢。`context`、`search` 與 `skill context` 只會輸出有效且 `approved` 的契約；draft 與 deprecated 術語保留為本機審閱產物。缺少契約檔不會改變一般 semantic context；但明確指定的缺檔或無效檔案會 fail closed。`contract drift` 會區分 valid、stale、invalid 與 unavailable 的本機證據。
>
> **Agent query draft。** 先把已檢閱的 `dbcli semantic context --format json` 輸出交給外部 agent；provider 帳號、憑證、prompt 與其他 agent context 都留在 dbcli 外。agent 回傳不受信任的 `QueryDraft` 檔案，形狀如下（只能使用該 semantic context 中的 model 與 field）：
>
> ```json
> {
>   "version": 1,
>   "questionHash": "<原始問題的-sha256>",
>   "candidate": { "kind": "sql", "sql": "<已檢閱的唯讀-sql>" },
>   "semanticReferences": ["model:<model>", "field:<model>.<field>"]
> }
> ```
>
> 再只提交這個明確指定的檔案或 stdin 載荷供離線驗證：
>
> ```bash
> dbcli semantic draft validate --input ./draft.json --format json
> # 或：external-agent | dbcli semantic draft validate --input - --format json
> ```
>
> 報告只含狀態、hash、canonical reference 與安全 violation code，絕不包含 candidate SQL。exit `0` 代表有效、`1` 代表拒絕、`2` 代表必要的本機 semantic 證據不可用。有效結果不是執行授權：先檢閱原始 `draft.json`，若確實要執行，再另行明確呼叫 `dbcli explain "<已檢閱的唯讀-sql>"` 或 `dbcli query "<已檢閱的唯讀-sql>"`。驗證不會保存輸入，也不會呼叫這兩個指令；dbcli 不會取得 agent 的 provider 憑證，也不會發出 provider 請求。

<!-- doc-key: design-assistant -->
> **資料庫設計輔助工具。** 新專案可在程式碼旁保留一份可檢閱的 `dbcli.design.json`。它描述目標 PostgreSQL/MySQL/MariaDB 的 model、field、key、relationship、index、access pattern 與設計決策；不包含 SQL、憑證、資料列或 provider 設定。
>
> ```bash
> # 只會寫入這個明確指定且不存在的路徑；請先編輯 starter 再驗證。
> dbcli design init --output ./dbcli.design.json --dialect postgresql
>
> # 兩個指令都離線且唯讀。
> dbcli design validate --format json
> dbcli design render --format mermaid
> dbcli design diff --against-cache --format markdown
> dbcli design diff --against-orm ./prisma/schema.prisma --format markdown
> dbcli design propose --against-orm ./prisma/schema.prisma --format markdown
> ```
>
> `validate` 對格式錯誤、缺少 primary key、無效 relationship endpoint 或 cardinality、relation type 不相容與不安全 index 採 fail-closed；也會回報建議性的 access-pattern index 缺口。`render` 只在設計沒有 error 時才輸出 JSON、Markdown 或 Mermaid ERD。`diff --against-cache` 讀取既有的本機 cache（先執行 `schema`），不會開啟連線，並回報不同的 column、index 與 foreign key。`diff --against-orm` 完全在本機執行：可對照明確指定的 Prisma、DDL、Drizzle snapshot 或 normalized JSON artifact，不需要設定或資料庫連線；DDL 可使用 glob。兩種模式都唯讀，而且必須剛好選擇一個比較目標。`propose` 會為每一項變更加上 blacklist/schema 預檢、僅在既有 migration 能無損表示時才提供 dry-run 指令、回滾提醒與寫入後的唯讀驗證計畫；其他變更一律升級為 `migration-review`。它不會套用任何寫入。`init` 是唯一的寫入指令，必須指定 `--output`，且拒絕覆寫既有檔案。這些指令不會呼叫 LLM 或查詢資料；外部 coding agent 可以起草檔案，但人仍應檢閱後再採用。

> **新專案工作流。** 執行 `design init`，編輯明確建立的 artifact，再執行 `design validate` 與 `design render`。若已有 application model，資料庫尚未建立前即可用離線的 `design diff --against-orm <path>` 對齊 artifact 與 ORM。

> **既有資料庫演進。** 先執行 `blacklist list`，以 `schema --format json` 更新 cache，再執行 `design diff --against-cache` 與 `design propose --against-cache`。檢閱計畫後，另外執行已核准的 migration；之後更新 schema 並重新執行相同的 diff。兩個 design 指令都不會寫入資料庫。

> **影響評估。** 在將 schema 變更視為安全之前，先寫出受治理依賴的有限報告：
>
> ```bash
> dbcli impact assess --design ./dbcli.design.json --against-cache --events ./.dbcli/proxy/events.jsonl --output ./impact.json --format json --fail-on warn
> dbcli impact assess --design ./dbcli.design.json --against-orm ./prisma/schema.prisma --output ./impact.md --format markdown --fail-on never
> ```
>
> 必須剛好選一種 baseline。指令只會讀取明確指定的 design／ORM 檔或既有本機 cache、semantic contracts、saved-query 名稱、verification artifact metadata，以及可選且已審閱的 `dbcli.data-access.json` operation metadata。此 manifest 必須使用 canonical semantic reference 與既存、workspace-relative 的 source path；dbcli 絕不讀取或解析那些 source file。可選的明確 `--events` 檔會先經 redaction-first 投影，只保留近期且安全的 table metadata；不會啟動 proxy、不會讀取 rotated log，也不會輸出 SQL、literal、error、session 或路徑。缺少、格式錯誤、過期、無法讀取或 redaction 失敗的 workload 證據會保留為 advisory coverage gap，且單獨存在時不會使 `--fail-on warn` 失敗。它不會連線、更新 cache、執行 SQL、讀取 query body，或輸出保護識別字。缺少、無效或被隱藏的證據會明確列為 `partial` coverage gap；v1 永不回報 complete。`--fail-on` 只在報告寫出後改變 exit code（`error`、`warn` 或 `never`）。

> **內建任務包 `analyze-table-perf`。** 唯讀（`plan-only`）的 task pack，吃必填的 `table` 參數，依序執行 `blacklist list` → `schema <table> --format json` → `guide index-usage --format json`。`dbcli inspect` 會針對近期活動中最熱門的資料表自動建議它。另也內建多個唯讀套件 — `audit-permissions`、`safe-backfill`、`schema-drift-review`、`orm-drift-review`、`design-review` 與 `connection-health`。`design-review` 會驗證／輸出 artifact、更新 cache，並產出只供審查的 proposal；絕不套用它們。用 `dbcli skill tasks list` 瀏覽所有 task pack。

> **`safe-backfill-verify` 任務計畫與 `verification` 區塊。** 執行 `dbcli skill tasks plan safe-backfill-verify --format json` 回傳的計畫 JSON 中包含一個 `verification` 區塊，其 `status` 為 `"planned"`。此區塊描述任務執行時將進行的回讀斷言 — 這是**計畫中**的佐證定義，**而非執行結果**。`status: "planned"` **不代表**驗證已執行或通過，僅表示任務計畫知道要在執行時執行哪項驗證。

---

<!-- doc-key: html-dashboards -->
## 互動式 HTML 儀表板

在查詢時加上 `--ui` 旗標，即可在瀏覽器中開啟互動式 React 報表。

```bash
dbcli query "SELECT * FROM daily_metrics" --ui
```

**KPI 與圖表**：在 Snippet 的 Frontmatter 中加入 `visual:` 區塊，即可直接在儀表板中呈現自定義圖表與 KPI。支援的圖表類型為 `line`（折線圖）、`bar`（長條圖）、`area`（區域圖）、`pie`（圓餅圖）四種；指定其他類型會在解析時報錯。

當 dbcli 的 lookahead 證明結果遭截斷時，dashboard 會在所有 KPI、圖表與 table **之前**顯示警示並標出實際上限；blacklist 的遮蔽／省略通知也會顯示在同一區域。query HTML/UI、saved-query HTML/UI 與 HTML export 只要執行路徑有產生對應 metadata，都會沿用此行為。

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

### MongoDB 連線設定

`dbcli init --system mongodb` 現在預設走逐欄精靈，與 SQL 引擎一致：依序詢問 Host、是否為 SRV 網域、Port（SRV 時略過）、User，有填 User 才接著問 Password 與 `authSource`，最後是可選的進階步驟（`replicaSet` / `tls`）。貼上完整連線字串改為明示的第二選項（「貼上完整連線字串（進階）」）。非互動用法不受影響：傳入 `--uri` 會直接跳過連線方式提問，行為與過去完全相同。

逐欄連線欄位（`ConnectionConfig`，`src/types/index.ts`）：

| 欄位 | 型別 | 用途 |
| --- | --- | --- |
| `authSource` | 字串或 `{"$env": "..."}` | 認證資料庫；有帳密時預設為 `admin`。 |
| `replicaSet` | 字串或 `{"$env": "..."}` | 複本集名稱。 |
| `tls` | 布林 | 是否啟用 TLS。 |
| `srv` | 布林（預設 `false`） | 組出 `mongodb+srv://` 並透過 DNS SRV 展開 host；啟用時 `port` 會被忽略。 |
| `timeout` | 數字（毫秒，100～600000） | 連線 timeout；可用 root-level `--timeout <ms>` 針對單次執行覆寫。兩者都未設定時，沿用 adapter 內建的 5000ms 預設值。與本表其他欄位不同，它不接受 `{"$env": "..."}` 參照，只接受字面數字。 |
| `statementTimeout` | 數字（毫秒，0～3600000） | 一句語句能跑多久，與連線 timeout 獨立；可用 root-level `--statement-timeout <ms>` 覆寫。未設定時退回 `timeout`，兩者都沒有則交給伺服器自己的設定。`0` 表示取消上限。與 `timeout` 一樣只接受字面數字。 |

`--auth-source <db>` 已是非互動的 `init` flag。`replicaSet` 與 `tls` 目前沒有專屬 flag，可在互動的進階步驟填寫，或事後直接編輯 `.dbcli`（與 Elasticsearch 的 `caPath` / `rejectUnauthorized` 是同一套模式）。

若設定同時存在 `uri` 與逐欄值（`host` / `user`），`uri` 仍會優先，逐欄值一樣被忽略——這點沒變，但 `dbcli doctor` 現在會針對這個情況發出警告，讓「改了欄位卻沒生效」可以被診斷出來，而不是原地困惑。`doctor` 也會在 `srv: true` 又同時指定非預設 `port` 時發出警告，因為 SRV 記錄自帶埠號。

逐欄模式下只填 `user` 沒填 `password`，現在會直接拋出錯誤，不再靜默降級成無認證連線。`user`、`database`、`password` 中的值在組成 URI 時皆會一致跳脫，帳號或資料庫名稱中含 `@`、`/` 等字元不會再讓 driver 誤判 authority 的邊界。

連線失敗訊息依成因分類提示：認證失敗會提示檢查 `user` / `password` / `authSource`（Atlas 與多數自架環境為 `admin`）；DNS/SRV 失敗會提示檢查 `srv` 設定與本機網路的 DNS 限制；TLS/憑證失敗會提示 `tls` 欄位與 CA 信任鏈設定。

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

結果帶有 `warnings[]`:引數被改寫時為 `REDIS_SIZE_REWRITE`,回覆被截斷時為 `REDIS_SIZE_TRUNCATE`。`dbcli query` 會把每一則 warning 印到 stderr,且被裁切的回覆同樣會回報 `truncated` / `limit_applied`,與其他引擎一致,因此被截斷的回覆不會被誤認為完整。以 `--no-limit`(CLI)或 `.no-limit on`(shell)略過。

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

- 預設**上限為 1000 筆**,而且撞到上限會讓**匯出失敗**,而不是寫出一份短少的檔案。加上 `--no-limit` 可匯出整個 index(整索引形式會以 scroll 分批串流),或加上 `--limit N` 刻意接受上限。
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
9.  **共用 agent CLI interface**：套件使用者可從 `@carllee1983/dbcli/agent-core` 匯入 `loadEnvFile`、`resolveEnvRef`、`resolveConnectionSelector`、`parseConnectionNames`、`trimAppliedLimit`，以及 `AppliedLimitMetadata`、`AppliedLimitResult`、`ConnectionSelectorInputs`。此小型 interface 不相依 CLI framework 或資料庫並遵守 semver；較廣的 `./core` 產品介面維持分離，CLI option factory、config storage binding 與連線字串解析刻意不納入 `agent-core`。

### 業務請求的意圖確認

已安裝的 skill 支援三種**當次請求的對話偏好**，它們不是 dbcli 旗標或儲存的設定。Agent
不得先以「要不要讓我提問？」這類後設問題打斷使用者。

| 偏好 | Agent 行為 |
| --- | --- |
| `auto`（預設） | 透過受治理的 semantic context 與 schema 證據釐清術語。僅在尚未解決的歧義會實質改變結果時，才用一小批精簡問題確認；否則說明假設後繼續。 |
| `confirm` | 先說明預計採用的解讀，等待核准後才發出該任務的資料查詢。 |
| `guided` | 以短而聚焦的問題建立請求內容，並在整個任務中保留已確認的答案。 |

例如「查昨天的銷售資料」在結果形狀（總額或明細）、指標定義、時區、訂單狀態／退款處理、
分組或連線未知時仍有歧義。Agent 應摘要候選解讀，只詢問會改變結果的問題。若使用者明確
要求自行判斷、不要再問，agent 會以 `auto` 模式繼續並說明重要假設。這個偏好絕不繞過
blacklist、schema、permission、dry-run、production 選取或寫入確認閘門。

### 何時 dbcli 比 MCP database server 或直接 DB client 更合適

沒有任何一種工具永遠勝出。可信任的人員在可拋棄的本機環境做一次性變更時，直接使用資料庫 client 是最短路徑；Agent host 需要以工具形式進行低風險互動探索時，MCP database server 很有價值。當同一個資料庫任務必須讓 Agent、人員、CI 與 incident runbook 都能安全且可重現地執行時，`dbcli` 才是更合適的邊界。

| 選擇 | 最適合的情境 | 取捨 |
| --- | --- | --- |
| 直接 DB client | 可信任操作者以最小權限憑證進行一次性操作 | 每個 client 與 script 都要自行重建安全、審查與證據慣例。 |
| MCP database server | Agent host 需要透過 tool 介面進行低風險、互動式探索 | 授權與稽核邊界由 host 與 server 定義；它通常不是 CI 或終端 runbook 使用的同一個邊界。 |
| `dbcli` | 人員、Agent、自動化與復原流程必須共用同一份指令契約 | 它刻意維持 CLI surface，因此 Agent 需要 shell command 授權，而非原生 MCP tool。 |

#### 快速圖解：怎麼選

```text
可拋棄的本機實驗 ───────────────────────────────→ 直接 client
綁定 Agent host 的互動式探索 ────────────────────→ MCP database server
真實資料、共享 fixture、CI 或 runbook ──────────→ dbcli
```

關鍵不在資料庫是不是本機，而在結果是否需要超出 Agent session 而存在。當快速實驗變成共享、可重跑或需審查的操作，就把它移到 dbcli 的指令路徑。

### 即使只是本機 vibe coding

本機開發改變的是爆炸半徑，不是基本的失敗模式。在可隨時丟棄、只含合成資料的資料庫上，當你會逐條看著 SQL 執行時，直接使用 client 完全合理；它更快，因為 Agent 可以立刻連線、探索並執行臨時 SQL。

代價是 client session 本身成了完整的安全契約。Agent 仍可能猜錯欄位名稱、查詢到本機的 production dump、對仍要保留的 fixture 執行無範圍操作，或留下當工作移到 CI 時沒有人能重跑的變更。資料庫 client 可能有自己的保護功能，但它們不會自動成為專案其餘部分使用的同一份政策與工作流。

`dbcli` 在 Agent 操作前加入一個很小、但刻意的停頓：先檢查保護範圍、讀取真實 schema，再預覽寫入。這些指令同時也是交接用的 artifact。開發者能把同一組步驟貼到 terminal、測試 script 或 PR 說明中，而不必重建 Agent 擁有的 client session 裡發生了什麼。

```bash
dbcli blacklist list
dbcli schema <table> --format json
dbcli update <table> --where "<predicate>" --set '<json>' --dry-run
```

這不代表每一條本機 SELECT 都值得一套儀式。結果不會進入任何操作流程的可拋棄實驗，就用直接 client。只要 Agent 會碰到接近真實的資料、修改共享 fixture 或 migration、需要可重跑的答案，或工作很可能進到 CI、staging、production，就使用 dbcli。它的價值不在於讓本機開發神奇地安全，而在於清楚地把快速實驗轉換成可負責工作流的時機標示出來。

在最後一種情境中，`dbcli` 有四個實際優勢：

1. **操作者能審查並授權一次 invocation。** 指令本身是具體交付物：執行前，人可以檢查選用連線、操作與 flags。像 Claude Code 這類可依 CLI 參數授權的 host，可形成實用的權限梯度——安全的探索指令能預先授權，查詢與寫入仍保留審查。MCP 權限通常以 tool 名稱為邊界；是否有更細的參數層級政策，取決於 host 與 server。
2. **相同 guardrail 不依賴 Agent 仍會執行。** 權限分級、blacklist 檢查、結果筆數限制、schema 探索、dry-run 預檢與機器可讀輸出都在 CLI path 上。CI job 與 incident responder 可執行相同指令並得到同樣的防護，不必仰賴特定 editor 或 agent session。
3. **工作流會留下可操作的證據。** 在支援的指令使用 `--recovery`，可產生結構化失敗封包並連結到 audit 紀錄。Saved queries 與 task packs 是團隊可 version、review、重用的檔案，而不是只存在聊天紀錄中的指示。
4. **沒有 Agent 時工具仍可使用。** Terminal、Makefile、CI job 或 runbook 都能以有意義的 exit code 執行指令。因此 dbcli 是耐久的操作介面，而不只是 AI 整合。

例如，Agent 協助資料變更的安全基線，仍是一組人員或 CI 可重跑的步驟：

```bash
dbcli blacklist list
dbcli schema <table> --format json
dbcli update <table> --where "<predicate>" --set '<json>' --dry-run
```

當 MCP server 的對話式介面是主要價值，且它的授權、日誌與執行模型滿足環境需求時，使用 MCP。當風險允許以簡單性為優先時，使用直接 client。真正重要的是受治理、可審查的執行路徑，而非僅僅送出一條 query 的能力時，選擇 dbcli。

> **安全邊界：** dbcli 是 defence in depth，不是資料庫授權的替代品。給 Agent 的資料庫憑證必須遵循最小權限。能修改自己 dbcli 設定的 process 可以提高宣告權限或改用其他 client；blacklist 與 dry-run 單獨無法讓該憑證變得安全。

---

<!-- doc-key: developer-workflows -->
## 開發者工作流

除了臨時查詢，`dbcli` 也針對「開發任務中牽涉資料庫」的常見情境而設計。Agent skill（[`SKILL.md`](../../../assets/SKILL.md)）內建了精簡的流程路由；當你自己操作 `dbcli` 時同樣適用：

- **DB-backed 功能**：編輯程式碼前先把產品/程式語彙對應到真實資料物件（`inspect --for-agent` → `blacklist list` → `schema <object>` → `queries suggest <intent>`）。
- **應用程式資料錯誤**：分離資料庫事實與應用程式推論（`inspect --for-agent` → `audit tail --for-agent` → `schema <object>` → 最小查詢）。
- **ORM 或 migration**：用 cached schema 證據支撐 model 與 migration 修改（`schema --format json` → `diff --against-orm <orm-schema>` → 審查 error → dry-run `migrate` 提案 → 用擷取的 DDL 執行 `migration-review` → 套用後以 snapshot 驗證）。
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
| 「這份 ORM 定義跟 cached DB schema 一致嗎？」 | `skill tasks plan orm-drift-review --param orm_path=prisma/schema.prisma` | `orm-drift-review` |
| 「連線健康嗎?」 | `skill tasks plan connection-health` | `connection-health` |
| 「審這個動到 DB 的 PR」 | `skill tasks plan pr-database-review`;任何 DDL/index 想法先過 `migration-review` 再寫 | `pr-database-review` / `migration-review` |
| 「安全回填 X 欄位」 | `skill tasks plan safe-backfill-verify --param table=<t> --param query="<UPDATE>" --param verify_query="<SELECT count(*)>"` | `safe-backfill` / `safe-backfill-verify` |

Pack 解析順序為 **local > shared > builtin**:`assets/tasks/`(builtin)、`.dbcli-shared/tasks/`(團隊)、`.dbcli/tasks/`(本地覆寫)。計畫不會凌駕 blacklist、schema、dry-run 或確認要求——一次執行一步。

### B. 跨領域情境

- **多環境切換(v2)**:`dbcli use prod` 切換預設;`dbcli query --use staging "<SQL>"` 只覆寫單次呼叫。每個具名連線有**獨立的 schema cache**(`.dbcli/schemas/<conn>/`)——切換後先跑一次 `dbcli schema --use <name>`,否則可能讀到別的連線的欄位。(見 **連線管理**。)
- **CI 中用環境變數參照密鑰**:連線設定本來就存放在 home storage(`~/.config/dbcli/…`),不會寫進專案 `.dbcli/`。`dbcli init --use-env-refs` 更進一步,把憑證存成執行期解析的 `{ "$env": "VAR" }` 參照而非明文。非互動式執行時必須傳入全部五個 `--env-*` 旗標,否則 `init` 會直接報錯——絕不會默默退回明文。**MongoDB 是例外**:只有 `--env-host` 為必填,`--env-port` / `--env-user` / `--env-password` / `--env-database` 皆為選填,留空的欄位會寫入字面值(`user` / `password` 寫空字串,`port` / `database` 寫實際值)而非 `$env` 參照——避免一個使用者本來就不需要的欄位,日後因為指向未定義的環境變數而讓每個指令都 fail closed。此模式下 `init` 也不會執行連線測試(`$env` 參照此刻還沒有值可以連),無論是否帶 `--skip-test` 皆然。
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

當 `query` / `q` / `insert` / `update` / `delete` / `export` / `schema` / `inspect` / `lint` / `diff --against-orm` 帶 `--recovery` 失敗時，stdout 會輸出 `RecoveryEnvelope` JSON，並把同一份內容**原子寫入** `.dbcli/last-recovery.json`。Agent 隨後用 `dbcli recover` 檢視，或 `dbcli recover --apply` 自動執行（預設只跑 `readonly` + `dry-run` 步驟）。

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

有一種連線類別錯誤**不會**分支：語句因超過 statement timeout 被伺服器取消（PostgreSQL SQLSTATE `57014`、MySQL `3024`、MariaDB `1969`）。它回報為 `CONN_TIMEOUT`，並將 `details.connectionCode` 設為 `STATEMENT_TIMEOUT`，這個欄位就是它與真正連線逾時的分辨依據 — 連線是通的，因此計畫針對查詢本身（`dbcli lint`、`dbcli explain`，再以明確的 `--statement-timeout <ms>` 重跑），而不是去跑 `doctor`。因為步驟 1 不是 `doctor`，envelope 不會帶 `branches` 與 `branchFork`，也不會帶 `verify` — 這個錯誤除了重跑原語句沒有別的驗證方式，而原語句只有呼叫端有。三個步驟都帶 placeholder，因此 `dbcli recover --apply` 會回報 `skipped-only` 且不執行任何指令。

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

已分類的錯誤在巢狀 adapter 呼叫間會保留原始 code、message 與 hints，不再重複加上前綴。MySQL 8 的 schema introspection 也相容預設的 `ONLY_FULL_GROUP_BY` 模式。

當連線設定驗證失敗時，dbcli 會依該連線宣告的 `system` 對應到正確分支，逐一列出有問題的欄位路徑，
而不是丟出整包巢狀的 union error tree —— 讓壞掉的 `.dbcli` 可以直接照欄位修，不必猜是哪個引擎分支。

### 有界的 CLI 錯誤輸出

需要連線的探索與讀取指令失敗時會以 exit code `1` 結束，且錯誤只呈現一次。一般模式的 stderr
會輸出可讀訊息，以及存在時的穩定錯誤碼與可執行 hint；不會包含 JavaScript
stack、bundle 原始碼片段或 source-code frame。需要診斷資訊時，請在指令前加
`-v`（或 `-vv`）以顯示 stack——旗標必須放在子指令**之前**（`dbcli -v list`，
而不是 `dbcli list -v`）。寫入類指令（`insert`、`update`、`delete`）與 `q`
保留自己的在地化措辭，並同樣遵守這個 stack 開關。措辭依錯誤碼決定：只有真正的
傳輸層失敗（`ECONNREFUSED`、`ETIMEDOUT`、`AUTH_FAILED`、`ENOTFOUND`、
`EHOSTUNREACH`、`CONNECTION_LOST`、`TOO_MANY_CONNECTIONS`、`TLS_ERROR`、
`SERVER_NOT_READY`、`CONNECTION_REJECTED`）才會被說成
連線失敗——`TABLE_NOT_FOUND`、`STATEMENT_TIMEOUT` 這類語句層級的錯誤連得上伺服器，
因此以自己的身分連同 hint 一起回報，而不是「無法連接到資料庫」。支援
`--recovery` 的指令仍只在 stdout 輸出既有 JSON recovery envelope，並抑制
重複的人類可讀 stderr 訊息。

### 完整的 stdout 管線輸出

stdout 經過管線或重新導向時，`dbcli` 會在完整寫入後才結束。大型 JSON、
CSV 與 HTML 結果經過 `dbcli query --format json | jq ...` 或
`dbcli export ... | cat > result.json` 等指令時仍會保持完整；成功的退出狀態
不會代表只寫入部分 stdout buffer。

### Query-only auto-LIMIT 範圍

`dbcli` 會在 `query-only` 模式對 `SELECT` 自動加 `LIMIT 1000`。**不**套用於:

- `SHOW` / `DESCRIBE` 語句(LIMIT 在此非合法語法)
- `EXPLAIN` / `EXPLAIN ANALYZE` / MariaDB `ANALYZE SELECT`

查 `information_schema` 時用 `--no-limit` 關閉。

當上限由 dbcli 套用（query-only 預設值或明確的 `--limit N`）時，dbcli
會多取一筆作為 lookahead，藉此區分結果剛好 N 筆與實際還有更多資料。
被截斷的 table 輸出會以 `Rows: N (truncated; limit N)` 結尾。只要上限由
dbcli 套用，JSON 一律包含 `metadata.truncated` 與
`metadata.limit_applied`；只有 lookahead 證明還有下一筆時，`truncated`
才是 `true`。使用 `--no-limit`，或 SQL、MongoDB pipeline、Elasticsearch
request body 已自行指定上限時，這兩個欄位不會出現。CSV 會附加一行
`# truncated; limit N` 的註解。

透過 `dbcli q` 執行的已儲存 snippet 也用同樣方式回報。snippet 的 size
guard 本身就有 1000 筆上限，現在這個上限會出現在 footer 與 `metadata`
中，不再需要使用者從整數列數猜測。

`dbcli export` 不回報截斷——而是直接**拒絕**執行。當匯出的資料被
query-only auto-limit 截斷時，會以 exit code `1` 結束且不寫入檔案：

```text
Export would silently drop rows — 1000-row auto-limit reached.
  Re-run with --no-limit to export everything,
  or --limit 1000 to accept the cap explicitly.
```

匯出的檔案沒有地方能記錄資料被遺漏——`jsonl` 是一行一筆文件、MongoDB
的 `--format json` 則是裸陣列——而 stderr 警告在重導向後就會消失。
明確指定 `--no-limit` 或 `--limit N` 才能讓這個選擇變得明確，匯出才會
繼續進行。

### 有界的 table cell

`dbcli query` 的 table 輸出預設會將每個序列化後的 cell 限制為 120 個
Unicode code point。可用 `--truncate N` 設定其他正整數上限，或用
`--no-truncate` 顯示完整的 table cell；兩個旗標不可同時使用。

計算上限前會沿用既有的 cell 序列化規則：null 與 undefined 轉成空字串，
object 以 JSON 序列化，primitive 則使用其字串表示。序列化後的值超過上限
時，dbcli 會保留前 N 個 code point，並附加例如 `…(+3412 chars)` 的標記。
標記不計入保留值的 N 字元預算，數字則代表從序列化值省略的 Unicode code
point 數量。

此行為只屬於 table formatting，絕不修改查詢結果中的 rows，因此 JSON 與
CSV 輸出仍保持無損。若在 JSON、CSV 或 HTML 輸出（包含 `--ui`）明確傳入
`--truncate`，dbcli 會回報錯誤，而不會靜默忽略。

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
| `--no-schema` | 關閉 | 不讀取 schema 快取路徑；跳過純 schema 檢查，但保留靜態 `NOT IN` NULL 檢查。 |
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
| `not-in-nullable` | warn | `NOT IN` 右側為 NULL 或可能是 nullable：明確的 `NULL`、outer join 補出的 NULL、nullable subquery 投影，或已知可為 NULL 的 CASE／cast／aggregate 運算式。 |

`not-in-nullable` 專門描述 SQL 中右側「NULL 污染 `NOT IN`」的風險。
它會遞迴檢查投影、JOIN `ON`、`WHERE` 與 `HAVING`，且每個巢狀
SELECT／CTE／derived statement 都使用自己的 scope。當下 join 的
synthetic NULL 只會在該 join 的 `ON` 評估後套用；schema 宣告的
nullability 與更早完成的 join 仍會在 `ON` 內生效。左側欄位可為 NULL
並不屬於這條規則。若右側是 subquery，應以
`IS NOT NULL` 過濾其投影值；在 correlation 與語意合適時，也可考慮
`NOT EXISTS`。除非 correlation、型別、qualified-column 解析與 rewrite
目標都明確，dbcli 不會自動執行此 rewrite。若 subquery 以直接條件或
`AND` 組合對完全相同的投影運算式套用 `IS NOT NULL`，則不會回報；
aggregate 投影也會在 `HAVING` 套用同一證明。位於 `OR` 下或運算式
解析不明確時仍保守回報。

解析失敗時，九條規則都會列為 `blocked: parse failed`。使用
`--no-schema` 時會跳過 `implicit-cast`，並以 `blocked: --no-schema`
標記 `not-in-nullable` 無法執行的 schema 部分；明確 NULL 與其他結構上
已知的 RHS 風險仍會執行。分層快取不存在時，無法執行的 schema 檢查會列為
`blocked: schema cache unavailable (run dbcli schema)`。Finding 可包含
有 confidence 標籤的 SQL 草稿與 shell-safe 驗證指令。只有結構上已證明
唯讀且不含明確 function／table-function call 或 session assignment 的
SQL 才會使用 `dbcli explain --analyze`；其他語句會退回 plain
`dbcli explain`。若 identifier 經大小寫折疊後衝突，或 relation 是 CTE、
derived、schema-qualified 或 database-qualified binding，則不會套用
unqualified cache facts。兩種指令都只供回報參考，絕不會自動執行。

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
