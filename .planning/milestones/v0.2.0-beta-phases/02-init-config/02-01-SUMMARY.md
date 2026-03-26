---
phase: 02-init-config
plan: 01
subsystem: Infrastructure & Validation
tags: [env-parser, config-management, validation, immutability, typescript]
completed: 2026-03-25T07:52:00Z
duration: ~20 minutes
key_decisions:
  - 使用 Zod for 運行時配置驗證，在讀取時捕捉錯誤
  - RFC 3986 百分比解碼支援密碼中的特殊字符
  - 不可變配置操作（copy-on-write 語義）防止靜默數據腐蝕
  - 資料庫系統特定的預設值集中在 adapters/defaults.ts
dependencies:
  requires: []
  provides: [env-parser, config-module, validation-schemas, error-classes]
  affects: [Phase 2 Plan 02 - init command]
tech_stack:
  added:
    - Zod 3.22.4 (已存在) - 運行時驗證
    - TypeScript 5.3+ (已存在) - 型別安全
  patterns:
    - Immutable config merging (spread operator)
    - Dual-path env parsing (DATABASE_URL vs DB_* components)
    - Schema-first validation
    - Custom error classes for domain-specific errors
key_files:
  created:
    - src/types/index.ts (介面定義)
    - src/utils/errors.ts (自訂錯誤類)
    - src/utils/validation.ts (Zod 模式)
    - src/core/env-parser.ts (.env 解析器)
    - src/core/config.ts (不可變配置模組)
    - src/adapters/defaults.ts (資料庫預設值)
    - tests/unit/core/env-parser.test.ts (51 個測試)
    - tests/unit/core/config.test.ts
    - tests/unit/utils/validation.test.ts
    - tests/fixtures/ (測試夾具)
  modified:
    - tsconfig.json (路徑別名 @/*)
    - vitest.config.ts (Vitest 路徑解析)
---

# Phase 2 Plan 01: Init & Config 基礎設施 Summary

**Infrastructure for database configuration management with .env parsing, validation, and immutable operations.**

## 完成狀態

✅ **所有 7 個任務已完成**

| Task | 名稱 | 狀態 | 提交 |
|------|------|------|------|
| 1 | 定義 TypeScript 介面 | ✅ | c1168bc |
| 2 | 實現自訂錯誤類 | ✅ | d53509a |
| 3 | Zod 驗證模式 | ✅ | 22fca99 |
| 4 | .env 解析器實現 | ✅ | 9bc4cf3 |
| 5 | 資料庫預設值模組 | ✅ | 636e785 |
| 6 | 不可變配置模組 | ✅ | f488d4a |
| 7 | 完整單元測試 | ✅ | 1d3b41d |

## 交付物

### 核心模組

#### 1. TypeScript 介面（src/types/index.ts）

定義了四個核心介面：

- **DatabaseEnv** - 環境變數解析的返回型別（6 個欄位：system、host、port、user、password、database）
- **ConnectionConfig** - .dbcli 文件中的連接配置（與 DatabaseEnv 相同結構）
- **Permission** - 權限級別類型（'query-only' | 'read-write' | 'admin'）
- **DbcliConfig** - 完整的 .dbcli 配置結構

#### 2. 自訂錯誤類（src/utils/errors.ts）

- **EnvParseError** - .env 解析失敗時拋出（DATABASE_URL 無效、缺少 DB_* 變數等）
- **ConfigError** - .dbcli 讀取/寫入/驗證失敗時拋出

兩個類都維護堆疊追蹤以便除錯。

#### 3. Zod 驗證模式（src/utils/validation.ts）

- **ConnectionConfigSchema** - 驗證連接配置的所有欄位（埠號 1-65535、必需欄位、預設值）
- **PermissionSchema** - 驗證權限枚舉（預設為 'query-only'）
- **MetadataSchema** - 驗證元數據（版本、創建時間戳）
- **DbcliConfigSchema** - 完整配置驗證

導出型別：`DbcliConfig = z.infer<typeof DbcliConfigSchema>`

#### 4. .env 解析器（src/core/env-parser.ts）

兩個主要函式：

**parseConnectionUrl(url: string): DatabaseEnv**
- 使用 `new URL()` 解析連接字符串
- **CRITICAL**：使用 `decodeURIComponent()` 解碼用戶名和密碼以支援 RFC 3986 百分比編碼
- 支援 postgresql://、mysql://、mariadb:// 協議
- 使用資料庫系統預設埠號（缺少埠號時）
- 拋出 EnvParseError 處理無效 URL 或未知協議

**parseEnvDatabase(env: Record<string, string>): DatabaseEnv | null**
- 優先路徑：DATABASE_URL
- 次要路徑：DB_* 元件（DB_SYSTEM、DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、DB_NAME）
- 返回 null 如果都不存在
- 驗證元件格式的必需欄位和埠號有效性

#### 5. 資料庫預設值（src/adapters/defaults.ts）

**getDefaultsForSystem(system: 'postgresql' | 'mysql' | 'mariadb'): Partial<ConnectionConfig>**

- PostgreSQL：埠 5432，主機 localhost
- MySQL/MariaDB：埠 3306，主機 localhost

用於 env-parser、config 和 init 命令。

#### 6. 不可變配置模組（src/core/config.ts）

**configModule** 對象導出四個函式：

**async read(path: string): Promise<DbcliConfig>**
- 使用 Bun.file() 讀取 .dbcli 文件
- 文件不存在時返回預設配置
- 解析 JSON 並驗證模式
- 拋出 ConfigError 處理無效 JSON 或模式不匹配

**validate(raw: unknown): DbcliConfig**
- 運行時模式驗證
- 拋出 ConfigError 帶詳細訊息

**merge(existing: DbcliConfig, updates: Partial<DbcliConfig>): DbcliConfig**
- **不可變語義**：返回新對象，永不修改輸入
- 深度合併嵌套對象（connection、metadata、schema）
- 保留現有的 metadata.createdAt 或設置新時間戳

**async write(path: string, config: DbcliConfig): Promise<void>**
- 寫入前驗證配置（失敗快速）
- 使用 2 空格縮進的 JSON.stringify() 格式化
- 使用 Bun.file() 寫入

### 測試

**51 個單元測試**（全部通過）涵蓋：

**env-parser.test.ts（18 個測試）**
- PostgreSQL、MySQL、MariaDB DATABASE_URL 解析
- 百分比編碼的特殊字符（密碼和用戶名）
- 預設埠號推論
- 無效 URL 和協議錯誤處理
- DB_* 元件格式解析
- 完整性驗證和預設值

**config.test.ts（19 個測試）**
- 文件不存在時的預設配置
- 現有 JSON 解析和驗證
- 無效 JSON 和模式驗證失敗錯誤
- 不可變合併語義驗證
- metadata.createdAt 保留
- JSON 格式化（2 空格縮進）

**validation.test.ts（14 個測試）**
- ConnectionConfig 有效性驗證
- 必需欄位和埠號範圍檢查
- PermissionSchema 預設值和枚舉
- DbcliConfig 完整結構驗證

### 測試夾具

- **.env.postgres** - PostgreSQL DATABASE_URL 格式
- **.env.mysql** - MySQL DB_* 元件格式
- **.env.edge-cases** - 特殊字符百分比編碼
- **sample.dbcli.json** - 有效的 .dbcli 配置

## 脫離（Deviations）

**無**：計劃完全按照編寫方式執行。

## 已知 Stubs

無。所有模組都完整實現。

## 技術決策

1. **RFC 3986 百分比解碼** - 支援密碼中的特殊字符（p@$$w0rd → p%40%24%24w0rd）
2. **複製語義用於配置合併** - 防止靜默數據腐蝕，使用 TypeScript 展開運算符
3. **集中式預設值** - 資料庫特定的預設值在 adapters/defaults.ts（易於擴展）
4. **Zod 檢驗優先** - 在讀取時捕捉無效配置，而不是在使用時
5. **路徑別名（@/*）** - 改善導入可讀性和模組路徑管理

## 驗證清單

- ✅ 所有 6 個模組存在並導出預期的函式/型別
- ✅ 單元測試套件通過（51/51 測試）
- ✅ TypeScript 編譯成功（無錯誤）
- ✅ .env 解析支援 DATABASE_URL 和 DB_* 格式
- ✅ 配置讀取/寫入/合併操作不可變驗證
- ✅ Zod 模式驗證 .dbcli 配置
- ✅ 自訂錯誤類有訊息欄位
- ✅ 沒有 console.log 陳述式在 src/ 代碼中
- ✅ 測試夾具為 Phase 2 整合測試建立

## 準備就緒

✅ Phase 2 Plan 01 基礎設施準備就緒用於 Plan 02：`dbcli init` 命令實現。

這些模組將被 init 命令消費，用於：
1. 從 .env 讀取現有資料庫配置
2. 提示使用者輸入缺失的值
3. 驗證並保存到 .dbcli 配置文件
4. 在後續命令中讀取和使用配置
