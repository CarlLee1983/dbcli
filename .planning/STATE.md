---
gsd_state_version: 1.0
milestone: null
milestone_name: null
status: between_milestones
last_updated: "2026-05-19T08:30:00.000Z"
last_activity: 2026-05-19
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# STATE.md — Current Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-19)

**Core Value:** AI agents can safely and intelligently access project databases through a single, permission-controlled CLI tool with sensitive data protection.

**Current Focus:** None — v1.20.0 archived 2026-05-17；v1.20.1 Phase 23-04 closure 2026-05-18；**v1.20.2** patch release 2026-05-19（MongoDB MVP 全套支援 + Recovery `--next` per-code branching for connection codes + `brace-expansion ^5.0.6` 安全修補）。下一個 milestone 待 `$gsd-new-milestone` 啟動。

---

## Current Position

Between milestones. No active phase.

- **Phase:** None
- **Plan:** None
- **Status:** v1.20.0 archived 2026-05-17; v1.20.1 Phase 23-04 closure patch released 2026-05-18; v1.20.2 patch released 2026-05-19 (MongoDB MVP + Recovery connection branching + brace-expansion security pin); awaiting next milestone definition
- **Last activity:** 2026-05-19
- **Next step:** `$gsd-new-milestone` — define next milestone (candidate directions in PROJECT.md → Next Milestone Goals)。

**Carried-over backlog:** 無 — Phase 23-04 audit wiring 於 v1.20.1 結清；MongoDB MVP（v1.6.0 起累積）與 Recovery `--next` per-code branching for connection codes 於 v1.20.2 補完（`package.json` 1.20.1 → 1.20.2，新增 CHANGELOG `## [1.20.2]`）。INTEGRATE-01 / INTEGRATE-04 partial 全部結清。Reference: `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`（已更新為全 wired）、`docs/superpowers/plans/2026-05-18-audit-wire-6-commands.md`。

---

## Milestone Status

**v1.20.2 — MongoDB MVP + Recovery Connection Branching Patch:** COMPLETE (2026-05-19)

- MongoDB MVP 全套支援：`q` 升 limited supported（`find` / `aggregate` snippet body）、tiered update-operator safety、nested-path blacklist、path-matcher（exact / dotted / suffix-wildcard）、`$sample` schema 採樣 + `--sample-method` 旗標、`maskMongoRows` 套用於 `query` / `export`、snippets 一級公民化（reference snippets、`queries list/search/suggest` 含 mongo）。
- Recovery `--next` per-code branching for connection codes (MVP)：`buildConnectionBranches` factory + `matchConnectionBranch` resolver、`classify` emit `branches` / `branchFork`、`--branch <id>` 旗標、`NextResult.branchId`、`GuideStep` / `NextResult` / `NextStepOutput` 全鏈 `branchId`；contract test 鎖 doctor↔resolver keyword coupling、6 種 connection envelope snapshot、E2E branching fork / walk / fallback。
- Security: pin `brace-expansion ^5.0.6` 修補 GHSA-jxxr-4gwj-5jf2 ReDoS。
- 雙語 user docs 新增 Agent 修復工作流段落（精簡 walkthrough）與 Recovery Cookbook；`assets/SKILL.md` / `assets/reference.md` 補 `--branch` 旗標、`NextResult.branchId`、MongoDB tier 行為；統一 npm 套件名為 `@carllee1983/dbcli`。
- `package.json` 1.20.1 → 1.20.2；CHANGELOG 新增 `## [1.20.2]`。

**v1.20.1 — Phase 23-04 Closure Patch:** COMPLETE (2026-05-18)

- DML/DDL audit coverage：`insert/update/delete/export/q/schema` 全部寫入 `writeAuditEntry` 並具備雙向 `audit_ref` ⇄ `recovery_ref` linkage；contract test `recovery-audit-link.test.ts` 從 J1 negative guard 翻為 6-command positive round-trip。
- Agent-facing skill docs（`assets/SKILL.md` / `assets/SKILL.zh-TW.md` / `assets/reference.md`）與雙語 user docs（`docs/user/en` + `docs/user/zh-TW`，md + html）同步補上全 8 個 `--recovery`-capable command 的覆蓋說明。
- INTEGRATE-01 / INTEGRATE-04 partial 全部結清；`package.json` 1.20.0 → 1.20.1；CHANGELOG 新增 `## [1.20.1]`。
- Release gate `bun run release:check` 8/8 全綠（含 step 8/8 doc-presence 偵測 `## [1.20.1]` heading）。

**v1.20.0 — Agent-Facing Audit Log:** COMPLETE (2026-05-17)

- Audit log writer + JSON 合約 + `dbcli audit` CLI + recovery envelope 雙向連結 + 強制 redaction 全部 shipped
- 6 phases / 29 plans / 82 commits / 141 files / +22432 / -337
- Known limitation：DML/DDL audit deltas → v1.20.1 patch release 補完
- Archive：`milestones/v1.20.0-ROADMAP.md` / `milestones/v1.20.0-REQUIREMENTS.md`
- 暫緩 seeds（保留）：`conflict-avoidance-resource-index`、`self-verification-correlation`

**v1.19.1 — Post-release Contract Stabilization Patch:** COMPLETE (2026-05-14)

- Typed engine capability registry and command capability boundaries
- Locked inspect / report / guide / recovery JSON contracts for agent-facing flows
- Expanded redaction guards for saved recovery artifacts and sensitive output fragments
- Deterministic production-mode UI bundle plus UI helper / render smoke coverage

**v1.19.0 — Expanded Antigravity Protocol & Agent Support:** COMPLETE (2026-05-11)

- Antigravity workflow 加入 Phase 0 (Scout) 研究階段與 Phase 3 (Auditor) 驗證階段
- `dbcli skill --install` 擴充支援 Codex (OMX) 與 Windsurf 平台
- `dbcli skill --install cursor` 改用 `.cursor/rules/*.mdc` 專案本地格式
- 新增專案層級 `GEMINI.md`，提供完整 Antigravity 生命週期指引

**v1.18.0 — Interactive HTML Dashboards:** COMPLETE (2026-05-11)

- React + Recharts + Tailwind 儀表板模板開發
- Bun-native 資源打包與 inlining 邏輯
- `--ui` 與 `--format html` 指令支援
- Saved-query `visual:` frontmatter 擴展
- 安全性：HTML escaping 與 Blacklist 強制過濾

**v1.17.0 — Guided Remediation & Multi-turn Recovery:** COMPLETE (2026-05-10)

- `dbcli recover --apply` 與 `--next` 指令上線
- 具備風險門控與驗證步驟 (P4) 的自動化復原流程
- 信任邊界強化與 RecoveryEnvelope 標準化

**v1.11.0 — Saved Queries Discovery:** COMPLETE (2026-05-08)

- `queries search` / `queries suggest` 指令上線
- frontmatter 加 optional `intent`，9 個 v1 namespace
- 9 個新內建診斷 snippet (ES x4 / Redis x4 / SQL x1)
- SKILL.md 補上 discovery 流程指引

**v1.10.1 — Packaging & Security Hotfix:** COMPLETE (2026-05-08)

- 修 npm 1.10.0 安裝後 packaged assets path 找不到（`src/utils/package-root.ts`）
- 修 `dbcli q` 略過 blacklist 檢查的安全漏洞
- 新增 `tests/integration/dist-smoke.test.ts` 守護 packaged assets path
- 清掉 45 個 lint warnings 並把 `--max-warnings=0` 設為 release-blocking

**v1.10.0 — ES / Redis Saved Queries:** COMPLETE (2026-05-08)

- Engine strategy refactor (SQL / Elasticsearch / Redis 各自獨立 strategy)
- ES JSON-aware 參數注入、size guard、body validation、index 欄位
- Redis 命令白名單、raw 參數注入（含警告）、range / SCAN size guard
- 內建診斷 snippet：`es-cluster-health`、`redis-key-stats`
- `q @<name>` 與 `q --dry-run` 依 engine family 分派與格式化
- 整合測試：ES / Redis end-to-end saved query 測試

**v1.9.1 — Skill 連線設定指引:** COMPLETE (2026-05-07)

- Skill 文件補上連線設定章節，引導 agent 正確初始化

**v1.9.0 — Agent Task Packs (plan-only 第一版):** COMPLETE (2026-05-06)

- 三層目錄 loader、shell-aware argv splitter、frontmatter parser
- Resolver（過濾 / 查找 / 模糊提示）、planner（參數 + 模板渲染）
- 內建任務 `diagnose-slow-query`
- CLI: `dbcli skill tasks list / show / plan`

**v1.8.0 — Redis & Elasticsearch 完整支援:** COMPLETE (2026-05-06)

- Elasticsearch adapter：execute / list / schema / write 全部完備
- ES Docker 整合測試、`doctor` / `init` / saved-queries 註冊 ES
- Blacklist 改為 case-insensitive 並支援 dotted paths
- Redis / ES `ExecutionResult` 形狀統一
- 早期 unsupported 指令防呆與型別 union 補齊

**v1.7.0 — Saved Queries (snippets):** COMPLETE (2026-05-04)

- YAML mini parser、frontmatter + SQL body 安全分析
- 雙層 loader（builtin + project）、`@name` resolver 與 fuzzy match
- 參數綁定 / `:name` 改寫器、子查詢式 size guard
- CLI：`q @<name>`、`queries list / show / new / edit / check`
- Live PostgreSQL 整合測試，模組覆蓋率 ≥ 80%

**v1.6.0 — Full MongoDB Support:** COMPLETE (2026-04-23)

- MongoDB query / insert / update / delete + blacklist + size guard
- `dbcli skill --install` 同時部署 SKILL.md + reference.md

**Prior milestones:**

- v1.5.x — Layered Schema Cache & MongoDB SRV
- v1.3.0 — Skill Update Reminders
- v1.2.0 — Multi-connection & REPL
- v1.0.0 — Stable Release (DDL & Core)
- v0.2.0-beta — Data Access Control
- v0.1.0-beta — i18n & Schema Optimization

---

## Release Gate

單一事實來源：[`docs/feature-matrix.md`](../docs/feature-matrix.md#required-ci-validation)。
打 release tag 前的完整流程：[`CONTRIBUTING.md → Release Process`](../CONTRIBUTING.md#release-process)。
以下四道指令都必須綠燈、不得 `continue-on-error`，才視為可發版：

| Gate | Command | Status (2026-05-14 +08:00) |
|------|---------|----------------------------|
| Typecheck | `bun run typecheck` | ✅ Pass — included in `bun run release:check` on 2026-05-14 |
| Tests | `bun test` | ✅ Pass — `2151 pass / 3 skip / 0 fail` in `bun run release:check` on 2026-05-14 |
| Lint | `bun run lint` | ✅ Pass — `--max-warnings=0` release-blocking in `bun run release:check` |
| Build | `bun run build` | ✅ Pass — `dist/cli.mjs` and deterministic UI template rebuilt in `bun run release:check` |

Benchmark（`bun run test:perf`）為 advisory，不擋 release。詳見 CONTRIBUTING.md 的 Pre-Release Checklist。

v1.20.0 將在 Phase 22 contract test 與 Phase 26 docs/feature-matrix 更新後，把 audit row 也納入 release gate 文件範圍。

---

## Accumulated Context (carried from previous milestones)

- **Capability registry**（`src/adapters/capabilities.ts`）— v1.19.1 已建立 engine × command × side-effect tier 對應；v1.20.0 audit entry `side_effect_tier` 欄位（SCHEMA-04）直接重用，禁止另外定義 enum（見 Phase 22 success criterion 4）。
- **Agent-facing JSON contract test 模式** — v1.19.1 已鎖定 inspect / report / guide / recovery；v1.20.0 audit entry schema（SCHEMA-02）必須沿用同一風格加 contract test（Phase 22 release-blocking）。
- **Sensitive-output redaction helper**（`tests/helpers/sensitive-output.ts`）— v1.19.1 擴充覆蓋 `--config` / `--param` / SQL body；v1.20.0 必須以此為唯一過濾來源（SCHEMA-03），不得新增第二套 redaction 規則。
- **Recovery envelope**（`.dbcli/last-recovery.json`、`dbcli recover --apply` / `--next`）— v1.17.0 起既有，v1.20.0 在 Phase 25 新增 `recovery_ref` ⇄ `audit_ref` 雙向欄位（INTEGRATE-02 / -03）。
- **Engine family dispatch**（SQL / Mongo / Redis / ES）— audit writer（Phase 23）必須一視同仁，所有引擎使用相同 entry shape；不允許 engine-specific 欄位漂移。
- **`.dbcli` config migration pattern** — 既有 connection 升級時 `audit.*` 缺欄位以預設值補齊（CONFIG-03 / Phase 21），沿用前述 milestone 的 migration 慣例。
- **Phase 25 J1 asymmetry — RESOLVED 2026-05-18 (Phase 23-04 closure)** — Bi-directional `recovery_ref` / `audit_ref` shipped on `query` + `inspect` in Phase 25 (v1.20.0); the remaining 6 commands (`insert / update / delete / export / q / schema`) were wired on 2026-05-18 (`feat/audit-wire-6-commands`, merge `60eab9b`). Contract test `tests/integration/recovery-audit-link.test.ts` is now a consolidated 6-command **positive** round-trip (commit `4629e51`) — the legacy J1 negative guard was deleted in the same commit. See `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` for the refreshed coverage table.

---

## Key Decisions Made

| Decision | Rationale | Status |
|----------|-----------|--------|
| Bun + TypeScript | Fast startup (important for CLI), native TS support | Locked |
| CLI-first, not MPC | Supports Claude Code, Gemini, Copilot, Cursor | Locked |
| Coarse-grained permissions + blacklist | Coarse roles + table/column blacklisting covers security needs | Locked |
| Hybrid init (read .env first) | Minimizes manual input for developers with existing configs | Locked |
| Blacklist over fine-grained ACL | Simpler, covers 90% of sensitive data protection needs | Locked |
| v1.20.0 audit log 預設 on | observability 必須 zero-config 有效；opt-out 由 `.dbcli` `audit.enabled = false` 控制 | Locked (D1) |
| v1.20.0 session_id env-first | `DBCLI_SESSION_ID` 優先，缺則自動生成；agent 安裝器可注入跨 invocation id | Locked (D2) |
| v1.20.0 不含 result preview | Entry 為 metadata-only，避免 PII；forensics 需要時 agent 重跑 query 或讀 recovery envelope | Locked (D3) |
| v1.20.0 multi-connection 每連線一檔 + `--all` merge | 儲存層保持單純，merge 邏輯只活在 CLI 層 | Locked (D4) |
| v1.20.0 tail 反序時序 | 最新在下，類 `git log`；agent-facing JSON 為扁平陣列 | Locked (D5) |
| v1.20.0 寫入失敗只警告 | audit log 為 observability 而非 safety gate；不可阻擋主指令 | Locked (D6) |
| v1.20.0 phase 編號續用 21–26 | 承續 v1.19.1 第 20 個 phase；未 `--reset-phase-numbers` | Locked (2026-05-14 roadmap) |

---

## Contacts & References

- **Project repo**: `/Users/carl/Dev/CMG/Dbcli`
- **Planning docs**: `.planning/`
- **Reference**: GSD methodology — https://github.com/gsd-build/get-shit-done
- **Active seed**: `.planning/seeds/v1.20.0-audit-log-milestone.md`
- **Deferred seeds**: `.planning/seeds/conflict-avoidance-resource-index.md`、`.planning/seeds/self-verification-correlation.md`
- **Active roadmap**: `.planning/ROADMAP.md`（Phase 21–26）
- **Active requirements**: `.planning/REQUIREMENTS.md`（28 REQ-IDs，全部 mapped）

---

*Last updated: 2026-05-18 — v1.20.1 patch release shipped (Phase 23-04 closure: `insert/update/delete/export/q/schema` audit + bi-directional ref wiring；`package.json` 1.20.0 → 1.20.1；CHANGELOG `## [1.20.1]`)。狀態維持 `between_milestones`，已無未結 backlog；下一個 milestone 待 `$gsd-new-milestone` 啟動。*
