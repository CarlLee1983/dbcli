# Plan 23-01: Audit Integration Foundation & Utilities

**Status:** Draft
**Owner:** Architect
**Requirements:** INTEGRATE-01

## Goal

建立 Audit 整合所需的基礎工具與 Helper，確保跨指令、跨引擎的呼叫一致且符合 D6 (不阻擋) 原則。

## Context

- **D-24/25**: 需要一個 `writeAuditEntry` Helper，確保整合代碼簡潔且安全。
- **D-26**: `extractTableName` 目前在 `QueryExecutor` 中，需要移動到通用位置。

## Tasks

### 1. 重構 `extractTableName`
- [ ] 建立 `src/utils/engine-hints.ts`。
- [ ] 將 `src/core/query-executor.ts` 中的 `extractTableName` 遷移至此並導出。
- [ ] 實作 `getOperationTarget(config, command, options, sql?)`：
  - 整合 SQL (extractTableName), MongoDB (options.collection), Redis (table), ES (index/collection)。
- [ ] 更新 `src/core/query-executor.ts` 引用新路徑。

### 2. 建立 `AuditIntegrationHelper`
- [ ] 建立 `src/core/audit/integration-helper.ts`。
- [ ] 實作 `getAuditLogger(config, configPath)`：
  - 快取 `AuditLogger` 實例 (per connection)。
- [ ] 實作 `writeAuditEntry(config, command, options, outcome)`：
  - `outcome`: `{ success: boolean, error?: any, metadata?: any, sql?: string, target?: string }`。
  - 封裝 `logger.write` 呼叫。
  - 捕捉所有錯誤並轉換為 stderr 警告 (D6)。
  - 自動處理 `redacted_query` (argv) 與 `redacted_sql`。

### 3. 單元測試
- [ ] 建立 `tests/unit/core/audit/integration-helper.test.ts`。
- [ ] 驗證 `writeAuditEntry` 能正確組合 Entry 並呼叫 Logger。
- [ ] 驗證 `getOperationTarget` 能正確識別各引擎的 Target。

## Verification

### Automated Tests
- [ ] `bun test tests/unit/core/audit/integration-helper.test.ts`
- [ ] `bun test tests/unit/utils/engine-hints.test.ts`

### Manual Verification
- [ ] 無
