# dbcli — full command reference

Companion to [SKILL.md](SKILL.md). Exhaustive flags, copy-paste examples, `shell`, `completion`, `upgrade`, `migrate` DDL, and extended MongoDB examples.

For cross-engine support status, see `docs/feature-matrix.md` in the repository.

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

# Redis (database = logical DB index)
dbcli init --system redis --host localhost --port 6379
dbcli init --system redis --host localhost --port 6379 --password secret --name 0

# Elasticsearch
dbcli init --system elasticsearch --host localhost --port 9200 --user elastic --password changeme
dbcli init --system elasticsearch --cloud-id "myCluster:dXMtZWFzdC0xLmF3..." --api-key "<base64>"

# Multi-connection (v2 format)
dbcli init --conn-name staging --env-file .env.staging   # Named connection with custom env file
dbcli init --conn-name prod --env-file .env.production --use-env-refs --skip-test
dbcli init --remove staging                              # Remove a named connection
dbcli init --rename staging:production                   # Rename a connection
```

**Key options:** `--system`, `--permission`, `--use-env-refs`, `--skip-test`, `--no-interactive`, `--force`, `--conn-name <name>`, `--env-file <path>`, `--remove <name>`, `--rename <old:new>`

**MongoDB-specific options:** `--uri <uri>` (full connection URI), `--auth-source <db>` (auth database, default: `admin` when user/password set)

**Elasticsearch-specific options:** `--cloud-id <id>` (Elastic Cloud), `--api-key <key>` (ApiKey auth). Other ES fields (`nodes[]`, `protocol`, `caPath`, `rejectUnauthorized`) can be edited directly in `.dbcli`.

**Redis note:** the `database` (or `--name`) field is the logical DB index (`"0"` … `"15"`), not a database name.

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

List all tables (SQL), collections (MongoDB), keys (Redis), or indices (Elasticsearch).

```bash
dbcli list
dbcli list --format json
dbcli list --include-system        # Elasticsearch: include `.system` indices
```

**Permission:** query-only+

> **MongoDB:** Lists collections with estimated document count.
> **Redis:** Returns up to 100 000 keys via `SCAN MATCH * COUNT 1000`. The header reads `Keys in db <n> (redis):` where `<n>` is the logical DB index.
> **Elasticsearch:** Returns indices with `documentCount` from `/_stats/docs`; aliases are tagged separately. System indices (names starting with `.`) are hidden unless `--include-system` is passed.

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

> **Redis:** `schema <key>` is required (no full scan). The output exposes `type`, `ttl`, `size`, and a small `sample` (e.g. first 5 hash keys). `--reset` / `--refresh` are rejected — Redis caches no schema.
> **Elasticsearch:** `schema [index]` flattens the `_mapping` properties (nested `a.b.c`) and emits each `.fields` multi-field as a separate column (e.g. `text` + `text.keyword`). Full scan iterates all non-system indices and stores per-connection caches alongside SQL engines.

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

# Redis: any whitelisted command (permission-gated by command)
dbcli query "GET session:abc"
dbcli query "HGETALL user:42" --format json
dbcli query "SCAN 0 MATCH user:* COUNT 100"
dbcli query "SET feature:flag enabled"          # requires read-write+
dbcli query "DEL stale:key"                      # requires data-admin+

# Elasticsearch: DSL body or Lucene q-string
dbcli query '{"query":{"match":{"status":"active"}}}' --collection orders
dbcli query 'status:active AND amount:>100' --index orders --limit 50
```

**Options:** `--format <table|json|csv>`, `--limit <number>`, `--no-limit`, `--collection <name>` (MongoDB / Elasticsearch), `--index <name>` (Elasticsearch alias for `--collection`)
**Permission:** query-only+ (Redis: per-command; Elasticsearch: per HTTP method/path)

> **MongoDB notes:**
> - SQL syntax is rejected — use JSON object (filter) or JSON array (pipeline)
> - `--collection <name>` is required
> - Auto-limit does not apply; use `$limit` in your pipeline if needed

> **Redis notes:**
> - The first token must be an allow-listed command (`GET`/`SET`/`HGET`/`HSET`/`DEL`/...). Unknown commands are refused.
> - Permission tier is derived from the command (read → `query-only`, write → `read-write`, delete → `data-admin`, `KEYS`/`FLUSHDB`/`CONFIG`/... → `admin`).
> - Output is always shaped into rows: scalar replies become `{value: ...}`; arrays become indexed rows; `HGETALL` is folded into a single object.

> **Elasticsearch notes:**
> - `--collection` (or `--index`) is required.
> - A body that begins with `{` is sent as DSL via `POST /<index>/_search`; otherwise the value is URL-encoded into `?q=...` (Lucene query string) via `GET`.
> - Hits are flattened: each result row contains `_id` plus dotted-path fields from `_source`. Pass `--format json` to keep nested structures readable.
> - Query-only mode caps at 1000 hits; `--no-limit` is internally capped at 10 000 (use saved searches / `search_after` for deeper pagination).

### q

Run a saved query snippet by `@name`. Snippets are parameterised SELECT/WITH statements resolved from three layers, with **local > shared > builtin** precedence (a local file always shadows shared and builtin variants of the same key):

- `builtin` — bundled with dbcli (e.g. `@diag/*`); read-only at runtime.
- `.dbcli-shared/queries/` — committed, team-shared.
- `.dbcli/queries/` — gitignored, personal override.

Engine variants (`name.postgres.sql` / `name.mysql.sql`) at the same layer are merged; the variant matching the active connection's engine is selected at execution time.

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

##### Elasticsearch snippets

Body is a JSON DSL `_search` request body. Frontmatter requires an `index:` field (may contain `:param`).

Example:

    -- ---
    -- name: events-by-day
    -- engine: elasticsearch
    -- index: 'events-:date'
    -- params:
    --   date:    { type: date,   required: true }
    --   user_id: { type: int,    required: true }
    -- ---
    {
      "query": {
        "bool": {
          "filter": [
            { "term": { "user_id": :user_id } }
          ]
        }
      },
      "size": 100
    }

Substitution rules (type-aware JSON injection):

- `int` / `float` / `bool` outside string literals → bare value (`42`, `1.5`, `true`)
- `string` / `date` / `datetime` outside string literals → JSON-quoted (`"Alice"`, `"2026-05-08"`)
- Any param inside a JSON string literal → escaped inner form (`"prefix-:name"` works)

`script` and `script_fields` are rejected anywhere in the body.

Size guard: if `size` is missing, `1000` is injected (or `0` when `aggs` is present); explicit `size > 1000` is overridden with a warning unless `--no-limit`.

##### Redis snippets

Body is a single Redis command on one line. Only read-only commands are allowed:
`GET MGET HGET HGETALL HMGET HKEYS HVALS HLEN HEXISTS LRANGE LLEN LINDEX SMEMBERS SISMEMBER SCARD ZRANGE ZRANGEBYSCORE ZRANGEBYLEX ZSCORE ZCARD ZCOUNT ZRANK TYPE EXISTS TTL PTTL STRLEN OBJECT SCAN HSCAN SSCAN ZSCAN`.

`KEYS`, `EVAL`, `FLUSHDB`, `FLUSHALL`, `CONFIG`, `DEBUG`, `SHUTDOWN`, `SCRIPT` and any write command are rejected.

Example:

    -- ---
    -- name: cache-user
    -- engine: redis
    -- params:
    --   id: { type: int, required: true }
    -- ---
    HGETALL user::id

Substitution rules: pure raw text — `:name` becomes the value's `String()` form. **Quoting is the snippet author's responsibility**: wrap `:name` in double quotes if the value may contain whitespace. The parser warns when a `string`-typed `:name` is adjacent to non-whitespace and unquoted.

Size guard: `LRANGE` / `ZRANGE` stop overridden when `< 0` or `> 1000`; `SCAN` / `HSCAN` / `SSCAN` / `ZSCAN` get `COUNT 1000` injected if absent. `--no-limit` disables.

### queries

Manage saved snippets — discover, inspect, scaffold, and edit local copies. Mutating
subcommands (`delete`, `rename`, `copy`, `import`) only operate on the local layer
(`.dbcli/queries/`); builtin and shared snippets are never modified in place.

```bash
# Discovery / inspection
dbcli queries list                      # all snippets (builtin + shared + local)
dbcli queries list --tag analytics --engine postgres --format json
dbcli queries list --source local       # only personal overrides
dbcli queries show @dau                 # frontmatter + SQL
dbcli queries show @dau --format json   # MCP-shaped contract

# Authoring
dbcli queries new @new/sample           # scaffold under .dbcli-shared/queries/
dbcli queries new @scratch --local      # personal copy under .dbcli/queries/
dbcli queries edit @dau                 # opens local first, falls back to shared
dbcli queries edit @dau --shared        # always edit the shared file
dbcli queries check                     # parse all snippets; exit 1 on errors
dbcli queries check --strict            # promote warnings (e.g. missing engine) to errors

# Local-layer file management
dbcli queries delete @scratch                       # remove local file(s); prompts unless --force
dbcli queries delete @scratch --force
dbcli queries rename @scratch @analytics/dau        # rename within local layer; preserves engine suffix
dbcli queries copy @diag/connections @my/connections    # fork builtin/shared into local for editing
dbcli queries import ./hotfix.sql                   # import an external .sql into .dbcli/queries/
dbcli queries import ./hotfix.sql --as @diag/custom # override the snippet key
dbcli queries export @dau --output dau.sql          # write snippet body to a file (stdout if omitted)
dbcli queries export @diag/connections --engine postgres  # pick a variant when multiple engines exist
```

**`list` options:** `--format <table|json|csv>`, `--tag <tag>`, `--engine <postgres|mysql>`, `--source <local|shared>`
**`show` options:** `--format <table|json|csv>`
**`new` options:** `--local`, `--edit`
**`edit` options:** `--shared`
**`check` options:** `--strict`, `--format <table|json|csv>`
**`delete` options:** `--force` (skip the confirmation prompt). Refuses to run if `@name` has no local copy.
**`rename` options:** `--force`. Both names must start with `@`. Engine suffix (`.postgres.sql` / `.mysql.sql`) is preserved; frontmatter `name:` is rewritten to the new key.
**`copy` options:** *(none)*. Copies every variant (all engines) of the source into the local layer; fails if the destination already has a local copy.
**`import` options:** `--force` (overwrite existing local file), `--as <name>` (override snippet key; defaults to filename without `.postgres` / `.mysql` suffix). Source must be `.sql` and parse cleanly (frontmatter validated, non-SELECT bodies rejected).
**`export` options:** `--output <path>` (write to file; otherwise stdout), `--engine <postgres|mysql>` (required when the snippet has multiple engine variants).

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

### inspect

Read-only snapshot for AI agents. Never emits credentials or blacklisted values.

| Flag | Purpose |
|------|---------|
| `--format <json\|markdown>` | Output format (default `json`) |
| `--brief` | Drop sample arrays and trim suggested commands to ≤3 |
| `--for-agent` | Shortcut for `--format json --brief` |
| `--no-connect` | Skip the cheap version/object probe (no DB traffic) |
| `--probe-timeout <ms>` | Hard timeout for the version/object probe (default 1500) |

Example:

```bash
dbcli inspect --for-agent
```

Output schema is locked at `schemaVersion: 1`. Sections: `connection`, `permission`, `blacklist`, `objects`, `schemaCache`, `snippets`, `suggestedCommands`, `warnings`.

**Permission:** query-only+

### report

Diagnostic report built on top of `inspect`. Reuses inspect context (connection,
permission, blacklist, snippet inventory) and additionally runs curated built-in
`@diag/*` snippets grouped into sections.

Flags:
- `--format json|markdown` (default: json)
- `--section health,capacity,perf` (default: all three)
- `--brief` — drop evidence rows; keep counts and statuses
- `--for-agent` — shortcut for `--format json --brief`
- `--no-connect` — context-only snapshot (skip diagnostics + inspect probe)
- `--per-snippet-timeout <ms>` (default 3000)
- `--max-rows-per-evidence <n>` (default 50)
- `--probe-timeout <ms>` (default 1500, inherited from inspect)

Examples:

    dbcli report --format json
    dbcli report --format markdown --section health,capacity
    dbcli report --for-agent
    dbcli report --no-connect

Boundaries:
- Read-only. Skips snippets whose required params have no default value.
- Never connects in `--no-connect` mode.
- MongoDB and no-config workspaces emit a context-only snapshot with a warning.

**Permission:** query-only+

### guide

Deterministic next-command planner for a fixed set of database goals. Reuses
`inspect` context (cache-first) and the workspace's saved-query inventory to
emit an ordered, read-only plan that an AI agent can follow step-by-step.

Goals (fixed list):
- `slow-query` — diagnose slow queries (long-running, locks, cache, indexes).
- `capacity` — audit storage and memory.
- `health` — connections, locks, cluster status.
- `index-usage` — index effectiveness audit.
- `permissions` — review permission level, blacklist, snippet inventory.
- `schema-overview` — orient in an unfamiliar database.

Flags:
- `--format json|markdown` (default: json)
- `--brief` — drop rationale + expects fields
- `--for-agent` — shortcut for `--format json --brief`
- `--list` — list available goals and exit
- `--probe` — refresh inspect context via live probe (default: cache-first)
- `--probe-timeout <ms>` (default 1500, inherited from inspect)

Examples:

    dbcli guide slow-query
    dbcli guide capacity --format markdown
    dbcli guide --list
    dbcli guide health --for-agent
    dbcli guide schema-overview --probe

Boundaries:
- Read-only. Guide plans commands; it does not execute them.
- Goal vocabulary is fixed in v1.14.0; user-supplied goals are rejected.
- Each step carries `risk: 'readonly'` in v1.14.0 (forward-compatible with v1.15.0 recovery).
- Coexists with `dbcli skill tasks plan` (template-driven). Use guide for ad-hoc goals; use task packs for repeatable workflows.

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

### skill tasks (Agent Task Packs)

```bash
dbcli skill tasks list                                            # human table
dbcli skill tasks list --format json --tag diagnostics
dbcli skill tasks list --engine postgres --source builtin
dbcli skill tasks show diagnose-slow-query
dbcli skill tasks show diagnose-slow-query --format json
dbcli skill tasks plan diagnose-slow-query --param query="SELECT 1"
dbcli skill tasks plan diagnose-slow-query --param query="..." --format json
```

- **list filters:** `--tag <tag>`, `--engine <postgres|mysql|mongodb|redis|elasticsearch>`, `--source <builtin|shared|local>`, `--format <table|json>`.
- **show:** prints the full task definition (frontmatter + Agent Notes). Use `--format json` for an agent-friendly contract.
- **plan:** resolves `{{param}}` placeholders, validates required parameters, and emits a stable plan. Plans are **plan-only** in this version — dbcli will never execute the resulting commands automatically.

Task storage layers:

| Source | Path | Notes |
| --- | --- | --- |
| builtin | `assets/tasks/` | shipped with dbcli |
| shared | `.dbcli-shared/tasks/` | team-managed, version-controlled |
| local | `.dbcli/tasks/` | personal, gitignored |

Higher tiers override lower tiers by task name. Task name is derived from the
file path under the tier root (e.g. `diag/inspect.md` → `diag/inspect`).

## MongoDB Support

MongoDB connections use a JSON-based query model instead of SQL. Treat MongoDB support as a narrower document-database path, not as a full SQL feature equivalent.

Atlas-style `mongodb+srv://` URIs are supported. `list` and `query` run against the database configured for the connection, and `query` always requires `--collection <name>`.

**Supported commands:** `init`, `use`, `list`, `schema`, `query`, `insert`, `update`, `delete`, `status`, `shell`, `doctor`, `upgrade`, `completion`

**Limited support:**

- `schema` samples collection documents to infer field names/types. It does not provide relational constraints, primary keys, foreign keys, or reliable index metadata.
- `query` accepts only JSON object filters or aggregation pipeline arrays and always requires `--collection <name>`.
- `insert` inserts one JSON document into the named collection.
- `update` accepts a JSON filter in `--where` or simple `key=value` conditions. If `--set` does not use MongoDB update operators such as `$set`, dbcli wraps it in `$set`.
- `delete` deletes all documents matching the JSON/simple filter.
- MongoDB write paths do not currently provide the same SQL dry-run, relational schema validation, or column-level blacklist filtering guarantees as SQL writes.
- `shell` blocks raw SQL for MongoDB; use `query <json> --collection <name>` inside the shell.

**Not supported (exit with error):** `q` saved-query execution, `export`, `diff`, `migrate`

**Not a supported MongoDB target:** `check` is designed for relational health checks and emits SQL-style checks.

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

# 4. Document writes (permission-gated; no SQL dry-run semantics)
dbcli insert orders --data '{"status":"paid","total":42}'
dbcli update orders --where '{"status":"pending"}' --set '{"status":"paid"}'
dbcli delete orders --where '{"status":"cancelled"}' --force
```

### Query syntax

| Intent | Syntax |
|--------|--------|
| All documents | `'{}'` |
| Field filter | `'{"field": "value"}'` |
| Comparison | `'{"age": {"$gt": 18}}'` |
| Aggregation | `'[{"$match": {...}}, {"$group": {...}}]'` |

## Redis Support

Redis connections speak Redis commands rather than SQL. The adapter uses the `ioredis` driver and exposes a narrow, permission-gated surface.

**Supported commands:** `init`, `use`, `list`, `schema`, `query`, `status`, `doctor`, `upgrade`, `completion`

**Saved queries:** `q` is supported for read-only Redis commands (see "Redis snippets" below).

**Not supported (exit with error or unsupported error):** `insert`, `update`, `delete`, `export`, `check`, `diff`, `migrate`, `shell`. For writes, run the equivalent Redis command via `query` — the same permission gate applies.

### Connection and configuration

- Required fields: `system: redis`, `host`, `port`. `password` and `database` are optional.
- `database` is the **logical DB index** (`"0"` … `"15"`), kept as a string to play nicely with env-ref bindings. `list` and the connection metadata both label it as the active DB.
- `connection.timeout` (ms, default 5000) maps to ioredis's `connectTimeout`.

### Permission classification

Permission is derived from the command's first token (case-insensitive). Unknown commands are denied even at `admin` tier — they must be added to the allow-list.

| Tier | Commands |
|------|----------|
| `query-only` | `GET`, `MGET`, `STRLEN`, `EXISTS`, `TTL`, `PTTL`, `TYPE`, `SCAN`, `HGET`, `HGETALL`, `HKEYS`, `HVALS`, `HLEN`, `HEXISTS`, `HMGET`, `LRANGE`, `LLEN`, `LINDEX`, `SMEMBERS`, `SCARD`, `SISMEMBER`, `ZRANGE`, `ZREVRANGE`, `ZRANGEBYSCORE`, `ZCARD`, `ZSCORE`, `PING`, `ECHO` |
| `read-write` | `SET`, `SETEX`, `SETNX`, `PSETEX`, `MSET`, `MSETNX`, `APPEND`, `INCR`/`INCRBY`, `DECR`/`DECRBY`, `HSET`/`HSETNX`/`HMSET`/`HINCRBY`, `LPUSH`/`RPUSH`/`LPOP`/`RPOP`/`LSET`, `SADD`/`SREM`, `ZADD`/`ZREM`, `EXPIRE`/`EXPIREAT`/`PEXPIRE`/`PERSIST`, `RENAME` |
| `data-admin` | `DEL`, `UNLINK`, `HDEL` |
| `admin` | `FLUSHDB`, `FLUSHALL`, `CONFIG`, `INFO`, `CLIENT`, `DEBUG`, `SHUTDOWN`, `KEYS`, `MONITOR`, `SAVE`, `BGSAVE`, `BGREWRITEAOF`, `REPLICAOF`, `SLAVEOF`, `ACL` |

### Schema inspection

`schema <key>` returns one synthetic row per key with these columns:

| column | meaning |
|--------|---------|
| `type` | Redis type (`string` / `hash` / `list` / `set` / `zset` / `stream` / `none`) |
| `ttl` | `<n>s`, `no expiry`, or `missing` |
| `size` | `STRLEN` / `HLEN` / `LLEN` / `SCARD` / `ZCARD` / `XLEN` depending on type |
| `sample` | First 5 hash field names (hash only) |

`schema` (no key) and `--refresh` / `--reset` are rejected — there is no full-database schema cache for Redis.

### Recommended `query` patterns

```bash
# Read
dbcli query "GET feature:flag"
dbcli query "HGETALL user:42" --format json
dbcli query "LRANGE queue:jobs 0 9"

# Iterate keys (paginated; never use KEYS — admin-only)
dbcli query "SCAN 0 MATCH session:* COUNT 200"

# Write (requires read-write+)
dbcli query "SET counter 1"
dbcli query "EXPIRE session:abc 3600"
dbcli query "HSET user:42 name Alice"

# Delete (requires data-admin+)
dbcli query "DEL temp:lock"
dbcli query "HDEL user:42 lastLogin"
```

### Limitations

- No `--dry-run` for writes — Redis commands execute immediately. Pair writes with a confirming read (`GET`, `HGETALL`, `EXISTS`).
- No transaction wrapping (`MULTI`/`EXEC`). Submit one command at a time.
- `KEYS` requires `admin`. Prefer `SCAN` for routine work.
- Blacklist rules are not enforced for Redis (there is no concept of "column" / "table" the validator can map). Be careful with sensitive key prefixes.

## Elasticsearch Support

Elasticsearch connections speak the REST API. The adapter is fetch-based (no SDK) and supports HTTPS, custom CA, API key, basic auth, and Cloud ID.

**Supported commands:** `init`, `use`, `list`, `schema`, `query`, `status`, `doctor`, `upgrade`, `completion`

**Saved queries:** `q` is supported for ES JSON DSL bodies (see "Elasticsearch snippets" below).

**Not supported (use external tooling):** `insert`, `update`, `delete`, `export`, `check`, `diff`, `migrate`, `shell`. The permission classifier already understands `_doc` / `_update` / `_bulk` so future write surfaces can be wired in without changing tiers.

### Connection and configuration

- Either `host` + `port` (default `https://localhost:9200`) or `nodes: [...]` (first node is used) or `cloudId`.
- Auth precedence: `apiKey` → `user`/`password` (HTTP Basic). Leave both unset for an open cluster.
- `protocol` defaults to `https`. For TLS quirks: `caPath` (path to a PEM bundle) and `rejectUnauthorized: false` (last resort).
- `connection.timeout` (ms, default 5000) is wired to `AbortController` on every request.

### Permission classification

Each REST request is mapped to a SQL-shaped tier based on method + path:

| ES surface | Mapped to | Permission |
|------------|-----------|------------|
| `GET _search` / `_count` / `_mapping` / `_settings` / `_alias` / `GET _doc` / `_source` | `SELECT` | `query-only` |
| `POST _update` / `POST _doc` | `UPDATE` | `read-write` |
| `PUT _doc` / `_create` | `INSERT` | `read-write` |
| `DELETE` (any) | `DELETE` | `data-admin` |
| `_bulk` | highest tier among the NDJSON actions (`delete` ⇒ `data-admin`) | derived |
| Anything else | `DROP` | `admin` (deny by default) |

### Schema inspection

`schema [index]` calls `GET /<index>/_mapping` and flattens nested properties into dotted-path columns. Multi-fields under `.fields` (e.g. `text` → `text.keyword`) are emitted as separate columns. All fields are reported as nullable. There is no PK / FK / index info.

`schema` (no argument) iterates all non-system indices through the standard full-scan code path and writes per-connection caches under `.dbcli/schemas/<connection>/`.

### Query semantics

- `--collection <index>` (or `--index <index>`) is required.
- Body that starts with `{` → sent as JSON DSL via `POST /<index>/_search`. Body otherwise → URL-encoded into `?q=...` (Lucene query string) on `GET`.
- Hits are flattened: each row carries `_id` plus dotted-path fields lifted from `_source`. Use `--format json` to inspect raw nested structure.
- Query-only mode caps `size` at 1000. `--no-limit` is internally capped at 10 000; for deeper pagination use the API directly with `search_after` or PIT.

### Recommended `query` patterns

```bash
# DSL match
dbcli query '{"query":{"match":{"status":"active"}}}' --collection orders --format json

# DSL with sort + size
dbcli query '{"query":{"range":{"created_at":{"gte":"2026-01-01"}}},"sort":[{"created_at":"desc"}],"size":50}' \
  --collection orders

# Aggregation
dbcli query '{"size":0,"aggs":{"by_status":{"terms":{"field":"status.keyword"}}}}' \
  --collection orders --format json

# Lucene query string
dbcli query 'status:active AND amount:>100' --index orders --limit 100
```

### Doctor and diagnostics

`dbcli doctor` runs a dedicated Elasticsearch path:

- Verifies REST connectivity to `GET /`.
- Reads `version.number` and runs the standard version freshness check.
- Walks every index via `listTables()` + `getTableSchema()` to feed the blacklist completeness check and the large-table heuristic (using `documentCount`).
- Standard schema-cache freshness using `schemaLastUpdated`.

### Limitations

- Writes (`insert`/`update`/`delete`/`export`) are not exposed yet — the adapter implements them, but the CLI currently only routes them for SQL and MongoDB.
- No `_search/scroll` or PIT pagination at the CLI layer; large pulls need a saved external script.
- `check`, `diff`, `migrate`, and `q` are SQL-only and exit with errors (or fall through to a generic "unsupported" path).
- Blacklist column rules are applied to flattened hit rows on `query`; table-level blacklist rejects an index up front.
