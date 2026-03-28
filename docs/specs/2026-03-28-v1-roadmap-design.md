# dbcli v1.0 Roadmap Design

**日期**: 2026-03-28
**起始版本**: v0.5.3-beta
**目標版本**: v1.0.0
**路線**: 方案 A（REPL 先行）

---

## 整體架構

### 三個里程碑

| 里程碑 | 版本 | 核心交付 |
|--------|------|----------|
| **M1: Smart REPL** | v0.6.0-beta | 互動式 shell — SQL 執行 + dbcli 指令 + 自動補全 + 語法高亮 |
| **M2: Schema DDL** | v0.8.0-beta | CREATE/DROP/ALTER TABLE、INDEX、CONSTRAINT、ENUM 管理 |
| **M3: 穩定化** | v1.0.0 | 拿掉 beta、邊緣案例修復、文件完善、Known Limitations 更新 |

### 多連線處理

維持現有 per-directory `.dbcli` 模式，不需新架構。M3 穩定化階段補上文件說明此 pattern，並確保 `dbcli init` 在已有 `.dbcli` 時的 UX 流暢（目前已有 overwrite check）。

### 版本跳號邏輯

- v0.5.x → v0.6.0（REPL 是重大新功能）
- v0.6.x → v0.8.0（DDL 是核心能力擴展，跳號留空間給修補版）
- v0.8.x → v1.0.0（穩定化，去 beta）

### 設計原則

- 零新 production 依賴（readline 內建、DDL 純字串生成）
- 所有破壞性操作預設需確認
- Blacklist 與權限模型全面覆蓋新功能
- AI agent 友善（`--format json`、`--dry-run`、非互動旗標模式）

---

## M1: Smart REPL（v0.6.0-beta）

### 進入方式

```bash
dbcli shell          # 啟動 REPL
dbcli shell --sql    # 純 SQL 模式（跳過 dbcli 指令解析）
```

指令名稱用 `shell` 而非 `repl`，對一般開發者更直覺。

### 兩種輸入模式

REPL 內自動辨識輸入類型：

1. **SQL 模式** — 以 SQL 關鍵字開頭（`SELECT`, `INSERT`, `CREATE` 等）或以 `;` 結尾的，直接走 query 管線執行
2. **指令模式** — 其他輸入視為 dbcli 指令（不需打 `dbcli` 前綴）

```
dbcli> SELECT * FROM users LIMIT 5;
┌────┬──────────┬───────────────────┐
│ id │ name     │ email             │
├────┼──────────┼───────────────────┤
│ 1  │ Alice    │ alice@example.com │
└────┴──────────┴───────────────────┘
3 rows (12ms)

dbcli> schema users
Column      Type         Nullable  Default  PK  FK
───────────────────────────────────────────────────
id          integer      NO        nextval  ✓
name        varchar(50)  NO
email       varchar(100) NO

dbcli> blacklist list
Tables: audit_logs, secrets_vault
Columns: users.password_hash, users.ssn
```

### 多行輸入

SQL 以 `;` 結尾才送出。未遇到 `;` 時顯示續行提示：

```
dbcli> SELECT *
   ...> FROM users
   ...> WHERE id = 1;
```

### 自動補全（Tab）

分層補全邏輯，根據游標位置上下文決定：

| 上下文 | 補全來源 |
|--------|----------|
| SQL 關鍵字位置 | `SELECT`, `FROM`, `WHERE`, `JOIN` 等 |
| `FROM` / `JOIN` 後 | schema cache 中的表名 |
| `SELECT` 欄位位置 / `WHERE` 條件 | 當前表的欄位名（需解析 FROM clause） |
| 行首非 SQL | dbcli 指令名（`schema`, `list`, `blacklist` 等） |
| 指令參數位置 | 表名（如 `schema <tab>`） |

補全資料來源：`.dbcli` 中已快取的 schema metadata，無需即時查 DB。

### 語法高亮

複用現有 `src/utils/sql-highlight.ts`，即時對輸入進行：

- SQL 關鍵字：藍色粗體
- 字串：綠色
- 數字：黃色
- dbcli 指令名：青色

### Meta 指令

以 `.` 開頭的內建指令，不送到 DB 也不走 dbcli 指令解析：

| 指令 | 功能 |
|------|------|
| `.help` | 顯示可用 meta 指令 |
| `.quit` / `.exit` | 離開 REPL（Ctrl+D 也可） |
| `.clear` | 清除螢幕 |
| `.format <table\|json\|csv>` | 切換輸出格式（預設 table） |
| `.history` | 顯示歷史指令 |
| `.timing on\|off` | 開關執行時間顯示 |

### 歷史紀錄

- 存檔位置：`~/.dbcli_history`（跨專案共用）
- 上下鍵瀏覽、Ctrl+R 反向搜尋
- 最多保留 1000 筆

### 權限與 Blacklist 整合

完全複用現有管線：

- SQL 經過 `PermissionGuard` 檢查
- 查詢結果經過 blacklist 過濾
- 權限不足時顯示錯誤訊息，不中斷 REPL session

### 技術實作

- 使用 Node.js 內建 `readline` 模組（Bun 相容）
- 自動補全掛載 `readline.completer`
- 語法高亮透過 readline 的 prompt 重繪
- 不引入外部 REPL 框架（保持零依賴原則）

### 錯誤處理

REPL 內的錯誤永遠不會 crash session：

- SQL 錯誤：顯示 DB 回傳的錯誤訊息 + 現有 error-mapper 的 troubleshooting hint
- 權限錯誤：顯示所需權限等級
- 連線斷線：嘗試自動重連一次，失敗則提示但不退出

---

## M2: Schema DDL（v0.8.0-beta）

### 指令結構

所有 DDL 操作歸在 `dbcli migrate` 子指令群下，與現有 `schema`（唯讀查看）區分：

```bash
dbcli migrate create <table>     # CREATE TABLE
dbcli migrate drop <table>       # DROP TABLE
dbcli migrate add-column <table> <column> <type> [options]
dbcli migrate drop-column <table> <column>
dbcli migrate alter-column <table> <column> [options]
dbcli migrate add-index <table> [options]
dbcli migrate drop-index <index>
dbcli migrate add-constraint <table> [options]
dbcli migrate drop-constraint <table> <constraint>
dbcli migrate add-enum <name> <values...>
dbcli migrate alter-enum <name> [options]
dbcli migrate drop-enum <name>
```

### 命名空間選擇理由

- 所有結構變更歸一處，語義清晰
- 避免頂層指令爆炸（目前已有 17 個）
- 未來若加 migration 版本追蹤，命名空間已就緒

### CREATE TABLE

支援兩種模式：

**旗標模式（AI agent 友善）**：

```bash
dbcli migrate create users \
  --column "id:serial:pk" \
  --column "name:varchar(50):not-null" \
  --column "email:varchar(100):not-null:unique" \
  --column "created_at:timestamp:default=now()" \
  --dry-run
```

**互動模式（人類友善）**：逐步提問欄位名、型別、約束，直到輸入空行結束。

兩種模式都支援 `--dry-run` 預覽生成的 SQL。

### ALTER TABLE

```bash
# 加欄位
dbcli migrate add-column users age integer --nullable --default 0

# 改欄位
dbcli migrate alter-column users name --type varchar(100)
dbcli migrate alter-column users email --rename user_email
dbcli migrate alter-column users status --set-default 'active'
dbcli migrate alter-column users bio --drop-default
dbcli migrate alter-column users bio --set-nullable
dbcli migrate alter-column users email --drop-nullable

# 刪欄位
dbcli migrate drop-column users temp_field
```

### INDEX 管理

```bash
# 建立
dbcli migrate add-index users --columns email --unique
dbcli migrate add-index users --columns "last_name,first_name" --name idx_users_fullname
dbcli migrate add-index orders --columns created_at --type btree

# 刪除
dbcli migrate drop-index idx_users_fullname
```

### CONSTRAINT 管理

```bash
# Foreign Key
dbcli migrate add-constraint orders --fk user_id --references users.id --on-delete cascade

# Unique
dbcli migrate add-constraint users --unique "email"

# Check
dbcli migrate add-constraint users --check "age >= 0"

# 刪除
dbcli migrate drop-constraint orders fk_orders_user_id
```

### ENUM 管理

```bash
dbcli migrate add-enum status active inactive suspended
dbcli migrate alter-enum status --add-value archived
dbcli migrate drop-enum status
```

跨 DB 處理：PostgreSQL 有原生 ENUM；MySQL/MariaDB 用 `ENUM('a','b','c')` 欄位型別。DDL 生成器依 adapter 產出對應語法。

### 權限模型

DDL 操作需要 **Admin** 權限（現有最高級）。在 PermissionGuard 的 SQL classifier 中新增 DDL 語句辨識：

| 語句 | 所需權限 |
|------|----------|
| CREATE TABLE / INDEX | Admin |
| ALTER TABLE | Admin |
| DROP TABLE / INDEX | Admin |
| DROP + 確認提示 | Admin + `--force` 或互動確認 |

### 安全機制

- **DDL 預設 dry-run**：不加 `--execute` 只顯示 SQL 不執行（DDL 破壞性高，預設反轉）
- **DROP 操作雙重確認**：需要 `--force` 或互動確認
- **Blacklist 保護**：無法對 blacklisted 表執行 DDL
- **Schema cache 自動更新**：DDL 執行成功後自動觸發 `schema --refresh`

### 跨資料庫 SQL 生成

新增 `DDLGenerator` 介面，每個 adapter 實作各自的方言：

```
src/adapters/
  ddl/
    types.ts            # DDLGenerator interface
    postgresql-ddl.ts   # PostgreSQL DDL 語法
    mysql-ddl.ts        # MySQL/MariaDB DDL 語法
```

主要差異處理：

- 自增主鍵：PG `SERIAL` / MySQL `AUTO_INCREMENT`
- 修改欄位：PG `ALTER COLUMN ... TYPE` / MySQL `MODIFY COLUMN`
- ENUM：PG 獨立型別 / MySQL 內聯定義
- IF EXISTS / IF NOT EXISTS 支援度差異

### REPL 整合

REPL 內可以直接用：

```
dbcli> migrate create posts --column "id:serial:pk" --column "title:varchar(200):not-null" --dry-run
```

也可以直接輸入 DDL SQL（Admin 權限時）：

```
dbcli> CREATE TABLE posts (id SERIAL PRIMARY KEY, title VARCHAR(200) NOT NULL);
```

---

## M3: 穩定化（v1.0.0）

### 邊緣案例修復

- REPL 與 DDL 上線後蒐集到的 bug
- 跨平台（Windows）相容性驗證——REPL 的 readline 行為在 Windows Terminal / PowerShell 可能有差異
- 大型 schema（500+ 表）下的補全效能確認

### 權限模型文件化

- 三層權限（query-only / read-write / admin）加上 DDL 後的完整權限矩陣文件
- SKILL.md 更新——讓 AI agent 知道新指令的存在與用法

### Known Limitations 更新

移除已解決的：

- ~~Read-only schema~~ → 已有 `migrate` 指令
- ~~CLI-only~~ → 已有 `shell` REPL

保留 / 新增：

- 單一資料庫 per directory（有意設計，非限制，改為文件說明推薦 pattern）
- 無 audit logging（明確標為 post-v1.0）
- 無 migration 版本追蹤（明確標為 post-v1.0，`migrate` 命名空間已預留）

### 測試覆蓋率

- REPL：readline mock 測試（輸入解析、補全邏輯、多行偵測）
- DDL：每個 adapter 的 SQL 生成 + dry-run 驗證
- 整體覆蓋率維持 80%+

### 文件完善

- README 更新 REPL 與 DDL 使用範例
- CHANGELOG v1.0.0 完整版
- CONTRIBUTING.md 更新開發指南

### 發佈準備

- `package.json` version → `1.0.0`
- npm publish 驗證
- GitHub Release + tag
