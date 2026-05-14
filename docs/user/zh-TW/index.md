# dbcli 完整說明文件

`dbcli` 是一款專為人類開發者與 AI 代理（AI Agents）設計的高效能、安全優先的資料庫 CLI 工具。它為 SQL（PostgreSQL、MySQL）、NoSQL（MongoDB）、Key-Value（Redis）及 Search（Elasticsearch）資料庫提供統一的操作介面，具備權限存取控制、敏感資料黑名單及自動化診斷工作流等核心功能。

---

## 📖 目錄

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

---

## 🛡️ 核心理念與安全性

`dbcli` 的設計初衷是「安全第一」，特別專注於防止 AI 代理在操作過程中意外洩漏或損壞敏感資料。

*   **權限守衛 (Permission Guard)**：提供四層存取控制（`query-only`、`read-write`、`data-admin`、`admin`）。
*   **黑名單管理器 (Blacklist Manager)**：從所有查詢結果中自動屏蔽敏感資料表與欄位。
*   **查詢風險分析器 (`plan`)**：在不連線資料庫的情況下分析 SQL 風險。
*   **Antigravity 協議**：將工作流程拆分為 **Architect (架構師/規劃)** 與 **Builder (建設者/執行)**，確保行動前必有策略。

---

## 🚀 快速入門

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

## 🔌 連線管理

`dbcli` 支援多連線配置 (v2)，讓你能在開發 (Local)、測試 (Staging) 與正式 (Production) 環境間切換自如。

*   **列出所有連線**：`dbcli use --list`
*   **切換預設連線**：`dbcli use <name>`
*   **單次執行覆蓋**：在任何指令後加上 `--use <name>` 參數。
    ```bash
    dbcli query --use staging "SELECT 1"
    ```

---

## 🛠️ 指令詳解

### 探索與發現

| 指令 | 說明 |
| :--- | :--- |
| `list` | 列出資料表、集合 (Collections)、鍵 (Keys) 或索引。 |
| `schema [table]` | 顯示特定物件的結構，或掃描整個資料庫並快取元資料。 |
| `inspect` | 為 AI 代理提供唯讀的上下文快照（物件、權限、指令建議）。 |
| `status` | 顯示目前配置的安全摘要（不含機密資訊）。 |

### 查詢與資料操作

| 指令 | 說明 |
| :--- | :--- |
| `query "<cmd>"` | 執行原生 SQL、MongoDB JSON、Redis 指令或 ES DSL。 |
| `q @snippet` | 執行帶有參數的儲存查詢片段。 |
| `export` | 將結果匯出為 JSON, CSV, JSONL 或互動式 HTML。 |
| `insert` | 從 JSON 插入資料 (支援 SQL & MongoDB)。 |
| `update` | 更新資料，強制要求 `--where` 子句。 |
| `delete` | 刪除資料，強制要求 `--where` 子句。 |
| `blacklist` | 管理敏感資料屏蔽規則。 |
| `plan "<sql>"` | **靜態分析器**：對 SQL 進行風險分級並給出優化建議。 |

### Snippet 管理

儲存的查詢 (Snippets) 讓你能在 Repo 中維護複雜的 SQL。解析優先序為：**Local > Shared > Builtin**。

*   **列出 Snippets**：`dbcli queries list`
*   **關鍵字搜尋**：`dbcli queries search <text>`
*   **意圖建議**：`dbcli queries suggest perf`
*   **建立本地 Snippet**：`dbcli queries new @my/query --local`

### 健康度、診斷與修復

| 指令 | 說明 |
| :--- | :--- |
| `doctor` | 執行環境與連線診斷。 |
| `check [table]` | 分析資料健康度（如孤兒資料、空值、重複項）。 |
| `diff` | 比較 Schema 快照以偵測結構變動。 |
| `report` | 產生完整的健康、容量與效能報告。 |
| `guide <goal>` | 產生特定目標的引導計畫（如：`slow-query`）。 |
| `recover --apply` | **自動化修復**：自動執行上次建議的故障修復計畫。 |

### 進階工具

| 指令 | 說明 |
| :--- | :--- |
| `shell` | 啟動互動式 REPL，支援 Tab 自動補全與 SQL 高亮。 |
| `migrate <action>` | **DDL 引擎**：建立/修改/刪除資料表與索引。 |
| `skill --install` | 為 AI 代理安裝 `SKILL.md` 指引（Claude, Gemini 等）。 |
| `skill tasks` | 管理任務包 (Task Packs) — 專家級的可重複資料庫工作流。 |
| `completion` | 安裝 shell 自動補全 (bash/zsh/fish)。 |

---

## 📊 互動式 HTML 儀表板

在查詢時加上 `--ui` 旗標，即可在瀏覽器中開啟精美的互動式 React 報表。

```bash
dbcli query "SELECT * FROM daily_metrics" --ui
```

**KPI 與圖表**：在 Snippet 的 Frontmatter 中加入 `visual:` 區塊，即可直接在儀表板中呈現自定義圖表（折線圖、長條圖、圓餅圖等）。

---

## 🗺️ 資料庫引擎支援矩陣

| 功能 | PostgreSQL/MySQL | MongoDB | Redis | Elasticsearch |
| :--- | :---: | :---: | :---: | :---: |
| 基礎查詢 | ✅ | ✅ | ✅ | ✅ |
| Schema 快取 | ✅ | ⚠️ (採樣) | ❌ | ✅ |
| 儲存 Snippets | ✅ | ❌ | ✅ | ✅ |
| 寫入操作 (DML) | ✅ | ✅ | ✅ (透過 query) | ❌ |
| 結構變更 (DDL) | ✅ | ❌ | ❌ | ❌ |
| 互動式 UI | ✅ | ✅ | ✅ | ✅ |

---

## 🤖 AI 代理整合

`dbcli` 從底層就是為了成為 AI 代理的「資料庫驅動程式」而設計的。

1.  **SKILL.md**：透過 `dbcli skill` 提供 AI 指引，讓代理知道安全的指令路徑。
2.  **修復封包 (Recovery Envelopes)**：當指令失敗時，使用 `--recovery` 獲得機器可讀的 JSON 錯誤及修復建議。
3.  **風險控制**：AI 代理會主動使用 `dbcli plan` 與 `--dry-run` 來驗證其行為。
4.  **上下文效率**：`inspect --for-agent` 提供精簡的元資料，防止 AI 上下文視窗過載。

---

*由 Dbcli 文件引擎自動產生。*
