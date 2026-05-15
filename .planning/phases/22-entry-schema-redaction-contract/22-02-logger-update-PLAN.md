# Plan 22-02: AuditLogger Interface Upgrade

**Status:** Draft
**Owner:** Architect
**Requirements:** AUDIT-01, SCHEMA-01

## Goal

升級 `AuditLogger.write` 介面，使其支援嚴格型別的 `AuditEntry`，並自動處理 `ts` 與 `session_id` 的注入。

## Context

- **AuditLogger** 目前接收 `Record<string, unknown>`，缺乏型別保障。
- **ts** 與 **session_id** 應該由 Logger 統一管理，避免 Caller 誤傳或漏傳。

## Tasks

### 1. 更新 `AuditLogger.write` 簽章
- [ ] 導入 `AuditEntry` (來自 `./types`)。
- [ ] 修改 `write` 方法，使其接收 `Omit<AuditEntry, 'ts' | 'session_id' | 'id'>`。
- [ ] 修改 `writeInternal` 以自動生成 `id` (UUID) 與 `ts` (ISO string)。
- [ ] 確保 `session_id` 正確從 `SessionIdService` 獲取。

### 2. 更新現有測試
- [ ] 更新 `tests/unit/core/audit/logger.test.ts` 以符合新的介面簽章。
- [ ] 驗證輸出的 JSONL 包含自動生成的 `id` 與 `ts`。

## Verification

### Automated Tests
- [ ] `bun test tests/unit/core/audit/logger.test.ts`

### Manual Verification
- [ ] 無

## Risk & Mitigations

- **Risk**: 介面變更可能破壞尚未合併的開發分支。
- **Mitigation**: 由於目前只有基礎建設，尚未有任何實質 Caller，此風險極低。
