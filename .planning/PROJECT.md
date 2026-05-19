# dbcli — Database CLI for AI Agents

## What This Is

dbcli is a **unified database CLI tool** that enables AI agents (Claude Code, Gemini, Copilot, Cursor) to safely query, discover, and operate on databases. It acts as a bridge between AI agents and multiple database systems (PostgreSQL, MySQL, MariaDB), abstracting away connection complexity, enforcing permission-based access control, and protecting sensitive data via table/column blacklisting. Developers initialize once per project, then AI agents can intelligently interact with the database without requiring manual schema discovery or SQL syntax knowledge.

## Core Value

**AI agents can safely and intelligently access project databases through a single, permission-controlled CLI tool with sensitive data protection.**

Everything else (multi-connection, audit logging, advanced features) can be deferred. This core must work flawlessly.

## Current Milestone: None — v1.20.1 patch shipped, next milestone TBD

**Status (2026-05-18):** v1.20.0 Agent-Facing Audit Log archived 2026-05-17；Phase 23-04 follow-up backlog closed and released as **v1.20.1** patch 2026-05-18 (`feat/audit-wire-6-commands`, merge `60eab9b`；`package.json` 1.20.0 → 1.20.1)。Awaiting `$gsd-new-milestone` to define the next direction. Candidate directions in [Next Milestone Goals](#next-milestone-goals).

**Carried-over backlog:** 無 — Phase 23-04 (`writeAuditEntry` wiring + bi-directional `audit_ref` ⇄ `recovery_ref` on `insert / update / delete / export / q / schema`) shipped 2026-05-18 as v1.20.1，INTEGRATE-01 / INTEGRATE-04 partial 全部結清。

## Requirements

### Validated

**Initialization & Configuration** — v1.0 (Phases 1-4)
- [x] `dbcli init` — Hybrid mode (read .env first, prompt for missing values)
- [x] Support mixed DB system configuration (PostgreSQL, MySQL, MariaDB)
- [x] Parse project .env files automatically
- [x] Store configuration in `.dbcli` (JSON format, DB-system-aware)
- [x] Define coarse-grained permissions: Query-only / Read-Write / Admin

**Schema Discovery & Storage** — v1.0 (Phases 5, 8)
- [x] `dbcli schema [table]` — Retrieve single table structure
- [x] `dbcli list` — List all tables
- [x] Auto-generate `.dbcli` with table structures and relationships
- [x] Support incremental schema refresh

**Query Operations** — v1.0 (Phase 6)
- [x] `dbcli query "SELECT ..."` — Direct SQL query execution
- [x] Respect permission levels (reject writes on Query-only mode)
- [x] Return results in structured format (table, JSON, CSV)
- [x] Provide helpful error messages for failed queries

**Data Modification** — v1.0 (Phase 7)
- [x] `dbcli insert [table]` — Insert data (Auth required, permission-checked)
- [x] `dbcli update [table]` — Update data (Auth required, permission-checked)

**Export** — v1.0 (Phase 8)
- [x] `dbcli export "SELECT ..." --format json|csv` — Export query results

**AI Integration** — v1.0 (Phase 9)
- [x] Create dbcli skill documentation (Claude Code compatible)
- [x] Support cross-platform AI agent usage
- [x] Skill dynamically reflects dbcli capabilities

**Data Access Control** — v0.2.0-beta (Phase 13)
- [x] Table-level blacklisting (reject all operations on blacklisted tables)
- [x] Column-level blacklisting (omit blacklisted columns from SELECT)
- [x] CLI commands for blacklist management (list, add, remove)
- [x] Security notifications in output (table, CSV, JSON formats)

**Multi-Connection Support** — v1.2 (Phase 14)
- [x] `dbcli init --conn-name` — Support multiple named database connections
- [x] `dbcli use` — Switch between named connections
- [x] Global `--use <name>` flag for all commands

**Interactive Shell (REPL)** — v1.2 (Phase 15)
- [x] `dbcli shell` — Interactive mode with SQL and dbcli commands
- [x] Auto-completion and multi-line SQL support
- [x] Persistent command history

**Skill Update Reminders** — v1.3 (Phase 16)
- [x] Automated reminders for outdated AI agent skills
- [x] Background check for skill updates across platforms

**Saved Queries (snippets)** — v1.7
- [x] YAML mini parser + frontmatter / SQL body 安全分析
- [x] 雙層 loader（builtin + project）、`@name` resolver、fuzzy match
- [x] 參數綁定與 `:name` 改寫器、子查詢式 size guard
- [x] CLI：`dbcli q @<name>`、`dbcli queries list / show / new / edit / check`
- [x] Live PostgreSQL 整合測試、模組覆蓋率 ≥ 80%

**Multi-Engine Support** — v1.8
- [x] Elasticsearch adapter：execute / list / schema / write
- [x] ES Docker 整合測試與 `doctor` / `init` / saved-queries 註冊
- [x] Blacklist case-insensitive + dotted path 查找
- [x] Redis / ES `ExecutionResult` 形狀統一
- [x] 早期 unsupported 指令防呆 + 型別 union 補齊

**Agent Task Packs (plan-only)** — v1.9
- [x] 三層目錄 loader、shell-aware argv splitter、frontmatter parser
- [x] Resolver（過濾 / 查找 / 模糊提示）、planner（參數 + 模板渲染）
- [x] 內建任務 `diagnose-slow-query`
- [x] CLI：`dbcli skill tasks list / show / plan`

**Skill 連線設定指引** — v1.9.1
- [x] Skill 文件補上連線設定章節，引導 agent 正確初始化

**Guided Remediation & Multi-turn Recovery** — v1.17.0 (Phases P2-P4)
- [x] `dbcli recover --apply` — 執行自動化復原計畫，具備風險門控 (Risk Gating)
- [x] `dbcli recover --next` — 多輪對話協定 (P2)，支援遞增執行與結果回饋
- [x] 自動存檔機制 — 失敗時自動將 `RecoveryEnvelope` 寫入 `.dbcli/last-recovery.json`
- [x] 驗證步驟 (P4) — 計畫執行後自動執行 `verify` 指令確認問題是否解決
- [x] 信任邊界 — 使用程式碼擁有的白名單 grammar 校驗指令安全，而非信任 Envelope 標籤

**Interactive HTML Dashboards** — v1.18.0
- [x] Standalone React + Recharts + Tailwind dashboard template
- [x] Bun-native bundling and inlining for zero-dependency HTML
- [x] `--ui` flag for instant browser visualization
- [x] `visual:` frontmatter block for KPI and chart configuration
- [x] Secure data injection with HTML escaping and blacklist redaction

**Expanded Antigravity Protocol & Agent Support** — v1.19.0
- [x] Antigravity workflow 加入 Phase 0 (Scout) 與 Phase 3 (Auditor)
- [x] `dbcli skill --install` 支援 Codex (OMX) 與 Windsurf
- [x] `dbcli skill --install cursor` 改用 `.cursor/rules/*.mdc` 專案本地格式
- [x] 新增專案層級 `GEMINI.md` 完整 Antigravity 生命週期指引

**Post-release Contract Stabilization Patch** — v1.19.1
- [x] 型別化能力註冊 `src/adapters/capabilities.ts`（engine × command × side-effect tier）
- [x] 鎖定 agent-facing JSON 合約鍵集合（inspect / report / guide / recovery）
- [x] 共用 `tests/helpers/sensitive-output.ts` 攔截 credential / 秘密片段
- [x] 擴充 saved recovery 指令 redaction 覆蓋率（含 `--config` / `--param` / SQL body）
- [x] `docs/feature-matrix.md` 補 side-effect tier 對照表
- [x] UI bundle determinism 修補（pin `NODE_ENV=production`）
- [x] UI helper 抽離（`format-value` / `resolve-kpi` / `derive-columns`）與 React render smoke 測試覆蓋
- [x] v1.19.1 patch release tag 發佈（2026-05-14）

**Agent-Facing Audit Log** — v1.20.0 (Phases 21–26) + v1.20.1 closure patch
- [x] `.dbcli/audit/<connection>.jsonl` append-only writer + file lock + size/entry rotation (D1, D6)
- [x] `SessionIdService` env-first (`DBCLI_SESSION_ID`) + `<pid>-<unix-ts>-<random>` 自動生成 + `last-session-id` 持久化 (D2)
- [x] Agent-facing `AuditEntry` JSON 合約鎖定 + release-blocking contract test (SCHEMA-*)
- [x] Redaction 統一 `tests/helpers/sensitive-output.ts`；`side_effect_tier` 取自 capability registry (D3)
- [x] `dbcli audit tail / show / clear / health` 全套 CLI；`--all` 跨連線 envelope；`--format table|json` (D4, D5)
- [x] Recovery envelope `recovery_ref` ⇄ `audit_ref` 雙向連結；`audit_recent` 注入 inspect / guide / recover 4 surfaces
- [x] `dbcli skill --install --lang en|zh-TW`；中英雙語 SKILL.md `## Audit Log usage`
- [x] `release-check.sh` 8/8（含 doc-presence）；`docs/feature-matrix.md` audit row + side-effect tier
- [x] Engine 全面整合 — `query`/`plan`/`doctor`/`inspect`/`report`/`guide` 在 v1.20.0 Phase 23 寫入；`insert/update/delete/export/q/schema` 於 2026-05-18 Phase 23-04 follow-up 補完（commits `c39b5a2`/`11dc38e`/`6391f1f`/`82fb348`/`4e31437` 各引擎、`60eab9b` 合併），INTEGRATE-01 / -04 全部結清

### Active

無 — v1.20.0 已歸檔；候選方向見 [Next Milestone Goals](#next-milestone-goals)。

### Out of Scope

Still deferred:

- **Data Import/Bulk Operations** — Large-scale data loading. Use database-native bulk loaders.
- **ORM Generation** — Auto-generate ORM code from schema. Requires deeper AI integration; revisit if demand emerges.
- **Migration Tools** — Schema versioning and migrations. Use existing tools (Flyway, Liquibase, Prisma Migrate).

Originally deferred but later shipped:

- ~~Audit Logging~~ → shipped in **v1.20.0 / v1.20.1** (Phases 21–26 + Phase 23-04 closure)
- ~~Multi-Connection Management~~ → shipped in **v1.2** (Phase 14)
- ~~Interactive SQL Shell~~ → shipped in **v1.2** (Phase 15, `dbcli shell`)

## Context

**Problem:** AI agents don't inherently know how to connect to databases, discover schemas, or execute safe SQL. Developers must manually describe their database structure, which becomes stale quickly. This prevents AI from helping with:
- Quick data queries during debugging
- Schema discovery for ORM generation
- Real-time data validation during development

**Vision:** Inspired by [GSD (Get Shit Done)](https://github.com/gsd-build/get-shit-done), dbcli is a **cross-platform AI workflow tool** that brings database capabilities directly into the AI agent's toolset. Like GSD provides `/gsd:plan-phase`, dbcli provides `/dbcli:query`, `/dbcli:schema`, etc.

**Why Bun + TypeScript:**
- Fast startup time (critical for CLI tools)
- Native TypeScript support without transpilation
- Excellent package ecosystem for database drivers
- Simple to distribute and install via npm

**Why not MCP?**
MPC requires Claude Code-specific integration. We want to support Claude Code, Gemini CLI, Copilot CLI, Cursor, and IDE integrations — so we build dbcli as a **CLI-first tool** with a **skill-based integration layer** that each platform can consume.

## Constraints

- **Tech Stack**: Bun + TypeScript (locked)
- **Testing**: `bun test` for unit and integration tests (locked) — migrated off Vitest pre-v1.6
- **Package Distribution**: npm (locked)
- **Cross-Platform**: Must work on macOS, Linux, Windows
- **Multi-DB Support**: PostgreSQL, MySQL, MariaDB in V1
- **Permission Model**: Coarse-grained roles (Query-only, Read-Write, Admin) + table/column blacklisting
- **AI Safety**: SQL execution must respect permission levels and blacklist rules — no bypass even for root connections

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| CLI-first, not MPC | Need to support Claude Code, Gemini, Copilot, Cursor — a single MCP wouldn't cover all. CLI + skill is more portable. | ✓ Good — enables maximum platform support |
| Coarse-grained permissions | Fine-grained (per-table, per-column) is complex for V1. Coarse roles are sufficient to prevent accidental writes. | ✓ Extended — v0.2.0-beta added table/column blacklisting on top of coarse roles |
| Hybrid init (read .env first) | Minimizes manual input for developers who already have .env. Falls back to prompts for missing values. | — Pending — validate UX in real usage |
| JSON for .dbcli config | Human-readable, widely supported, DB-system-aware (parameters differ per DB). | ✓ Good — v2 config supports multi-connection |
| Multi-connection in V1.2 | Added support for multiple databases per project as it was a highly requested feature for complex environments. | ✓ Good — v1.2.0 shipped |
| No audit logging in V1 | Adds storage, cleanup complexity. Can add if compliance needs emerge. | — Pending |
| Blacklist over fine-grained ACL | Table/column blacklisting is simpler than full RBAC. Covers 90% of sensitive data protection needs. | ✓ Good — v0.2.0-beta shipped; consider RBAC if needed later |
| Audit log 預設 on (v1.20.0 D1) | observability 必須 zero-config 有效；opt-out 由 `.dbcli` 控制 | ✓ Good — v1.20.0 shipped with `audit.enabled = true` default + upgrade warning in CHANGELOG |
| Audit session_id env-first (v1.20.0 D2) | 跨 invocation correlation 需由 agent 安裝器注入；fallback PID 戳記避免空值 | ✓ Good — v1.20.0 shipped; `DBCLI_SESSION_ID` honored + `last-session-id` 持久化 |
| Audit entry metadata-only (v1.20.0 D3) | PII / storage cost 雙重考量；forensics 由 agent 重跑 query 或讀 recovery envelope | ✓ Good — redaction 由 `tests/helpers/sensitive-output.ts` 統一守住 |
| Audit 寫入失敗只警告 (v1.20.0 D6) | audit log 是 observability、不是 safety gate；不可阻擋 DB 操作 | ✓ Good — release gate 含 fail-soft 測試 |
| Phase 23-04 audit-only deltas 拆為 follow-up | DML/DDL 整合與本 milestone 範圍切割成本高；分離的 follow-up phase 更聚焦 | ✓ Good — 於 2026-05-18 補完，6 個 command 全部 wired 並通過 release:check |

## Current State (v1.20.1 — Phase 23-04 Closure Patch: Released 2026-05-18)

**Active milestone:** None — v1.20.0 archived 2026-05-17；v1.20.1 patch released 2026-05-18 (Phase 23-04 closure)。Next milestone TBD; awaiting `$gsd-new-milestone`.

**Latest Release:** v1.20.1 (2026-05-18) — Phase 23-04 closure patch.
- ✅ Phase 23-04 Closure Patch (v1.20.1) — `insert/update/delete/export/q/schema` 補上 `writeAuditEntry` 並具備雙向 `audit_ref` ⇄ `recovery_ref`；`recovery-audit-link.test.ts` 從 J1 negative guard 翻為 6-command positive round-trip；agent-facing skill docs（`assets/SKILL.md` / `assets/SKILL.zh-TW.md` / `assets/reference.md`）與雙語 user docs（`docs/user/en` + `docs/user/zh-TW`，md + html）同步補上全 8 個 `--recovery`-capable command 的覆蓋說明。INTEGRATE-01 / -04 partial 結清。
- ✅ Agent-Facing Audit Log (v1.20.0) — `dbcli audit tail|show|clear|health` CLI; `.dbcli/audit/<connection>.jsonl` writer with rotation; redaction; recovery envelope ↔ audit entry bi-directional linkage on `query`/`inspect`/diagnostic surfaces; `audit_recent` embedded in inspect/guide/recover JSON; bilingual SKILL.md + `--lang en|zh-TW` flag; feature-matrix audit row + release-check step 8/8 doc-presence. Known limitation 由 v1.20.1 補完。
- ✅ Post-release Contract Stabilization Patch (v1.19.1) — 型別化能力註冊、agent-facing JSON 合約鎖定（inspect / report / guide / recovery）、redaction 守則擴充、`docs/feature-matrix.md` side-effect tier 表格、UI bundle determinism (`NODE_ENV=production`)、UI helper 抽離 + render smoke 測試
- ✅ Expanded Antigravity Protocol (v1.19.0) — Phase 0 Scout + Phase 3 Auditor、Codex (OMX) / Windsurf 安裝器、Cursor `.cursor/rules/*.mdc` 遷移、新增 `GEMINI.md`
- ✅ Interactive HTML Dashboards (v1.18.0) — React + Recharts + Tailwind 模板、`--ui` flag、`visual:` frontmatter、安全資料注入
- ✅ Guided Remediation & Multi-turn Recovery (v1.17.0) — `recover --apply` / `--next`、信任邊界、自動驗證 `verify`
- ✅ Broaden Recovery 覆蓋 (v1.16.0) — `insert/update/delete/export/schema/inspect --recovery`、dry-run 步驟
- ✅ Recovery Envelopes (v1.15.0) — `dbcli recovery`、`query/q --recovery`、14 個 recovery code
- ✅ Agent Guide / Report / Inspect (v1.12.0 – v1.14.0) — context snapshot、診斷 report、deterministic guide planner
- ✅ Saved Queries Discovery (v1.11.0) — `queries search` / `suggest`、9 個新診斷 snippet、`intent` frontmatter
- ✅ Packaging & Security Hotfix (v1.10.1) — packaged assets path 修補、`q` blacklist 漏洞修補、lint release-blocking
- ✅ ES / Redis Saved Queries (v1.10.0) — engine strategy refactor、engine-family dispatch
- ✅ Multi-Engine 完整支援 (v1.8.0) — ES adapter 完備、Redis / ES ExecutionResult 統一
- ✅ Saved Queries / snippets (v1.7.0)、Full MongoDB Support (v1.6.0)、Layered Schema Cache (v1.5.0)

**In Progress:** 無 — v1.20.0 已於 2026-05-17 歸檔；唯一 carry-over backlog Phase 23-04 已於 2026-05-18 補完並以 **v1.20.1** patch release 出版（`package.json` 1.20.0 → 1.20.1，CHANGELOG `## [1.20.1]`）。下一個 milestone 主題待規劃（候選方向見 Next Milestone Goals）。

**What's Shipped (v1.20.0):**
1. **`.dbcli/audit/<connection>.jsonl` writer** — append-only JSONL + file lock + size/entry rotation；`SessionIdService` env-first (`DBCLI_SESSION_ID`) + PID 戳記持久化
2. **Agent-facing AuditEntry JSON 合約** — release-blocking contract test 鎖定；redaction 統一回 `tests/helpers/sensitive-output.ts`
3. **Engine 整合（diagnostic surface）** — `query` / `plan` / `doctor` / `inspect` / `report` / `guide` 跨 SQL / Mongo / Redis / Elasticsearch 全寫入同一 entry shape
4. **`dbcli audit` CLI** — `tail`（含 `--all` envelope）/ `show`（UUID + prefix + `--recovery-ref`）/ `clear`（互動確認 + `--yes` 非 TTY guard）/ `health`
5. **Recovery envelope 雙向連結** — `recovery_ref` ⇄ `audit_ref`；`audit_recent` 注入 inspect / guide / recover / recover --apply 4 surfaces
6. **中英雙語 SKILL.md + `--lang` flag** — `dbcli skill --install --lang en|zh-TW`；新 `## Audit Log usage` 章節
7. **Release gate 8/8** — `bun run release:check` 含 typecheck / prettier / lint / test / build / dist-smoke / doc-presence；`docs/feature-matrix.md` audit row + side-effect tier 對照

**What's Shipped (v1.19.1):**
1. **型別化能力註冊** — `src/adapters/capabilities.ts` 明確標註 engine × command × side-effect tier
2. **Agent-facing JSON 合約鎖定** — `inspect` / `report` / `guide` / `recovery` 必要鍵集合與 schema 加上 contract tests
3. **Redaction 守則擴充** — 共用 `tests/helpers/sensitive-output.ts` 攔截 credential / SQL body / `--param` / `--config` 等敏感片段
4. **Side-effect tier 文件** — `docs/feature-matrix.md` 補上 `readonly` / `dry-run` / `local-write` / `db-write` / `interactive` / `none` 對照表
5. **UI bundle determinism** — UI template 建置固定 `NODE_ENV=production`，release formatting gate 維持綠燈
6. **UI helper 抽離 + 測試** — `format-value` / `resolve-kpi` / `derive-columns` 從 `App.tsx` 抽離，新增單元測試與 React render smoke 覆蓋

**What's Shipped (v1.9.1):**
1. **Skill 連線設定指引** — Agent 第一次使用 dbcli 時能依 Skill 指引完成連線設定

**What's Shipped (v1.9.0):**
1. **Agent Task Packs (plan-only)** — 內建 / 全域 / 專案三層 loader、shell-aware argv splitter、frontmatter parser
2. **Resolver + Planner** — 過濾 / 查找 / 模糊提示、參數綁定 + 模板渲染
3. **內建任務** — `diagnose-slow-query`
4. **CLI** — `dbcli skill tasks list / show / plan`

**What's Shipped (v1.8.0):**
1. **Elasticsearch adapter** — execute / list / schema / write 全部完備，含 Docker 整合測試
2. **註冊 ES** — `doctor` / `init` / saved-queries 全面支援
3. **Blacklist 強化** — case-insensitive + dotted path lookup
4. **ExecutionResult 統一** — Redis / ES 共用相同形狀
5. **早期防呆** — unsupported 指令回報 + 型別 union 補齊

**What's Shipped (v1.7.0):**
1. **YAML mini parser** — frontmatter + SQL body 安全分析
2. **雙層 loader** — builtin + project，含 `@name` resolver 與 fuzzy match
3. **參數系統** — 綁定 + `:name` 改寫器 + 子查詢式 size guard
4. **CLI** — `dbcli q @<name>`、`dbcli queries list / show / new / edit / check`
5. **品質** — Live PostgreSQL 整合測試、模組覆蓋率 ≥ 80%

**What's Shipped (v1.6.0):**
1. **Full MongoDB Support** — Extended all core operations to support MongoDB collections
2. **MongoDB Safeguards** — Integrated `blacklist` and `query-size-guard` for MongoDB commands
3. **Improved Skill Installation** — `dbcli skill --install` deploys both `SKILL.md` and `reference.md`
4. **Enhanced Security Model** — `dbcli init` defaults to secure storage in `~/.config/dbcli/`
5. **MongoDB SRV Diagnostics** — `dbcli doctor` reports SRV resolution capabilities

**What's Shipped (v1.5.2):**
1. **Doctor diagnostics for MongoDB SRV** — `dbcli doctor` reports SRV resolution capabilities
2. **MongoDB SRV Connections** — `mongodb+srv://` URIs correctly expanded and connected
3. **Layered Schema Cache (Wave 1)** — integrated file-based persistence for database schemas
4. **Per-connection isolation** — each connection has its own schema directory
5. **Improved Migration UX** — proactive hints during schema migration
6. **Documentation update** — clarified schema storage layout in SKILL.md


**What's Shipped (v1.0.0 and prior):**
1. Full database CLI with init, list, schema, query, insert, update, delete, export
2. Multi-database support (PostgreSQL, MySQL, MariaDB)
3. Permission-based access control (Query-only, Read-Write, Admin)
4. AI integration with SKILL.md generation
5. Schema optimization with LRU cache, atomic updates, and concurrent safety
6. Table and column-level blacklisting
7. npm-published package, cross-platform CI/CD

**See:** [v13.0 Milestone Summary](reports/MILESTONE_SUMMARY-v13.0.md)

## Next Milestone Goals

Potential directions (prioritize based on usage and feedback):

1. **Distributed Schema Management** (if multi-instance deployment needed)
   - Distributed locking (Redis/PostgreSQL advisory locks)
   - Multi-database connections
   - Centralized schema registry

2. **Compliance & Governance** (if regulatory requirements emerge)
   - Query approval workflows
   - Data classification and masking
   - (Audit logging already shipped in v1.20.0 — extend if needed)

3. **AI Enhancement** (if AI agent usage scales)
   - ORM code generation from schema
   - Query suggestions and optimization hints
   - Natural language → SQL translation

4. **Developer Experience** (if adoption metrics suggest)
   - Tab completion for `dbcli shell`
   - Schema diff visualization
   - (REPL shell already shipped in v1.2 — extend if needed)

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:plan-phase → /gsd:execute-phase`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (v0.1.0-beta, v0.2.0-beta, etc.):
1. Archive milestone roadmap and requirements
2. Full review of all sections
3. Core Value check — still the right priority?
4. Audit Out of Scope — reasons still valid?
5. Update Context with learnings from shipped features
6. Define next milestone goals

---

*Last updated: 2026-05-18 — v1.20.1 patch released (Phase 23-04 closure: `insert/update/delete/export/q/schema` audit wiring + bi-directional ref；`package.json` 1.20.0 → 1.20.1；CHANGELOG `## [1.20.1]`). No outstanding backlog; next milestone TBD, awaiting `$gsd-new-milestone`.*
