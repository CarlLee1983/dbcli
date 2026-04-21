# Milestones

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
