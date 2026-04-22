# Changelog

All notable changes to dbcli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] - 2026-04-22

### Fixed

- **MongoDB SRV Connections**: `mongodb+srv://` URIs are now expanded and connected through the MongoDB adapter, and MongoDB operations consistently use the configured database.
- **MongoDB Documentation**: Clarified SRV URI support and configured-database behavior in README, README.zh-TW, and `assets/SKILL.md`.

## [1.5.0] - 2026-04-21

### Added

- **Layered Schema Cache (Wave 1)**: Integrated file-based persistence for database schemas.
  - New `SchemaWriter` for saving schema snapshots to `.dbcli/schemas/`.
  - Layered schema loading (Hot/Cold) integrated into `configModule`.
  - Per-connection isolation: Each connection now has its own schema directory (`.dbcli/schemas/<connection>/`).
- **Improved Migration UX**: Added proactive hints during schema migration to ensure data consistency.
- **Documentation Update**: Added per-connection schema isolation details to `SKILL.md` for AI agents.
  - Clarified schema storage layout in `.dbcli/schemas/`.
  - Added usage examples for `--use <connection>` with schema commands.

## [1.4.1] - 2026-04-21

## [1.3.0] - 2026-04-02

### Added

- **Skill Update Reminders**: Added automated reminders for updating AI agent skills (`SKILL.md`).
  - New `dbcli upgrade` check that notifies if installed skills are outdated compared to the project's `assets/SKILL.md`.
  - Background check in CLI that displays a one-line reminder to stderr after commands finish.
  - Support for checking skills in `.claude/`, `.local/share/gemini/`, etc.

## [1.2.1] - 2026-03-31

### Fixed

- **Config Loader**: Fixed variable naming in `loadConnectionEnv` call, ensuring correct env files are loaded during connection resolution.

## [1.2.0] - 2026-03-31

### Added

- **Multi-connection Support (v2)**: Support for multiple named database connections in a single project.
  - New `dbcli use` command to switch between connections.
  - Named connections with custom `.env` files via `init --conn-name` and `--env-file`.
  - Global `--use <name>` flag to execute commands against a specific connection.
- **Unified DDL Interface (`migrate`)**: Abstracted DDL operations that work across PostgreSQL, MySQL, and MariaDB.
  - 12 subcommands for managing tables, columns, indexes, and constraints.
  - Intelligent SQL generation per database dialect.
  - Default dry-run mode for safety.
- **Enhanced Data Health Checks**: Added `rowCount` and `size` checks to the `dbcli check` command.
- **Comprehensive Documentation**: Updated README (en/zh-TW) with Internals & Strategy sections and new command references.

### Changed

- **Schema Update Strategy**: Refined how and when the schema snapshot in `.dbcli` is updated.
  - Automatic snapshot refresh after successful `migrate` operations.
  - Real-time schema fetching for data modification commands without affecting the snapshot.

---

## [1.1.0] - 2026-03-30

### Changed

- **Adapter `execute()` 回傳型別重構**: 從 `T[]` 改為 `ExecutionResult<T>`，包含 `rows`、`affectedRows`、`lastInsertId` 欄位，DML 操作（INSERT/UPDATE/DELETE）現在回傳正確的 affected rows 計數
- **Export 覆寫確認**: `export --output` 寫入已存在檔案時會提示確認，可用 `--force` 跳過
- **`ExecutionResult<T>` 介面**: 新增統一的查詢結果型別定義於 `src/adapters/types.ts`

---

## [1.0.0] - 2026-03-28

### Stable Release

dbcli v1.0.0 is the first stable release. All three milestones are complete:
- **M1 (v0.6.0):** Smart REPL — interactive shell with SQL + dbcli commands
- **M2 (v0.8.0):** Schema DDL — CREATE/DROP/ALTER TABLE, INDEX, CONSTRAINT, ENUM
- **M3 (v1.0.0):** Stabilization — documentation, permission matrix, known limitations update

### Added

- **`dbcli migrate` command group** (12 subcommands): Full DDL operations with cross-database support
  - `migrate create <table>` — CREATE TABLE with `--column` spec format (`"id:serial:pk"`)
  - `migrate drop <table>` — DROP TABLE with double confirmation (`--execute --force`)
  - `migrate add-column` / `drop-column` / `alter-column` — Column management
  - `migrate add-index` / `drop-index` — Index management (MySQL `--table` option for DROP)
  - `migrate add-constraint` / `drop-constraint` — FK, UNIQUE, CHECK constraints
  - `migrate add-enum` / `alter-enum` / `drop-enum` — PostgreSQL native ENUM support
- **DDLGenerator interface** with PostgreSQL and MySQL/MariaDB dialect implementations
  - PostgreSQL: SERIAL, native ENUM types, ALTER COLUMN TYPE, double-quote identifiers
  - MySQL: AUTO_INCREMENT, inline ENUM, MODIFY COLUMN, backtick identifiers
- **DDLExecutor**: Unified execution pipeline — admin permission check → blacklist protection → SQL generation → dry-run/execute → schema cache auto-refresh
- **Default dry-run for DDL**: All `migrate` commands preview SQL without `--execute`. Destructive operations also require `--force`
- **142 new tests**: column-parser (17), PG DDL (35), MySQL DDL (25), factory (5), DDL executor (22), schema cache DDL (6), CLI migrate (26), live-db migrate lifecycle (6)

### Fixed

- **Schema comment encoding**: Fixed double-encoded UTF-8 comments from MySQL/MariaDB `information_schema` (e.g., `å¸³è™Ÿ` → `帳號`)
- **MySQL connection charset**: Added `charset: utf8mb4` and `SET NAMES utf8mb4`
- **DDL multi-line SQL execution**: Fixed statement splitting to use `;\n` instead of `\n`
- **MySQL DROP INDEX**: Added `--table` option (MariaDB requires `ON <table>`)

### Changed

- **Permission model**: 4 levels — query-only, read-write, data-admin, admin (DDL requires admin)
- **Known Limitations**: Removed "Read-only schema" and "CLI-only" (both resolved). Added "No migration version tracking" as post-v1.0 item
- **Test infrastructure**: `docker-compose.test.yml` for MySQL 8 + PostgreSQL 16 integration testing
- **Package scripts**: Added `test:unit`, `test:integration`, `test:docker`
- **SKILL.md**: Updated with full `migrate` command reference and AI agent guidelines

### Test Results (v1.0.0)

- Unit/Core: 1082 pass, 0 fail
- Live DB (MariaDB 10.11): 61 pass
- Docker Adapter (MySQL 8 + PG 16): 18 pass

---

## [0.6.1-beta] - 2026-03-28

### Encoding Fix & Test Infrastructure

### Fixed

- **Schema comment encoding**: Fixed double-encoded UTF-8 comments from MySQL/MariaDB `information_schema`. Comments stored through latin1 (cp1252) connections now correctly display CJK characters (e.g., `å¸³è™Ÿ` → `帳號`)
- **MySQL connection charset**: Added `charset: utf8mb4` and `SET NAMES utf8mb4` to MySQL adapter connections

### Added

- **`fixDoubleEncodedUtf8()` utility** (`src/utils/encoding.ts`): Detects and reverses cp1252-to-UTF-8 double encoding with full cp1252 reverse mapping table. Applied to schema comments in both MySQL and PostgreSQL adapters
- **`docker-compose.test.yml`**: MySQL 8.4 (port 3307) + PostgreSQL 16 (port 5433) for integration testing, with health checks and tmpfs for fast ephemeral storage
- **Environment-driven adapter tests**: `mysql.test.ts` and `postgresql.test.ts` now read connection from `MYSQL_*` / `PG_*` env vars, falling back to docker-compose defaults. Auto-skip when DB is unreachable
- **`live-db.test.ts`**: 55 comprehensive CLI-level integration tests covering all commands against live MariaDB — list, schema, query, blacklist CRUD, insert/update/delete lifecycle, export, check, diff, status, doctor, shell, format validation, SQL injection protection
- **New test scripts**: `test:unit`, `test:integration`, `test:docker` in package.json

### Test Results

- Unit/Core: 940 pass
- Live DB (MariaDB 10.11): 55 pass
- Adapter (Docker MySQL 8 + PG 16): 18 pass

---

## [0.6.0-beta] - 2026-03-28

### Interactive Shell — Smart REPL

### Added

- **`dbcli shell` command:** Interactive database shell with SQL execution and dbcli command dispatch
- **SQL-only mode:** `--sql` flag restricts to SQL statements only
- **Auto-completion (Tab):** Context-aware completion for SQL keywords, table names, column names, and dbcli commands
- **Multi-line SQL:** Accumulates input until `;` is found, with `...>` continuation prompt
- **SQL syntax highlighting:** Real-time colorization of keywords, strings, and numbers in verbose mode
- **Meta commands:** `.help`, `.quit`/`.exit`, `.clear`, `.format`, `.history`, `.timing`
- **Persistent history:** Stored in `~/.dbcli_history` (max 1000 entries), with up/down navigation and Ctrl+R search
- **Permission & blacklist integration:** Full enforcement within REPL session — SQL goes through PermissionGuard, query results go through blacklist filtering
- **Auto-reconnect:** Attempts to reconnect once on connection errors, then displays error without crashing the session
- **Error resilience:** SQL/permission/connection errors never crash the session
- **i18n support:** All shell messages available in English and Traditional Chinese
- **102 new tests:** input-classifier (25), multiline-buffer (10), meta-commands (15), completer (17), history-manager (8), command-dispatcher (12), repl-engine (12), shell-command (3)

---

## [0.5.2-beta] - 2026-03-27

### Fixed

- **`init --use-env-refs` permission bug**: Interactive env-ref mode now correctly offers all 4 permission levels (was missing `data-admin`)
- **`init` i18n completeness**: All 10 hardcoded English messages replaced with i18n keys (supports en/zh-TW)
- **`init` duplicate code**: Extracted shared `.dbcli exists` overwrite check into `checkOverwrite()` helper
- **`--use-env-refs` help text**: Improved option description to clarify CI/CD and multi-env use case
- **Documentation**: Added `--use-env-refs` to README (en/zh-TW), CHANGELOG, and SKILL.md with AI agent guidance

---

## [0.5.1-beta] - 2026-03-27

### Added

- **Database version check**: Warns on stderr when connected database version is below minimum supported (PostgreSQL 12+, MySQL 8.0+, MariaDB 10.5+). Non-blocking — connection proceeds normally.
- **`dbcli doctor` DB version check**: New "Database version" item in Connection & Data group.
- **`dbcli init --use-env-refs`**: Store environment variable references (`{"$env": "DB_HOST"}`) in config instead of actual values. Supports interactive and non-interactive modes with `--env-host`, `--env-port`, `--env-user`, `--env-password`, `--env-database` options. Suitable for CI/CD and multi-environment deployments.

### Fixed

- **`init` permission bug**: Interactive env-ref mode now correctly offers all 4 permission levels (was missing `data-admin`)
- **`init` i18n**: All hardcoded English messages in init command replaced with i18n keys (10 messages)
- **`init` duplicate code**: Extracted shared `.dbcli exists` overwrite check into `checkOverwrite()` helper

---

## [0.5.0-beta] - 2026-03-27

### UX & Developer Experience — Colors, Logging, Diagnostics, and Tooling

### Added

- **Color system** (`picocolors`): Semantic color helpers (`success`/`error`/`warn`/`info`/`dim`/`bold`) with automatic `NO_COLOR` support
- **SQL syntax highlighting**: Keywords (blue bold), strings (green), numbers (yellow) — applied in verbose mode and dry-run preview
- **Leveled logger**: Four levels — quiet (`-q`), normal (default), verbose (`-v`), debug (`-vv`) — all output to stderr to keep stdout clean for structured data
- **`--no-color` global flag**: Disable colored output; also respects `NO_COLOR` environment variable (<https://no-color.org/>)
- **`-v, --verbose` global flag**: Increase verbosity (`-v` = verbose, `-vv` = debug)
- **`-q, --quiet` global flag**: Suppress non-essential output
- **`dbcli doctor` command**: Full self-diagnostic — checks Bun version, dbcli version (npm registry), config validity, permission level, blacklist completeness (detects unprotected sensitive columns like `password`/`token`/`secret`), database connectivity, schema cache freshness, and large table warnings (> 1M rows). Supports `--format json` for AI agents. Exits with code 1 on errors.
- **`dbcli completion` command**: Shell auto-completion script generation for bash, zsh, and fish. `--install` flag auto-writes to the shell rc file using idempotent marker blocks.
- **`dbcli upgrade` command**: Self-update from npm registry. `--check` flag for check-only mode.
- **Background version check**: Every command silently checks the npm registry (at most once per 24 hours, cached in `.dbcli/version-check.json`). Shows a one-line hint to stderr after the command completes if a newer version is available. Suppressed by `--quiet`.
- **Table formatter colorization**: Table headers now display in bold
- **62 new tests**: colors (7), sql-highlight (6), logger (10), doctor (12), completion (8), upgrade/version-check (19)

### Dependencies

- Added `picocolors` (~0.4 KB) as production dependency

---

## [0.2.0-beta] - 2026-03-26

### Data Access Control — Blacklist System

Added table and column-level blacklisting to protect sensitive data from AI agent access.

### Added

- **`dbcli blacklist` command suite:** Manage blacklist rules via CLI
  - `blacklist list` — display current blacklist configuration
  - `blacklist table add/remove <table>` — manage table-level blacklist
  - `blacklist column add/remove <table>.<column>` — manage column-level blacklist
- **Table-level blacklisting:** Reject all operations (query, insert, update, delete) on blacklisted tables
- **Column-level blacklisting:** Automatically omit blacklisted columns from SELECT results
- **Security notifications:** Footer in table/CSV/JSON output when columns are filtered (e.g., "Security: 2 column(s) were omitted based on your blacklist")
- **Context-aware override:** `DBCLI_OVERRIDE_BLACKLIST=true` environment variable for temporary bypass with warning
- **i18n support:** Blacklist messages in English and Traditional Chinese
- **Performance:** < 1ms overhead per query (O(1) Set/Map lookups)
- **103 new tests:** 83 core + 12 CLI wiring + 8 formatter security tests
- **`dbcli schema --reset`:** Clear all existing schema data and re-fetch from database — solves stale schema after switching DB connections

### Configuration

Blacklist rules stored in `.dbcli`:
```json
{
  "blacklist": {
    "tables": ["audit_logs", "secrets_vault"],
    "columns": {
      "users": ["password_hash", "ssn"]
    }
  }
}
```

---

## [0.1.0-beta] - 2026-03-26

### Initial Release - AI-Ready Database CLI

dbcli v0.1.0-beta is a complete, production-ready CLI tool enabling AI agents and developers to safely interact with PostgreSQL, MySQL, and MariaDB databases through a permission-controlled interface.

**Key Achievement:** Single command-line tool bridging AI agents (Claude Code, Gemini, Copilot, Cursor) to database access without requiring multiple MPC integrations.

---

## Features by Phase

### Phase 1: Project Scaffold

- **Foundation established:** CLI framework with Commander.js v13.0+
- **Build process:** Bun bundler with native TypeScript support (1.1MB binary, <100ms startup)
- **Test infrastructure:** Vitest with 80%+ coverage target
- **Cross-platform CI:** GitHub Actions matrix testing (ubuntu, macos, windows)
- **Code quality:** ESLint + Prettier configured

**Status:** ✅ Complete

---

### Phase 2: Init & Config

- **`dbcli init` command:** Interactive configuration with `.env` parsing
- **Hybrid initialization:** Auto-fills from .env, prompts only for missing values
- **Config management:** `.dbcli` JSON file with immutable copy-on-write semantics
- **Database support preparation:** Multi-database adapter layer foundation
- **RFC 3986 percent-decoding:** Handles special characters in DATABASE_URL passwords
- **Validation:** Zod schemas for type-safe configuration

**Status:** ✅ Complete

**Commands added:** `dbcli init`

---

### Phase 3: DB Connection

- **Multi-database support:** PostgreSQL, MySQL, MariaDB via unified adapter interface
- **Bun.sql integration:** Native SQL API (zero npm dependencies for drivers)
- **Connection testing:** Validates credentials before saving config
- **Error mapping:** Categorized error messages with troubleshooting hints (5 categories: ECONNREFUSED, ETIMEDOUT, AUTH_FAILED, ENOTFOUND, UNKNOWN)
- **Adapter pattern:** Clean abstraction enabling driver swaps without CLI changes

**Status:** ✅ Complete

**Technical:** DatabaseAdapter interface with PostgreSQLAdapter, MySQLAdapter implementations

---

### Phase 4: Permission Model

- **Three-tier permission system:** Query-only, Read-Write, Admin
- **SQL classification:** Character state machine for robust SQL analysis (handles comments, strings, CTEs, subqueries)
- **Permission enforcement:** Coarse-grained checks (no per-table/column fine-grained control in V1)
- **Default-deny approach:** Uncertain operations require Admin mode
- **Zero external dependencies:** Pure TypeScript string processing

**Status:** ✅ Complete

**Technical:** PermissionGuard module with SQL classifier (120+ unit tests)

---

### Phase 5: Schema Discovery

- **`dbcli list` command:** Display all tables with metadata
- **`dbcli schema [table]` command:** Show single table structure or scan entire database
- **Foreign key extraction:** PostgreSQL FK metadata from pg_stat_user_tables; MySQL from REFERENTIAL_CONSTRAINTS
- **Output formatters:** Table (ASCII) and JSON (AI-parseable)
- **Schema storage:** Complete metadata in `.dbcli` for offline AI reference
- **Column details:** Type, constraints, nullable, defaults, primary keys, foreign keys

**Status:** ✅ Complete

**Commands added:** `dbcli list`, `dbcli schema`

**Output formats:** table, json

---

### Phase 6: Query Operations

- **`dbcli query "SQL"` command:** Direct SQL execution with permission enforcement
- **Output formatters:** Table (human-readable), JSON (AI-parseable), CSV (RFC 4180 compliant)
- **Auto-limiting:** Query-only mode limits to 1000 rows (with user notification)
- **Helpful errors:** Levenshtein distance table suggestions for typos
- **Structured results:** Metadata including row count, execution time, columns
- **Permission guarding:** Blocks write operations in Query-only/Read-Write modes

**Status:** ✅ Complete

**Commands added:** `dbcli query`

**Output formats:** table, json, csv

**Libraries:** Levenshtein distance (custom 30-line implementation, no deps)

---

### Phase 7: Data Modification

- **`dbcli insert [table]` command:** Insert rows with parameterized queries
- **`dbcli update [table]` command:** Update existing rows with WHERE clause and SET columns
- **`dbcli delete [table]` command:** Delete rows (Admin-only for safety)
- **Parameterized SQL:** Prevents SQL injection across all modification commands
- **Confirmation flows:** --force flag for bypass; default prompts user
- **Dry-run mode:** `--dry-run` shows SQL without executing
- **Permission enforcement:** Insert/Update require Read-Write+; Delete requires Admin

**Status:** ✅ Complete

**Commands added:** `dbcli insert`, `dbcli update`, `dbcli delete`

**Safety features:** Confirmation prompts, --dry-run, --force override

---

### Phase 8: Schema Refresh & Export

- **`dbcli schema --refresh` command:** Detect and apply schema changes incrementally
- **`dbcli export "SQL"` command:** Export query results as JSON or CSV
- **SchemaDiffEngine:** Two-phase diff algorithm (table-level, column-level)
- **Type normalization:** Case-insensitive comparison for column types
- **Immutable merge:** Preserves metadata.createdAt, updates schemaLastUpdated
- **Streaming output:** CSV generated line-by-line; JSON buffered for validity
- **File output:** `--output file` support for both export and schema refresh

**Status:** ✅ Complete

**Commands enhanced:** `dbcli schema` (added --refresh), new `dbcli export`

**Output:** JSON (standard), CSV (RFC 4180)

---

### Phase 9: AI Integration

- **`dbcli skill` command:** Generate AI-consumable skill documentation
- **SkillGenerator class:** Runtime CLI introspection (collects commands dynamically)
- **Permission-based filtering:** Query-only hides insert/update/delete; Read-Write hides delete
- **SKILL.md format:** YAML frontmatter + markdown (compatible with Claude Code, Gemini, Copilot, Cursor)
- **Platform installation:** `dbcli skill --install {claude|gemini|copilot|cursor}`
- **Cross-platform paths:** Installs to correct location per platform (.claude/, .local/share/gemini/, etc.)
- **Dynamic updates:** Skill regenerates as CLI evolves; no manual documentation maintenance

**Status:** ✅ Complete

**Commands added:** `dbcli skill`

**Installation targets:** Claude Code, Gemini CLI, GitHub Copilot, Cursor IDE

---

### Phase 10: Polish & Distribution

- **npm publication:** `files` whitelist, `engines` constraints, `prepublishOnly` hook
- **Cross-platform validation:** Windows CI matrix with .cmd wrapper verification
- **Comprehensive documentation:** API reference, permission model, AI guide, troubleshooting
- **Performance benchmarking:** CLI startup < 200ms, query overhead < 50ms
- **Release readiness:** v1.0.0 quality gates met, all requirements satisfied

**Status:** ✅ Complete

---

## Known Limitations

- **Single database per project:** Each directory uses one `.dbcli` config. For multi-database setups, use separate directories or `--config` flag. This is by design, not a technical limitation.
- **No audit logging:** WHO/WHAT/WHEN tracking deferred to post-v1.0
- **No migration version tracking:** `migrate` commands execute DDL directly without version history or rollback. The `migrate` namespace is reserved for future migration tracking support.

---

## Compatibility

### Databases

- PostgreSQL 12+
- MySQL 8.0+
- MariaDB 10.5+

### Runtime

- Node.js 18.0.0+
- Bun 1.3.3+

### Platforms

- macOS (Intel, Apple Silicon)
- Linux (x86_64)
- Windows 10+ (via npm .cmd wrapper)

### AI Agents

- Claude Code (Anthropic)
- Gemini CLI (Google)
- GitHub Copilot
- Cursor IDE

---

## Installation

```bash
npm install -g dbcli

# or use with npx (no installation)
npx dbcli init
```

---

## Quick Start

```bash
# Initialize project with database connection
dbcli init

# List tables
dbcli list

# Show table schema
dbcli schema users

# Query data
dbcli query "SELECT * FROM users"

# Generate AI agent skill
dbcli skill --install claude
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and release process.

---

## License

See LICENSE file for details.
