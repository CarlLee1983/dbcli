# Milestones

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
