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

### Active

(No active requirements — milestone complete. Define next milestone with `/gsd:new-milestone`.)

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
| JSON for .dbcli config | Human-readable, widely supported, DB-system-aware (parameters differ per DB). | — Pending — may add YAML alternative if requested |
| Single connection in V1 | Multi-connection adds complexity. Most projects use one primary DB. Can add in V2 if needed. | — Pending |
| No audit logging in V1 | Adds storage, cleanup complexity. Can add if compliance needs emerge. | — Pending |
| Blacklist over fine-grained ACL | Table/column blacklisting is simpler than full RBAC. Covers 90% of sensitive data protection needs. | ✓ Good — v0.2.0-beta shipped; consider RBAC if needed later |

## Current State (v0.2.0-beta — Phase 13 Complete)

**Latest Release:** v0.2.0-beta (2026-03-26)
- ✅ Phase 13 complete: 3 plans executed (1 core + 2 gap closure), verification passed 10/10
- ✅ 230+ tests passing, 83 new blacklist tests added
- ✅ Table and column-level blacklisting fully operational end-to-end
- ✅ All 8 requirements satisfied (BL-01 through BL-04, NF-01 through NF-04)

**What's Shipped (v0.2.0-beta):**
1. Table-level blacklist — reject all operations on blacklisted tables
2. Column-level blacklist — omit blacklisted columns from SELECT results
3. CLI management commands: `blacklist list`, `blacklist table add/remove`, `blacklist column add/remove`
4. Security notifications in table/CSV/JSON output when columns are filtered
5. Context-aware override via `DBCLI_OVERRIDE_BLACKLIST` environment variable
6. Performance: < 1ms overhead per query (7 benchmarks verified)

**What's Shipped (v0.1.0-beta and prior):**
1. Full database CLI with init, list, schema, query, insert, update, delete, export
2. Multi-database support (PostgreSQL, MySQL, MariaDB)
3. Permission-based access control (Query-only, Read-Write, Admin)
4. AI integration with SKILL.md generation
5. Schema optimization with LRU cache, atomic updates, and concurrent safety
6. npm-published package, cross-platform CI/CD

**See:** [v0.1.0-beta Milestone Summary](reports/MILESTONE_SUMMARY-v13.0.md) | [Audit Report](MILESTONE-AUDIT.md)

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

*Last updated: 2026-03-26 after v0.2.0-beta milestone completion*
