# Plan 23-02: Core Command & Executor Integration

**Status:** Draft
**Owner:** Architect
**Requirements:** INTEGRATE-01, INTEGRATE-04

## Goal

將 Audit 記錄注入 `query`, `insert`, `update`, `delete` 指令，包含 SQL Executor 與 NoSQL 分支。

## Context

- **Core Data Flow**: 這些指令是 `dbcli` 的核心，必須優先覆蓋。
- **Side Effect Tier**: 必須正確識別 `db-write` 與 `readonly` (或 `dry-run`)。

## Tasks

### 1. 更新 `QueryExecutor`
- [ ] 修改 `src/core/query-executor.ts`。
- [ ] 注入 `writeAuditEntry` 呼叫。
- [ ] 確保在 `execute` 成功後記錄 `rows_affected` 與 `execution_ms`。
- [ ] 確保在 `catch` 塊中記錄失敗。

### 2. 更新 `DataExecutor`
- [ ] 修改 `src/core/data-executor.ts`。
- [ ] 在 `executeInsert`, `executeUpdate`, `executeDelete` 中注入 audit。
- [ ] 處理 `dryRun` 標記為 `dry-run` tier。

### 3. 更新 `queryCommand` (MongoDB/Redis/ES 分支)
- [ ] 修改 `src/commands/query.ts`。
- [ ] 在 `mongoQueryBranch`, `redisQueryBranch`, `elasticsearchQueryBranch` 中注入 audit。

### 4. 更新 `insert/update/delete` 指令
- [ ] 修改 `src/commands/insert.ts`, `src/commands/update.ts`, `src/commands/delete.ts`。
- [ ] 確保 NoSQL 分支 (Redis/ES/Mongo) 都有 audit 覆蓋。
- [ ] 確保 `catch` 塊在 `process.exit(1)` 前完成 audit 寫入。

## Verification

### Automated Tests
- [ ] `bun test tests/integration/audit-contract.test.ts` (應看到更多真實 Entry)

### Manual Verification
- [ ] 執行 `dbcli query "SELECT 1"`，檢查 `.dbcli/audit/default.jsonl`。
- [ ] 執行 `dbcli query "SELECT * FROM non_existent"`，檢查失敗記錄。
- [ ] 執行 `dbcli query '{"a":1}' --collection users` (Mongo)，檢查記錄。
