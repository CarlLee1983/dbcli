# dbcli — Database CLI for AI Agents

## What This Is

dbcli is a **unified database CLI tool** that enables AI agents (Claude Code, Gemini, Copilot, Cursor) to safely query, discover, and operate on databases. It acts as a bridge between AI agents and multiple database systems (PostgreSQL, MySQL, MariaDB), abstracting away connection complexity, enforcing permission-based access control, and protecting sensitive data via table/column blacklisting. Developers initialize once per project, then AI agents can intelligently interact with the database without requiring manual schema discovery or SQL syntax knowledge.

## Core Value

**AI agents can safely and intelligently access project databases through a single, permission-controlled CLI tool with sensitive data protection.**

Everything else (multi-connection, audit logging, advanced features) can be deferred. This core must work flawlessly.

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

### Active

**ES / Redis Saved Queries** — v1.10.0+ (Shipped)
- [x] Engine strategy refactor（SQL / ES / Redis 拆成獨立 strategy）
- [x] ES JSON-aware 參數注入、size guard、body validation、index 欄位
- [x] Redis 命令白名單、raw 參數注入（含警告）、range / SCAN size guard
- [x] 內建診斷 snippet：`es-cluster-health`、`redis-key-stats`
- [x] `q @<name>` 與 `q --dry-run` 依 engine family 分派與格式化
- [x] ES / Redis end-to-end saved query 整合測試

### Out of Scope (V1)

- **Audit Logging** — Who did what, when, why. Deferred to V2 based on usage.
- **Multi-Connection Management** — Support multiple databases per project. V1 focuses on single "default" connection.
- **Interactive SQL Shell** — Similar to `psql` or `mysql` interactive mode. Can add if needed.
- **Data Import/Bulk Operations** — Large-scale data loading. Out of scope for V1.
- **ORM Generation** — Auto-generate ORM code from schema. Deferred to V2 (requires deeper AI integration).
- **Migration Tools** — Schema versioning and migrations. Out of scope (use existing tools like Flyway, Liquibase).

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
- **Testing**: Vitest for unit and integration tests (locked)
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

## Current State (v1.9.1 — Multi-Engine + Agent Task Packs Shipped)

**Latest Release:** v1.9.1 (2026-05-07)
- ✅ Skill 連線設定指引 (v1.9.1) — Skill 文件補上連線設定章節
- ✅ Agent Task Packs plan-only (v1.9.0) — 三層目錄 loader、planner、`diagnose-slow-query`
- ✅ Redis & Elasticsearch 完整支援 (v1.8.0) — adapter、blacklist、ExecutionResult 統一
- ✅ Saved Queries / snippets (v1.7.0) — `q @<name>`、`queries` 子命令、size guard、覆蓋率 ≥ 80%
- ✅ Full MongoDB Support (v1.6.0) — query / insert / update / delete + safeguards
- ✅ MongoDB SRV (v1.5.1 / v1.5.2) — `mongodb+srv://` 與 `doctor` 診斷
- ✅ Layered Schema Cache (v1.5.0) — file-based persistence + per-connection isolation

**In Progress (post-1.9.1, on `main`):** ES / Redis saved query strategies、engine-family dispatch、內建診斷 snippet（`es-cluster-health` / `redis-key-stats`）、ES / Redis end-to-end 整合測試。等待下個 release tag。

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
   - Audit logging (who, what, when)
   - Query approval workflows
   - Data classification and masking

3. **AI Enhancement** (if AI agent usage scales)
   - ORM code generation from schema
   - Query suggestions and optimization hints
   - Natural language → SQL translation

4. **Developer Experience** (if adoption metrics suggest)
   - Interactive REPL shell (like psql)
   - Tab completion
   - Schema diff visualization

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

*Last updated: 2026-05-08 — v1.9.1 released; ES/Redis saved-query work merged on `main`, awaiting next release tag*
