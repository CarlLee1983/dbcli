# Phase 22 Plan: Entry Schema & Redaction Contract

**Status:** Ready to Execute
**Milestone:** v1.20.0 Agent-Facing Audit Log

## Goal

鎖定 audit entry 的 agent-facing JSON 合約，並把「不得洩漏原始 SQL / params / cell 值」變成 release gate。所有後續 phase 都以此 entry shape 寫入。

## Plans

1. [ ] **22-01-types-redaction-PLAN.md** — 定義 `AuditEntry` 介面與實作通用 redaction 工具。
2. [ ] **22-02-logger-update-PLAN.md** — 升級 `AuditLogger` 介面，支援自動注入 `ts` 與 `session_id`。
3. [ ] **22-03-contract-test-PLAN.md** — 實作整合性合約測試，驗證 JSON 形狀與 redaction 效果。

## Requirements Coverage

- [ ] **SCHEMA-01**: Audit entry JSON 必填欄位。
- [ ] **SCHEMA-02**: Contract test 鎖定。
- [ ] **SCHEMA-03**: Redaction 效果驗證。
- [ ] **SCHEMA-04**: `side_effect_tier` 重用。

## Success Criteria

1. 任何接觸 DB 的 command 執行後都產出一筆符合鎖定 schema 的 entry。
2. Contract test 以 `bun test` 守住 entry schema 並列為 release-blocking。
3. Redaction 測試證明 entry 內絕不會出現原始 SQL body、原始 `--param` 值、result cell 值。
4. Entry 的 `side_effect_tier` 直接讀 `src/adapters/capabilities.ts`。

---

*Plan created: 2026-05-15*
