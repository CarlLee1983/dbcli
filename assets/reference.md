# dbcli — full command reference

Companion to [SKILL.md](SKILL.md). Exhaustive flags, copy-paste examples, `shell`, `completion`, `upgrade`, `migrate` DDL, and extended MongoDB examples.

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

### q

Run a saved query snippet by `@name`. Snippets are parameterised SELECT/WITH statements stored under `.dbcli-shared/queries/` (committed, team-shared) or `.dbcli/queries/` (gitignored, personal override). Local snippets always shadow shared ones with the same key.

```bash
dbcli q @dau                                  # run with declared defaults
dbcli q @dau --param days=30 --format json    # override a param
dbcli q @analytics/revenue --param-file params.json
dbcli q @dau --dry-run                        # show final SQL + bind values
dbcli q @dau --no-limit                       # disable size guard wrap
```

**Options:**
- `--format <table|json|csv>` — output format (default: `table`)
- `--param <key=value>` — pass a parameter (repeatable)
- `--param-file <path>` — JSON object whose keys are param names
- `--no-limit` — skip the `SELECT * FROM (…) AS _dbcli_guard LIMIT 1000` wrap
- `--dry-run` — print the bound SQL + values without executing
- `--use <name>` — pick a v2 named connection

**Permission:** query-only+

#### Snippet file format

Each `.sql` file is plain SQL with optional YAML frontmatter inside a leading `-- ---` block. Lines outside frontmatter form the SQL body.

```sql
-- ---
-- name: DAU
-- description: Daily Active Users
-- engine: postgres        # or [postgres, mysql]
-- params:
--   days:
--     type: int           # int | string | float | bool | date | datetime
--     default: 7
--     required: false
--     description: lookback window in days
--     enum: [7, 30, 90]
-- tags: [analytics]
-- ---
SELECT COUNT(DISTINCT user_id) AS dau
FROM events
WHERE created_at > NOW() - (:days || ' days')::interval;
```

Param placeholders use `:name`. They are rewritten to `$1, $2, …` (Postgres) or `?, ?, …` (MySQL) at execution time and passed as bind values — string interpolation is never used.

#### Param type coercion

| Declared `type` | Accepts |
|-----------------|---------|
| `int` | integer literal |
| `float` | decimal literal |
| `bool` | `true` / `false` / `1` / `0` / `yes` / `no` |
| `string` | any value |
| `date` | `YYYY-MM-DD` |
| `datetime` | ISO 8601 |

`enum` (optional) restricts the accepted values; mismatch is a hard error. CLI `--param` overrides `--param-file`, which overrides the snippet's `default`.

#### Safety invariants

- Only `SELECT` / `WITH` (CTE) bodies are accepted; `INSERT/UPDATE/DELETE/DDL` are rejected by the parser.
- Multi-statement bodies (`SELECT 1; DROP TABLE x`) are rejected.
- Template syntax inside SQL (`${…}`, `{{…}}`) is rejected — use `:name` parameters.
- Files exceeding 64 KiB are rejected.
- `--no-limit` is honoured only at the outermost level; nested subqueries are still wrapped by the size guard.

### queries

Manage saved snippets — list / show / new / edit / check.

```bash
dbcli queries list                      # all snippets
dbcli queries list --tag analytics --engine postgres --format json
dbcli queries show @dau                 # frontmatter + SQL
dbcli queries show @dau --format json   # MCP-shaped contract
dbcli queries new @new/sample           # scaffold under .dbcli-shared/queries/
dbcli queries new @scratch --local      # personal copy under .dbcli/queries/
dbcli queries edit @dau                 # opens local first, falls back to shared
dbcli queries edit @dau --shared        # always edit the shared file
dbcli queries check                     # parse all snippets; exit 1 on errors
dbcli queries check --strict            # promote warnings (e.g. missing engine) to errors
```

**`list` options:** `--format <table|json|csv>`, `--tag <tag>`, `--engine <postgres|mysql>`, `--source <local|shared>`
**`show` options:** `--format <table|json|csv>`
**`new` options:** `--local`, `--edit`
**`edit` options:** `--shared`
**`check` options:** `--strict`, `--format <table|json|csv>`

`--format json` on `list` and `show` emits a stable, machine-readable shape — designed to back a future MCP server without further refactor.

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

> **MongoDB SRV diagnostics:** When the active connection uses `mongodb+srv://`, `doctor` reports whether the current runtime can resolve SRV records directly or only through the DNS-over-HTTPS fallback used by dbcli. This helps spot execution-environment DNS restrictions even when Compass can connect.

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
