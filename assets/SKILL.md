---
name: dbcli
description: Database CLI for AI agents with permission-based access control. Use to query, inspect schemas, insert/update/delete data, export results, and manage sensitive data blacklists. Supports MySQL, PostgreSQL, MariaDB. Trigger when working with databases, running SQL, exploring table structures, or protecting sensitive columns/tables from AI access.
---

# dbcli

Database CLI for AI agents with permission-based access control.

## Quick Start

```bash
dbcli init                          # Initialize .dbcli config (parses .env automatically)
dbcli schema                        # Scan all tables and save to .dbcli
dbcli query "SELECT * FROM users"   # Execute SQL
```

## Commands

### init

Initialize `.dbcli` configuration file. Typically run manually by the developer — avoid running on behalf of the user unless explicitly requested.

```bash
dbcli init
dbcli init --system mysql --host localhost --port 3306 --user root --name mydb
dbcli init --use-env-refs           # Store env var references instead of values
dbcli init --no-interactive --force # Non-interactive, skip overwrite confirmation
```

**Key options:** `--system <postgresql|mysql|mariadb>`, `--permission <query-only|read-write|data-admin|admin>`, `--use-env-refs`, `--skip-test`, `--no-interactive`, `--force`

### list

List all tables.

```bash
dbcli list
dbcli list --format json
```

**Permission:** query-only+

### schema

Display table schema or scan entire database.

```bash
dbcli schema                        # Scan all tables, save to .dbcli
dbcli schema users                  # Show single table schema
dbcli schema users --format json
dbcli schema --refresh              # Detect and apply schema changes
dbcli schema --reset                # Clear all schema data and re-fetch
dbcli schema --reset --force        # Skip confirmation
```

**Options:** `--format <table|json>`, `--refresh`, `--reset`, `--force`
**Permission:** query-only+

### query

Execute SQL query.

```bash
dbcli query "SELECT * FROM users LIMIT 10"
dbcli query "SELECT id, email FROM users" --format json
dbcli query "SELECT * FROM logs" --no-limit
```

**Options:** `--format <table|json|csv>`, `--limit <number>`, `--no-limit`
**Permission:** query-only+

### insert

Insert data into a table.

```bash
dbcli insert users --data '{"name":"Alice","email":"alice@example.com"}'
dbcli insert users --data '{"name":"Alice"}' --dry-run
dbcli insert users --data '{"name":"Alice"}' --force
```

**Options:** `--data <json>`, `--dry-run`, `--force`
**Permission:** read-write+

### update

Update existing data.

```bash
dbcli update users --where "id=1" --set '{"name":"Bob"}'
dbcli update users --where "id=1" --set '{"name":"Bob"}' --dry-run
```

**Options:** `--where <condition>` (required), `--set <json>` (required), `--dry-run`, `--force`
**Permission:** read-write+

### delete

Delete data from a table.

```bash
dbcli delete users --where "id=1"
dbcli delete users --where "id=1" --dry-run
dbcli delete users --where "id=1" --force
```

**Options:** `--where <condition>` (required), `--dry-run`, `--force`
**Permission:** data-admin+

### export

Export query results to file or stdout.

```bash
dbcli export "SELECT * FROM users" --format csv --output users.csv
dbcli export "SELECT * FROM users" --format json | jq '.[]'
```

**Options:** `--format <json|csv>` (required), `--output <path>`
**Permission:** query-only+

### blacklist

Manage sensitive data blacklist to prevent AI access to restricted tables/columns.

```bash
dbcli blacklist list                        # Show current blacklist
dbcli blacklist table add payments          # Block entire table
dbcli blacklist table remove payments       # Unblock table
dbcli blacklist column add users.password   # Block specific column
dbcli blacklist column remove users.password
```

**Subcommands:** `list`, `table add <name>`, `table remove <name>`, `column add <table.column>`, `column remove <table.column>`

### check

Run data health checks on tables.

```bash
dbcli check users                           # Check single table
dbcli check users --format json             # JSON output (default)
dbcli check --all                           # Check all tables (huge tables auto-skipped)
dbcli check --all --include-large           # Include huge tables
dbcli check orders --checks nulls,orphans   # Specific checks only
dbcli check orders --sample 10000           # Sample size for large tables
```

**Checks:** `nulls`, `duplicates`, `orphans`, `emptyStrings`, `rowCount`, `size`
**Options:** `--all`, `--include-large`, `--checks <types>`, `--sample <number>`, `--format <json|table>`
**Permission:** query-only+

### diff

Compare schema snapshots to detect changes.

```bash
dbcli diff --snapshot before.json           # Save current schema snapshot
dbcli diff --against before.json            # Compare current vs snapshot
dbcli diff --against before.json --format json
```

**Options:** `--snapshot <path>`, `--against <path>`, `--format <json|table>`
**Permission:** query-only+

### status

Show current configuration status (safe for AI agents, no credentials exposed).

```bash
dbcli status                    # JSON output (default)
dbcli status --format text      # Human-readable text output
```

**Output:** `permission`, `system`, `blacklist` summary, `version`
**Permission:** query-only+

### doctor

Run diagnostic checks on environment, configuration, connection, and data.

```bash
dbcli doctor                    # Colored text output
dbcli doctor --format json      # JSON output for AI agents
```

**Checks:**
- Environment: Bun version, dbcli version (compares with npm registry)
- Configuration: config file exists/valid, permission level, blacklist completeness (detects unprotected sensitive columns)
- Connection & Data: database connectivity, schema cache freshness (warns if > 7 days), large table warnings (> 1M rows)

**Exit code:** 0 if all pass or warnings only, 1 if any error
**Options:** `--format <text|json>`

### completion

Generate shell completion scripts for tab auto-complete.

```bash
dbcli completion bash            # Output bash completion script
dbcli completion zsh             # Output zsh completion script
dbcli completion fish            # Output fish completion script
dbcli completion --install       # Auto-detect shell and install
dbcli completion --install zsh   # Install for specific shell
```

**Supported shells:** bash, zsh, fish

### upgrade

Check for updates and self-upgrade dbcli to the latest version from npm.

```bash
dbcli upgrade                   # Check and upgrade if newer version available
dbcli upgrade --check           # Only check, do not upgrade
```

**Options:** `--check`

**Background check:** Every command silently checks the npm registry for a newer version (at most once per 24 hours, cached in `.dbcli/version-check.json`). If a newer version is found, a one-line hint is printed to stderr after the command completes. Pass `-q` / `--quiet` to suppress the hint.

## Permission Levels

| Level | Allowed Operations |
|-------|-------------------|
| query-only | SELECT, list, schema, export |
| read-write | query-only + INSERT, UPDATE |
| data-admin | read-write + DELETE (full DML, no DDL) |
| admin | data-admin + DROP, ALTER, CREATE, TRUNCATE |

Set via `dbcli init --permission <level>` or in `.dbcli` config.

## Global Options

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to .dbcli config file (default: `.dbcli`) |
| `-v, --verbose` | Increase verbosity (`-v` verbose, `-vv` debug) |
| `-q, --quiet` | Suppress non-essential output |
| `--no-color` | Disable colored output (also respects `NO_COLOR` env var) |

## AI Agent Workflow

**Before any database operation, follow this sequence:**

1. `dbcli status` — Check current permission level and system info (safe — no credentials exposed)
2. `dbcli blacklist list` — Confirm sensitive data is protected
3. `dbcli schema <table> --format json` — Verify actual column names
4. Then execute `query` / `insert` / `update` / `export` / `delete` according to your permission level

**Never guess column names.** Naming conventions vary across projects (e.g. `frozen_balance` vs `freeze`, `amount` vs `balance_variable`). Always confirm with `schema` first.

## Debugging Workflow

When investigating a bug related to database state:

1. `dbcli schema <table> --format json` — Confirm actual columns and types
2. `dbcli check <table> --format json` — Quick health scan (nulls, orphans, duplicates)
3. `dbcli query "SELECT * FROM <table> WHERE <condition>" --format json` — Inspect the specific record
4. Follow foreign keys from schema to trace related tables
5. Repeat step 3 for each related table to verify referential integrity

**Key principle:** Let the data tell the story. Don't hypothesize before seeing actual state.

## Write Verification Workflow

After any INSERT or UPDATE:

1. `dbcli insert <table> --data '...' --dry-run` — Preview SQL first
2. Execute the actual insert/update (remove --dry-run)
3. `dbcli query "SELECT * FROM <table> WHERE <condition>" --format json` — Read back the written record
4. Compare the returned data against the intended values
5. If mismatch, check for triggers, default values, or blacklisted columns that may alter the result

## Migration Safety Workflow

Before and after running database migrations:

1. `dbcli diff --snapshot before.json` — Capture current schema
2. Run the migration
3. `dbcli diff --against before.json --format json` — Compare changes
4. Verify: added/removed/modified columns match the migration intent
5. `dbcli check <affected-tables> --format json` — Ensure no orphaned data from column drops or FK changes

## Health Check Workflow

Periodic or on-demand database health scan:

1. `dbcli check --all --format json` — Scan all tables (huge tables auto-skipped)
2. Review the summary: focus on orphans (broken FKs) and unexpected nulls
3. For any flagged issues, drill down with `dbcli query` to inspect specific records
4. Use `estimatedRowCount` and `sizeCategory` from schema to gauge table growth

## Code Generation from Schema

When setting up a new project or migrating frameworks (e.g., Laravel to Bun + Drizzle):

1. `dbcli schema --format json` — Export full database schema with FK, indexes, defaults, enums
2. Use the JSON output to generate ORM schema definitions (Drizzle, Prisma, TypeORM, etc.)
3. For each table, map:
   - `primaryKey` + `autoIncrement` to ORM primary key decorator
   - `foreignKey` to relation/reference definitions
   - `indexes` to index declarations
   - `enumValues` to TypeScript enums or union types
   - `nullable` + `defaultValue` to column options
   - `comment` to JSDoc or schema comments
4. `dbcli check --all --format json` — Verify data health before trusting existing data
5. After ORM setup, run a test query through the new ORM and compare results with `dbcli query` to validate correctness

## Logic Verification Workflow

Validate that application logic produces correct database state:

1. `dbcli query "SELECT * FROM <table> WHERE <condition>" --format json` — Capture state BEFORE
2. Execute the application logic (API call, script, etc.)
3. `dbcli query "SELECT * FROM <table> WHERE <condition>" --format json` — Capture state AFTER
4. Compare before/after:
   - Were the expected rows created/updated/deleted?
   - Are computed values correct (totals, balances, counters)?
   - Did related tables update consistently?
5. For complex transactions, check ALL affected tables
6. `dbcli check <affected-tables> --format json` — Ensure no orphaned data post-operation

**When to use:** Unit tests mock the DB and may miss real constraint violations, triggers, and default values. dbcli verifies actual DB state — catches what mocks hide. Best practice: unit tests for logic, dbcli for integration truth.

## Natural Language Operations Workflow

When the user describes a database operation in plain language:

1. **Parse intent** — Identify the operation type:
   - "查今天的訂單" → query (SELECT)
   - "幫我新增一筆記事" → insert (INSERT)
   - "把這筆訂單改成已出貨" → update (UPDATE)

2. **Resolve context** — Use schema to map natural language to actual columns:
   - `dbcli schema <table> --format json` — Get real column names
   - "今天的訂單" → `WHERE created_at >= CURDATE()` (verify column name from schema)
   - "已出貨" → check status column's enum values or existing data patterns

3. **Infer missing fields** — Use schema defaults and context:
   - `defaultValue` from schema → skip fields with sensible defaults
   - `autoIncrement` → don't include primary key in INSERT
   - `nullable: false` without default → MUST ask user for this value

4. **Safety gate**:
   - `dbcli blacklist list` — Ensure no blacklisted columns in the operation
   - Check `sizeCategory` — if querying a huge table without filter, warn and suggest conditions
   - For writes: ALWAYS use `--dry-run` first, show the SQL, then confirm

5. **Execute and verify**:
   - Run the operation
   - For INSERT/UPDATE: read back with `dbcli query` to confirm
   - Report result in natural language back to user

**Key principle:** Never guess column names or values. Always schema-first, dry-run-first.

## Notes

- **Use `--format json`**: More reliable for AI parsing than table format
- **Use `--dry-run` before writes**: Preview generated SQL before executing
- **auto-limit**: Query-only mode appends `LIMIT 1000` automatically. Use `--no-limit` for `information_schema` queries or statements incompatible with LIMIT
- **Blacklist scope**: Blacklisted tables/columns are automatically filtered from query results

## Data Volume Protection

Schema output includes `estimatedRowCount` and `sizeCategory` for each table:

| Category | Rows | Behavior |
|----------|------|----------|
| small | < 10K | No restrictions |
| medium | 10K - 100K | Suggest adding LIMIT/WHERE |
| large | 100K - 1M | Warning displayed |
| huge | > 1M | Full-table SELECT blocked without WHERE/LIMIT — use `--no-limit` to override |

**Always check `sizeCategory` before querying.** For `large`/`huge` tables, add WHERE conditions or reasonable LIMIT.
