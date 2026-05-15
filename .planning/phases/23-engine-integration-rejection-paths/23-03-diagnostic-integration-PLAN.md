# Plan 23-03: Diagnostic Commands & Rejection Path Integration

**Status:** Draft
**Owner:** Architect
**Requirements:** INTEGRATE-01, INTEGRATE-04

## Goal

完成所有其餘 db-touching 指令的 audit 整合，並確保 Blacklist 與 Permission 攔截能正確被記錄。

## Context

- **Diagnostic Commands**: `schema`, `list`, `doctor`, `inspect`, `report`, `guide` 等。
- **Rejection Paths**: 這些是 agent 最容易遇到的「失敗情境」，audit log 必須能反映為何被拒絕。

## Tasks

### 1. 更新診斷指令
- [ ] 修改 `src/commands/schema.ts`, `src/commands/list.ts`, `src/commands/export.ts`。
- [ ] 修改 `src/commands/doctor.ts`, `src/commands/inspect.ts`, `src/commands/report.ts`, `src/commands/guide.ts`。
- [ ] 修改 `src/commands/check.ts`, `src/commands/diff.ts`, `src/commands/migrate.ts`。

### 2. 攔截 Blacklist / Permission
- [ ] 確保在 `src/commands/*.ts` 的 `catch` 塊中，`BlacklistError` 與 `PermissionError` 被正確捕捉並寫入 audit。
- [ ] 驗證 `success: false` 且包含 redacted 錯誤訊息。

### 3. 處理 --plan 與 shell
- [ ] 更新 `src/commands/plan.ts`：雖然不執行，但記錄「計畫分析」行為。
- [ ] 更新 `src/commands/shell.ts`：記錄進入 REPL 的行為 (具體 query 記錄在 REPL 內部處理)。

### 4. 跨引擎整合測試
- [ ] 建立 `tests/integration/audit-engines.test.ts`。
- [ ] 測試 SQL, Mongo, Redis, ES 的典型指令。
- [ ] 驗證產出的 JSONL 每行形狀一致。

## Verification

### Automated Tests
- [ ] `bun test tests/integration/audit-engines.test.ts`

### Manual Verification
- [ ] 執行被 Blacklist 攔截的 query，檢查 audit log 是否有失敗記錄。
- [ ] 執行 `dbcli schema`，檢查記錄。
