# Plan 22-03: Audit Contract Test

**Status:** Draft
**Owner:** Architect
**Requirements:** SCHEMA-02, SCHEMA-03

## Goal

實作 `tests/integration/audit-contract.test.ts`，鎖定 audit entry 的 JSON 形狀，並驗證 redaction 守則。

## Context

- **SCHEMA-02**: Contract test 必須守住 entry schema 並列為 release-blocking。
- **SCHEMA-03**: Redaction 測試證明 entry 內絕不會出現原始 SQL body、原始 `--param` 值、result cell 值。

## Tasks

### 1. 建立合約測試
- [ ] 建立 `tests/integration/audit-contract.test.ts`。
- [ ] 模仿 `guide.test.ts` 風格，使用 `spawn` 執行 CLI 指令。
- [ ] 建立一個臨時測試目錄，並連線到 Mock 資料庫 (或使用現有 PostgreSQL 測試資料庫)。
- [ ] 執行多種指令：`query`, `insert`, `schema`, `doctor`。
- [ ] 驗證 `.dbcli/audit/default.jsonl` 中的每一筆 Entry：
  - 符合 `AuditEntry` 形狀。
  - 欄位型別正確。
  - 包含正確的 `side_effect_tier`。

### 2. 驗證 Redaction 效果
- [ ] 執行 `dbcli query "SELECT * FROM users WHERE password = 'secret'"`。
- [ ] 驗證 Log 中的 `redacted_query` 不含 `secret` 字串。
- [ ] 執行 `dbcli query "SELECT 1" --param key=secret`。
- [ ] 驗證 Log 中的 `redacted_query` 不含 `secret` 字串。
- [ ] 整合 `tests/helpers/sensitive-output.ts` 的 `expectNoSensitiveFragments` 檢查整個 Audit 檔案。

## Verification

### Automated Tests
- [ ] `bun test tests/integration/audit-contract.test.ts`

### Manual Verification
- [ ] 無

## Risk & Mitigations

- **Risk**: 整合測試依賴外部資料庫環境可能較不穩定。
- **Mitigation**: 優先使用 Mock Adapter 進行 Contract 驗證，或確保 PostgreSQL Docker 環境就緒。
