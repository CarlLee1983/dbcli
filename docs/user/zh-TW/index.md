# dbcli 完整說明文件

<!-- doc-key: overview -->
`dbcli` 是一款專為人類開發者與 AI 代理（AI Agents）設計的高效能、安全優先的資料庫 CLI 工具。它為 SQL（PostgreSQL、MySQL）、NoSQL（MongoDB）、Key-Value（Redis）及 Search（Elasticsearch）資料庫提供統一的操作介面，具備權限存取控制、敏感資料黑名單及自動化診斷工作流等核心功能。

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
    *   [進階工具 (DDL, Shell, AI Skills)](#進階工具)
5.  [互動式 HTML 儀表板](#互動式-html-儀表板)
6.  [資料庫引擎支援矩陣](#資料庫引擎支援矩陣)
7.  [AI 代理整合與 Antigravity 協議](#ai-代理整合)
8.  [文件維護與覆蓋範圍](#文件維護與覆蓋範圍)

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
npm install -g @gravito/dbcli
# 或使用 Bun
bun install -g @gravito/dbcli
```

### 初始化連線
`init` 指令會引導你完成連線設定，它能自動解析現有的 `.env` 檔案。

```bash
dbcli init
```

**專家建議：** 使用 `--use-env-refs` 可將機密資訊保留在環境變數中，而非直接寫入設定檔，這對於 CI/CD 環境非常安全。

---

<!-- doc-key: connection-management -->
## 連線管理

`dbcli` 支援多連線配置 (v2)，讓你能在開發 (Local)、測試 (Staging) 與正式 (Production) 環境間切換自如。

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

<!-- doc-key: query-data-operations -->
### 查詢與資料操作

| 指令 | 說明 |
| :--- | :--- |
| `query "<cmd>"` | 執行原生 SQL、MongoDB JSON、Redis 指令或 ES DSL。 |
| `q @snippet` | 執行帶有參數的儲存查詢片段。 |
| `export` | 將結果匯出為 JSON, CSV, JSONL 或互動式 HTML。 |
| `insert` | 從 JSON 插入資料 (支援 SQL & MongoDB)。支援 `--plan` 風險預檢（SQL、MongoDB、Redis、Elasticsearch）。 |
| `update` | 更新資料，強制要求 `--where` 子句。支援 `--plan` 風險預檢（SQL、MongoDB、Redis、Elasticsearch）。 |
| `delete` | 刪除資料，強制要求 `--where` 子句。支援 `--plan` 風險預檢（SQL、MongoDB、Redis、Elasticsearch）。 |
| `blacklist` | 管理敏感資料屏蔽規則。 |
| `plan "<sql>"` | **靜態分析器**：對 SQL 進行風險分級並給出優化建議。 |

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
| `--recovery`（所有指令） | **Recovery ↔ Audit 雙向連結**：`query`、`inspect`、`insert`、`update`、`delete`、`export`、`q`、`schema` 失敗時都會寫入互相對應的 `audit.recovery_ref` ↔ `envelope.audit_ref` UUID；用 `audit tail --recovery-ref <id>` 從 envelope 反查 audit entry。|

<!-- doc-key: advanced-tools -->
### 進階工具

| 指令 | 說明 |
| :--- | :--- |
| `shell` | 啟動互動式 REPL，支援 Tab 自動補全與 SQL 高亮。 |
| `migrate <action>` | **DDL 引擎**：建立/修改/刪除資料表與索引。 |
| `skill --install` | 為 AI 代理安裝 `SKILL.md` 指引（Claude, Gemini 等）。 |
| `skill tasks` | 管理任務包 (Task Packs) — 專家級的可重複資料庫工作流。 |
| `completion` | 安裝 shell 自動補全 (bash/zsh/fish)。 |

---

<!-- doc-key: html-dashboards -->
## 互動式 HTML 儀表板

在查詢時加上 `--ui` 旗標，即可在瀏覽器中開啟精美的互動式 React 報表。

```bash
dbcli query "SELECT * FROM daily_metrics" --ui
```

**KPI 與圖表**：在 Snippet 的 Frontmatter 中加入 `visual:` 區塊，即可直接在儀表板中呈現自定義圖表（折線圖、長條圖、圓餅圖等）。

---

<!-- doc-key: engine-support -->
## 資料庫引擎支援矩陣

| 功能 | PostgreSQL/MySQL | MongoDB | Redis | Elasticsearch |
| :--- | :---: | :---: | :---: | :---: |
| 基礎查詢 | ✅ | ✅ | ✅ | ✅ |
| Schema 快取 | ✅ | ⚠️ (採樣) | ❌ | ✅ |
| 儲存 Snippets | ✅ | ❌ | ✅ | ✅ |
| 寫入操作 (DML) | ✅ | ✅ | ✅ (透過 query) | ❌ |
| 結構變更 (DDL) | ✅ | ❌ | ❌ | ❌ |
| 互動式 UI | ✅ | ✅ | ✅ | ✅ |

---

<!-- doc-key: ai-agent-integration -->
## AI 代理整合

`dbcli` 從底層就是為了成為 AI 代理的「資料庫驅動程式」而設計的。

1.  **SKILL.md**：透過 `dbcli skill` 提供 AI 指引，讓代理知道安全的指令路徑。
2.  **修復封包 (Recovery Envelopes)**：當指令失敗時，使用 `--recovery` 獲得機器可讀的 JSON 錯誤及修復建議。
3.  **風險控制**：AI 代理會主動使用 `dbcli plan`、`insert`/`update`/`delete` 的 `--plan` 預檢與 `--dry-run` 來驗證其行為。
4.  **上下文效率**：`inspect --for-agent` 提供精簡的元資料，防止 AI 上下文視窗過載。
5.  **稽核日誌 (Audit Log)**：詳見 [`SKILL.md`](../../../assets/SKILL.md) / [`README §Audit Log`](../../../README.md#audit-log)。

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
