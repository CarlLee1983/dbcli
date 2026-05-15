# Phase 22: Entry Schema & Redaction Contract - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

鎖定 audit entry 的 agent-facing JSON 合約，確保跨引擎一致性，並建立強制的 redaction (去識別化) 守則與 contract tests。

**包含：**
- `AuditEntry` 介面定義 (含必填欄位)。
- 統一的 redaction 工具函式 (處理 argv, SQL, params)。
- `AuditLogger.write` 介面升級 (支援 strict typing)。
- `tests/integration/audit-contract.test.ts` 合約測試。
- `side_effect_tier` 與 capability registry 的整合模式。

**不包含：**
- 將 writer 接到引擎 (Phase 23)。
- `dbcli audit` CLI 指令 (Phase 24)。
- Recovery envelope 連結 (Phase 25)。

</domain>

<decisions>
## Implementation Decisions

### A. Audit Entry 合約 (Contract)
- **D-17:** **嚴格的 `AuditEntry` 介面**：定義在 `src/core/audit/types.ts`。必填欄位如下：
  - `id`: 隨機 UUID 或時序 ID (唯一性)。
  - `ts`: ISO-8601 時戳 (由 Logger 統一生成或校驗)。
  - `session_id`: 由 Logger 注入。
  - `engine`: `DatabaseSystem` (postgresql/mysql/mongodb/etc.)。
  - `command`: 指令名稱 (query/insert/schema/etc.)。
  - `side_effect_tier`: `SideEffectTier` (重用 `src/adapters/capabilities.ts`)。
  - `target`: 操作對象 (table name, collection name, or key pattern)。
  - `success`: boolean。
  - `error?`: 失敗時的簡短訊息 (redacted)。
  - `recovery_ref?`: `string` (UUID of recovery envelope)。
  - `redacted_query`: 經過處理的指令摘要 (argv redacted + SQL redacted)。
  - `metadata?`: 額外非敏感資訊 (如 `rows_affected`, `execution_ms`)。

- **D-18:** **禁止 Result Preview**：對齊 D3 鎖定決策，Entry 內嚴格禁止包含任何 result cell 值、欄位值或原始資料片段。

### B. 統一 Redaction (去識別化) 邏輯
- **D-19:** **集中化 Redaction 工具**：在 `src/utils/redaction.ts` 建立 (或遷移自 `src/core/recovery/last-envelope.ts`)。
  - `redactArgv(argv: string[])`: 現有 `sanitizeCommandSummary` 的升級版。
  - `redactSql(sql: string)`: 移除或替換 SQL 中的字串字面量與數值。
  - `redactParams(params: any)`: 將參數物件的所有值替換為 `<redacted>`。
- **D-20:** **Redaction 測試規則**：Audit Log 必須通過 `tests/helpers/sensitive-output.ts` 的檢查，且不得洩漏 `--param` 與 `--config` 的原始值。

### C. Logger 與引擎整合模式 (Scaffolding)
- **D-21:** **Side Effect Tier 來源**：`side_effect_tier` 必須透過 `getEngineCapability(engine, command).tier` 獲取，禁止硬編碼。
- **D-22:** **AuditLogger 介面升級**：`AuditLogger.write` 修改為接收 `Omit<AuditEntry, 'ts' | 'session_id'>`。`AuditLogger` 內部自動補齊 `ts` 與 `session_id`，確保這兩個核心欄位的權威性。

### D. 合約測試 (Contract Test)
- **D-23:** **專屬合約測試檔案**：`tests/integration/audit-contract.test.ts`。
  - 模仿 v1.19.1 的 `inspect/report/guide` 測試風格。
  - 驗證 `dbcli` 執行任何指令後，產出的 `.jsonl` 內容每行都是合法 JSON 且包含所有必要鍵。
  - 驗證特定敏感指令 (如 `query --param "secret"`) 在 Log 中確實被 redacted。

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` §Phase 22
- `src/adapters/capabilities.ts` — `SideEffectTier` 定義來源
- `src/core/recovery/last-envelope.ts` — `sanitizeCommandSummary` 參考實作
- `tests/helpers/sensitive-output.ts` — Redaction 驗證標準
- `tests/integration/guide.test.ts` — Contract test 參考風格

</canonical_refs>

<code_context>
## Existing Code Insights

- `src/core/audit/logger.ts` 已經有 `enriched = { ...entry, session_id: sessionId }` 邏輯，需要微調以加入 `ts`。
- `sanitizeCommandSummary` 目前在 `src/core/recovery/last-envelope.ts`，應該被重構成通用的 `redactArgv` 並移動到 `src/utils/redaction.ts`。

</code_context>

<specifics>
## Specific Ideas

- **SQL Redaction 策略**：不需完整的 SQL parser，可以使用簡單的 Regex 替換 `'...'` 為 `'?'` 以及 `\d+` 為 `0`。
- **Entry ID**：使用 `crypto.randomUUID()` 或 `<ts>-<random>`。

</specifics>

<deferred>
## Deferred Ideas

- 實時 Audit Log 過濾/搜尋 (Phase 24)。
- Audit Log 與 Recovery Envelope 的反向連結 (Phase 25)。

</deferred>

---

*Phase: 22-entry-schema-redaction-contract*
*Context gathered: 2026-05-15*
