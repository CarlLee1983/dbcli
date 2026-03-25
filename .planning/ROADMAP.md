# dbcli Roadmap

## Overview

**[10] phases** | **[19] requirements mapped** | All v1 requirements covered ✓

| # | Phase | Goal | Requirements | Plans | Status |
|---|-------|------|--------------|-------|--------|
| 1 | Project Scaffold | CLI framework, build setup, test infrastructure | — | 1 | ✅ Complete |
| 2 | Init & Config | `dbcli init` with .env parsing and .dbcli config | INIT-01, INIT-03, INIT-04 | 2 | ✅ Complete |
| 3 | DB Connection | Multi-database adapter layer (PostgreSQL, MySQL, MariaDB) | INIT-02 | 2 | ✅ Complete |
| 4 | Permission Model | Coarse-grained permission system | INIT-05 | 1 | Planned |
| 5 | Schema Discovery | `dbcli list` and `dbcli schema` commands | SCHEMA-01, SCHEMA-02, SCHEMA-03 | 2 | Pending |
| 6 | Query Operations | `dbcli query` with structured output and error handling | QUERY-01, QUERY-02, QUERY-03, QUERY-04 | 2 | Pending |
| 7 | Data Modification | `dbcli insert` and `dbcli update` with safeguards | DATA-01, DATA-02 | 2 | Pending |
| 8 | Schema Refresh & Export | Incremental schema updates and data export | SCHEMA-04, EXPORT-01 | 2 | Pending |
| 9 | AI Integration | Skill documentation and cross-platform support | AI-01, AI-02, AI-03 | 2 | Pending |
| 10 | Polish & Distribution | npm publish, cross-platform validation, docs | — | 2 | Pending |

---

## Phase Details

### Phase 1: Project Scaffold

**Goal:** Establish runnable project skeleton with CLI entry point, test framework, and build process.

**Plan:** [01-PLAN.md](.planning/phases/01-project-scaffold/01-PLAN.md) — Single plan with 6 atomic tasks across 1 wave

**Requirements Mapped:** None (infrastructure)

**Key Deliverables:**
- ✓ Bun project initialization (package.json, tsconfig.json, bunfig.toml)
- ✓ Commander.js v13.0+ CLI entry point (src/cli.ts)
- ✓ Directory structure (src/commands/, src/core/, src/adapters/, src/utils/, src/types/)
- ✓ Vitest test framework with 80% coverage threshold (node environment, no jsdom needed)
- ✓ ESLint + Prettier for code quality
- ✓ .gitignore, initial README.md
- ✓ npm bin field pointing to bundled output
- ✓ GitHub Actions matrix CI (macOS, Linux, Windows × Bun 1.3.3 + latest)

**Success Criteria:**
1. `bun run dev -- --help` displays CLI help message
2. `bun test --run` passes 2 smoke tests (--help, --version)
3. `bun run build` produces working executable (dist/cli.mjs)
4. `./dist/cli.mjs --version` works without `bun run` prefix
5. GitHub Actions CI includes matrix testing on all platforms

**Complexity:** Low | **Risk:** Low
**Dependencies:** None | **Estimated Duration:** 1 phase (30-45 min execution time)

**Key Decisions (Locked from research):**
- Commander.js v13.0+ (proven, standard, TypeScript-native)
- Bun's native bundler (integrated, 5ms startup vs Node's 50ms)
- Vitest 1.2+ (10-20x faster than Jest, excellent Bun integration)
- GitHub Actions from day one (catch cross-platform issues early)

**Pitfalls Addressed:**
- Cross-platform testing matrix prevents "works on my Mac" failures
- Build process verified to produce direct executable with correct shebang
- Test infrastructure matches production environment (node, not jsdom for CLI code)
- npm bin field configured correctly (Phase 10 npm publish will depend on this)

---

### Phase 2: Init & Config

**Goal:** Implement `dbcli init` command with .env parsing, interactive prompts, and .dbcli config generation.

**Plans:**
- [02-01-PLAN.md](.planning/phases/02-init-config/02-01-PLAN.md) — Infrastructure (env parser, config module, validation, 7 tasks)
- [02-02-PLAN.md](.planning/phases/02-init-config/02-02-PLAN.md) — Init command implementation (5 tasks)

**Wave Structure:**
- Wave 1: Plan 02-01 (infrastructure, no dependencies)
- Wave 2: Plan 02-02 (init command, depends on 02-01)

**Requirements Mapped:** INIT-01, INIT-03, INIT-04

**Plan 02-01: Infrastructure** ✅ COMPLETE
- ✓ Task 1: TypeScript interfaces (DatabaseEnv, ConnectionConfig, DbcliConfig)
- ✓ Task 2: Custom error classes (EnvParseError, ConfigError)
- ✓ Task 3: Zod validation schemas
- ✓ Task 4: .env parser (DATABASE_URL + DB_* component formats with RFC 3986 support)
- ✓ Task 5: Database defaults module (PostgreSQL, MySQL, MariaDB)
- ✓ Task 6: Immutable config read/write/merge module (copy-on-write semantics)
- ✓ Task 7: Comprehensive unit tests (51 tests, all passing)

**Plan 02-02: Init Command** ✅ COMPLETE
- ✓ Task 1: Interactive prompts module with @inquirer/prompts + fallback
- ✓ Task 2: dbcli init command implementation (hybrid .env + interactive)
- ✓ Task 3: Register init command in CLI entry point
- ✓ Task 4: Integration tests for init flow (13 tests, all passing)
- ✓ Task 5: Verify build and end-to-end execution

**Success Criteria:**
1. In project with `.env`, `dbcli init` auto-fills known values and only prompts missing ones
2. In project without `.env`, `dbcli init` provides complete interactive walkthrough
3. Generated `.dbcli` file has valid JSON format with all required fields
4. Re-running `dbcli init` on existing config prompts for override confirmation
5. All tests pass (unit + integration)
6. `./dist/cli.mjs init --help` works

**Complexity:** Medium | **Risk:** Medium (varies .env formats, Bun prompt library compatibility)
**Dependencies:** Phase 1 | **Estimated Duration:** 2 plans (~90 min execution time)

**Key Decisions (from research):**
- Use @inquirer/prompts with fallback to minimal synchronous prompts for Bun compatibility
- RFC 3986 percent-decoding for DATABASE_URL passwords
- Immutable config operations (copy-on-write semantics, no mutations)
- Zod schemas for validation (type-safe, meaningful error messages)
- Bun.file for config I/O (per CLAUDE.md)

**Pitfalls Addressed:**
- DATABASE_URL percent-encoding (special chars in passwords)
- Incomplete DB_* component variables (validation catches missing values)
- .dbcli file overwrite protection (prompt before rewriting)
- Prompt library hang/timeout risk (fallback system provides graceful degradation)
- Schema defaults not applied (centralized in adapters/defaults.ts)

---

### Phase 3: DB Connection

**Goal:** Create database adapter abstraction layer supporting PostgreSQL, MySQL, MariaDB; validate `.dbcli` config can connect successfully.

**Plans:**
- [03-01-PLAN.md](.planning/phases/03-db-connection/03-01-PLAN.md) — Adapter interface, factory, error mapping (7 tasks, Wave 1)
- [03-02-PLAN.md](.planning/phases/03-db-connection/03-02-PLAN.md) — PostgreSQL/MySQL adapters, init integration, tests (8 tasks, Wave 2)

**Wave Structure:**
- Wave 1: Plan 03-01 (types, factory, error mapping)
- Wave 2: Plan 03-02 (adapter implementations, init integration)

**Requirements Mapped:** INIT-02

**Plan 03-01: Adapter Foundation** ✅ COMPLETE
- ✓ Task 1: Define DatabaseAdapter interface and types
- ✓ Task 2: Create AdapterFactory for database-system-aware instantiation
- ✓ Task 3: Implement error-mapper with categorized error messages and hints
- ✓ Task 4: Create public exports in src/adapters/index.ts
- ✓ Task 5: Write unit tests for AdapterFactory instantiation logic
- ✓ Task 6: Write unit tests for error-mapper error categorization
- ✓ Task 7: Verify full test suite passes and types compile

**Plan 03-02: Adapter Implementation** ✅ COMPLETE
- ✓ Task 1: Implement PostgreSQLAdapter with Bun.sql (243 lines)
- ✓ Task 2: Implement MySQLAdapter with Bun.sql for MySQL and MariaDB (244 lines)
- ✓ Task 3: Update AdapterFactory to import real adapter implementations
- ✓ Task 4: Add connection testing to dbcli init command
- ✓ Task 5: Write integration tests for PostgreSQL adapter (9 tests)
- ✓ Task 6: Write integration tests for MySQL adapter (9 tests)
- ✓ Task 7: Update init integration tests to include connection testing scenarios (3 tests)
- ✓ Task 8: Verify full test suite and build (99 tests pass, 0 fail)

**Success Criteria:**
1. `dbcli init` successfully tests PostgreSQL connection
2. `dbcli init` successfully tests MySQL connection
3. Connection failures display clear error messages with troubleshooting hints
4. All error categories recognized (ECONNREFUSED, ETIMEDOUT, AUTH_FAILED, ENOTFOUND, UNKNOWN)
5. Adapter interface enables clean CLI commands without driver-specific imports

**Complexity:** Medium | **Risk:** Medium (driver compatibility, Bun native module support)
**Dependencies:** Phase 1, 2 | **Estimated Duration:** 2 phases

**Key Decisions (from research):**
- Use Bun's native SQL API (Bun.sql) for PostgreSQL, MySQL, MariaDB — zero npm dependencies, unified API
- Adapter pattern decouples CLI commands from driver implementations
- Single connection per CLI invocation (no pooling needed for CLI tool)
- Comprehensive error mapping (5 categories) with actionable troubleshooting hints
- Validate connection before saving config (fail fast with clear feedback)

**Pitfalls to Avoid:**
- Bun.sql documentation lag (docs may show only SQLite examples; verify PostgreSQL/MySQL support)
- Connection timeout not configurable (expose timeout in ConnectionOptions)
- localhost vs 127.0.0.1 hostname resolution issues (provide both in error hints)
- Error messages leaking sensitive info (sanitize URLs in error output)
- MySQL vs MariaDB dialect differences (test both systems separately, use single adapter for compatibility)

---

### Phase 4: Permission Model

**Goal:** Implement coarse-grained permission system for all subsequent commands.

**Plans:**
- [04-01-PLAN.md](.planning/phases/04-permission-model/04-01-PLAN.md) — SQL classifier and permission enforcement (4 tasks, Wave 1)

**Wave Structure:**
- Wave 1: Plan 04-01 (SQL classifier, permission guard, tests)

**Requirements Mapped:** INIT-05

**Plan 04-01: Permission Guard** 📋 PLANNED
- Task 1: Implement SQL classifier with statement normalization and keyword extraction
- Task 2: Implement permission guard module with classification and enforcement
- Task 3: Write comprehensive unit tests for SQL classifier and permission enforcement (40+ cases)
- Task 4: Integrate permission-guard module into project and verify full test suite

**Key Work Items:**
- Define three permission levels with capability matrix:
  - **Query-only**: SELECT, schema, list, export only
  - **Read-Write**: + INSERT, UPDATE
  - **Admin**: + DELETE, DROP, ALTER
- Implement `PermissionGuard` module (SQL statement classification + permission check)
- Build SQL statement classifier (parse keywords: SELECT, INSERT, UPDATE, DELETE, ALTER, DROP)
- Store permission level in `.dbcli` config (✓ already done in Phase 2)
- Add permission selection step to `dbcli init` (✓ already done in Phase 2)

**Success Criteria:**
1. Query-only mode rejects INSERT with clear error message
2. Read-Write mode rejects DROP TABLE with clear error message
3. Admin mode allows all operations (SELECT, INSERT, UPDATE, DELETE, DROP)
4. Permission checks work with CTE, subqueries, and edge cases

**Complexity:** Low-Medium | **Risk:** Low (SQL classification edge cases)
**Dependencies:** Phase 2, 3 | **Estimated Duration:** 1 phase (~20 min execution time)

**Key Decisions (from research):**
- Lightweight regex + keyword detection (not full SQL parser) for CLI permission checking
- Character state machine for comment/string handling (more reliable than regex)
- Outer keyword determines classification (CTE/subquery/UNION don't change operation type)
- Default-deny approach: if confidence is LOW, user must use admin mode
- No external dependencies (pure TypeScript string processing)

**Pitfalls to Avoid:**
- Comment keywords not stripped (→ use character state machine, not regex)
- CTE + dangerous operation misclassified (→ classify by outer keyword, not CTE presence)
- String literals with keywords blocked incorrectly (→ strip strings before keyword extraction)
- Parameterized queries interfering (→ remove ? and $N before processing)
- Over-blocking due to LOW confidence (→ explicit confidence levels, allow safe patterns)

---

### Phase 5: Schema Discovery

**Goal:** Implement `dbcli list` and `dbcli schema [table]` commands; populate `.dbcli` with schema metadata for offline AI reference.

**Requirements Mapped:** SCHEMA-01, SCHEMA-02, SCHEMA-03

**Key Work Items:**
- Implement per-adapter `listTables()` (table name, engine, row count estimate)
- Implement per-adapter `getTableSchema(tableName)` (column name, type, nullable, default, PK/FK)
- Implement per-adapter `getRelationships()` (foreign key constraints)
- Create `dbcli list` command with table-format output
- Create `dbcli schema [table]` command showing detailed structure
- Create `dbcli schema` (no args) to write full database schema to `.dbcli`
- Support `--format json` for AI parsing

**Success Criteria:**
1. `dbcli list` correctly lists all tables (PostgreSQL and MySQL)
2. `dbcli schema users` displays complete column structure with types, constraints, FKs
3. `dbcli schema` populates `.dbcli` schema block; AI can read it offline
4. `--format json` output is valid JSON

**Complexity:** Medium-High | **Risk:** Medium (information_schema query syntax differs per DB)
**Dependencies:** Phase 3, 4 | **Estimated Duration:** 2-3 phases

---

### Phase 6: Query Operations

**Goal:** Implement core `dbcli query` command—the most frequent AI agent interaction point.

**Requirements Mapped:** QUERY-01, QUERY-02, QUERY-03, QUERY-04

**Key Work Items:**
- Implement `dbcli query "SQL"` command
- Integrate Phase 4 PermissionGuard (pre-execution check)
- Implement output formatters (table, JSON, CSV)
- Add query result metadata (row count, execution time, column types)
- Enhance error messages (SQL syntax hints, "Did you mean: [similar_table]?" for missing tables)
- Add safety LIMIT in Query-only mode (auto-append `LIMIT 1000`, configurable)

**Success Criteria:**
1. `dbcli query "SELECT * FROM users"` returns properly formatted results
2. `dbcli query "SELECT * FROM users" --format json` returns valid JSON with metadata
3. Query-only mode rejects `DELETE FROM users`
4. Missing table error suggests: "Did you mean: 'user' or 'users_old'?"
5. Large result sets auto-limit with user notification

**Complexity:** Medium | **Risk:** Low (builds on stable earlier phases)
**Dependencies:** Phase 3, 4, 5 | **Estimated Duration:** 2 phases

---

### Phase 7: Data Modification

**Goal:** Implement `dbcli insert` and `dbcli update` commands with safety safeguards.

**Requirements Mapped:** DATA-01, DATA-02

**Key Work Items:**
- Implement `dbcli insert [table]` with interactive field prompts or JSON stdin
- Implement `dbcli update [table]` requiring WHERE clause, accepting JSON stdin
- Enforce permission checks (Read-Write or Admin required)
- Add pre-execution confirmation (show SQL, require y/n)
- Return confirmation message with affected row count
- Support `--dry-run` mode (show SQL without executing)
- Use parameterized queries to prevent SQL injection

**Success Criteria:**
1. `dbcli insert users --data '{"name":"Alice","email":"a@b.com"}'` inserts and confirms
2. `dbcli update users --where "id=1" --data '{"name":"Bob"}'` updates successfully
3. Query-only mode rejects both commands
4. `--dry-run` shows SQL without side effects
5. Parameterized queries prevent SQL injection

**Complexity:** Medium | **Risk:** Medium (SQL injection prevention critical)
**Dependencies:** Phase 3, 4, 6 | **Estimated Duration:** 2 phases

---

### Phase 8: Schema Refresh & Export

**Goal:** Implement incremental schema updates and data export with streaming support.

**Requirements Mapped:** SCHEMA-04, EXPORT-01

**Key Work Items:**
- Implement incremental schema refresh (compare current `.dbcli` with database, update only deltas)
- Generate schema diff report (added/removed/modified tables and columns)
- Implement `dbcli export "SQL" --format json|csv` command
- Support export to stdout (pipe-able) or `--output file.json`
- Implement streaming for large result sets (prevent memory overflow)

**Success Criteria:**
1. Adding table to database, then `dbcli schema --refresh` only updates new entries
2. `dbcli export "SELECT * FROM users" --format csv` outputs valid CSV
3. Exporting 100K rows uses stable memory (streaming not buffering)
4. `dbcli export "..." | jq` works for piped JSON processing

**Complexity:** Medium | **Risk:** Medium (streaming support varies per DB driver)
**Dependencies:** Phase 3, 5, 6 | **Estimated Duration:** 2 phases

---

### Phase 9: AI Integration

**Goal:** Create AI agent-consumable skill documentation; make dbcli first-class tool in AI agent ecosystem.

**Requirements Mapped:** AI-01, AI-02, AI-03

**Key Work Items:**
- Create `dbcli-skill.md` template (Claude Code CLAUDE.md format)
- Implement `dbcli skill` command generating dynamic skill documentation
- Skill content: available commands, parameters, permission levels, usage examples
- Multi-platform support: Claude Code (`.claude/`), Cursor (`.cursorrules`), universal (README)
- Implement `dbcli skill --install` to auto-write skill to AI agent config locations
- Ensure skill updates automatically as dbcli evolves

**Success Criteria:**
1. `dbcli skill` outputs complete skill; AI agents understand all commands
2. `dbcli skill --install claude` writes to `.claude/` directory
3. Skill correctly reflects current permission level (Query-only hides insert/update)
4. Skill examples are copy-paste ready

**Complexity:** Medium | **Risk:** Low (documentation focused; AI platform formats may evolve)
**Dependencies:** Phase 6, 7, 8 (can run parallel) | **Estimated Duration:** 2 phases

---

### Phase 10: Polish & Distribution

**Goal:** Complete cross-platform validation, npm publication, comprehensive documentation; achieve V1 release quality.

**Requirements Mapped:** None (quality & distribution)

**Key Work Items:**
- Cross-platform testing (macOS, Linux, Windows; pay special attention to path separators, shell behavior)
- Configure npm publication (prepublishOnly hook, files whitelist, engines field)
- Verify `npx dbcli` zero-install experience
- Finalize README.md (Quick Start, API Reference, Permission Model, AI Integration Guide)
- Create CHANGELOG.md
- Setup GitHub Actions CI (lint, test, build across OS)
- Performance benchmarks: CLI startup < 200ms, query overhead < 50ms

**Success Criteria:**
1. `npx dbcli init` works on macOS, Linux, Windows
2. npm package size < 5MB
3. CLI cold startup time < 300ms
4. README covers all commands with examples
5. All GitHub Actions CI checks pass

**Complexity:** Medium | **Risk:** Medium (Windows compatibility typically most problematic)
**Dependencies:** All phases 1-9 | **Estimated Duration:** 2-3 phases

---

## Dependency Graph

```
Phase 1 (Scaffold)
    └── Phase 2 (Init & Config)
        ├── Phase 3 (DB Connection)
        │   ├── Phase 4 (Permission Model)
        │   │   ├── Phase 5 (Schema Discovery)
        │   │   │   ├── Phase 6 (Query Operations)
        │   │   │   │   ├── Phase 7 (Data Modification)
        │   │   │   │   └── Phase 8 (Schema Refresh & Export)
        │   │   │   └── Phase 9 (AI Integration) ← Can start after Phase 6
        │   │   └────────────────────────────────────────────┐
        └────────────────────────────── Phase 10 (Polish & Distribution)
```

**Critical Path:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (longest dependency chain)

**Parallelization Opportunities:**
- Phase 9 can start after Phase 6 completes (doesn't need insert/update)
- Phase 8 (Schema Refresh and Export) are independent subtasks (can split developers)

---

## MVP Milestone

**Minimum Viable Product achieved after Phase 6 completion:**
- ✓ Initialize project with `dbcli init`
- ✓ Discover tables with `dbcli list`
- ✓ View table schema with `dbcli schema`
- ✓ Query databases with `dbcli query`
- ✓ Respect permission levels

At this point, dbcli is **usable for read-only AI agent scenarios**. Insert/update and export are nice-to-haves.

---

## Risk Summary

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|-----------|
| Bun native module compatibility (pg, mysql2) | High | Medium | Validate drivers in Phase 3 early; have fallback pure-JS `postgres` driver |
| Windows path/shell differences | Medium | High | Establish cross-platform test matrix in Phase 1; use `node:path` |
| SQL classifier edge cases (CTE, subqueries) | Medium | Medium | Whitelist approach (safe patterns) vs blacklist (risky); add Phase 6 tests |
| `.env` format variability | Low | High | Use mature `dotenv` package + custom `DATABASE_URL` parser |
| AI platform skill format changes | Low | Medium | Template-based design; each platform has separate module; easy to update |
| Large data export memory bloat | Medium | Medium | Force streaming in Phase 8; set reasonable LIMIT defaults |

---

## Success Metrics (Post-Release)

Once V1 ships, track:
- **Installation**: `npm install` time, final package size, CI build time
- **Performance**: CLI startup time, query execution overhead
- **Adoption**: GitHub stars, npm downloads, reported issues/PRs
- **AI Feedback**: Error messages helpful? Skill documentation clear? Permission model intuitive?

---

## Next Steps

1. ✅ PROJECT.md created — captures vision and constraints
2. ✅ REQUIREMENTS.md created — defines 19 specific v1 requirements
3. ✅ ROADMAP.md created — 10 phases with dependencies and success criteria
4. ✅ RESEARCH.md completed (Phase 2) — validates tech stack and patterns
5. ✅ PLAN-01.md created — atomic task breakdown for Phase 1
6. ✅ PLAN-02-01.md and PLAN-02-02.md created — atomic task breakdown for Phase 2
7. ✅ PLAN-03-01.md and PLAN-03-02.md created — atomic task breakdown for Phase 3
8. ✅ PLAN-04-01.md created — atomic task breakdown for Phase 4
9. **→ Ready for execution** — Run `/gsd:execute-phase 04-permission-model` to begin Phase 4

---

*Last updated: 2026-03-25 after Phase 4 planning*
