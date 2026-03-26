---
phase: 02-init-config
plan: 02
subsystem: CLI Commands & Initialization
tags: [init-command, interactive-prompts, env-parsing, config-generation, cli-integration]
completed: 2026-03-25T15:41:00Z
duration: ~45 minutes
key_decisions:
  - 使用 @inquirer/prompts 帶有同步備用方案以兼容 Bun
  - 互動式提示與非互動命令行標誌混合模式
  - 覆蓋保護：.dbcli 存在時提示確認（除非使用 --force）
  - 權限選擇與驗證（query-only、read-write、admin）
dependencies:
  requires: [Phase 02 Plan 01 - env-parser, config-module, validation]
  provides: [dbcli init command, CLI initialization workflow]
  affects: [Phase 3+ - database connection]
tech_stack:
  added:
    - "@inquirer/prompts 5.0.0" (已存在於 devDependencies)
  patterns:
    - Interactive prompt with fallback system
    - Non-interactive command-line mode for CI/automation
    - Immutable configuration merging
    - Permission-based access control
key_files:
  created:
    - src/utils/prompts.ts (互動式提示模組)
    - src/commands/init.ts (dbcli init 命令)
    - tests/integration/init-command.test.ts (集成測試)
    - tests/fixtures/.dbcli.sample (sample 配置文件)
  modified:
    - src/cli.ts (註冊 init 命令)
---

# Phase 2 Plan 02: Init & Config 完整實現 Summary

**完整的 `dbcli init` 命令實現，包括互動式提示、.env 解析、配置生成和驗證。**

## 完成狀態

✅ **所有 5 個任務已完成**

| Task | 名稱 | 狀態 | 提交 |
|------|------|------|------|
| 1 | 創建互動式提示模組 | ✅ | 5240e62 |
| 2 | 實現 dbcli init 命令 | ✅ | e388b51 |
| 3 | 在 CLI 入點註冊 init 命令 | ✅ | 14ba6c2 |
| 4 | 創建集成測試 | ✅ | c203b9a |
| 5 | 驗證 CLI 構建和執行 | ✅ | 7caf9de |

## 交付物

### 1. 互動式提示模組 (src/utils/prompts.ts)

提供三個異步函數和備用系統：

- **text(message, defaultValue)** - 文本輸入提示
  - 嘗試使用 @inquirer/prompts
  - 備用：console.log + stdin 讀取
  - 支援預設值

- **select(message, choices)** - 選項選擇提示
  - 嘗試使用 @inquirer/prompts
  - 備用：列表編號選擇
  - 返回選定的選項

- **confirm(message)** - 是/否確認提示
  - 嘗試使用 @inquirer/prompts
  - 備用：簡單 y/n 輸入

**設計特性：**
- 動態導入允許優雅地降級到備用方案
- 無外部依賴的備用實現
- 可在測試中輕鬆替換為模擬提示

### 2. dbcli init 命令 (src/commands/init.ts)

完整實現的 init 命令，包含完整的初始化工作流程。

**命令定義：**
- 名稱：`dbcli init`
- 描述：「使用 .env 解析和互動式提示初始化 dbcli 配置」

**選項：**
- `--host <host>` - 資料庫主機
- `--port <port>` - 資料庫埠號
- `--user <user>` - 資料庫用戶
- `--password <password>` - 資料庫密碼
- `--name <name>` - 資料庫名稱
- `--system <system>` - 資料庫系統（postgresql、mysql、mariadb）
- `--permission <permission>` - 權限級別（query-only、read-write、admin，預設：query-only）
- `--no-interactive` - 非互動模式（所有值需通過標誌提供）
- `--force` - 跳過覆蓋確認

**初始化工作流程：**

1. 加載現有 .dbcli 配置（如果存在）
2. 嘗試從 .env 解析資料庫配置
3. 確定資料庫系統（優先順序：CLI 選項 → .env → 提示）
4. 為每個連接參數收集值（CLI 選項 → .env → 提示 → 預設值）
5. 選擇權限級別
6. 驗證所有值
7. 檢查現有文件並提示覆蓋確認
8. 寫入配置到 .dbcli
9. 打印成功訊息

**混合初始化模式：**
- 互動模式：讀取 .env，提示缺少的值
- 非互動模式：需要所有值通過 CLI 標誌提供
- 自動覆蓋保護：如果 .dbcli 存在，除非使用 --force，否則提示確認

### 3. CLI 入點更新 (src/cli.ts)

- 導入 initCommand
- 使用 `app.addCommand(initCommand)` 註冊命令
- Init 命令現在在 `dbcli --help` 和 `dbcli init --help` 中可用

### 4. 集成測試 (tests/integration/init-command.test.ts)

**13 個測試覆蓋關鍵功能：**

1. **環境變數解析**
   - DATABASE_URL 格式解析（PostgreSQL 連接字符串）
   - DB_* 元件格式解析（個別變數）
   - RFC 3986 百分比編碼密碼支援
   - 多個資料庫系統（PostgreSQL、MySQL、MariaDB）

2. **配置驗證**
   - 有效配置驗證通過
   - 無效權限級別拒絕
   - 無效埠號範圍拒絕
   - 無效資料庫系統拒絕

3. **配置合併**
   - 合併時保留 createdAt
   - 不可變語義驗證（原配置未改變）

4. **預設值**
   - 為各資料庫系統提供正確的預設值
   - 缺少埠號時使用預設值

### 5. 測試夾具 (tests/fixtures/.dbcli.sample)

有效的 .dbcli 配置範例文件：
```json
{
  "connection": {
    "system": "postgresql",
    "host": "localhost",
    "port": 5432,
    "user": "testuser",
    "password": "testpass",
    "database": "testdb"
  },
  "permission": "query-only",
  "schema": {},
  "metadata": {
    "version": "1.0"
  }
}
```

## CLI 功能驗證

✅ **所有 CLI 命令可用並正常運作：**

```bash
$ bun run dev -- init --help
Usage: dbcli init [options]

Initialize dbcli configuration with .env parsing and interactive prompts

Options:
  --host <host>              Database host
  --port <port>              Database port
  --user <user>              Database user
  --password <password>      Database password
  --name <name>              Database name
  --system <system>          Database system (postgresql, mysql, mariadb)
  --permission <permission>  Permission level (query-only, read-write, admin)
  --no-interactive           Non-interactive mode (requires all values via flags)
  --force                    Skip overwrite confirmation if .dbcli exists
```

✅ **構建成功：**
```bash
$ bun run build
Bundled 112 modules in 27ms
```

✅ **測試結果：**
```
Test Files: 2 passed (2)
Tests: 32 passed (32)
```

## 脫離（Deviations）

**無**：計劃完全按照編寫方式執行。

所有任務在預期範圍內完成。代碼符合 CLAUDE.md 指南和 TypeScript/ESLint 標準。

## 已知 Stubs

**無**。所有實現都是完整的，沒有待完成的部分或占位符。

## 技術決策

1. **互動式提示備用系統** - 即使 @inquirer/prompts 由於 Bun 兼容性問題而失敗，也能優雅降級到純文本提示

2. **混合初始化模式** - 支援互動和非互動（CI/自動化）工作流

3. **覆蓋保護** - 防止意外覆蓋現有配置，除非明確使用 --force

4. **不可變配置合併** - 所有操作返回新對象，保護原始配置

5. **權限級別驗證** - 在寫入前驗證所有值

## 驗證清單

- ✅ src/utils/prompts.ts 存在並導出 promptUser（text、select、confirm）
- ✅ src/commands/init.ts 存在並導出 initCommand
- ✅ src/cli.ts 導入並註冊 init 命令
- ✅ `bun run dev -- init --help` 顯示完整幫助
- ✅ `bun run build` 構建成功，生成可執行的 dist/cli.mjs
- ✅ 13 個集成測試全部通過
- ✅ 19 個 env-parser 單元測試全部通過
- ✅ 無控制台語句在生產代碼中（CLI 輸出除外）
- ✅ TypeScript 編譯成功
- ✅ 所有導入正確解析
- ✅ 不可變性原則得到維護

## 準備就緒

✅ Phase 2 Plan 02 完成。

`dbcli init` 命令現已完全實現並集成到 CLI。開發者可以運行 `dbcli init` 來配置他們的資料庫連接。

### 工作流範例

**互動模式（從 .env 讀取，提示缺少的值）：**
```bash
$ bun run dev -- init
選擇資料庫系統: (Use arrow keys)
❯ postgresql
  mysql
  mariadb
資料庫主機: [localhost]: mydb.example.com
資料庫埠號: [5432]:
資料庫用戶名: myuser
資料庫密碼 (可選): mypassword
資料庫名稱: mydatabase
選擇權限級別: (Use arrow keys)
❯ query-only
  read-write
  admin
✓ 配置已保存至 .dbcli
```

**非互動模式（CI/自動化）：**
```bash
$ bun run dev -- init --no-interactive \
  --system postgresql \
  --host localhost \
  --port 5432 \
  --user postgres \
  --password secret \
  --name mydb \
  --force
✓ 配置已保存至 .dbcli
```

Phase 2（Plan 01 + Plan 02）現已完成。用戶可以初始化他們的 dbcli 配置。

接下來的 Phase 3 將實現資料庫連接和連線測試。
