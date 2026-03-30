# dbcli — 為 AI 代理設計的資料庫 CLI

**語言：** [English](./README.md) | [繁體中文](./README.zh-TW.md)

統一的資料庫 CLI 工具，讓 AI 代理（Claude Code、Gemini、Copilot、Cursor）能安全地查詢、探索與操作資料庫。

**核心價值：** AI 代理可透過單一、具權限控管的 CLI 工具，在敏感資料保護下安全且智慧地存取專案資料庫。

## 國際化（i18n）

dbcli 透過環境變數 `DBCLI_LANG` 支援多語系：

```bash
# 英文（預設）
dbcli init

# 繁體中文
DBCLI_LANG=zh-TW dbcli init

# 或在 .env 中設定
export DBCLI_LANG=zh-TW
dbcli init
```

**支援語言：**
- `en` — English（預設）
- `zh-TW` — 繁體中文（台灣）

所有訊息、說明文字、錯誤訊息與指令輸出會依語言設定自動切換。


## 快速開始

### 安裝

#### 全域安裝（建議）

```bash
npm install -g @carllee1983/dbcli
```

#### 免安裝（無需事先安裝）

```bash
npx @carllee1983/dbcli init
npx @carllee1983/dbcli query "SELECT * FROM users"
```

#### 更新

```bash
# 自我更新（建議）
dbcli upgrade

# 或透過 npm
npm update -g @carllee1983/dbcli
```

#### 開發安裝

```bash
git clone <repository>
cd dbcli
bun install
bun run dev -- --help
```

### 第一步

```bash
# 以資料庫連線初始化專案
dbcli init

# 列出可用資料表
dbcli list

# 檢視資料表結構
dbcli schema users

# 查詢資料
dbcli query "SELECT * FROM users"

# 產生 AI 代理 skill
dbcli skill --install claude
```

---

## API 參考

### 指令

#### `dbcli init`

以資料庫連線設定初始化新的 dbcli 專案。

**用法：**
```bash
dbcli init [OPTIONS]
```

**選項：**
- `--system <type>` — 資料庫系統：`postgresql`、`mysql`、`mariadb`
- `--host <host>` — 主機
- `--port <port>` — 埠號
- `--user <user>` — 使用者
- `--password <pass>` — 密碼
- `--name <db>` — 資料庫名稱
- `--permission <level>` — 權限等級：`query-only`、`read-write`、`data-admin`、`admin`
- `--use-env-refs` — 在設定檔中儲存環境變數名稱參照，而非實際值
- `--env-host <var>` — 主機對應的環境變數名（搭配 `--use-env-refs`）
- `--env-port <var>` — 埠號
- `--env-user <var>` — 使用者
- `--env-password <var>` — 密碼
- `--env-database <var>` — 資料庫名稱
- `--skip-test` — 略過連線測試
- `--no-interactive` — 非互動模式（須提供所有必要選項）
- `--force` — 覆寫既有設定且不詢問確認

**行為：**
- 若存在 `.env` 會讀取（自動帶入 DATABASE_URL、DB_* 等變數）
- 缺少的欄位會互動提示（主機、埠、使用者、密碼、資料庫名、權限等級）
- 在專案根目錄建立 `.dbcli` JSON 設定檔
- 儲存前會測試資料庫連線

**範例：**
```bash
# 互動式初始化
dbcli init

# 預先設定環境變數
export DATABASE_URL="postgresql://user:pass@localhost/mydb"
dbcli init

# 指定權限等級
echo "PERMISSION_LEVEL=admin" >> .env && dbcli init

# 儲存環境變數參照（互動）
dbcli init --use-env-refs

# 儲存環境變數參照（非互動）
dbcli init --use-env-refs --system mysql \
  --env-host DB_HOST --env-port DB_PORT \
  --env-user DB_USER --env-password DB_PASSWORD \
  --env-database DB_DATABASE \
  --no-interactive
```

> **`--use-env-refs`：** 啟用後，設定檔會儲存環境變數名稱（例如 `{"$env": "DB_HOST"}`）而非實際值，避免將憑證寫入檔案，適合多環境與 CI/CD。連線時 dbcli 會自動從對應環境變數讀取實際值。

---

#### `dbcli list`

列出已連線資料庫中的所有資料表。

**用法：**
```bash
dbcli list [OPTIONS]
```

**選項：**
- `--format json` — 以 JSON 輸出，而非 ASCII 表格

**範例：**
```bash
# 表格（人類可讀）
dbcli list

# JSON（供 AI 解析）
dbcli list --format json

# 串接工具
dbcli list --format json | jq '.data[].name'
```

---

#### `dbcli schema [table]`

顯示資料表結構（欄位、型別、限制、外鍵）。

**用法：**
```bash
dbcli schema [table]
dbcli schema                 # 掃描整個資料庫並更新 .dbcli
dbcli schema users           # 顯示 `users` 表結構
```

**選項：**
- `--format json` — JSON 輸出
- `--refresh` — 偵測並增量更新 schema 變更（需 `--force` 核准）
- `--reset` — 清除既有 schema 並自資料庫重新抓取（切換連線後適用）
- `--force` — 重新整理／覆寫／重置時略過確認

**範例：**
```bash
# 顯示 users 表結構
dbcli schema users

# JSON 與完整中繼資料
dbcli schema users --format json

# 增量更新 schema（新表等）
dbcli schema --refresh --force

# 清空後全量重抓（切換 DB 後）
dbcli schema --reset --force

# 掃描整個資料庫
dbcli schema
```

---

#### `dbcli query "SQL"`

執行 SQL 查詢並回傳結果。

**用法：**
```bash
dbcli query "SELECT * FROM users"
```

**選項：**
- `--format json|table|csv` — 輸出格式（預設：table）
- `--output file` — 寫入檔案而非 stdout

**行為：**
- 依權限限制操作（Query-only 會阻擋 INSERT/UPDATE/DELETE）
- Query-only 模式自動限制最多 1000 列（並顯示提示）
- 回傳含中繼資料的結構化結果（列數、執行時間等）

**範例：**
```bash
# 表格輸出
dbcli query "SELECT * FROM users"

# JSON
dbcli query "SELECT * FROM users" --format json

# 匯出 CSV
dbcli query "SELECT * FROM users" --format csv --output users.csv

# 串接其他工具
dbcli query "SELECT * FROM products" --format json | jq '.data[] | .name'

# 大量結果（以 LIMIT/OFFSET 分頁）
dbcli query "SELECT * FROM users LIMIT 100 OFFSET 0"
```

---

#### `dbcli insert [table]`（需要 Read-Write 或 Admin 權限）

插入資料列。

**用法：**
```bash
dbcli insert users --data '{"name": "Alice", "email": "alice@example.com"}'
```

**選項：**
- `--data JSON` — 資料列 JSON 物件（**必填**）
- `--dry-run` — 僅顯示 SQL，不執行
- `--force` — 略過確認

**行為：**
- 驗證 JSON 格式
- 產生參數化 SQL（降低 SQL 注入風險）
- 插入前顯示確認（除非使用 `--force`）

**範例：**
```bash
# 插入一列
dbcli insert users --data '{"name": "Bob", "email": "bob@example.com"}'

# 預覽 SQL
dbcli insert users --data '{"name": "Charlie"}' --dry-run

# 略過確認
dbcli insert users --data '{"name": "Diana"}' --force
```

---

#### `dbcli update [table]`（需要 Read-Write 或 Admin 權限）

更新既有資料列。

**用法：**
```bash
dbcli update users --where "id=1" --set '{"name": "Alice Updated"}'
```

**選項：**
- `--where condition` — WHERE 條件（**必填**，例如 `"id=1 AND status='active'"`）
- `--set JSON` — 要更新的欄位 JSON（**必填**）
- `--dry-run` — 僅顯示 SQL
- `--force` — 略過確認

**範例：**
```bash
# 更新單列
dbcli update users --where "id=1" --set '{"name": "Alice"}'

# 更新多列
dbcli update users --where "status='inactive'" --set '{"status":"active"}'

# 預覽 SQL
dbcli update users --where "id=1" --set '{"name": "Bob"}' --dry-run

# 略過確認
dbcli update users --where "id=2" --set '{"email": "new@example.com"}' --force
```

---

#### `dbcli delete [table]`（僅 Admin 權限）

刪除資料列（僅管理員，安全考量）。

**用法：**
```bash
dbcli delete users --where "id=1" --force
```

**選項：**
- `--where condition` — WHERE 條件（**必填**）
- `--dry-run` — 僅顯示 SQL
- `--force` — 實際刪除時必填（安全閘門）

**範例：**
```bash
# 刪除單列（須 `--force`）
dbcli delete users --where "id=1" --force

# 預覽刪除
dbcli delete products --where "status='deprecated'" --dry-run

# 刪除多列
dbcli delete orders --where "created_at < '2020-01-01'" --force
```

---

#### `dbcli export "SQL"`

將查詢結果匯出至檔案。

**用法：**
```bash
dbcli export "SELECT * FROM users" --format json --output users.json
```

**選項：**
- `--format json|csv` — 輸出格式
- `--output file` — 寫入檔案（預設 stdout 供管道使用）

**行為：**
- Query-only 權限下每次匯出最多 1000 列
- 產生符合 RFC 4180 的 CSV
- 產生結構良好的 JSON 陣列

**範例：**
```bash
# 匯出 JSON
dbcli export "SELECT * FROM users" --format json --output users.json

# 匯出 CSV
dbcli export "SELECT * FROM orders" --format csv --output orders.csv

# 管道壓縮
dbcli export "SELECT * FROM products" --format csv | gzip > products.csv.gz

# 搭配 jq
dbcli export "SELECT * FROM users WHERE active=true" --format json | jq '.data | length'
```

---

#### `dbcli skill`

產生或安裝 AI 代理 skill 說明文件。

**用法：**
```bash
dbcli skill                           # 輸出至 stdout
dbcli skill --output SKILL.md         # 寫入檔案
dbcli skill --install claude          # 安裝至 Claude Code 設定
dbcli skill --install gemini          # 安裝至 Gemini CLI
dbcli skill --install copilot         # 安裝至 GitHub Copilot
dbcli skill --install cursor          # 安裝至 Cursor IDE
```

**行為：**
- 依 CLI 內省動態產生 SKILL.md
- 依權限等級過濾指令（Query-only 會隱藏寫入類指令）
- 支援 stdout、檔案、各平台安裝等輸出方式

**範例：**
```bash
# 為 Claude Code 產生 skill
dbcli skill --install claude

# 手動產生文件
dbcli skill > ./docs/SKILL.md

# 檢視產生的 skill（stdout）
dbcli skill

# 為多平台安裝
dbcli skill --install claude && \
dbcli skill --install gemini && \
dbcli skill --install copilot && \
dbcli skill --install cursor
```

---

#### `dbcli blacklist`

管理資料存取黑名單，阻擋 AI 代理存取敏感資料表或欄位。

**用法：**
```bash
dbcli blacklist list
dbcli blacklist table add <table>
dbcli blacklist table remove <table>
dbcli blacklist column add <table>.<column>
dbcli blacklist column remove <table>.<column>
```

**子指令：**

| 子指令 | 說明 |
|--------|------|
| `dbcli blacklist list` | 顯示目前黑名單（表與欄位） |
| `dbcli blacklist table add <table>` | 將表加入黑名單（阻擋所有操作） |
| `dbcli blacklist table remove <table>` | 從黑名單移除表 |
| `dbcli blacklist column add <table>.<column>` | 將欄位加入黑名單（SELECT 結果中省略） |
| `dbcli blacklist column remove <table>.<column>` | 從黑名單移除欄位 |

**行為：**
- 表黑名單會阻擋該表所有操作（query、insert、update、delete）
- 欄位黑名單會從 SELECT 結果中靜默省略欄位，並顯示安全通知
- 規則存在 `.dbcli`，適用於所有權限等級
- 管理員可透過環境變數 `DBCLI_OVERRIDE_BLACKLIST=true` 覆蓋

**範例：**
```bash
# 檢視黑名單
dbcli blacklist list

# 封鎖敏感表
dbcli blacklist table add audit_logs
dbcli blacklist table add secrets_vault

# 在查詢結果中隱藏敏感欄位
dbcli blacklist column add users.password_hash
dbcli blacklist column add users.ssn

# 移除表黑名單
dbcli blacklist table remove audit_logs

# 移除欄位黑名單
dbcli blacklist column remove users.ssn

# 覆蓋黑名單（僅管理用途）
DBCLI_OVERRIDE_BLACKLIST=true dbcli query "SELECT * FROM secrets_vault"
```

---

#### `dbcli doctor`

對環境、設定、連線與資料執行診斷檢查。

```bash
dbcli doctor                    # 彩色文字輸出
dbcli doctor --format json      # JSON 輸出（供 AI 代理）
```

**檢查項目：**
- **環境：** Bun 版本相容性、dbcli 版本（與 npm registry 比對）
- **設定：** 設定檔是否存在／有效、權限等級、黑名單完整性
- **連線與資料：** 資料庫連線、schema 快取新鮮度（超過 7 天警告）、大表警告（超過 100 萬列）

**選項：** `--format <text|json>`  
**結束代碼：** 0 = 全部通過或僅警告，1 = 有錯誤

---

#### `dbcli completion [shell]`

產生 shell 自動補全腳本。

```bash
dbcli completion bash            # bash 補全輸出至 stdout
dbcli completion zsh             # zsh
dbcli completion fish            # fish
dbcli completion --install       # 自動偵測 shell 並寫入 rc
dbcli completion --install zsh   # 指定 shell 安裝
```

**支援 shell：** bash、zsh、fish

---

#### `dbcli upgrade`

檢查更新並自我升級 dbcli。

```bash
dbcli upgrade                   # 有新版則升級
dbcli upgrade --check           # 僅檢查，不安裝
```

**選項：** `--check` — 只檢查，不安裝  
**背景檢查：** dbcli 每 24 小時會靜默查詢 npm registry 一次；若有新版，會在指令輸出結束後顯示提示。

#### `dbcli shell`

互動式資料庫 shell：執行 SQL、自動補全、語法高亮。

**用法：**
```bash
dbcli shell          # 互動模式（SQL + dbcli 指令）
dbcli shell --sql    # 僅 SQL 模式
```

**Shell 內：**
- 以 `;` 結尾的 SQL 會執行
- 可輸入 dbcli 子指令且不需 `dbcli` 前綴（例如 `schema users`、`list`）
- Tab 可觸發情境式補全（SQL 關鍵字、表／欄位名）
- `.help` 可查看 meta 指令（`.quit`、`.clear`、`.format`、`.history`、`.timing`）
- 多行 SQL：輸入會累積直到出現 `;`
- 歷史記錄跨工作階段保存在 `~/.dbcli_history`

**權限：** 繼承設定檔；SQL 與子指令皆受權限／黑名單約束。

#### `dbcli migrate`

Schema DDL 操作。**所有子指令預設為 dry-run** — 實際執行 SQL 請加 `--execute`。

**用法：**
```bash
# 建立表
dbcli migrate create posts \
  --column "id:serial:pk" \
  --column "title:varchar(200):not-null" \
  --column "body:text" \
  --column "created_at:timestamp:default=now()"

# 執行（真正跑 SQL）
dbcli migrate create posts --column "id:serial:pk" --execute

# 刪表（破壞性 — 需 `--execute --force`）
dbcli migrate drop posts --execute --force

# 欄位操作
dbcli migrate add-column users bio text --nullable --execute
dbcli migrate alter-column users name --type "varchar(200)" --execute
dbcli migrate alter-column users email --rename user_email --execute
dbcli migrate drop-column users temp_field --execute --force

# 索引
dbcli migrate add-index users --columns email --unique --execute
dbcli migrate drop-index idx_users_email --table users --execute --force

# 限制條件
dbcli migrate add-constraint orders --fk user_id --references users.id --on-delete cascade --execute
dbcli migrate add-constraint users --unique email --execute
dbcli migrate add-constraint users --check "age >= 0" --execute
dbcli migrate drop-constraint orders fk_orders_user_id --execute --force

# 列舉型別（僅 PostgreSQL）
dbcli migrate add-enum status active inactive suspended --execute
dbcli migrate alter-enum status --add-value archived --execute
dbcli migrate drop-enum status --execute --force
```

**欄位規格格式：** `name:type[:modifier...]` — 修飾子：`pk`、`not-null`、`unique`、`auto-increment`、`default=<value>`、`references=<table>.<column>`

**選項（各子指令）：** `--execute`（執行 SQL）、`--force`（DROP 時略過確認）、`--config <path>`  
**權限：** 僅 admin

---

## 全域選項

所有指令皆支援下列全域選項：

| 旗標 | 說明 |
|------|------|
| `--config <path>` | `.dbcli` 設定檔路徑（預設：`.dbcli`） |
| `-v, --verbose` | 提高詳細度（`-v` 詳細、`-vv` 除錯） |
| `-q, --quiet` | 抑制非必要輸出 |
| `--no-color` | 關閉彩色輸出（亦遵守 `NO_COLOR` 環境變數） |

---

## 權限模型

dbcli 採用粗粒度權限系統，共四個等級。權限在 `dbcli init` 時設定並存於 `.dbcli`。黑名單與權限並行，針對敏感表與欄位提供細部保護（見[資料存取控制](#資料存取控制)）。

### 權限等級

| 等級 | 允許的指令 | 阻擋的指令 | 適用情境 |
|------|------------|------------|----------|
| **Query-only** | `init`、`list`、`schema`、`query`、`export`（最多 1000 列） | `insert`、`update`、`delete`、`migrate` | 唯讀 AI 代理、分析、報表 |
| **Read-Write** | 另含 `insert`、`update` | `delete`、`migrate` | 應用開發、內容管理 |
| **Data-Admin** | 另含 `delete` | `migrate` | 完整 DML，無 DDL |
| **Admin** | 含 `migrate`（DDL）在內的全部指令 | — | DBA、結構變更 |

### 設定

權限在初始化時設定：

```bash
dbcli init
# 提示：「Permission level? (query-only / read-write / admin)」
# 儲存於 ~/.dbcli： "permissionLevel": "query-only"
```

### 依權限的範例

#### Query-only 模式（AI 代理）
```bash
# 允許：讀取
dbcli query "SELECT * FROM users"
dbcli schema users
dbcli export "SELECT * FROM orders" --format json

# 阻擋：寫入
dbcli insert users --data '{...}'  # 錯誤：權限不足
dbcli delete users --where "id=1"  # 錯誤：權限不足
```

#### Read-Write 模式（應用開發者）
```bash
# 允許：讀寫
dbcli query "SELECT * FROM users"
dbcli insert users --data '{"name": "Alice"}'
dbcli update users --where "id=1" --set '{"name": "Bob"}'

# 阻擋：刪除（安全設計）
dbcli delete users --where "id=1"  # 錯誤：僅 Admin
```

#### Admin 模式（資料庫管理員）
```bash
# 允許：含 DDL 在內的全部操作
dbcli query "SELECT * FROM users"
dbcli insert users --data '{"name": "Eve"}'
dbcli update users --where "id=1" --set '{"status": "active"}'
dbcli delete users --where "id=1" --force  # Data-Admin 以上可刪除
dbcli migrate create posts --column "id:serial:pk" --execute  # 僅 Admin
```

### 最佳實踐

- **AI 代理：** 唯讀情境使用 Query-only，降低誤刪／誤改風險
- **應用程式：** 一般 CRUD 使用 Read-Write，避免誤執行 DROP TABLE
- **維運：** 僅在結構變更、大量刪除或緊急處理時使用 Admin
- **最小權限：** 依實際需求給予最低足夠的權限等級

---

## 資料存取控制

黑名單與權限模型搭配，防止 AI 代理存取敏感表或欄位，不受其權限等級影響。

### 表層級黑名單

封鎖表後，查詢、插入、更新、刪除皆會被拒絕，並顯示明確錯誤。

```bash
dbcli blacklist table add secrets_vault

dbcli query "SELECT * FROM secrets_vault"
# 錯誤：表 'secrets_vault' 已列入黑名單
```

### 欄位層級黑名單

黑名單欄位會從 SELECT 結果中省略，輸出中會附安全通知，讓代理知道結果已被過濾。

```bash
dbcli blacklist column add users.password_hash
dbcli blacklist column add users.ssn

dbcli query "SELECT * FROM users"
# [Security] Columns omitted by blacklist: password_hash, ssn
```

### 安全通知

當黑名單過濾查詢輸出時，dbcli 會在結果中附加通知列，避免代理在不知情下依不完整資料決策。

### 以環境變數覆蓋

管理員可在緊急或維護時以 `DBCLI_OVERRIDE_BLACKLIST=true` 略過黑名單：

```bash
DBCLI_OVERRIDE_BLACKLIST=true dbcli query "SELECT * FROM secrets_vault"
```

此覆蓋會被記錄，僅應在必要時由管理員使用。

### 黑名單設定

規則存於 `.dbcli`，亦可手動編輯：

```json
{
  "blacklist": {
    "tables": ["audit_logs", "secrets_vault"],
    "columns": {
      "users": ["password_hash", "ssn"]
    }
  }
}
```

### 黑名單與權限的關係

兩者互補：

| 層級 | 控制內容 | 作用範圍 |
|------|----------|----------|
| **權限模型** | 操作類型（讀／寫／刪） | 所有表 |
| **黑名單** | 特定表與欄位 | 敏感資料 |

Query-only 代理無法寫入任何表，也無法讀取黑名單表或欄位 — 兩層限制同時生效。

---

## AI 整合指南

dbcli 可產生供 AI 使用的 skill 文件，並可整合至常見 AI 開發工具。

### 快速開始

為慣用平台產生 skill：

```bash
# Claude Code（Anthropic VS Code 擴充）
dbcli skill --install claude

# Gemini CLI（Google 命令列 AI）
dbcli skill --install gemini

# GitHub Copilot CLI
dbcli skill --install copilot

# Cursor IDE
dbcli skill --install cursor
```

安裝後，AI 可依你的權限等級使用 dbcli 查詢、插入、更新或匯出資料。

### 各平台設定

#### Claude Code（Anthropic）

1. 全域安裝 dbcli：`npm install -g @carllee1983/dbcli`
2. 初始化：`dbcli init`（選擇權限等級）
3. 安裝 skill：`dbcli skill --install claude`
4. 重新啟動 Claude Code 擴充
5. 在對話中詢問：「顯示資料庫 schema」或「查詢作用中使用者」

**Skill 路徑：** `~/.claude/skills/SKILL.md`

---

#### Gemini CLI（Google）

1. 全域安裝：`npm install -g @carllee1983/dbcli`
2. 初始化：`dbcli init`
3. 安裝 skill：`dbcli skill --install gemini`
4. 啟動 Gemini：`gemini start`
5. 在對話中請求：「查詢 users 表」或「列出資料庫資料表」

**Skill 路徑：** `~/.local/share/gemini/skills/`（Linux）或各平台對應路徑

---

#### GitHub Copilot CLI

1. 全域安裝：`npm install -g @carllee1983/dbcli`
2. 初始化：`dbcli init`
3. 安裝 skill：`dbcli skill --install copilot`
4. 安裝 Copilot CLI：`npm install -g @github-next/github-copilot-cli`
5. 使用 `copilot --help` 並探索與 dbcli 的整合

**Skill 路徑：** 依 Copilot 設定而定

---

#### Cursor IDE

1. 全域安裝：`npm install -g @carllee1983/dbcli`
2. 初始化：`dbcli init`
3. 安裝 skill：`dbcli skill --install cursor`
4. 開啟 Cursor
5. 在 Composer 中：「新增一筆使用者」或「匯出使用者資料」

**Skill 路徑：** `~/.cursor/skills/`

---

### 範例：AI 代理工作流程

**情境：** 希望 AI 分析使用者參與度。

```bash
# 1. 安裝並初始化
npm install -g @carllee1983/dbcli
dbcli init  # 選擇「query-only」較安全

# 2. 為 Claude Code 安裝 skill
dbcli skill --install claude

# 3. 在 Claude Code 對話中：
# 「分析最近 7 天的使用者活動並摘要重點」

# Claude Code 可能會：
# - 使用：dbcli schema users、dbcli query "SELECT ..."
# - 解析 JSON 輸出
# - 提供分析
```

### 重新整理 Skill

權限或設定變更後，可重新產生 skill：

```bash
# 例如將 ~/.dbcli 中 permissionLevel 改為 admin
dbcli skill  # 會顯示 delete 與 migrate 等指令

# 再安裝一次以更新 AI 平台
dbcli skill --install claude
```

---

## 故障排除

### 連線問題

#### 「ECONNREFUSED: Connection refused」

資料庫未執行或主機／埠錯誤。

**處理方式：**

```bash
# 確認資料庫是否在跑
psql --version   # PostgreSQL
mysql --version  # MySQL

# 檢查連線字串
dbcli init  # 重新初始化以確認憑證

# 命令列測試主機／埠
psql -h localhost -U postgres
mysql -h 127.0.0.1 -u root
```

#### 「ENOTFOUND: getaddrinfo ENOTFOUND hostname」

主機名稱無法解析（拼字錯誤或 DNS 問題）。

**處理方式：**

```bash
# 檢查 .dbcli 中的 host
cat ~/.dbcli | grep host

# 測試 DNS
ping your-hostname.com

# 若仍有問題可改試 127.0.0.1
dbcli init
```

---

### 權限錯誤

#### 「Permission denied: INSERT requires Read-Write or Admin」

在 Query-only 下嘗試寫入。

**處理方式：** 以較高權限重新初始化：

```bash
rm ~/.dbcli
dbcli init  # 選擇 read-write 或 admin
```

#### 「Permission denied: DELETE requires Admin」

僅 Admin 可刪除列（安全設計）。

**處理方式：** 以 Admin 重新初始化，或洽管理員。

```bash
dbcli init  # 選擇 admin
dbcli delete users --where "id=1" --force
```

---

### 查詢錯誤

#### 「Table not found: users」

表不存在或名稱拼錯。

**處理方式：**

```bash
dbcli list
dbcli query "SELECT * FROM user" --format json
```

#### 「Syntax error near SELECT」

SQL 語法錯誤。

**處理方式：**

```bash
# 先在原生用戶端測試
psql  # 或 mysql

# 再在 dbcli 使用
dbcli query "SELECT * FROM users"
```

---

### 效能問題

#### 「查詢只回傳 1000 列而非完整結果」

Query-only 會自動限制列數以策安全。

**處理方式：** 提高權限或分段抓取：

```bash
dbcli init  # read-write 或 admin

# 或分塊查詢
dbcli query "SELECT * FROM users LIMIT 100 OFFSET 0"
dbcli query "SELECT * FROM users LIMIT 100 OFFSET 100"
```

#### 「第一次執行 CLI 超過 30 秒」

npx 正在下載並快取套件。

**處理方式：** 首次較慢屬正常，之後會很快：

```bash
npx @carllee1983/dbcli init   # 首次約 30s
npx @carllee1983/dbcli init   # 之後 <1s

# 或全域安裝
npm install -g @carllee1983/dbcli
dbcli init
```

---

### 跨平台問題

#### Windows：「Command not found: dbcli」

npm 未建立 .cmd 或 PATH 未更新。

**處理方式：**

```bash
# 重開終端機以更新 PATH
# 或重新全域安裝
npm uninstall -g @carllee1983/dbcli
npm install -g @carllee1983/dbcli

where dbcli
```

#### macOS／Linux：「Permission denied: ./dist/cli.mjs」

未設定執行位元。

**處理方式：**

```bash
chmod +x dist/cli.mjs
./dist/cli.mjs --help
```

---

## 系統需求

### 資料庫支援

- **PostgreSQL：** 12.0+
- **MySQL：** 8.0+
- **MariaDB：** 10.5+

### 執行環境

- **Node.js：** 18.0.0+
- **Bun：** 1.3.3+

### 平台

- **macOS：** Intel 與 Apple Silicon
- **Linux：** x86_64（Ubuntu、Debian、CentOS 等）
- **Windows：** 10+（透過 npm .cmd 包裝）

---

## 開發

開發環境、測試與發布流程見 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 授權

詳見專案中的 LICENSE 檔案。
