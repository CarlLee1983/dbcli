# Milestones

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
