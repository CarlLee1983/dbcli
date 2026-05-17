# Milestones

## v1.20.0 — Agent-Facing Audit Log (Shipped: 2026-05-17)

**Scope:** 為 AI agent 補上跨 session / 跨 invocation 的「歷史活動」維度。Append-only JSONL audit store、agent-facing JSON 合約 + redaction、`dbcli audit` 全套 CLI、recovery envelope 雙向連結，皆於 v1.20.0 一次到位。Phase 21–26 / 29 plans / 6 phases。

**Key accomplishments:**
- **Audit Writer Foundation (Phase 21)** — `.dbcli/audit/<connection>.jsonl` append-only writer + file lock + size/entry rotation cap；`SessionIdService` env-first（`DBCLI_SESSION_ID`）+ PID 戳記持久化；`audit.*` config schema 預設 on（D1），寫入失敗只 stderr 警告 + 主指令照跑（D6）。
- **Entry Schema & Redaction Contract (Phase 22)** — agent-facing `AuditEntry` JSON 合約鎖定（release-blocking contract test），redaction 統一回 `tests/helpers/sensitive-output.ts`（不允許第二套），`side_effect_tier` 直接讀 `src/adapters/capabilities.ts`（不重複定義 enum）。
- **Engine Integration (Phase 23, Partial)** — `query` / `plan` / `doctor` / `inspect` / `report` / `guide` 在 SQL / Mongo / Redis / Elasticsearch 全部寫入同一 entry shape（含 blacklist / permission / parser 拒絕路徑）；DML/DDL（`insert/update/delete/export/q/schema`）延後到 v1.21.x Phase 23-04 backlog。
- **`dbcli audit` CLI (Phase 24)** — `tail`（單連線 + `--all` 跨連線 envelope, D5 反序）、`show <id>`（UUID + ≥4 prefix + `--recovery-ref`）、`clear`（互動確認 + `--yes` 非 TTY guard）、`health`（writer / lock / rotation 健康）；`--format table|json` 雙輸出，JSON 為扁平陣列供 agent 直接消費。
- **Recovery Envelope Bi-directional Linkage (Phase 25)** — audit entry `recovery_ref` ⇄ `last-recovery.json` `audit_ref` 雙向連結；`audit_recent` 注入 4 個 agent guide surface（inspect / guide / recover / recover --apply），release-blocking contract test 守住 round-trip 與 J1 scope（query + inspect catch blocks）。
- **Docs, Skill & Release Gate (Phase 26)** — `SKILL.md` 中英雙語 + 新 `## Audit Log usage` 章節 + `dbcli skill --install --lang en|zh-TW` flag；`docs/feature-matrix.md` audit row + side-effect tier 對照；`package.json` 1.19.1 → 1.20.0 + CHANGELOG `## [1.20.0]`；`release-check.sh` step 8/8 doc-presence；README en/zh-TW + `docs/user/*` 4-file parity。

**Release gate:** `bun run release:check` 8/8 全綠（typecheck / prettier / lint `--max-warnings=0` / `bun test` / build / dist-smoke / doc-presence）。

**Known deferred items:** Phase 23-04（`insert/update/delete/export/q/schema` audit-only deltas）— 文件記錄於 `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`，下一個 milestone backlog 處理。

**Stats:** 6 phases / 29 plans / 82 commits (3a2834d..6f30a62) / 141 files changed / +22,432 / -337 lines / 2026-05-15 → 2026-05-17 (3 days)

---

## v1.19.1 — Post-release Contract Stabilization Patch (Shipped: 2026-05-14)

**Scope:** 將 v1.19.0 後在 `main` 累積的合約穩定化工作打包成 patch release。無新使用者可見功能，聚焦於 agent-facing 合約強化、安全守則擴充與建置決定性。

**Key accomplishments:**
- 引入 `src/adapters/capabilities.ts` 型別化能力註冊（engine × command × side-effect tier），對齊 `docs/feature-matrix.md`。
- 鎖定 agent-facing JSON 合約：`inspect` / `report` / `guide` / `recovery` 必要鍵集合與 schema，並補上 contract tests。
- 共用 `tests/helpers/sensitive-output.ts` 攔截 credential 與秘密片段；擴充 saved recovery 指令的 redaction 覆蓋率（含 `--config` / `--param` / SQL body）。
- `docs/feature-matrix.md` 補上 side-effect tier 對照表（`readonly` / `dry-run` / `local-write` / `db-write` / `interactive` / `none`）。
- UI bundle 固定 `NODE_ENV=production` 保證 build 決定性；release formatting gate 維持綠燈。
- UI 模板抽離純函式 helper（`format-value` / `resolve-kpi` / `derive-columns`）並補上單元測試與 React render smoke 覆蓋。

**Release gate:** `bun run release:check` 全綠（typecheck / `bun test` 2151 pass / lint `--max-warnings=0` / build）。

---

## v1.19.0 — Expanded Antigravity Protocol & Agent Support (Shipped: 2026-05-11)

**Scope:** Antigravity 工作流擴充（Scout / Auditor 階段）與新增 agent 平台支援。

**Key accomplishments:**
- 在核心 agentic workflow 中加入 **Phase 0 (Scout)** 研究階段與 **Phase 3 (Auditor)** 驗證階段。
- `dbcli skill --install` 擴充支援 **Codex (OMX)** 與 **Windsurf**。
- `dbcli skill --install cursor` 改用現代 `.cursor/rules/*.mdc` 專案本地格式。
- 新增 `GEMINI.md` 專案層級指令檔，提供完整 Antigravity 生命週期指引。

**Post-release stabilization:** 上述穩定化工作已於 2026-05-14 隨 **v1.19.1** patch release 發佈，詳見上方 v1.19.1 條目。

---

## v1.18.0 — Interactive HTML Dashboards (Shipped: 2026-05-11)

**Scope:** React-based standalone HTML reports, `--ui` flag, `visual:` frontmatter block, and secure data injection.

**Key accomplishments:**
- Developed a standalone React + Recharts + Tailwind dashboard template.
- Built-in Bun-native bundling and inlining logic for zero-dependency HTML output.
- New `--ui` flag across `query`, `q`, and `export` for instant browser visualization.
- Extended saved-query parser to support `visual:` metadata (KPIs and Charts).
- Hardened data injection contract with HTML escaping and mandatory blacklist redaction.
- Automatic browser opening with `DBCLI_NO_OPEN` safety guard.

---

## v1.17.0 — Guided Remediation & Multi-turn Recovery (Shipped: 2026-05-10)

**Scope:** P3 (recover --apply), P4 (Verification step), and P2 (Multi-turn protocol).

**Key accomplishments:**
- New `dbcli recover --apply` command to execute saved recovery plans under risk gating.
- **P2 Multi-turn Protocol**: New `dbcli recover --next` command to advance recovery one step at a time with result payloads, allowing deterministic branching.
- Auto-save of `RecoveryEnvelope` to `.dbcli/last-recovery.json` on any `--recovery` failure.
- Robust risk gating with authoritative code-owned allowlist (trust boundary).
- Support for `--allow-write=readonly-cmd` and `--allow-write=write-cmd` tiers.
- Automatic verification step (`verify`) run after successful plan execution to confirm fix.
- New `GuideStep` fields: `interactive`, `dbWrite`, `placeholders`.
- Full aggregated JSON and Markdown output for recovery execution results.
- Comprehensive documentation in `SKILL.md` and `reference.md`.

---

## v1.11.0 — Saved Queries Discovery (Shipped: 2026-05-08)

**Scope:** Make snippets discoverable for AI agents — keyword search, intent-prefix suggest, 9 new diagnostic snippets, expanded SKILL.md.

**Key accomplishments:**
- New `dbcli queries search <keywords>` — token-based fuzzy ranking (deterministic, no external dep).
- New `dbcli queries suggest <intent>` — intent prefix matching.
- New optional `intent` frontmatter field, validated against `^[a-z][a-z0-9.-]*$`.
- 9 v1 built-in intent namespaces (`perf.*`, `capacity.*`, `safety.*`, `monitor.*`).
- 9 new diagnostic snippets: ES x4 (hot-threads, index-stats, unassigned-shards, pending-tasks); Redis x4 (slowlog, client-list, memory-usage, cluster-info); SQL x1 (blocking-queries.postgres).
- Backfilled `intent` on 18 existing built-in snippets.
- SKILL.md gained "When you don't know which query to run" section.
- MongoDB saved-query support remains out of scope (runner.ts:26-29 rejection still in place).

---

## v1.6.0 — Full MongoDB Support & Improved Skill Installation (Shipped: 2026-04-23)

**Scope:** Phase 20 (Full MongoDB DML, diagnostics, documentation refactor)

**Key accomplishments:**
- **Full MongoDB Support**: Extended query, insert, update, and delete support to MongoDB.
- **Safeguards**: Integrated `blacklist` and `query-size-guard` for MongoDB.
- **Improved Skill Installation**: `dbcli skill --install` now deploys both `SKILL.md` and `reference.md`.
- **Enhanced Security Model**: Secure connection storage in `~/.config/dbcli/` by default.

---

## v1.5.2 — MongoDB SRV Diagnostics (Shipped: 2026-04-22)

**Scope:** Fixes for MongoDB SRV environment reporting.

**Key accomplishments:**
- **Doctor diagnostics for MongoDB SRV**: `dbcli doctor` now reports SRV resolution capabilities.
- **Documentation**: Clarified MongoDB SRV environment diagnostic in README and `SKILL.md`.

---

## v1.5.1 — MongoDB SRV Expansion (Shipped: 2026-04-22)

**Scope:** Support for mongodb+srv:// URIs.

**Key accomplishments:**
- **MongoDB SRV Connections**: `mongodb+srv://` URIs are now correctly expanded and connected.
- **Database Consistency**: MongoDB operations now consistently use the database configured in the connection string or options.

---

## v1.5.0 — Layered Schema Cache & Multi-Connection Isolation (Shipped: 2026-04-21)

**Scope:** Phase 18 (1 phase, 3 plans)

**Key accomplishments:**
- **Layered Schema Cache**: Integrated file-based persistence for database schemas with hot/cold loading.
- **Per-connection isolation**: Each named connection now has its own schema directory (`.dbcli/schemas/<connection>/`).
- **Improved Migration UX**: Added proactive hints during schema migration to ensure data consistency.
- **Documentation Update**: Updated `SKILL.md` with connection-aware schema isolation details.

---

## v1.3.0 — Skill Update Reminders (Shipped: 2026-04-02)

**Scope:** Phase 16

**Key accomplishments:**
- Automated reminders for updating AI agent skills (`SKILL.md`).
- Background check in CLI that notifies if installed skills are outdated.
- Support for checking skills in `.claude/`, `.local/share/gemini/`, etc.

---

## v1.2.0 — Multi-connection Support & Interactive Shell (Shipped: 2026-03-31)

**Scope:** Phase 14-15

**Key accomplishments:**
- Support for multiple named database connections in a single project.
- Global `--use <name>` flag to execute commands against a specific connection.
- Interactive database shell (`dbcli shell`) with SQL + dbcli command support.
- Context-aware auto-completion and multi-line SQL accumulation.

---

## v0.2.0-beta — Data Access Control (Shipped: 2026-03-26)

**Scope:** Phase 13 (1 phase, 3 plans)

**Key accomplishments:**
- Table and column-level blacklisting with O(1) Set/Map lookups
- CLI management commands (blacklist list/table/column add/remove)
- Security notifications in all output formats (table, CSV, JSON)
- End-to-end CLI wiring across all 4 execution commands
- Context-aware override via DBCLI_OVERRIDE_BLACKLIST env var
- 103 new tests, < 1ms performance overhead

---

## v0.1.0-beta — Core Functionality + i18n + Schema Optimization (Shipped: 2026-03-26)

**Scope:** Phases 1-12 (12 phases, 25 plans)

**Key accomplishments:**
- Full database CLI: init, list, schema, query, insert, update, delete, export
- Multi-database support (PostgreSQL, MySQL, MariaDB)
- Permission-based access control (Query-only, Read-Write, Admin)
- AI integration with dynamic SKILL.md generation
- Schema optimization with LRU cache, atomic updates, concurrent safety
- i18n system (English primary + Traditional Chinese)
- npm-published package, cross-platform CI/CD

---
