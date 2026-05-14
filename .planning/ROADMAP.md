# Roadmap: dbcli — Milestone v1.20.0 Agent-Facing Audit Log

**Created:** 2026-05-14
**Milestone goal:** 讓 AI agent 跨 session / 跨 invocation 能讀回 dbcli 在這個 DB 上做過什麼，補上 inspect / recovery envelope / report 共同缺失的「歷史活動」維度。

**Phase numbering:** Continues from v1.19.1 (final phase = 20). v1.20.0 starts at **Phase 21**.

**Locked decisions referenced below:** D1 預設 on、D2 session_id env 優先、D3 metadata-only、D4 每連線一檔 + `--all` merge、D5 純時序反序、D6 寫入失敗只警告。

---

## Phases

- [ ] **Phase 21: Audit Writer Foundation** — JSONL writer + file lock + rotation + session_id service + `.dbcli` `audit.*` config schema
- [ ] **Phase 22: Entry Schema & Redaction Contract** — Agent-facing entry JSON 合約鎖定 + contract test + 統一 redaction（reuse `tests/helpers/sensitive-output.ts`）+ `side_effect_tier` reuse
- [ ] **Phase 23: Engine Integration & Rejection Paths** — 在所有引擎 / 所有 command 注入 audit write（含 blacklist / permission / parser 短路拒絕路徑）
- [ ] **Phase 24: `dbcli audit` CLI** — `tail` / `tail --all` / `show` / `clear` / `health`、table / JSON 兩種輸出格式
- [ ] **Phase 25: Recovery Envelope Bi-directional Linkage** — `recovery_ref` ⇄ `audit_ref` 雙向欄位、失敗路徑自動連結、`inspect` / `recover` flow 引用 recent audit
- [ ] **Phase 26: Docs, Skill & Release Gate** — SKILL.md 中英雙語 audit 章節、`docs/feature-matrix.md` audit row、README / CHANGELOG 升級說明（強調 D1 預設 on）

---

## Phase Details

### Phase 21: Audit Writer Foundation
**Goal:** dbcli 內部具備一個可開關的 audit writer service：能在 `.dbcli/audit/<connection>.jsonl` 以 append-only JSONL 形式安全寫入、自動 rotation、不會因為寫入失敗影響主指令。
**Depends on:** Nothing (foundation; reuses existing `.dbcli` config plumbing).
**Requirements:** AUDIT-02, AUDIT-03, STORE-01, STORE-02, STORE-03, STORE-04, CONFIG-01, CONFIG-02, CONFIG-03
**Success Criteria** (what must be TRUE):
  1. 開發者在 `.dbcli` 設 `audit.enabled = false` 後再執行任何 db command，`.dbcli/audit/` 目錄不會被建立、不會有任何寫入動作
  2. 預設 enable 狀態下，連續寫入超過 size cap (~10 MB) 或 entry cap (~1000) 任一條件即觸發 rotation；前一段檔案保留在磁碟上、現用檔案重新開始計數
  3. 兩個 dbcli 進程同時寫入同一連線時，產出的 JSONL 仍每行可解析（file lock 序列化）
  4. 手動將 audit 目錄改為唯讀後執行 db command，stderr 出現警告但主指令仍回原本的結果與 exit code（D6）
  5. 第一次呼叫無 `DBCLI_SESSION_ID` env 時自動生成 `<pid>-<unix-ts>-<random>` 並寫入 `.dbcli/last-session-id`；同進程後續呼叫讀回同一 id（D2）
  6. 既有 v1.19.x 的 `.dbcli` 升級到 v1.20.0 後仍可正常運作，缺少的 `audit.*` 欄位以預設值補齊
**Plans:** 5 plans

Plans:
- [x] 21-01-config-schema-PLAN.md — Extend zod schemas with `audit.*` block (CONFIG-01/02/03)
- [x] 21-02-session-id-service-PLAN.md — SessionIdService with env-first resolution + PID-stamped persistence (AUDIT-02/03)
- [x] 21-03-lock-manager-PLAN.md — AuditLockManager with 200ms retry budget + fail-soft on exhaustion (STORE-03 primitive)
- [x] 21-04-logger-rotation-PLAN.md — AuditLogger writer + rotation.ts + getHealth() introspection (STORE-01/02/04)
- [x] 21-05-integration-tests-PLAN.md — Two-instance concurrent + readonly-dir integration tests (STORE-03/04 closure)

### Phase 22: Entry Schema & Redaction Contract
**Goal:** 鎖定 audit entry 的 agent-facing JSON 合約，並把「不得洩漏原始 SQL / params / cell 值」變成 release gate。所有後續 phase 都以此 entry shape 寫入。
**Depends on:** Phase 21 (writer must exist to test schema)
**Requirements:** AUDIT-01, SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04
**Success Criteria** (what must be TRUE):
  1. 任何接觸 DB 的 command 執行後（成功或失敗）都產出一筆符合鎖定 schema 的 entry，必要鍵 `ts` / `session_id` / `engine` / `command` / `side_effect_tier` / `target` / `success` / `recovery_ref` / `redacted_sql` 全部存在
  2. Contract test（風格比照 v1.19.1 inspect / report / guide / recovery）以 `bun test` 守住 entry schema 並列為 release-blocking
  3. Redaction 測試證明 entry 內絕不會出現原始 SQL body、原始 `--param` 值、result cell 值；redaction 來源是 `tests/helpers/sensitive-output.ts`，沒有第二套規則
  4. Entry 的 `side_effect_tier` 直接讀 `src/adapters/capabilities.ts`，不重新定義 enum；新增 command 後 capability registry 是唯一需要更新的點
**Plans:** TBD

### Phase 23: Engine Integration & Rejection Paths
**Goal:** 把 audit write 接到所有引擎 / 所有指令的 happy / failure / short-circuit-reject 三條路徑上，確保 entry shape 一致、覆蓋率 100%。
**Depends on:** Phase 22 (schema must be locked before hooking all engines to avoid rework)
**Requirements:** INTEGRATE-01, INTEGRATE-04
**Success Criteria** (what must be TRUE):
  1. 對 PostgreSQL / MySQL / MariaDB / MongoDB / Redis / Elasticsearch 各跑一輪 query / write，產出的 entry 全部符合相同 schema（無引擎特例欄位）
  2. Blacklist 拒絕、permission 拒絕、parser error 等 short-circuit 路徑都寫入 `success: false` entry，且 entry 含拒絕理由
  3. Dry-run 路徑寫入 entry 並標示 `side_effect_tier = dry-run`（與 capability registry 一致）
  4. 任一引擎在 audit 寫入失敗時仍走 D6 行為（stderr 警告 + 主指令照跑），不會因為某個 engine 整合錯誤而退化
**Plans:** TBD

### Phase 24: `dbcli audit` CLI
**Goal:** 給 agent 與開發者一個可消費的查詢介面：列出時序、查看單筆、清空、檢查 writer 健康，並提供扁平 JSON 給 agent 直接 parse。
**Depends on:** Phase 23 (need real entries from all engines to verify CLI output)
**Requirements:** CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06
**Success Criteria** (what must be TRUE):
  1. `dbcli audit tail --n 10` 對當前連線輸出最近 10 筆，最新在下（D5）；同時支援 `--format table` 與 `--format json`（扁平陣列，agent 可直接消費）
  2. `dbcli audit tail --all` 跨連線合併時序輸出（D4），entry 內保留原連線標記
  3. `dbcli audit show <id>` 印出單筆完整 entry，仍走 redaction（不外洩 raw SQL）
  4. `dbcli audit clear` 沒有 `--yes` 時要求互動確認；有 `--yes` 時直接清空當前連線 audit log
  5. `dbcli audit health` 回報 writer 啟用狀態、最後一次寫入結果、file lock 狀態、rotation cap 使用率；當 `audit.enabled = false` 時明確標示 disabled（D6 / CONFIG-02）
**Plans:** TBD

### Phase 25: Recovery Envelope Bi-directional Linkage
**Goal:** 讓 audit log 和既有 recovery envelope（v1.17.0 起）互為起點，agent 可以從任一端跳到另一端，補上 forensics 的完整路徑。
**Depends on:** Phase 23 (audit entries must exist on failure paths), and existing recovery envelope (`.dbcli/last-recovery.json`)
**Requirements:** INTEGRATE-02, INTEGRATE-03, DOCS-02
**Success Criteria** (what must be TRUE):
  1. Command 失敗時產生的 audit entry，其 `recovery_ref` 指向當次寫入的 `.dbcli/last-recovery.json`（含 envelope id / path）
  2. 同一次失敗寫入的 recovery envelope 新增 `audit_ref` 欄位，反向指向觸發它的 audit entry id
  3. `dbcli inspect` 與 `dbcli recover` 在 agent guide 輸出中自動引用 recent audit（last N 筆摘要），讓 agent 看到歷史脈絡而非只看到當前狀態
  4. 雙向欄位在 `--format json` agent-facing 輸出皆存在且互相對得上（contract test 守住）
**Plans:** TBD

### Phase 26: Docs, Skill & Release Gate
**Goal:** v1.20.0 對外發佈所需的所有人 / 機可讀文件就緒，包含 agent 整合指引、feature matrix、CHANGELOG / README，並通過 release gate。
**Depends on:** Phases 21–25 (need shipped behavior to document accurately)
**Requirements:** DOCS-01, DOCS-03, DOCS-04
**Success Criteria** (what must be TRUE):
  1. SKILL.md 新增中英雙語「Audit Log usage」章節，明確說明 session handoff 與 forensics 兩種 agent 使用情境
  2. `docs/feature-matrix.md` 加 audit row（含 side-effect tier 對照）並被列入 release gate 文件清單
  3. README（en + zh-TW）與 CHANGELOG 補上 v1.20.0 audit log 說明，特別點出「預設 on」對既有用戶的影響（D1 升級警告）
  4. 完整 release gate（`bun run release:check`：typecheck / `bun test` / lint `--max-warnings=0` / build）全綠
**Plans:** TBD

---

## Dependencies (visual)

```
Phase 21 (Writer + Storage + Config)
        │
        ▼
Phase 22 (Entry Schema + Redaction Contract)
        │
        ▼
Phase 23 (Engine Integration + Rejection Paths)
        │
        ├──────────────┐
        ▼              ▼
Phase 24 (CLI)   Phase 25 (Recovery Linkage)
        │              │
        └──────┬───────┘
               ▼
        Phase 26 (Docs + Release Gate)
```

Phase 24 and Phase 25 are technically independent after Phase 23 lands and can be planned in parallel, but Phase 26 (docs + release gate) needs both to be feature-complete.

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 21. Audit Writer Foundation | 5/5 | Ready for verification | — |
| 22. Entry Schema & Redaction Contract | 0/0 | Not started | — |
| 23. Engine Integration & Rejection Paths | 0/0 | Not started | — |
| 24. `dbcli audit` CLI | 0/0 | Not started | — |
| 25. Recovery Envelope Bi-directional Linkage | 0/0 | Not started | — |
| 26. Docs, Skill & Release Gate | 0/0 | Not started | — |

---

## Coverage Notes

All 28 v1.20.0 requirements mapped to exactly one phase. No orphans, no duplicates.

| Phase | Requirements | Count |
|-------|--------------|-------|
| 21 | AUDIT-02, AUDIT-03, STORE-01, STORE-02, STORE-03, STORE-04, CONFIG-01, CONFIG-02, CONFIG-03 | 9 |
| 22 | AUDIT-01, SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04 | 5 |
| 23 | INTEGRATE-01, INTEGRATE-04 | 2 |
| 24 | CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06 | 6 |
| 25 | INTEGRATE-02, INTEGRATE-03, DOCS-02 | 3 |
| 26 | DOCS-01, DOCS-03, DOCS-04 | 3 |
| **Total** | | **28 / 28** |

**Notes on mapping choices:**
- **AUDIT-01 → Phase 22** (not 21): The requirement is "every db-touching command writes an entry"; this becomes verifiable only once the entry schema is locked. Phase 21 builds the *capability* to write; Phase 22 makes it a *contract* that every command produces a valid entry.
- **CONFIG-* → Phase 21** (not a late phase): `audit.enabled` opt-out must exist before any writer code paths can land safely. Bundling config with the foundation prevents needing to retrofit a kill-switch later.
- **DOCS-02 → Phase 25** (not 26): "inspect / recover flow auto-references recent audit" is a behavior change in agent guide output, not just documentation. It belongs with the linkage work.
- **INTEGRATE-02 / INTEGRATE-03 → Phase 25** (not 23): Engine-level audit writes (INTEGRATE-01 / -04) are pure forward integration; the bi-directional `recovery_ref` ⇄ `audit_ref` linkage is a separable concern that depends on engine integration already being in place.

---

## Cross-Phase Risks & Sequencing Notes

1. **Schema lock-in must precede broad engine integration.** If Phase 23 starts before Phase 22's contract test exists, each engine hook becomes a chance to drift the entry shape. Hold the line: Phase 22 release-blocking contract test ships before Phase 23 begins.
2. **Redaction is a single-source rule.** Phase 22 explicitly forbids a second redaction helper. Any temptation in Phase 23 / 24 to "just filter here too" should route back to `tests/helpers/sensitive-output.ts`.
3. **D1 (default on) raises an upgrade-impact concern.** Existing users upgrading to v1.20.0 will silently start producing `.dbcli/audit/` directories. Phase 26 CHANGELOG / README work MUST call this out prominently — this is not just docs polish.
4. **Phase 21's `last-session-id` file is shared mutable state.** Watch for stale `.dbcli/last-session-id` after long-lived shell sessions or PID reuse; plan should include a freshness check (e.g. PID still alive, timestamp within reasonable window).
5. **`audit health` is part of the foundation contract.** Even though CLI-05 lives in Phase 24, the *signals* it surfaces (writer state, lock state, rotation usage) must be exposed by the Phase 21 writer service. Phase 24 is just the CLI surface; Phase 21 plans must include the introspection API.
6. **Phase 23 dry-run handling.** `side_effect_tier = dry-run` from the capability registry needs to be honored — dry-run paths still produce an audit entry, but it must be clear in the entry that no DB mutation occurred. Add explicit test cases for this.
7. **Multi-engine fixture coverage cost.** Phase 23 needs at least one happy-path + one rejection-path entry per engine (SQL × 3, Mongo, Redis, ES = 6 engines). Plan integration test budget accordingly.

---

*Roadmap created: 2026-05-14 from `.planning/REQUIREMENTS.md` (28 REQ-IDs) and `.planning/seeds/v1.20.0-audit-log-milestone.md`. Phase numbering continues from v1.19.1 (last phase = 20).*
