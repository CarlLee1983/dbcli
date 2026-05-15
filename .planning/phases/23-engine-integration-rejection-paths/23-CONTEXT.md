# Phase 23: Engine Integration & Rejection Paths - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

將 `AuditLogger` 整合到所有資料庫引擎 (SQL, MongoDB, Redis, Elasticsearch) 的所有指令路徑中。確保無論指令成功、失敗還是被短路攔截 (Blacklist, Permission, Validation)，都能產出符合合約的 Audit Entry。

**包含：**
- 建立 `src/core/audit/integration.ts` 作為統一整合入口。
- 更新所有 db-touching 指令 (query, insert, update, delete, schema, export, check, diff, migrate, inspect, report, guide, doctor)。
- 捕捉並記錄短路攔截路徑 (BlacklistError, PermissionError, SizeGuard)。
- 處理 dry-run 與 --plan 的 audit 記錄。
- 跨引擎測試，驗證 entry shape 一致性。

**不包含：**
- `dbcli audit` CLI 指令 (Phase 24)。
- Recovery envelope 雙向連結 (Phase 25)。

</domain>

<decisions>
## Implementation Decisions

### A. 整合模式 (Injection Pattern)
- **D-24:** **集中式整合助手**：在 `src/core/audit/integration.ts` 實作 `writeAuditEntry(config, command, options, outcome)`。
  - 此 Helper 負責：解析 `AuditLogger`、提取 `engine` 與 `target`、呼叫 redaction 工具、捕捉 `metadata` (如 `rows_affected`)、並執行最後的 `logger.write`。
  - 所有指令 handler 必須在 `try` 塊結束前與 `catch` 塊內呼叫此 Helper。
- **D-25:** **D6 行為守護**：`writeAuditEntry` 內部的任何錯誤 (包括 Logger 本身的警告) 都不得拋出，必須確保主指令流程不受 audit 影響。

### B. 目標與引擎提取 (Target & Engine Extraction)
- **D-26:** **統一 Target 提取規則**：
  - **SQL**: 使用重構後的 `extractTableName(sql)`。
  - **MongoDB**: 使用 `options.collection`。
  - **Redis**: 使用第一個 positional arg (如 `table`)。
  - **Elasticsearch**: 使用 `options.index` 或 `options.collection`。
- **D-27:** **Side Effect Tier 動態獲取**：使用 `getEngineCapability(engine, command).tier`。如果 `options.dryRun` 為 true，則強行設為 `dry-run`。

### C. 攔截路徑處理 (Rejection Paths)
- **D-28:** **Blacklist / Permission 記錄**：
  - 當攔截發生時，`success` 設為 `false`。
  - `error` 欄位填入 Redacted 後的錯誤訊息 (如 "Table '?' is blacklisted")。
  - `side_effect_tier` 仍應顯示該指令原本預期的 Tier，但標記為失敗。
- **D-29:** **Validation 錯誤**：如 JSON 格式錯誤、缺少必填參數等，亦寫入 Audit Log，以補全 agent 失敗歷史。

### D. Redaction 應用
- **D-30:** **欄位填充規則**：
  - `redacted_query`: 使用 `redactArgv(process.argv)`。
  - `redacted_sql`: 僅在 SQL 相關指令填入 `redactSql(sql)`。
  - `metadata`: 可包含 `rows_affected`, `execution_ms`, `error_code` 等，但嚴禁包含原始資料。

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` §Phase 23
- `src/adapters/capabilities.ts` — Tier 與 Capability 來源
- `src/core/audit/types.ts` — `AuditEntry` 介面
- `src/utils/redaction.ts` — 必用的去識別化工具
- `src/core/query-executor.ts` — `extractTableName` 參考實作

</canonical_refs>

<code_context>
## Existing Code Insights

- **Command Handlers**: 散落在 `src/commands/*.ts`，大都包含 `try...catch` 結構。
- **Process Exit**: 許多 `catch` 塊呼叫了 `process.exit(1)`。必須確保 `await writeAuditEntry` 在 `exit` 之前完成。
- **Global connection**: `config.effectiveConnectionName` 已由 `preAction` hook 處理，`configModule.read()` 會回傳正確的 connection 資訊。

</code_context>

<specifics>
## Specific Ideas

- **Wave 劃分建議**：
  1. **Wave 1**: 實作 `integration.ts` 與重構 `extractTableName` 成為通用工具。
  2. **Wave 2**: 整合 `query`, `insert`, `update`, `delete` (最核心指令)。
  3. **Wave 3**: 整合 `schema`, `list`, `doctor` 等唯讀診斷指令。
  4. **Wave 4**: 處理極端路徑 (Blacklist, Permission, Parser errors)。

</specifics>

<deferred>
## Deferred Ideas

- `audit tail --all` 的合併邏輯 (Phase 24)。
- `recovery_ref` 與 `audit_ref` 的雙向寫入 (Phase 25)。

</deferred>

---

*Phase: 23-engine-integration-rejection-paths*
*Context gathered: 2026-05-15*
