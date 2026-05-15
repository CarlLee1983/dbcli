# Phase 23 Plan: Engine Integration & Rejection Paths

**Status:** Ready to Execute
**Milestone:** v1.20.0 Agent-Facing Audit Log

## Goal

將 audit write 接到所有引擎 / 所有指令的 happy / failure / short-circuit-reject 三條路徑上，確保 entry shape 一致、覆蓋率 100%。

## Plans

1. [ ] **23-01-foundation-PLAN.md** — 建立 `AuditIntegrationHelper` 與通用 `target` 提取工具。
2. [ ] **23-02-core-integration-PLAN.md** — 整合 `query`, `insert`, `update`, `delete` 核心指令與 SQL/NoSQL Executor。
3. [ ] **23-03-diagnostic-integration-PLAN.md** — 整合其餘診斷指令與 Blacklist/Permission 攔截路徑，並進行跨引擎驗證。

## Requirements Coverage

- [ ] **INTEGRATE-01**: 覆蓋所有 db-touching commands (happy/failure)。
- [ ] **INTEGRATE-04**: 捕捉短路攔截路徑 (Blacklist, Permission)。

## Success Criteria

1. 對 PostgreSQL / MySQL / MariaDB / MongoDB / Redis / Elasticsearch 執行 query / write，產出符合鎖定 schema 的 entry。
2. Blacklist / Permission 拒絕路徑寫入 `success: false` entry，且含拒絕理由。
3. Dry-run 路徑標示 `side_effect_tier = dry-run`。
4. Audit 寫入失敗不阻擋主指令 (D6)。

---

*Plan created: 2026-05-15*
