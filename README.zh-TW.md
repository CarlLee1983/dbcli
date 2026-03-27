# dbcli — 為 AI 代理的資料庫 CLI

[English](./README.md) | 繁體中文

## 概述

dbcli 是一個統一的資料庫 CLI 工具，能讓 AI 代理（Claude Code、Gemini、Copilot、Cursor）安全地查詢、探索及操作資料庫。它扮演 AI 代理和多個資料庫系統（PostgreSQL、MySQL、MariaDB）之間的橋樑，簡化連接複雜度並強制實施基於權限的訪問控制。開發者每個專案初始化一次，之後 AI 代理就能智慧地與資料庫互動，無需手動架構探索或 SQL 語法知識。

## 核心價值

**AI 代理能透過單一的、權限受控的 CLI 工具安全且智慧地訪問專案資料庫，並提供敏感資料保護。**

## 快速開始

### 安裝

使用 Bun 安裝：

```bash
bun add -D @carllee1983/dbcli
```

或使用 npm：

```bash
npm install --save-dev @carllee1983/dbcli
```

### 更新

```bash
# 自動更新（推薦）
dbcli upgrade

# 或手動更新
bun update @carllee1983/dbcli
```

### 初始化

```bash
# 交互式設定
dbcli init

# 或非交互模式
dbcli init --host localhost --port 5432 --user postgres --password secret --name mydb --system postgresql
```

### 基本使用

```bash
# 列出所有表
dbcli list

# 查看特定表的架構
dbcli schema users

# 執行查詢
dbcli query "SELECT * FROM users LIMIT 10"

# 新增資料
dbcli insert users --data '{"name":"Alice","email":"alice@example.com"}'

# 更新資料
dbcli update users --where "id=1" --set '{"status":"active"}'

# 刪除資料（僅限 Admin）
dbcli delete users --where "id=1" --force

# 導出結果
dbcli export "SELECT * FROM users" --format json --output users.json
```

## 國際化

dbcli 支援多語言，可透過 `DBCLI_LANG` 環境變數控制：

```bash
# 英文（預設）
dbcli init

# 繁體中文
DBCLI_LANG=zh-TW dbcli init

# 或在 .env 中設定
export DBCLI_LANG=zh-TW
dbcli init
```

支援語言：
- `en` — English（英文，預設）
- `zh-TW` — 繁體中文（台灣）

所有訊息、幫助文字和錯誤都會根據語言設定自動翻譯。

## 功能

### 初始化與配置

- `dbcli init` — 混合模式初始化（先讀取 .env，再提示缺少的值）
- 支援混合資料庫系統配置（PostgreSQL、MySQL、MariaDB）
- 自動解析專案 .env 檔案
- 將配置儲存在 `.dbcli`（JSON 格式，按資料庫系統區分）
- 定義粗粒度權限：Query-only / Read-Write / Admin

### 架構探索與存儲

- `dbcli list` — 列出所有表
- `dbcli schema [table]` — 檢查單個或所有表的架構
- 自動生成 `.dbcli` 搭配表結構及關聯
- 支援增量架構刷新

### 查詢操作

- `dbcli query "SELECT ..."` — 直接 SQL 查詢執行
- 尊重權限等級（Query-only 模式拒絕寫入）
- 返回結構化結果（便於 AI 解析）
- 提供有用的錯誤訊息

### 資料修改（附帶安全措施）

- `dbcli insert [table]` — 插入資料（需要驗證，權限檢查）
- `dbcli update [table]` — 更新資料（需要驗證，權限檢查）
- `dbcli delete [table]` — 刪除資料（僅限 Admin）
- 返回確認及受影響行數

### 導出

- `dbcli export "SELECT ..." [--format json|csv]` — 導出查詢結果

### 資料存取控制（黑名單）

- `dbcli blacklist table add/remove <table>` — 封鎖或解除封鎖整個表
- `dbcli blacklist column add/remove <table>.<column>` — 隱藏或顯示特定欄位
- `dbcli blacklist list` — 查看目前黑名單設定
- 欄位黑名單在查詢結果中自動省略，並顯示安全通知
- 可透過 `DBCLI_OVERRIDE_BLACKLIST=true` 環境變數覆蓋（僅限管理員）

### AI 整合

- 生成 dbcli 技能文檔（Claude Code 相容）
- 支援跨平台 AI 代理使用（Claude Code、Gemini、Copilot CLI、Cursor、IDE）
- 技能動態反映 dbcli 功能

### 診斷與維護

- `dbcli doctor` — 執行環境、設定、連線與資料的全面診斷
- `dbcli upgrade` — 檢查更新並自動升級 dbcli
- `dbcli completion [shell]` — 產生 shell 自動補全腳本（bash、zsh、fish）

## 權限模型

dbcli 使用三層粗粒度權限模型，並搭配黑名單系統提供敏感表和欄位的細粒度保護（見[資料存取控制](#資料存取控制)）：

### 1. Query-only（查詢只讀）

可用命令：
- `dbcli list` — 列出表
- `dbcli schema [table]` — 查看架構
- `dbcli query "SELECT ..."` — 查詢

限制：
- 寫入操作（INSERT、UPDATE、DELETE）被拒絕
- 查詢自動限制為 1000 行（防止意外全表掃描）

### 2. Read-Write（讀寫）

可用命令：
- Query-only 的所有命令
- `dbcli insert` — 插入資料
- `dbcli update` — 更新資料

限制：
- DELETE 被拒絕（需要 Admin）
- Insert/Update 需要確認（除非 `--force`）

### 3. Admin（管理員）

完全訪問：
- 所有讀寫操作
- DELETE 無限制
- 可跳過確認（`--force`）

## 資料存取控制

dbcli 提供黑名單系統，與權限模型協同運作，防止 AI 代理存取敏感表或欄位，無論其權限等級為何。

### 表層級黑名單

封鎖表後，所有操作（查詢、插入、更新、刪除）均會被拒絕，並顯示明確的錯誤訊息。

```bash
dbcli blacklist table add secrets_vault
dbcli query "SELECT * FROM secrets_vault"
# 錯誤：表 'secrets_vault' 已被列入黑名單
```

### 欄位層級黑名單

黑名單欄位會從 SELECT 結果中自動省略，並在輸出中顯示安全通知，讓 AI 代理了解結果集已被過濾。

```bash
dbcli blacklist column add users.password_hash
dbcli query "SELECT * FROM users"
# [安全通知] 已省略黑名單欄位：password_hash
```

### 黑名單配置範例

黑名單規則儲存在 `.dbcli` 配置檔案中：

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

### 覆蓋黑名單

管理員可透過環境變數在緊急情況下繞過黑名單：

```bash
DBCLI_OVERRIDE_BLACKLIST=true dbcli query "SELECT * FROM secrets_vault"
```

## 常見命令

### 初始化

```bash
dbcli init
# 提示：主機、埠口、用戶、密碼、資料庫名稱、權限級別

dbcli init --host db.example.com --port 5432 --user admin --password secret --name prod_db --system postgresql
# 非交互式初始化

dbcli init --use-env-refs
# 交互式：提示輸入環境變數名稱，config 中儲存 {"$env": "DB_HOST"} 而非實際值

dbcli init --use-env-refs --system mysql \
  --env-host DB_HOST --env-port DB_PORT \
  --env-user DB_USER --env-password DB_PASSWORD \
  --env-database DB_DATABASE --no-interactive
# 非交互式環境變數參照模式，適合 CI/CD
```

> **`--use-env-refs` 說明：** 使用此選項時，config 中儲存的是環境變數名稱（如 `{"$env": "DB_HOST"}`）而非實際值。這樣可以避免將敏感資訊寫入 config 檔案，適合多環境部署或 CI/CD 場景。連線時 dbcli 會自動從環境變數讀取實際值。

### 列出表

```bash
dbcli list
# 以表格輸出
# ┌─────────┬──────────┬────────┐
# │ Table   │ Rows     │ Engine │
# ├─────────┼──────────┼────────┤
# │ users   │ 1,250    │ InnoDB │
# │ posts   │ 8,431    │ InnoDB │
# └─────────┴──────────┴────────┘

dbcli list --format json
# 以 JSON 輸出
```

### 查看架構

```bash
dbcli schema users
# 列出 users 表的欄位、型別、約束

dbcli schema
# 掃描整個資料庫架構

dbcli schema --refresh --force
# 檢測並應用架構變更（增量）

dbcli schema --reset --force
# 清空舊 schema 並重新從 DB 抓取（切換 DB 後使用）
```

### 執行查詢

```bash
dbcli query "SELECT id, name FROM users WHERE active = true"

dbcli query "SELECT * FROM posts" --format json
# 以 JSON 輸出

dbcli query "SELECT * FROM large_table" --limit 100
# 限制行數

dbcli query "SELECT * FROM large_table" --no-limit
# 停用自動限制（Query-only 模式下需要 `--force`）
```

### 插入資料

```bash
dbcli insert users --data '{"name":"Bob","email":"bob@example.com"}'

echo '{"name":"Charlie","email":"charlie@example.com"}' | dbcli insert users

dbcli insert users --data '{"name":"David","email":"david@example.com"}' --force
# 跳過確認提示
```

### 更新資料

```bash
dbcli update users --where "id=1" --set '{"status":"active"}'

dbcli update posts --where "author_id=5" --set '{"updated_at":"2026-03-26"}'

dbcli update users --where "id=1" --set '{"name":"Updated"}' --dry-run
# 顯示 SQL 但不執行
```

### 刪除資料

```bash
# 僅限 Admin 權限
dbcli delete users --where "id=1"

dbcli delete users --where "status='inactive'" --force
# 跳過確認提示
```

### 導出資料

```bash
dbcli export "SELECT * FROM users" --format json --output users.json

dbcli export "SELECT id, name FROM posts" --format csv > posts.csv
```

### 生成技能

```bash
dbcli skill
# 輸出到標準輸出（用於管道傳輸）

dbcli skill --output ./SKILL.md
# 寫入檔案

dbcli skill --install claude
# 安裝至 Claude Code 技能目錄
```

### 管理黑名單

```bash
# 查看目前黑名單
dbcli blacklist list

# 封鎖整個表
dbcli blacklist table add audit_logs
dbcli blacklist table add secrets_vault

# 從黑名單移除表
dbcli blacklist table remove audit_logs

# 隱藏敏感欄位
dbcli blacklist column add users.password_hash
dbcli blacklist column add users.ssn

# 從黑名單移除欄位
dbcli blacklist column remove users.ssn

# 管理員覆蓋黑名單（緊急使用）
DBCLI_OVERRIDE_BLACKLIST=true dbcli query "SELECT * FROM secrets_vault"
```

#### `dbcli doctor`

執行環境、設定、連線與資料的全面診斷。

```bash
dbcli doctor                    # 彩色文字輸出
dbcli doctor --format json      # JSON 輸出供 AI agent 使用
```

**檢查項目：**
- **環境：** Bun 版本相容性、dbcli 版本（與 npm registry 比對）
- **設定：** 設定檔存在/合法、權限等級、blacklist 完整性
- **連線與資料：** 資料庫連線測試、schema cache 新鮮度（> 7 天警告）、大表警告（> 1M 列）

**選項：** `--format <text|json>`

---

#### `dbcli completion [shell]`

產生 shell 自動補全腳本。

```bash
dbcli completion bash            # 輸出 bash 補全腳本
dbcli completion zsh             # 輸出 zsh 補全腳本
dbcli completion fish            # 輸出 fish 補全腳本
dbcli completion --install       # 自動偵測 shell 並安裝
dbcli completion --install zsh   # 指定 shell 安裝
```

**支援 shell：** bash、zsh、fish

---

#### `dbcli upgrade`

檢查更新並自動升級 dbcli。

```bash
dbcli upgrade                   # 檢查並升級
dbcli upgrade --check           # 僅檢查，不升級
```

**背景檢查：** 每個指令靜默檢查 npm registry（每 24 小時一次），有新版時在指令完成後顯示提示。

## 全域選項

以下選項適用於所有指令：

| 選項 | 說明 |
|------|------|
| `--config <path>` | 指定 .dbcli 設定檔路徑（預設：`.dbcli`） |
| `-v, --verbose` | 增加輸出詳細度（`-v` 詳細、`-vv` 除錯） |
| `-q, --quiet` | 靜音模式，抑制非必要輸出 |
| `--no-color` | 關閉彩色輸出（支援 `NO_COLOR` 環境變數） |

## 環境配置

### .dbcli 配置檔案

初始化後，dbcli 會創建 `.dbcli` 檔案：

```json
{
  "connection": {
    "system": "postgresql",
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "secret",
    "database": "mydb"
  },
  "permission": "read-write",
  "metadata": {
    "createdAt": "2026-03-26T12:00:00Z",
    "tables": [
      {
        "name": "users",
        "columns": [...],
        "primaryKey": ["id"],
        "foreignKeys": [...]
      }
    ]
  }
}
```

### 環境變數參考

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `DBCLI_LANG` | 語言（en、zh-TW） | `en` |
| `DATABASE_URL` | 資料庫連接字串（可選，init 會嘗試解析） | 無 |

### .env 整合

dbcli init 會自動解析 .env 檔案以預先填入連接詳細資訊：

```bash
# .env
DATABASE_URL=postgresql://user:password@localhost:5432/mydb

dbcli init
# 自動填入資料庫詳細資訊，只需確認或調整
```

## 故障排除

### 「未配置資料庫」

```
Database not configured. Run: dbcli init
```

**解決方案：** 執行 `dbcli init` 建立 `.dbcli` 配置檔案。

### 「連接失敗」

```
Failed to connect to database: ECONNREFUSED 127.0.0.1:5432
```

**檢查清單：**
- 資料庫伺服器是否執行中？
- 主機和埠口是否正確？
- 用戶和密碼是否有效？
- 網路是否可達？（特別是遠程資料庫）

### 「權限被拒」

```
Permission denied (required: admin)
```

**解決方案：**
- 該命令需要更高的權限等級
- 執行 `dbcli init` 並選擇更高的權限級別
- 或聯繫資料庫管理員

### 「表不存在」

```
Table not found: nonexistent_table
```

**解決方案：**
- 執行 `dbcli list` 檢查可用表
- 檢查表名拼寫
- 確認已連接到正確的資料庫

### 查詢超時

```
Query timeout after 30s
```

**解決方案：**
- 簡化查詢（新增 WHERE 條件、JOIN 等）
- 使用 `--limit` 限制行數
- 檢查資料庫索引是否最佳化

## 技術棧

| 組件 | 技術 | 理由 |
|------|------|------|
| 執行時 | Bun | 快速啟動、原生 TS 支援 |
| 資料庫 | PostgreSQL、MySQL、MariaDB | 廣泛使用、成熟生態 |
| 測試 | Vitest | 快速、全面的單位 & 集成測試 |
| 分發 | npm | 標準 Node.js/Bun 生態 |

## 開發

### 設定開發環境

```bash
# 克隆倉庫
git clone https://github.com/your-org/dbcli.git
cd dbcli

# 安裝依賴
bun install

# 執行測試
bun test

# 本地開發
bun run src/cli.ts init
```

### 測試

```bash
# 執行所有測試
bun test

# 執行特定測試檔案
bun test src/commands/query.test.ts

# 監視模式
bun test --watch
```

### 構建

```bash
# 構建發行版本
bun build src/cli.ts --outfile dist/cli.mjs
```

## 貢獻

貢獻歡迎！請提交問題和拉請求。

### 開發者指南

詳見 [CONTRIBUTING.md](./CONTRIBUTING.md)。

### 國際化貢獻

如果要新增訊息或翻譯：

1. 編輯 `resources/lang/{en,zh-TW}/messages.json`
2. 在命令中使用 `t()` 或 `t_vars()`
3. 執行測試確保一致性

## 授權

MIT — 見 [LICENSE](./LICENSE)

## 更新日誌

見 [CHANGELOG.md](./CHANGELOG.md)。

---

**最後更新：** 2026-03-26 | **版本：** v1.0.0+
