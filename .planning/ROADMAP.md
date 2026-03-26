# dbcli Roadmap

## Overview

**[10] phases** | **[19] requirements mapped** | All v1 requirements covered ✓

| # | Phase | Goal | Requirements | Plans | Status |
|---|-------|------|--------------|-------|--------|
| 1 | Project Scaffold | CLI framework, build setup, test infrastructure | — | 1 | ✅ Complete |
| 2 | Init & Config | `dbcli init` with .env parsing and .dbcli config | INIT-01, INIT-03, INIT-04 | 2 | ✅ Complete |
| 3 | DB Connection | Multi-database adapter layer (PostgreSQL, MySQL, MariaDB) | INIT-02 | 2 | ✅ Complete |
| 4 | Permission Model | Coarse-grained permission system | INIT-05 | 1 | ✅ Complete |
| 5 | Schema Discovery | `dbcli list` and `dbcli schema` commands | SCHEMA-01, SCHEMA-02, SCHEMA-03 | 2 | ✅ Complete |
| 6 | Query Operations | `dbcli query` with structured output and error handling | QUERY-01, QUERY-02, QUERY-03, QUERY-04 | 2 | ✅ Complete |
| 7 | Data Modification | `dbcli insert`, `dbcli update`, `dbcli delete` with safeguards | DATA-01, DATA-02 | 3 | ✅ Complete |
| 8 | Schema Refresh & Export | Incremental schema updates and data export | SCHEMA-04, EXPORT-01 | 2 | ✅ Complete |
| 9 | AI Integration | Skill documentation and cross-platform support | AI-01, AI-02, AI-03 | 2 | ✅ Complete |
| 10 | Polish & Distribution | npm publish, cross-platform validation, docs | — | 2 | ⏳ In Progress (1/2) |
| 11 | Schema Optimization | Hybrid storage + LRU cache + atomic updates for 100-500 table support | — | 2 | 📋 Planned (0/2) |

---
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

**Plan 04-01: Permission Guard** ✅ COMPLETE
- ✓ Task 1: Implement SQL classifier with statement normalization and keyword extraction
- ✓ Task 2: Implement permission guard module with classification and enforcement
- ✓ Task 3: Write comprehensive unit tests for SQL classifier and permission enforcement (82 cases)
- ✓ Task 4: Integrate permission-guard module into project and verify full test suite

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

**Plans:**
- [05-01-PLAN.md](.planning/phases/05-schema-discovery/05-01-PLAN.md) — Adapter enhancements + formatters (9 tasks, Wave 1)
- [05-02-PLAN.md](.planning/phases/05-schema-discovery/05-02-PLAN.md) — CLI commands + integration (8 tasks, Wave 2)

**Wave Structure:**
- Wave 1: Plan 05-01 (enhance adapters with FK extraction, create formatters)
- Wave 2: Plan 05-02 (list and schema commands, CLI registration)

**Requirements Mapped:** SCHEMA-01, SCHEMA-02, SCHEMA-03

**Plan 05-01: Adapter & Formatter Infrastructure** ✅ COMPLETE
- ✓ Task 1: Extend ColumnSchema and TableSchema interfaces with FK metadata
- ✓ Task 2: Enhance PostgreSQL adapter getTableSchema with FK extraction
- ✓ Task 3: Enhance MySQL adapter getTableSchema with FK extraction
- ✓ Task 4: Create table-formatter.ts for CLI table output
- ✓ Task 5: Create json-formatter.ts for AI-parseable output
- ✓ Task 6: Create formatters index.ts with exports
- ✓ Task 7: Write unit tests for table-formatter
- ✓ Task 8: Write unit tests for json-formatter
- ✓ Task 9: Run full test suite and verify build

**Plan 05-02: Commands & Integration** ✅ COMPLETE
- ✓ Task 1: Implement `dbcli list` command
- ✓ Task 2: Implement `dbcli schema [table]` and `dbcli schema` commands
- ✓ Task 3: Register list and schema commands in CLI
- ✓ Task 4: Write integration tests for `dbcli list` command
- ✓ Task 5: Write integration tests for `dbcli schema` command
- ✓ Task 6: Update .dbcli config to support schema field
- ✓ Task 7: Verify CLI help and manual testing setup
- ✓ Task 8: Run full test suite and verify build

**Success Criteria:**
1. `dbcli list` correctly lists all tables (PostgreSQL and MySQL)
2. `dbcli list --format json` outputs valid JSON
3. `dbcli schema users` displays complete column structure with types, constraints, FKs
4. `dbcli schema [table] --format json` outputs full metadata
5. `dbcli schema` (no args) scans database and populates `.dbcli` schema block
6. All formatters work correctly (table + JSON output)
7. All tests pass (unit + integration)
8. Build succeeds

**Complexity:** Medium-High | **Risk:** Medium (information_schema query syntax differs per DB)
**Dependencies:** Phase 3, 4 | **Estimated Duration:** 2 plans (~120 min execution time)

**Key Decisions (from research):**
- Extend adapter interfaces to capture FK relationships for AI-friendly schema output
- Separate output formatters (table vs JSON) for human and machine consumption
- Store complete schema metadata in `.dbcli` for offline AI reference
- Use information_schema queries (database-specific) for schema introspection
- Progress tracking for large database scans
- --force flag to skip confirmation on schema overwrite

**Pitfalls to Avoid:**
- Missing FK references (affects AI JOIN generation)
- Row count performance on large tables (use estimates, not exact counts)
- Character encoding issues in column names/types (use UTF-8, test with non-ASCII identifiers)
- Incomplete schema after partial scan (collect in memory, write once at end)
- Schema drift undetected (add --refresh flag for manual updates)

---

### Phase 6: Query Operations

**Goal:** Implement core `dbcli query` command—the most frequent AI agent interaction point.

**Plans:**
- [06-01-PLAN.md](.planning/phases/06-query-operations/06-01-PLAN.md) — Query formatters and utilities (9 tasks, Wave 1)
- [06-02-PLAN.md](.planning/phases/06-query-operations/06-02-PLAN.md) — Query command and integration (6 tasks, Wave 2)

**Wave Structure:**
- Wave 1: Plan 06-01 (QueryResult types, formatters: table/json/csv, utilities: Levenshtein distance, error suggestion)
- Wave 2: Plan 06-02 (QueryExecutor, query command, CLI registration, tests)

**Requirements Mapped:** QUERY-01, QUERY-02, QUERY-03, QUERY-04

**Plan 06-01: Query Formatters & Utilities** ✅ COMPLETE
- Task 1: Create QueryResult type definitions with metadata ✓
- Task 2: Implement QueryResultFormatter for table/json/csv output ✓
- Task 3: Update formatters index to export QueryResultFormatter ✓
- Task 4: Implement Levenshtein distance utility ✓
- Task 5: Implement error suggester utility for missing table detection ✓
- Task 6: Unit tests for QueryResultFormatter ✓ (27 tests)
- Task 7: Unit tests for Levenshtein distance ✓ (17 tests)
- Task 8: Unit tests for error suggester ✓ (19 tests)
- Task 9: Run full test suite and verify build ✓ (221 tests total, 0 failures)

**Plan 06-02: Query Command & Integration** ✅ COMPLETE
- Task 1: Implement QueryExecutor class with permission checks and execution ✓
- Task 2: Implement query command with CLI interface ✓
- Task 3: Register query command in CLI entry point ✓
- Task 4: Unit tests for query command logic ✓
- Task 5: Integration tests for query command (real database) ✓
- Task 6: Run full test suite and verify build ✓

**Success Criteria:**
1. `dbcli query "SELECT * FROM users"` returns properly formatted results
2. `dbcli query "SELECT * FROM users" --format json` returns valid JSON with metadata
3. Query-only mode rejects `DELETE FROM users`
4. Missing table error suggests: "Did you mean: 'user' or 'users_old'?"
5. Large result sets auto-limit with user notification
6. All tests pass (unit + integration)
7. Build succeeds

**Complexity:** Medium | **Risk:** Low (builds on stable earlier phases)
**Dependencies:** Phase 3, 4, 5 | **Estimated Duration:** 2 plans (~90 min execution time)

**Key Decisions (from research):**
- CSV formatter hand-rolled (RFC 4180 compliant, no external dependencies)
- Levenshtein distance for table name suggestions (simple algorithm, 30 lines)
- Auto-limit to 1000 rows in query-only mode (safety default)
- Runtime type inference from result data (no information_schema queries)
- Error handling with table suggestions proactively (don't rely on error message parsing)

**Pitfalls to Avoid:**
- Unbounded result sets causing memory bloat (auto-limit in query-only mode)
- Missing table detection via fragile error parsing (instead: proactive table listing + distance comparison)
- CSV escaping failures (test with commas, quotes, newlines, mixed special chars)
- Permission bypass via parameterized queries (verify permission guard strips params correctly)
- Execution time measurement including formatting overhead (measure only DB execution)

---

### Phase 7: Data Modification

**Goal:** Implement `dbcli insert`, `dbcli update`, and `dbcli delete` commands with safety safeguards.

**Plans:**
- [07-01-PLAN.md](.planning/phases/07-data-modification/07-01-PLAN.md) — DataExecutor foundation (5 tasks, Wave 1)
- [07-02-PLAN.md](.planning/phases/07-data-modification/07-02-PLAN.md) — UPDATE command (5 tasks, Wave 2)
- [07-03-PLAN.md](.planning/phases/07-data-modification/07-03-PLAN.md) — DELETE command (5 tasks, Wave 2)

**Wave Structure:**
- Wave 1: Plan 07-01 (DataExecutor, INSERT command, CLI registration)
- Wave 2: Plan 07-02 and 07-03 parallel (UPDATE and DELETE commands)

**Requirements Mapped:** DATA-01, DATA-02

**Plan 07-01: DataExecutor & INSERT** ✅ COMPLETE
- ✓ Task 1: Create DataExecutor class with INSERT, UPDATE, DELETE execution methods
- ✓ Task 2: Implement INSERT command handler with parameterized queries
- ✓ Task 3: Register INSERT command in CLI
- ✓ Task 4: Write unit and integration tests for DataExecutor INSERT methods
- ✓ Task 5: Verify build and test suite

**Plan 07-02: UPDATE Command** ✅ COMPLETE
- ✓ Task 1: Implement UPDATE command handler with WHERE clause parsing
- ✓ Task 2: Register UPDATE command in CLI
- ✓ Task 3: Write unit tests for DataExecutor UPDATE methods
- ✓ Task 4: Write integration tests for UPDATE command
- ✓ Task 5: Verify build and full test suite

**Plan 07-03: DELETE Command** ✅ COMPLETE
- ✓ Task 1: Implement DELETE command handler with WHERE clause parsing
- ✓ Task 2: Admin-only permission enforcement at CLI level
- ✓ Task 3: Register DELETE command in CLI with --force flag
- ✓ Task 4: Write unit tests for DataExecutor DELETE methods
- ✓ Task 5: Write integration tests for DELETE command, verify full suite

**Success Criteria:**
1. `dbcli insert users --data '{"name":"Alice"}'` inserts and confirms
2. `dbcli update users --where "id=1" --set '{"name":"Bob"}'` updates successfully
3. `dbcli delete users --where "id=1" --force` deletes (admin-only)
4. Query-only mode rejects all write operations
5. `--dry-run` shows SQL without side effects
6. All tests pass (unit + integration)

**Complexity:** Medium | **Risk:** Medium (SQL injection prevention critical)
**Dependencies:** Phase 3, 4, 6 | **Estimated Duration:** 3 plans

---

### Phase 8: Schema Refresh & Export

**Goal:** Implement incremental schema updates and data export with streaming support.

**Plans:**
- [08-01-PLAN.md](.planning/phases/08-schema-refresh-export/08-01-PLAN.md) — SchemaDiffEngine and types (4 tasks, Wave 1)
- [08-02-PLAN.md](.planning/phases/08-schema-refresh-export/08-02-PLAN.md) — Schema refresh & export commands (6 tasks, Wave 2)

**Wave Structure:**
- Wave 1: Plan 08-01 (SchemaDiffEngine, type definitions, unit tests)
- Wave 2: Plan 08-02 (schema --refresh, export commands, CLI registration, integration tests)

**Requirements Mapped:** SCHEMA-04, EXPORT-01

**Plan 08-01: SchemaDiffEngine Foundation** 📋 PLANNED
- Task 1: Create schema-diff.ts type definitions (SchemaDiffReport, ColumnDiff, TableDiffDetail)
- Task 2: Implement SchemaDiffEngine class with two-phase diff algorithm
- Task 3: Write comprehensive unit tests (15+ tests: table detection, column detection, type normalization, FK preservation)
- Task 4: Export SchemaDiffEngine from core module index

**Plan 08-02: Commands & Integration** 📋 PLANNED
- Task 1: Extend schema.ts with --refresh flag handler and immutable merge
- Task 2: Create export.ts command handler with QueryExecutor integration
- Task 3: Register schema --refresh and export commands in CLI
- Task 4: Write integration tests for schema refresh workflow (10+ tests)
- Task 5: Write integration tests for export command (12+ tests)
- Task 6: Verify full build and test suite

**Success Criteria:**
1. Adding table to database, then `dbcli schema --refresh` only updates new entries
2. `dbcli export "SELECT * FROM users" --format csv` outputs valid RFC 4180 CSV
3. Exporting 100K rows uses stable memory (CSV formatter generates line-by-line)
4. `dbcli export "..." | jq` works for piped JSON processing
5. Query-only mode auto-limits exports to 1000 rows
6. File output with `--output file.json` works correctly

**Complexity:** Medium | **Risk:** Medium (type normalization, auto-limit respect)
**Dependencies:** Phase 3, 5, 6 (Plan 08-01 depends on 05, 06; Plan 08-02 depends on 08-01) | **Estimated Duration:** 2 plans

**Key Decisions (locked in CONTEXT.md):**
- D-01: Schema diffing compares in-memory snapshot (from .dbcli) against live DB
- D-02: Diff reports track: added/removed tables, added/removed/modified columns
- D-03: Immutable merge preserves metadata.createdAt, updates schemaLastUpdated
- D-04: Export uses buffered results (Bun.sql Promise<T[]>), not adapter-level streaming
- D-05: Formats: standard JSON (not newline-delimited), RFC 4180 CSV
- D-06: Query-only respects 1000-row auto-limit; Read-Write/Admin unlimited
- D-07: CLI supports `--output file` for file export; default stdout (pipe-able)
- D-08: "Streaming" via CSV line-by-line generation + shell stdout piping
- D-09: No adapter interface changes needed
- D-10: `dbcli schema --refresh [table]` with optional table filter
- D-11: `dbcli export "SQL" --format json|csv [--output file]`

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

**Status:** ✅ COMPLETE

**Plan 09-01: SkillGenerator** ✅ COMPLETE
- ✓ SkillGenerator class with CLI introspection (runtime command collection)
- ✓ Permission-based filtering (query-only, read-write, admin)
- ✓ SKILL.md rendering with frontmatter and examples

**Plan 09-02: Skill Command Integration** ✅ COMPLETE (2026-03-25)
- ✓ skillCommand handler with three output modes (stdout, file, install)
- ✓ Cross-platform installation (claude, gemini, copilot, cursor)
- ✓ ensureDir() using Bun shell mkdir -p with fs.mkdir fallback
- ✓ 11 integration tests (all passing)

**Success Criteria:**
1. ✓ `dbcli skill` outputs complete skill; AI agents understand all commands
2. ✓ `dbcli skill --install claude` writes to `.claude/` directory
3. ✓ Skill correctly reflects current permission level (Query-only hides insert/update)
4. ✓ Skill examples are copy-paste ready
5. ✓ Multi-platform support (claude, gemini, copilot, cursor)

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

**Critical Path:** 1 → 2 → 3 → 4 → 5 → 6 → 7/8 (longest dependency chain)

**Parallelization Opportunities:**
- Phase 9 can start after Phase 6 completes (doesn't need insert/update)
- Phase 8 (Schema Refresh and Export) independent subtasks per plan structure (01 → 02)

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
| Schema introspection query syntax | Medium | Medium | Keep database-specific queries in each adapter; test with real databases |
| Type normalization in diff algorithm | Medium | Low | Lowercase comparison + structural parsing of complex types (Phase 8 Plan 01) |

---

## Success Metrics (Post-Release)

Once V1 ships, track:
- **Installation**: `npm install` time, final package size, CI build time
- **Performance**: CLI startup time, query execution overhead
- **Adoption**: GitHub stars, npm downloads, reported issues/PRs
- **AI Feedback**: Error messages helpful? Skill documentation clear? Permission model intuitive?

12. ✅ PLAN-08-01.md and PLAN-08-02.md created — atomic task breakdown for Phase 8
13. **→ Ready for execution** — Run `/gsd:execute-phase 08-schema-refresh-export` to begin Phase 8

---

*Last updated: 2026-03-25 after Phase 8 planning*

### Phase 11: Schema 管理优化

**Goal:** Optimize schema storage and performance for 100-500 table databases using hybrid storage + LRU caching + atomic updates + field indexing.

**Plans:**
- [11-PLAN.md](.planning/phases/11-schema-optimization/11-PLAN.md) — Infrastructure (schema cache, index, loader) — Wave 1
- [11-PLAN-WAVES2-5.md](.planning/phases/11-schema-optimization/11-PLAN-WAVES2-5.md) — Complete architecture (updater, atomic writer, column index, optimizer, integration tests) — Waves 2-5

**Wave Structure:**
- Wave 1: SchemaLayeredLoader, SchemaCacheManager, SchemaIndexBuilder (150+ lines each)
- Wave 2: SchemaUpdater, AtomicFileWriter (incremental updates + atomic writes)
- Wave 3: Concurrency locks + backup/restore + rollback
- Wave 4: ColumnIndexBuilder, SchemaOptimizer (O(1) field queries + diagnostics)
- Wave 5: Integration tests, benchmarks, documentation

**Requirements Mapped:** None (performance & optimization)

**Key Work Items:**
- File structure: .dbcli/schemas/{index.json, hot-schemas.json, cold/*.json}
- Two-layer cache: hot tables (preload) + cold tables (lazy load via LRU)
- Incremental updates: DIFF algorithm + atomic write with backup
- Field indexing: O(1) column lookup by name/type
- Concurrent safety: atomic rename pattern + backup restore

**Success Criteria:**
1. Init time < 100ms (100+ tables, index + hot-schemas only)
2. Hot table query < 1ms (in-memory)
3. Cold table load 10-50ms (first access), < 5ms (cached)
4. Field query < 1ms (O(1) hash lookup)
5. Incremental update < 50ms (only changed parts)
6. Concurrent updates safe (atomic rename prevents corruption)
7. All tests pass (90+ cases across 5 waves)
8. Benchmarks show 80%+ improvement over flat JSON loading

**Performance Targets (from CONTEXT.md):**
- Startup + first query for new 100-table database: balance both concerns
- Schema refresh with 10 new tables: 50ms write time
- Field search across 500 tables: O(1) response
- Concurrent dbcli instances: atomic writes prevent data loss

**Complexity:** High | **Risk:** Medium (concurrent file I/O, performance edge cases)
**Dependencies:** Phase 1-10 (none, optimization layer on top) | **Estimated Duration:** 5 waves (~300 min execution)

**Key Decisions (locked in CONTEXT.md):**
- D-01: Two-tier cache (hot tables preloaded, cold lazy-loaded via LRU)
- D-02: Hot/cold split based on schema file size (assume size ∝ usage)
- D-03: Atomic writes via temp file + rename pattern (prevent corruption)
- D-04: Incremental DIFF (only changed tables in update)
- D-05: No external cache service (Redis) — keep CLI standalone
- D-06: Manual schema refresh (no hot reload) — business schema changes infrequent
- D-07: LRU cache config: max 100 tables, 50MB limit, size-aware eviction

**Code Patterns (from RESEARCH.md):**
- Pattern 1: Hybrid storage + layered loading
- Pattern 2: Atomic file writes (temp + rename)
- Pattern 3: Incremental DIFF and patch application
- Pattern 4: Column index hash tables (O(1) lookups)

**Pitfalls to Avoid (from RESEARCH.md):**
- ✓ Concurrent writes corruption (atomic rename)
- ✓ Startup delay explosion (layered loading, LRU)
- ✓ Field query O(n) traversal (hash index)
- ✓ Environment var missing on init (non-strict mode, graceful degradation)
- ✓ DIFF algorithm missing field changes (deep comparison, type/nullable/default)

**Codebase Integration:**
- src/core/schema-cache.ts - LRU cache management
- src/core/schema-index.ts - Index building and loading
- src/core/schema-loader.ts - Layered initialization
- src/core/schema-updater.ts - Incremental refresh
- src/core/atomic-writer.ts - Atomic file writes with backup
- src/core/column-index.ts - Field indexing
- src/core/schema-optimizer.ts - Performance diagnostics
- src/types/schema-cache.ts - Type definitions
- src/commands/schema.ts - Extended with --refresh, --analyze, --backup flags
- src/benchmarks/schema-performance.bench.ts - Performance baseline

**Tech Stack (from RESEARCH.md):**
- `lru-cache@10.4.3` - O(1) cache with size limits
- `zod@3.22+` - Schema validation (existing)
- `stream-json@1.8+` - Optional for > 1MB files
- Bun.file API for I/O (no additional dependencies)

**Next Steps:**
1. Execute Wave 1: Build caching infrastructure
2. Execute Waves 2-3: Add incremental updates and concurrency
3. Execute Waves 4-5: Optimize queries and integrate
4. Profile with 100-500 table benchmarks
5. Integrate into Phase 12 (command flow)

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
9. ✅ PLAN-05-01.md and PLAN-05-02.md created — atomic task breakdown for Phase 5
10. ✅ PLAN-06-01.md and PLAN-06-02.md created — atomic task breakdown for Phase 6
11. ✅ PLAN-07-01.md, PLAN-07-02.md, PLAN-07-03.md created — atomic task breakdown for Phase 7
12. ✅ PLAN-08-01.md and PLAN-08-02.md created — atomic task breakdown for Phase 8
13. ✅ PLAN-09-01.md and PLAN-09-02.md created — atomic task breakdown for Phase 9
14. ✅ PLAN-10-*.md created — atomic task breakdown for Phase 10
15. **→ Phase 11 Planning Complete** — Run `/gsd:execute-phase 11-schema-optimization --wave 1` to begin Wave 1

---

*Last updated: 2026-03-26 after Phase 11 planning (Schema Optimization)*
