# Plan 22-01: Audit Entry Types & Redaction Utilities

**Status:** Draft
**Owner:** Architect
**Requirements:** SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04

## Goal

定義 `AuditEntry` 介面並實作通用的 redaction (去識別化) 工具，確保所有寫入 audit log 的資料都經過安全處理，且符合 agent-facing JSON 合約。

## Context

- **SCHEMA-01**: Audit entry JSON 必須包含時戳、session ID、engine、command、side effect tier、target、success、recovery_ref 與 redacted_query。
- **SCHEMA-04**: `side_effect_tier` 必須重用 `src/adapters/capabilities.ts`。
- **Redaction**: 目前 `sanitizeCommandSummary` 散落在 `src/core/recovery/`，需要集中化並擴充 SQL redaction。

## Tasks

### 1. 定義 `AuditEntry` 介面
- [ ] 建立 `src/core/audit/types.ts`。
- [ ] 導入 `DatabaseSystem` (來自 `src/adapters/types`) 與 `SideEffectTier` (來自 `src/adapters/capabilities`)。
- [ ] 定義 `AuditEntry` 介面，包含所有 ROADMAP 要求的欄位。

### 2. 實作通用 Redaction 工具
- [ ] 建立 `src/utils/redaction.ts`。
- [ ] 將 `src/core/recovery/last-envelope.ts` 中的 `sanitizeCommandSummary` 遷移至此並更名為 `redactArgv`。
- [ ] 實作 `redactSql(sql: string)`：
  - 使用 Regex 替換字串字面量 (`'...'`, `"..."`) 為 `'?'`。
  - 使用 Regex 替換數值為 `0`。
- [ ] 實作 `redactParams(params: any)`：遞迴遍歷物件，將所有 leaf values 替換為 `<redacted>`。
- [ ] 更新 `src/core/recovery/last-envelope.ts` 與 `src/core/recovery/emit.ts` 以引用新路徑。

### 3. 單元測試
- [ ] 建立 `tests/unit/utils/redaction.test.ts`。
- [ ] 測試 `redactArgv` 是否正確處理 `--password`, `--token`, `--config` 等敏感 flag。
- [ ] 測試 `redactSql` 是否正確處理複雜 SQL 中的敏感值。
- [ ] 測試 `redactParams` 是否正確處理巢狀物件。

## Verification

### Automated Tests
- [ ] `bun test tests/unit/utils/redaction.test.ts`

### Manual Verification
- [ ] 無

## Risk & Mitigations

- **Risk**: SQL Redaction Regex 可能過於簡單，漏掉某些敏感語法。
- **Mitigation**: 優先處理最常見的字面量與數值。Audit log 的目標是 observability 而非 100% 完美的去識別化，但必須確保 credentials 不外洩。
