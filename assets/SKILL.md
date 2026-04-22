---
name: dbcli
description: Database CLI for AI agents with permission-based access control. Use to query, inspect schemas, insert/update/delete data, export results, and manage sensitive data blacklists. Supports MySQL, PostgreSQL, MariaDB, and MongoDB with multiple named connections per project and custom env files. Trigger when working with databases, running SQL or MongoDB JSON queries, exploring table/collection structures, switching between database environments, or protecting sensitive columns/tables from AI access.
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
dbcli init                                              # Single connection (v1 format)
dbcli init --system mysql --host localhost --port 3306 --user root --name mydb
dbcli init --use-env-refs                               # Store env var references
dbcli init --no-interactive --force                     # Non-interactive mode

# MongoDB
dbcli init --system mongodb --uri "mongodb://user:pass@host:27017/mydb?authSource=admin"
dbcli init --system mongodb --host localhost --port 27017 --user admin --password secret --name mydb
dbcli init --system mongodb --host localhost --port 27017 --name mydb  # No auth

# Multi-connection (v2 format)
dbcli init --conn-name staging --env-file .env.staging   # Named connection with custom env file
dbcli init --conn-name prod --env-file .env.production --use-env-refs --skip-test
dbcli init --remove staging                              # Remove a named connection
dbcli init --rename staging:production                   # Rename a connection
```

**Key options:** `--system`, `--permission`, `--use-env-refs`, `--skip-test`, `--no-interactive`, `--force`, `--conn-name <name>`, `--env-file <path>`, `--remove <name>`, `--rename <old:new>`

**MongoDB-specific options:** `--uri <uri>` (full connection URI), `--auth-source <db>` (auth database, default: `admin` when user/password set)

**Multi-connection:** Using `--conn-name` or `--env-file` creates a v2 config with named connections. Each connection can have its own env file and permission level. Existing v1 configs are automatically imported as the `default` connection when upgrading.

> **AI agent note on `--use-env-refs`:** If an existing `.dbcli` config contains `{"$env": "DB_HOST"}` style references, the connection values are read from environment variables at runtime. Do NOT re-run `init` to replace these references with actual values — the env-ref format is intentional for CI/CD and multi-environment setups.

### use

Switch or display the default database connection (v2 multi-connection config).

```bash
dbcli use                   # Show current default connection
dbcli use staging           # Switch default to 'staging'
dbcli use --list            # List all connections (* marks default)
```

Any command can also use `--use <name>` to temporarily select a connection without changing the default:

```bash
dbcli query --use staging "SELECT * FROM users LIMIT 10"
dbcli list --use prod
```

**Requires v2 config** (created with `dbcli init --conn-name`).

### list

List all tables (SQL) or collections (MongoDB).

```bash
dbcli list
dbcli list --format json
```

**Permission:** query-only+

> **MongoDB:** Lists collections with estimated document count instead of tables.

### schema

Display table schema or scan entire database.

```bash
dbcli schema                        # Scan all tables, save to .dbcli/schemas/
dbcli schema users                  # Show single table schema
dbcli schema users --format json
dbcli schema --refresh              # Detect and apply schema changes
dbcli schema --reset                # Clear all schema data and re-fetch
dbcli schema --reset --force        # Skip confirmation

# Per-connection schema isolation (v2 multi-connection config)
dbcli schema --use staging          # Scan staging DB; saves to .dbcli/schemas/staging/
dbcli schema --use prod             # Scan prod DB; saves to .dbcli/schemas/prod/
```

**Options:** `--format <table|json>`, `--refresh`, `--reset`, `--force`, `--use <connection>`
**Permission:** query-only+

**Schema storage (v1.4+):** Schema is persisted as layered files under `.dbcli/schemas/`. With v2 multi-connection config each connection gets its own subdirectory (`.dbcli/schemas/<connection>/`). Run `dbcli schema --use <connection>` once per connection before querying it — otherwise `schema <table>` may return data from the wrong connection's cache.

### query

Execute SQL query (MySQL/PostgreSQL/MariaDB) or JSON filter/pipeline (MongoDB).

```bash
# SQL databases
dbcli query "SELECT * FROM users LIMIT 10"
dbcli query "SELECT id, email FROM users" --format json
dbcli query "SELECT * FROM logs" --no-limit

# MongoDB: JSON filter (find)
dbcli query '{"status": "active"}' --collection users
dbcli query '{"age": {"$gt": 18}}' --collection users --format json

# MongoDB: aggregation pipeline
dbcli query '[{"$match": {"status": "active"}}, {"$group": {"_id": "$role", "count": {"$sum": 1}}}]' --collection users
```

**Options:** `--format <table|json|csv>`, `--limit <number>`, `--no-limit`, `--collection <name>` (MongoDB only)
**Permission:** query-only+

> **MongoDB notes:**
> - SQL syntax is rejected — use JSON object (filter) or JSON array (pipeline)
> - `--collection <name>` is required
> - Auto-limit does not apply; use `$limit` in your pipeline if needed

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
dbcli export "SELECT * FROM users" --format csv --output users.csv --force  # Skip overwrite confirmation
dbcli export "SELECT * FROM users" --format json | jq '.[]'
```

**Options:** `--format <json|csv>` (required), `--output <path>`, `--force`
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

### `dbcli shell`

Start an interactive database shell.

```bash
dbcli shell          # Interactive mode with SQL + dbcli commands
dbcli shell --sql    # SQL-only mode
```

Inside the shell:
- Type SQL statements ending with `;` to execute
- Type dbcli commands without the `dbcli` prefix (e.g., `schema users`)
- Use Tab for auto-completion (SQL keywords, table names, column names)
- Type `.help` for meta commands (.quit, .clear, .format, .history, .timing)
- Multi-line SQL: keeps accumulating until `;` is found
- History persists across sessions (~/.dbcli_history)

### migrate

Schema DDL operations. **All commands default to dry-run** — use `--execute` to actually run the SQL. Destructive operations (DROP) also require `--force`.

```bash
# Create table
dbcli migrate create posts \
  --column "id:serial:pk" \
  --column "title:varchar(200):not-null" \
  --column "body:text" \
  --column "created_at:timestamp:default=now()"

# Drop table (dry-run by default)
dbcli migrate drop posts
dbcli migrate drop posts --execute --force   # Actually drop

# Add/drop/alter column
dbcli migrate add-column users bio text --nullable
dbcli migrate drop-column users temp_field --execute --force
dbcli migrate alter-column users name --type "varchar(200)"
dbcli migrate alter-column users email --rename user_email
dbcli migrate alter-column users status --set-default "'active'"
dbcli migrate alter-column users bio --drop-default
dbcli migrate alter-column users bio --set-nullable
dbcli migrate alter-column users email --drop-nullable

# Index management
dbcli migrate add-index users --columns email --unique
dbcli migrate add-index users --columns "last_name,first_name" --name idx_fullname
dbcli migrate drop-index idx_fullname --execute --force

# Constraint management
dbcli migrate add-constraint orders --fk user_id --references users.id --on-delete cascade
dbcli migrate add-constraint users --unique email
dbcli migrate add-constraint users --check "age >= 0"
dbcli migrate drop-constraint orders fk_orders_user_id --execute --force

# Enum (PostgreSQL only — MySQL uses inline ENUM in column type)
dbcli migrate add-enum status active inactive suspended
dbcli migrate alter-enum status --add-value archived
dbcli migrate drop-enum status --execute --force
```

**Column spec format:** `name:type[:modifier[:modifier...]]`
- Modifiers: `pk`, `not-null`, `unique`, `auto-increment`, `default=<value>`, `references=<table>.<column>`
- Serial types: `serial`, `bigserial`, `smallserial` (auto-expand per DB dialect)

**Options (all subcommands):** `--execute`, `--force`, `--config <path>`
**Permission:** admin

**AI agent note:** Always use dry-run first (no `--execute`) to preview generated SQL. Only add `--execute` after confirming the SQL is correct. For DROP operations, both `--execute` and `--force` are required.

## MongoDB Support

MongoDB connections use a JSON-based query model instead of SQL.

Atlas-style `mongodb+srv://` URIs are supported. `list` and `query` run against the database configured for the connection, and `query` always requires `--collection <name>`.

**Supported commands:** `init`, `list`, `query`, `status`, `use`, `shell`, `doctor`, `upgrade`, `completion`

**Not supported (exit with error):** `schema`, `insert`, `update`, `delete`, `export`, `diff`, `migrate`, `check`

### MongoDB-specific workflow

```bash
# 1. Initialize (URI or individual params)
dbcli init --system mongodb --uri "mongodb+srv://user:pass@cluster.example.mongodb.net/mydb"

# 2. List collections
dbcli list --format json

# 3. Query with JSON filter (find) or pipeline (aggregate)
dbcli query '{}' --collection orders --format json          # All documents
dbcli query '{"status": "paid"}' --collection orders        # Filter
dbcli query '[{"$match": {"status":"paid"}}, {"$count":"total"}]' --collection orders  # Pipeline
```

### Query syntax

| Intent | Syntax |
|--------|--------|
| All documents | `'{}'` |
| Field filter | `'{"field": "value"}'` |
| Comparison | `'{"age": {"$gt": 18}}'` |
| Aggregation | `'[{"$match": {...}}, {"$group": {...}}]'` |

## Permission Levels

| Level | Allowed Operations |
|-------|-------------------|
| query-only | SELECT, list, schema, export |
| read-write | query-only + INSERT, UPDATE |
| data-admin | read-write + DELETE (full DML, no DDL) |
| admin | data-admin + DDL (migrate create/drop/alter, DROP, ALTER, CREATE, TRUNCATE) |

Set via `dbcli init --permission <level>` or in `.dbcli` config.

## Global Options

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to .dbcli config file (default: `.dbcli`) |
| `--use <connection>` | Use a specific named connection (v2 config) |
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
