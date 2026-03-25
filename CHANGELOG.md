# Changelog

All notable changes to dbcli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-26

### Initial Release - AI-Ready Database CLI

dbcli v1.0.0 is a complete, production-ready CLI tool enabling AI agents and developers to safely interact with PostgreSQL, MySQL, and MariaDB databases through a permission-controlled interface.

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

## Known Limitations (V1)

- **Single database per project:** Multi-connection support deferred to V1.1
- **Coarse-grained permissions:** Per-table/column access control not in scope
- **No audit logging:** WHO/WHAT/WHEN tracking deferred to V1.1
- **Read-only schema:** No schema modification commands (ALTER TABLE, etc.) in V1
- **CLI-only:** No visual schema designer, REPL, or interactive shell in V1

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
