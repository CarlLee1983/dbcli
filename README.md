# dbcli — Database CLI for AI Agents

**Languages:** [English](./README.md) | [繁體中文](./README.zh-TW.md)

A unified database CLI tool that enables AI agents (Claude Code, Gemini, Copilot, Cursor) to safely query, discover, and operate on databases.

**Core Value:** AI agents can safely and intelligently access project databases through a single, permission-controlled CLI tool with sensitive data protection.

## Internationalization (i18n)

dbcli supports multiple languages via the `DBCLI_LANG` environment variable:

```bash
# English (default)
dbcli init

# Traditional Chinese
DBCLI_LANG=zh-TW dbcli init

# Or set in .env
export DBCLI_LANG=zh-TW
dbcli init
```

**Supported languages:**
- `en` — English (default)
- `zh-TW` — Traditional Chinese (Taiwan)

All messages, help text, error messages, and command output respond to the language setting automatically.


## Quick Start

### Installation

#### Global Installation (Recommended)

```bash
npm install -g @carllee1983/dbcli
# or: bun install -g @carllee1983/dbcli
```

#### Zero-Install (No Installation Needed)

```bash
npx @carllee1983/dbcli init
npx @carllee1983/dbcli query "SELECT * FROM users"
# or with Bun: bunx @carllee1983/dbcli init
```

#### Update

```bash
# Self-update (recommended)
dbcli upgrade

# Or via npm
npm update -g @carllee1983/dbcli
```

#### Development Installation

```bash
git clone https://github.com/CarlLee1983/dbcli.git
cd dbcli
bun install
bun run src/cli.ts -- --help
# or: bun run dev -- --help
```

When `dbcli` is not on your `PATH`, use `bun run src/cli.ts <subcommand> ...` (same as `bun run dev -- <subcommand> ...`).

### First Steps

```bash
# Initialize project with database connection
dbcli init

# List available tables
dbcli list

# View table structure
dbcli schema users

# Query data
dbcli query "SELECT * FROM users"

# Generate AI agent skill
dbcli skill --install claude
```

---

## Multi-connection Support (v2)

dbcli supports multiple named database connections within a single project. This is useful for managing different environments (development, staging, production) or multiple databases.

### Initializing Named Connections

To create a named connection, use the `--conn-name` option during `init`. You can also specify a custom `.env` file for that connection.

```bash
# Add a staging connection using .env.staging
dbcli init --conn-name staging --env-file .env.staging

# Add a production connection with environment variable references
dbcli init --conn-name prod --env-file .env.production --use-env-refs
```

### Managing Connections

Use the `dbcli use` command to switch between connections or list them.

```bash
# List all connections (* marks the current default)
dbcli use --list

# Switch the default connection to 'staging'
dbcli use staging

# Show the current default connection
dbcli use

# Remove a connection
dbcli init --remove staging

# Rename a connection
dbcli init --rename staging:production
```

### Using a Specific Connection Temporarily

You can use the `--use <name>` global flag to execute any command against a specific connection without changing the default.

```bash
# Query the production database once
dbcli query "SELECT count(*) FROM users" --use prod

# Check staging table health
dbcli check users --use staging
```

---


#### `dbcli init`

Initialize a new dbcli project with database connection configuration.

**Usage:**
```bash
dbcli init [OPTIONS]
```

**Options (Basic):**
- `--system <type>` — Database system: `postgresql`, `mysql`, `mariadb`
- `--host <host>` — Database host
- `--port <port>` — Database port
- `--user <user>` — Database user
- `--password <pass>` — Database password
- `--name <db>` — Database name
- `--permission <level>` — Permission level: `query-only`, `read-write`, `data-admin`, `admin`
- `--use-env-refs` — Store environment variable references instead of actual values in config
- `--skip-test` — Skip connection test
- `--no-interactive` — Non-interactive mode (requires all options)
- `--force` — Overwrite existing config without confirmation

**Options (Multi-connection v2):**
- `--conn-name <name>` — Create a named connection (e.g., `staging`, `prod`)
- `--env-file <path>` — Load credentials from a specific `.env` file for this connection
- `--remove <name>` — Remove a named connection from the config
- `--rename <old:new>` — Rename an existing connection (format: `old:new`)

**Behavior:**
- Reads `.env` file if present (auto-fills DATABASE_URL, DB_* variables)
- Prompts for missing values (host, port, user, password, database name, permission level)
- Creates `.dbcli` JSON config file in project root
- Tests database connection before saving

**Examples:**
```bash
# Interactive initialization
dbcli init

# Multi-connection setup
dbcli init --conn-name staging --env-file .env.staging
dbcli init --conn-name prod --env-file .env.production --use-env-refs

# Store env var references (non-interactive)
dbcli init --use-env-refs --system mysql \
  --env-host DB_HOST --env-port DB_PORT \
  --env-user DB_USER --env-password DB_PASSWORD \
  --env-database DB_DATABASE \
  --no-interactive
```

---

#### `dbcli use` (Requires v2 config)

Manage or switch the default database connection in multi-connection projects.

**Usage:**
```bash
dbcli use [connection-name] [OPTIONS]
```

**Options:**
- `--list` — List all connections and show the current default

**Examples:**
```bash
# Show current default connection
dbcli use

# Switch default connection to 'prod'
dbcli use prod

# List all connections
dbcli use --list
```

---

> **`--use-env-refs`:** When enabled, the config stores environment variable names (e.g., `{"$env": "DB_HOST"}`) instead of actual values. This avoids writing sensitive credentials into the config file, making it suitable for multi-environment deployments and CI/CD pipelines. At connection time, dbcli automatically reads the actual values from the referenced environment variables.

---

#### `dbcli list`

List all tables in the connected database.

**Usage:**
```bash
dbcli list [OPTIONS]
```

**Options:**
- `--format json` — Output as JSON instead of ASCII table

**Examples:**
```bash
# Table format (human-readable)
dbcli list

# JSON format (for AI parsing)
dbcli list --format json

# Pipe to tools
dbcli list --format json | jq '.data[].name'
```

---

#### `dbcli schema [table]`

Show table structure (columns, types, constraints, foreign keys).

**Usage:**
```bash
dbcli schema [table]
dbcli schema                 # Scan entire database and update .dbcli
dbcli schema users           # Show structure of 'users' table
```

**Options:**
- `--format json` — Output as JSON
- `--refresh` — Detect and update schema changes incrementally (requires --force for approval)
- `--reset` — Clear all existing schema data and re-fetch from database (useful after switching DB connections)
- `--force` — Skip confirmation for schema refresh/overwrite/reset

**Examples:**
```bash
# Show users table structure
dbcli schema users

# JSON output with full metadata
dbcli schema users --format json

# Update schema with new tables (incremental)
dbcli schema --refresh --force

# Clear and re-fetch all schema (after switching DB)
dbcli schema --reset --force

# Scan entire database
dbcli schema
```

---

#### `dbcli query "SQL"`

Execute SQL query and return results.

**Usage:**
```bash
dbcli query "SELECT * FROM users"
```

**Options:**
- `--format json|table|csv` — Output format (default: table)
- `--limit <number>` — Cap rows (overrides the automatic limit in query-only mode)
- `--no-limit` — Disable the automatic 1000-row cap in query-only mode

**Behavior:**
- Enforces permission-based restrictions (Query-only mode blocks INSERT/UPDATE/DELETE)
- Auto-limits results to 1000 rows in Query-only mode (notification shown), unless `--no-limit` or `--limit` applies
- Returns structured results with metadata (row count, execution time)
- To write CSV/JSON to a file, use shell redirection or the `export` command

**Examples:**
```bash
# Table output (human-readable)
dbcli query "SELECT * FROM users"

# JSON (for AI/programmatic parsing)
dbcli query "SELECT * FROM users" --format json

# CSV to stdout (redirect to a file)
dbcli query "SELECT * FROM users" --format csv > users.csv

# Pipe to other tools
dbcli query "SELECT * FROM products" --format json | jq '.data[] | .name'

# Large result sets (paginate with LIMIT/OFFSET)
dbcli query "SELECT * FROM users LIMIT 100 OFFSET 0"
```

---

#### `dbcli insert [table]` (Requires Read-Write or Admin permission)

Insert data into table.

**Usage:**
```bash
dbcli insert users --data '{"name": "Alice", "email": "alice@example.com"}'
```

**Options:**
- `--data JSON` — Row data as JSON object (REQUIRED)
- `--dry-run` — Show SQL without executing
- `--force` — Skip confirmation

**Behavior:**
- Validates JSON format
- Generates parameterized SQL (prevents SQL injection)
- Shows confirmation prompt before inserting (unless --force used)

**Examples:**
```bash
# Insert single row
dbcli insert users --data '{"name": "Bob", "email": "bob@example.com"}'

# Preview SQL without executing
dbcli insert users --data '{"name": "Charlie"}' --dry-run

# Skip confirmation
dbcli insert users --data '{"name": "Diana"}' --force
```

---

#### `dbcli update [table]` (Requires Read-Write or Admin permission)

Update existing rows.

**Usage:**
```bash
dbcli update users --where "id=1" --set '{"name": "Alice Updated"}'
```

**Options:**
- `--where condition` — WHERE clause (REQUIRED, e.g., "id=1 AND status='active'")
- `--set JSON` — Updated columns as JSON object (REQUIRED)
- `--dry-run` — Show SQL without executing
- `--force` — Skip confirmation

**Examples:**
```bash
# Update single row
dbcli update users --where "id=1" --set '{"name": "Alice"}'

# Update multiple rows
dbcli update users --where "status='inactive'" --set '{"status":"active"}'

# Preview SQL
dbcli update users --where "id=1" --set '{"name": "Bob"}' --dry-run

# Skip confirmation
dbcli update users --where "id=2" --set '{"email": "new@example.com"}' --force
```

---

#### `dbcli delete [table]` (Requires Data-Admin or Admin permission)

Delete rows (blocked for query-only and read-write; requires elevated DML permission).

**Usage:**
```bash
dbcli delete users --where "id=1" --force
```

**Options:**
- `--where condition` — WHERE clause (REQUIRED)
- `--dry-run` — Show SQL without executing
- `--force` — Required to actually delete (safety guard)

**Examples:**
```bash
# Delete single row (requires --force)
dbcli delete users --where "id=1" --force

# Preview deletion
dbcli delete products --where "status='deprecated'" --dry-run

# Delete multiple rows
dbcli delete orders --where "created_at < '2020-01-01'" --force
```

---

#### `dbcli export "SQL"`

Export query results to file.

**Usage:**
```bash
dbcli export "SELECT * FROM users" --format json --output users.json
```

**Options:**
- `--format json|csv` — Output format
- `--output file` — Write to file (default: stdout for piping)

**Behavior:**
- Query-only permission limited to 1000 rows per export
- Generates RFC 4180 compliant CSV
- Creates well-formed JSON arrays

**Examples:**
```bash
# Export to JSON
dbcli export "SELECT * FROM users" --format json --output users.json

# Export to CSV
dbcli export "SELECT * FROM orders" --format csv --output orders.csv

# Pipe compressed export
dbcli export "SELECT * FROM products" --format csv | gzip > products.csv.gz

# Combine with query tools
dbcli export "SELECT * FROM users WHERE active=true" --format json | jq '.data | length'
```

---

#### `dbcli skill`

Generate or install AI agent skill documentation.

**Usage:**
```bash
dbcli skill                           # Output skill to stdout
dbcli skill --output SKILL.md         # Write to file
dbcli skill --install claude          # Install to Claude Code config
dbcli skill --install gemini          # Install to Gemini CLI
dbcli skill --install copilot         # Install to GitHub Copilot
dbcli skill --install cursor          # Install to Cursor IDE
```

**Behavior:**
- Dynamically generates SKILL.md from CLI introspection
- Filters commands by permission level (Query-only hides write commands)
- Supports multiple output modes: stdout, file, platform installation

**Examples:**
```bash
# Generate skill for Claude Code
dbcli skill --install claude

# Generate skill manually for documentation
dbcli skill > ./docs/SKILL.md

# View generated skill (stdout)
dbcli skill

# Install for all platforms
dbcli skill --install claude && \
dbcli skill --install gemini && \
dbcli skill --install copilot && \
dbcli skill --install cursor
```

---

#### `dbcli blacklist`

Manage the data access blacklist to block AI agents from accessing sensitive tables or columns.

**Usage:**
```bash
dbcli blacklist list
dbcli blacklist table add <table>
dbcli blacklist table remove <table>
dbcli blacklist column add <table>.<column>
dbcli blacklist column remove <table>.<column>
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `dbcli blacklist list` | Show current blacklist (tables and columns) |
| `dbcli blacklist table add <table>` | Add table to blacklist (blocks all operations) |
| `dbcli blacklist table remove <table>` | Remove table from blacklist |
| `dbcli blacklist column add <table>.<column>` | Add column to blacklist (omitted from SELECT results) |
| `dbcli blacklist column remove <table>.<column>` | Remove column from blacklist |

**Behavior:**
- Table blacklist blocks all operations on that table (query, insert, update, delete)
- Column blacklist silently omits columns from SELECT results and shows a security notification
- Blacklist rules are stored in `.dbcli` and apply to all permission levels
- Override for admin use via `DBCLI_OVERRIDE_BLACKLIST=true` environment variable

**Examples:**
```bash
# View current blacklist
dbcli blacklist list

# Block all access to sensitive tables
dbcli blacklist table add audit_logs
dbcli blacklist table add secrets_vault

# Hide sensitive columns from query results
dbcli blacklist column add users.password_hash
dbcli blacklist column add users.ssn

# Remove a table from blacklist
dbcli blacklist table remove audit_logs

# Remove a column from blacklist
dbcli blacklist column remove users.ssn

# Override blacklist (admin use only)
DBCLI_OVERRIDE_BLACKLIST=true dbcli query "SELECT * FROM secrets_vault"
```

---

#### `dbcli check`

Run data-quality and health checks on tables.

**Usage:**
```bash
dbcli check [table] [OPTIONS]
```

**Options:**
- `--all` — Check every table (skips huge tables unless `--include-large`)
- `--include-large` — Include huge tables in `--all` scan
- `--checks <types>` — Comma-separated checks: `nulls`, `duplicates`, `orphans`, `emptyStrings`, `rowCount`, `size`
- `--sample <number>` — Sample size for large tables (default: 10000)
- `--format json|table` — Output format (default: json)

**Examples:**
```bash
# Check users table
dbcli check users

# Run specific checks only
dbcli check orders --checks nulls,orphans --format table
# Scan all tables
dbcli check --all
```

---

**Examples:**
```bash
dbcli check orders --format table
dbcli check --all --checks nulls,duplicates --format json
```

---

#### `dbcli diff`

Save a schema snapshot or compare the live database to a previous snapshot (tables, columns, indexes).

**Usage:**
```bash
dbcli diff --snapshot ./schema-before.json
dbcli diff --against ./schema-before.json
dbcli diff --against ./schema-before.json --format table
```

**Options:**
- `--snapshot <path>` — Write the current schema to a JSON file
- `--against <path>` — Diff live schema vs. the saved snapshot
- `--format json|table` — Output format (default: `json`)
- `--config <path>` — Config path (default: `.dbcli`)

---

#### `dbcli status`

Show non-sensitive configuration summary (permission level, DB system, blacklist counts, config metadata version). Does not print connection credentials — intended for AI agents.

**Usage:**
```bash
dbcli status
dbcli status --format text
dbcli status --format json
```

**Options:**
- `--format text|json` — Output format (default: `json`)

**Note:** This command reads the default project config path `.dbcli` (not the global `--config` flag).

---

#### `dbcli doctor`

Run diagnostic checks on environment, configuration, connection, and data.

```bash
dbcli doctor                    # Colored text output
dbcli doctor --format json      # JSON output for AI agents
```

**Checks:**
- **Environment:** Bun version compatibility, dbcli version (compares with npm registry)
- **Configuration:** Config file exists/valid, permission level, blacklist completeness
- **Connection & Data:** Database connectivity, schema cache freshness (> 7 days warning), large table warnings (> 1M rows)

**Options:** `--format <text|json>`
**Exit code:** 0 = all pass or warnings only, 1 = errors found

---

#### `dbcli completion [shell]`

Generate shell completion scripts for tab auto-complete.

```bash
dbcli completion bash            # Output bash completion to stdout
dbcli completion zsh             # Output zsh completion to stdout
dbcli completion fish            # Output fish completion to stdout
dbcli completion --install       # Auto-detect shell and install to rc file
dbcli completion --install zsh   # Install for specific shell
```

**Supported shells:** bash, zsh, fish

---

#### `dbcli upgrade`

Check for updates and self-upgrade dbcli.

```bash
dbcli upgrade                   # Check and upgrade if newer version available
dbcli upgrade --check           # Only check, do not upgrade
```

**Options:** `--check` — check only, don't install
**Background check:** dbcli silently checks npm registry once per 24 hours. If a newer version is found, a hint is shown after command output.

#### `dbcli shell`

Interactive database shell with SQL execution, auto-completion, and syntax highlighting.

**Usage:**
```bash
dbcli shell          # Interactive mode (SQL + dbcli commands)
dbcli shell --sql    # SQL-only mode
```

**Inside the shell:**
- Type SQL statements ending with `;` to execute queries
- Type dbcli commands without the `dbcli` prefix (e.g., `schema users`, `list`)
- Press Tab for context-aware auto-completion (SQL keywords, table/column names)
- Use `.help` for meta commands (`.quit`, `.clear`, `.format`, `.history`, `.timing`)
- Multi-line SQL: input accumulates until `;` is found
- History persists across sessions in `~/.dbcli_history`

**Permission:** Inherits from config. SQL and commands are fully permission/blacklist enforced.

#### `dbcli migrate`

Schema DDL operations. **All commands default to dry-run** — use `--execute` to actually run the SQL.

**Usage:**
```bash
# Create table
dbcli migrate create posts \
  --column "id:serial:pk" \
  --column "title:varchar(200):not-null" \
  --column "body:text" \
  --column "created_at:timestamp:default=now()"

# Execute (actually run the SQL)
dbcli migrate create posts --column "id:serial:pk" --execute

# Drop table (destructive — requires --execute --force)
dbcli migrate drop posts --execute --force

# Column operations
dbcli migrate add-column users bio text --nullable --execute
dbcli migrate alter-column users name --type "varchar(200)" --execute
dbcli migrate alter-column users email --rename user_email --execute
dbcli migrate drop-column users temp_field --execute --force

# Index operations
dbcli migrate add-index users --columns email --unique --execute
dbcli migrate drop-index idx_users_email --table users --execute --force

# Constraint operations
dbcli migrate add-constraint orders --fk user_id --references users.id --on-delete cascade --execute
dbcli migrate add-constraint users --unique email --execute
dbcli migrate add-constraint users --check "age >= 0" --execute
dbcli migrate drop-constraint orders fk_orders_user_id --execute --force

# Enum (PostgreSQL only)
dbcli migrate add-enum status active inactive suspended --execute
dbcli migrate alter-enum status --add-value archived --execute
dbcli migrate drop-enum status --execute --force
```

**Column spec format:** `name:type[:modifier...]` — Modifiers: `pk`, `not-null`, `unique`, `auto-increment`, `default=<value>`, `references=<table>.<column>`

**Options (all subcommands):** `--execute` (run SQL), `--force` (skip confirmation for DROP), `--config <path>`
**Permission:** admin only

---

## Global Options

All commands support these global options:

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to .dbcli config file (default: `.dbcli`) |
| `-v, --verbose` | Increase verbosity (`-v` verbose, `-vv` debug) |
| `-q, --quiet` | Suppress non-essential output |
| `--no-color` | Disable colored output (respects `NO_COLOR` env var) |

---

## Internals & Strategy

### Schema Update Strategy

dbcli maintains a schema snapshot in your `.dbcli` config file. This allows AI agents to understand the database structure without constant network overhead. Understanding when this cache updates is key:

1.  **Manual Updates:**
    *   `dbcli schema`: Performs a full scan of the database.
    *   `dbcli schema --refresh`: Incremental update. Detects changes and updates only the affected tables.
    *   `dbcli schema --reset`: Clears the cache and re-fetches everything.
2.  **Automatic Updates (DDL):**
    *   When you execute DDL through `dbcli migrate` (e.g., `add-column`), the CLI automatically re-scans the affected table and updates the `.dbcli` snapshot after successful execution.
3.  **Real-time Validation (Non-cached):**
    *   Commands like `insert`, `update`, `delete`, and `check` fetch the latest schema from the database immediately before execution to ensure data integrity, but they **do not** update the long-term snapshot in `.dbcli`.

> **Note:** If you change the database schema using external tools (like DBeaver or migration scripts), you **must** run `dbcli schema --refresh` to sync the snapshot so AI agents can see the changes.

### How `dbcli migrate` Works

The `migrate` command follows a strict safety pipeline to prevent accidental database corruption:

1.  **Permission Check:** Verifies the user has `admin` privileges. DDL is blocked for all other levels.
2.  **Blacklist Check:** Ensures the operation isn't targeting a table restricted in the security blacklist.
3.  **Dialect-Specific Generation:** The `DDLGenerator` translates your request into the correct SQL for your system:
    *   **PostgreSQL:** Uses `SERIAL`, native `ENUM` types, and double-quoted identifiers.
    *   **MySQL/MariaDB:** Uses `AUTO_INCREMENT`, inline `ENUM` definitions, and backticked identifiers.
4.  **Dry-run (Default):** All commands output the generated SQL for review without executing it.
5.  **Execution & Confirmation:**
    *   Requires the `--execute` flag to run.
    *   Destructive operations (like `drop`) require both `--execute` and `--force`.
6.  **Snapshot Sync:** After successful execution, it automatically triggers a schema refresh for the modified table to keep your `.dbcli` file up to date.

---

## Permission Model

dbcli implements a coarse-grained permission system with three levels. Permission level is set during `dbcli init` and stored in `.dbcli` config file. The blacklist system works alongside permissions to provide fine-grained protection for sensitive tables and columns (see [Data Access Control](#data-access-control)).

### Permission Levels

| Level | Allowed Commands | Blocked Commands | Use Case |
|-------|------------------|------------------|----------|
| **Query-only** | `init`, `list`, `schema`, `query`, `export` (limited to 1000 rows) | `insert`, `update`, `delete`, `migrate` | Read-only AI agents, data analysts, reporting |
| **Read-Write** | + `insert`, `update` | `delete`, `migrate` | Application developers, content managers |
| **Data-Admin** | + `delete` | `migrate` | Full DML access, no DDL |
| **Admin** | All commands including `migrate` (DDL) | — | Database administrators, schema modifications |

### Configuration

Permission level is set during initialization:

```bash
dbcli init
# Prompts: permission level (query-only / read-write / data-admin / admin)
# Stored in project .dbcli/config.json as: "permission": "query-only"
```

### Permission-Based Examples

#### Query-Only Mode (AI Agent)
```bash
# Allowed: Read operations
dbcli query "SELECT * FROM users"
dbcli schema users
dbcli export "SELECT * FROM orders" --format json

# Blocked: Write operations
dbcli insert users --data '{...}'  # ERROR: Permission denied
dbcli delete users --where "id=1"  # ERROR: Permission denied
```

#### Read-Write Mode (Application Developer)
```bash
# Allowed: Read + write
dbcli query "SELECT * FROM users"
dbcli insert users --data '{"name": "Alice"}'
dbcli update users --where "id=1" --set '{"name": "Bob"}'

# Blocked: Delete (requires data-admin or admin)
dbcli delete users --where "id=1"  # ERROR: Permission denied (read-write cannot DELETE)
```

#### Admin Mode (Database Administrator)
```bash
# Allowed: Everything including DDL
dbcli query "SELECT * FROM users"
dbcli insert users --data '{"name": "Eve"}'
dbcli update users --where "id=1" --set '{"status": "active"}'
dbcli delete users --where "id=1" --force  # Data-Admin+ can delete
dbcli migrate create posts --column "id:serial:pk" --execute  # Admin only
```

### Best Practices

- **AI Agents:** Use Query-only for read-only scenarios; prevents accidental data loss
- **Applications:** Use Read-Write for normal CRUD operations; prevents DROP TABLE accidents
- **Maintenance:** Use Admin only for schema changes, bulk deletes, or emergency operations
- **Principle of Least Privilege:** Assign minimum permission level needed for each use case

---

## Data Access Control

dbcli provides a blacklist system that works alongside the permission model to prevent AI agents from accessing sensitive tables or columns, regardless of their permission level.

### Table-Level Blacklist

Blocking a table prevents all operations on it — queries, inserts, updates, and deletes are all refused with a clear error message.

```bash
# Block a table
dbcli blacklist table add secrets_vault

# Attempting access is blocked at all permission levels
dbcli query "SELECT * FROM secrets_vault"
# ERROR: Table 'secrets_vault' is blacklisted
```

### Column-Level Blacklist

Blacklisted columns are silently omitted from SELECT results. A security notification is shown in the output so the agent is aware that the result set has been filtered.

```bash
# Blacklist sensitive columns
dbcli blacklist column add users.password_hash
dbcli blacklist column add users.ssn

# Query returns all other columns; notification shown
dbcli query "SELECT * FROM users"
# [Security] Columns omitted by blacklist: password_hash, ssn
```

### Security Notifications

Whenever a blacklist rule filters query output, dbcli appends a notification line to the result. This ensures AI agents do not silently operate on incomplete data without awareness.

### Override via Environment Variable

Administrators can bypass the blacklist for emergency or maintenance operations using the `DBCLI_OVERRIDE_BLACKLIST=true` environment variable:

```bash
DBCLI_OVERRIDE_BLACKLIST=true dbcli query "SELECT * FROM secrets_vault"
```

This override is logged and should only be used by administrators when necessary.

### Blacklist Configuration

Blacklist rules are stored in the `.dbcli` config file and can also be set manually:

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

### Blacklist vs. Permissions

The blacklist and permission model are complementary layers of access control:

| Layer | Controls | Applies To |
|-------|----------|------------|
| **Permission Model** | Operation type (read/write/delete) | All tables |
| **Blacklist** | Specific tables and columns | Targeted sensitive data |

A Query-only agent cannot write to any table, and also cannot read blacklisted tables or columns — both restrictions apply simultaneously.

---

## AI Integration Guide

dbcli generates AI-consumable skill documentation and can be integrated into your favorite AI development tools.

### Quick Start

Generate skill for your preferred platform:

```bash
# Claude Code (Anthropic's VS Code extension)
dbcli skill --install claude

# Gemini CLI (Google's command-line AI)
dbcli skill --install gemini

# GitHub Copilot CLI
dbcli skill --install copilot

# Cursor IDE (AI-native editor)
dbcli skill --install cursor
```

After installation, the AI agent will have access to dbcli commands and can use them to query, insert, update, or export data based on your permission level.

### Platform-Specific Setup

#### Claude Code (Anthropic)

1. Install dbcli globally: `npm install -g @carllee1983/dbcli`
2. Initialize: `dbcli init` (choose permission level)
3. Install skill: `dbcli skill --install claude`
4. Restart Claude Code extension
5. In Claude Code chat, ask: "Show me the database schema" or "Query active users"

**Skill location:** `~/.claude/skills/SKILL.md`

---

#### Gemini CLI (Google)

1. Install dbcli globally: `npm install -g @carllee1983/dbcli`
2. Initialize: `dbcli init`
3. Install skill: `dbcli skill --install gemini`
4. Start Gemini: `gemini start`
5. In chat, request: "Query the users table" or "Show database tables"

**Skill location:** `~/.local/share/gemini/skills/` (Linux) or platform equivalent

---

#### GitHub Copilot CLI

1. Install dbcli globally: `npm install -g @carllee1983/dbcli`
2. Initialize: `dbcli init`
3. Install skill: `dbcli skill --install copilot`
4. Install Copilot CLI: `npm install -g @github-next/github-copilot-cli`
5. Use copilot preview: `copilot --help` and explore dbcli integration

**Skill location:** Per Copilot configuration

---

#### Cursor IDE

1. Install dbcli globally: `npm install -g @carllee1983/dbcli`
2. Initialize: `dbcli init`
3. Install skill: `dbcli skill --install cursor`
4. Open Cursor editor
5. Use Cursor's Composer: "Insert a new user" or "Export user data"

**Skill location:** `~/.cursor/skills/`

---

### Example: AI Agent Workflow

**Scenario:** You want an AI agent to analyze user engagement data.

```bash
# 1. Install and initialize
npm install -g @carllee1983/dbcli
dbcli init  # Choose "query-only" for safety

# 2. Install skill to Claude Code
dbcli skill --install claude

# 3. In Claude Code chat, ask:
# "Analyze the last 7 days of user activity and summarize insights"

# Claude Code will:
# - Use: dbcli schema users, dbcli query "SELECT ..."
# - Parse JSON output
# - Provide analysis
```

### Skill Refresh

dbcli dynamically generates skills based on your current configuration:

```bash
# When permission level changes, skill updates automatically
# Edit .dbcli/config.json and set "permission" to "admin" (or re-run dbcli init)
dbcli skill  # Now shows delete and admin commands

# Re-install to push changes to AI platform
dbcli skill --install claude
```

---

## Troubleshooting

### Connection Issues

#### "ECONNREFUSED: Connection refused"

Database is not running or host/port is incorrect.

**Solutions:**

```bash
# Verify database is running
psql --version  # PostgreSQL installed?
mysql --version  # MySQL installed?

# Check connection string
dbcli init  # Re-run initialization to verify credentials

# Verify host/port from command line
psql -h localhost -U postgres  # PostgreSQL test
mysql -h 127.0.0.1 -u root      # MySQL test
```

#### "ENOTFOUND: getaddrinfo ENOTFOUND hostname"

Hostname resolution failed (typo or DNS issue).

**Solutions:**

```bash
# Verify hostname in project config (directory layout: .dbcli/config.json)
grep host .dbcli/config.json

# Test DNS resolution
ping your-hostname.com

# Use 127.0.0.1 instead of localhost if issues persist
dbcli init  # Re-initialize with correct host
```

---

### Permission Errors

#### "Permission denied: INSERT requires Read-Write or Admin"

Trying to write with Query-only permission level.

**Solution:** Re-initialize with higher permission level:

```bash
rm -rf .dbcli   # Remove project config (destructive — backup if needed)
dbcli init      # Re-run, choose "read-write", "data-admin", or "admin"
```

#### "Permission denied: DELETE operation requires Data-Admin or Admin"

DELETE is not allowed in query-only or read-write mode.

**Solution:** Use `data-admin` or `admin` permission (re-run `dbcli init`, or edit `.dbcli/config.json`), or ask an administrator.

```bash
dbcli init  # Choose "data-admin" or "admin"
dbcli delete users --where "id=1" --force
```

---

### Query Errors

#### "Table not found: users"

Table doesn't exist or name is misspelled.

**Solution:**

```bash
# Show all available tables
dbcli list

# Check spelling and retry
dbcli query "SELECT * FROM user" --format json
```

#### "Syntax error near SELECT"

SQL syntax error in query.

**Solution:**

```bash
# Test query in native database client first
psql  # Or mysql
# SELECT * FROM users;  <- Test here first

# Then use in dbcli
dbcli query "SELECT * FROM users"
```

---

### Performance Issues

#### "Query returns 1000 rows instead of full result set"

Query-only permission auto-limits results for safety.

**Solution:** Increase permission level or fetch data in chunks:

```bash
# Re-initialize with higher permission
dbcli init  # Choose "read-write" or "admin"

# OR fetch data in chunks
dbcli query "SELECT * FROM users LIMIT 100 OFFSET 0"
dbcli query "SELECT * FROM users LIMIT 100 OFFSET 100"
```

#### "CLI startup takes 30+ seconds (first run)"

npx is downloading and caching package.

**Solution:** This is normal on first run. Subsequent runs are instant:

```bash
npx @carllee1983/dbcli init  # First run: 30s (downloads)
npx @carllee1983/dbcli init  # Second run: <1s (cached)

# Or install globally for faster startup
npm install -g @carllee1983/dbcli
dbcli init  # All future runs: <1s
```

---

### Cross-Platform Issues

#### Windows: "Command not found: dbcli"

npm .cmd wrapper not created or PATH not updated.

**Solutions:**

```bash
# Restart terminal to refresh PATH
# OR reinstall globally
npm uninstall -g @carllee1983/dbcli
npm install -g @carllee1983/dbcli

# Verify installation
where dbcli  # Windows command to find executable
```

#### macOS/Linux: "Permission denied: ./dist/cli.mjs"

Executable bit not set.

**Solution:**

```bash
chmod +x dist/cli.mjs
./dist/cli.mjs --help
```

---

## System Requirements

### Database Support

- **PostgreSQL:** 12.0+
- **MySQL:** 8.0+
- **MariaDB:** 10.5+

### Runtime

- **Node.js:** 18.0.0+
- **Bun:** 1.3.3+

### Platforms

- **macOS:** Intel and Apple Silicon
- **Linux:** x86_64 (Ubuntu, Debian, CentOS, etc.)
- **Windows:** 10+ (via npm .cmd wrapper)

---

## Development

```bash
bun test        # run test suite
bun run build   # bundle CLI to dist/ (used before publish)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full setup, testing, and release process.

---

## License

See LICENSE file for details.
