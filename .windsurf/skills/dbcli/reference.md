# dbcli — full command reference

Companion to [SKILL.md](SKILL.md). Exhaustive flags, copy-paste examples, `shell`, `completion`, `upgrade`, `migrate` DDL, and extended MongoDB examples.

For cross-engine support status, see `docs/feature-matrix.md` in the repository.

## Global options and placement

These options are available on the root `dbcli` command. Root-level options must
appear before the command path (for example, `dbcli --use prod status`). A
command-level option is only valid after the command that declares it.

| Option | Purpose |
|---|---|
| `--version` | Print the installed dbcli version. |
| `--no-color` | Disable colored output. |
| `-v, --verbose` | Increase logging verbosity; repeat for debug output. |
| `-q, --quiet` | Suppress non-essential output. |
| `--config <path>` | Select the `.dbcli` configuration path. |
| `--global` | Select the user-global registry at `~/.config/dbcli/config.json` instead of the current project's `.dbcli` config. Place it before the command path. |
| `--use <connection>` | Select a named connection for this invocation; place it before the command path unless that command explicitly lists a command-level `--use`. |
| `--timeout <ms>` | Connection timeout in milliseconds (integer, 100–600000), overriding the connection config's `timeout` field for this invocation. Applies to every engine adapter. Without either the flag or the config field, adapters fall back to their built-in 5000ms default. |

`--timeout` is applied only when the adapter is constructed for this invocation — it is
never written back to `config.json`. Set the connection's `timeout` field instead for a
value that persists across runs. On PostgreSQL, the same value is also used as the
session's `statement_timeout` (not just the connection timeout), so a low value can cut
off a long-running query with an error that looks like a connection timeout; the 100ms
floor exists specifically to keep that failure mode from being too easy to trigger.
Elasticsearch applies its timeout per request rather than once for the whole connection.
The `timeout` field itself always takes a literal number — unlike other connection
fields, it does not accept an `{"$env": "..."}` reference.

### Redirecting output

Results go to stdout; diagnostics (auto-limit notices, warnings, update hints) go to
stderr. That split is what keeps `--format json` machine-parseable, so do not collapse
it with `2>&1` — the diagnostic lines land in front of the JSON document and the parse
fails. Pipe stdout alone, or add `2>/dev/null` when the diagnostics are not wanted:

```bash
dbcli query '{}' --collection events --format json 2>/dev/null | jq '.rows | length'
```

## Commands

### init

Initialize `.dbcli` configuration file. Typically run manually by the developer — avoid running on behalf of the user unless explicitly requested.

```bash
dbcli init                                              # Single connection (v1 format)
dbcli init --system mysql --host localhost --port 3306 --user root --name mydb
dbcli init --use-env-refs                               # Store env var references
dbcli init --no-interactive --force                     # Non-interactive mode

# MongoDB — field-by-field (primary path, same shape as SQL)
dbcli init --system mongodb --host localhost --port 27017 --user admin --password secret --auth-source admin --name mydb
dbcli init --system mongodb --host localhost --port 27017 --name mydb  # No auth
# MongoDB — full URI (advanced fallback: multi-host, non-standard driver options)
dbcli init --system mongodb --uri "mongodb://user:pass@host:27017/mydb?authSource=admin"

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

# User-global registry (shared by projects; --global must precede the command)
dbcli --global init --conn-name shared --system postgresql --host db.example.com \
  --port 5432 --user app --password '<secret>' --name appdb \
  --skip-test --no-interactive --force
dbcli --global use --list
```

**Key options:** `--system`, `--permission`, `--use-env-refs`, `--skip-test`, `--no-interactive`, `--force`, `--conn-name <name>`, `--env-file <path>`, `--remove <name>`, `--rename <old:new>`

**Environment-reference options:** `--env-host <var>`, `--env-port <var>`, `--env-user <var>`, `--env-password <var>`, `--env-database <var>`

**MongoDB-specific options:** `--uri <uri>` (full connection URI — advanced fallback), `--auth-source <db>` (auth database, default: `admin` when user/password set). Interactive `init` also asks for `replicaSet` and `tls` under an "advanced options?" prompt; there is no dedicated non-interactive flag for either yet — set them interactively or edit `.dbcli` afterward. `srv` (boolean, builds `mongodb+srv://` and resolves hosts via DNS SRV, ignoring `port`) is asked right after `host`, before `port`, since it decides whether `port` is even relevant.

**Elasticsearch-specific options:** `--cloud-id <id>` (Elastic Cloud), `--api-key <key>` (ApiKey auth). Other ES fields (`nodes[]`, `protocol`, `caPath`, `rejectUnauthorized`) can be edited directly in `.dbcli`.

**Redis note:** the `database` (or `--name`) field is the logical DB index (`"0"` … `"15"`), not a database name.

**Multi-connection:** Using `--conn-name` or `--env-file` creates a v2 config with named connections. Each connection can have its own env file and permission level. Existing v1 configs are automatically imported as the `default` connection when upgrading.

Use root-level `--global` with `init`, `use`, `status`, `query`, or any other command to read or mutate the user-global v2 registry at `~/.config/dbcli/config.json`. Without it, the current project binding remains the source of truth. The global registry uses the same private file mode and integrity record as project home storage.

> **AI agent note on `--use-env-refs`:** If an existing `.dbcli` config contains `{"$env": "DB_HOST"}` style references, the connection values are read from environment variables at runtime. Do NOT re-run `init` to replace these references with actual values — the env-ref format is intentional for CI/CD and multi-environment setups.

### use

Switch or display the default database connection (v2 multi-connection config).

```bash
dbcli use                   # Show current default connection
dbcli use staging           # Switch default to 'staging'
dbcli use --list            # List all connections (* marks default)
dbcli use --list --format json # Credential-free connection identity inventory
```

Each v2 named connection may include an optional non-secret `environment` label
(for example, `"environment": "production"`). JSON output is an object with a
`connections` array. Each item contains `name`, `environment` (a string or
`null`),
`permission`, `system`, `server` (`host` and `port`), `database`, and `isDefault`.
Environment-backed server and database fields are `null`; URI-only MongoDB and
Cloud ID-only Elasticsearch connections also return `null` instead of default
placeholders. It deliberately excludes user names, passwords, URIs, Cloud IDs,
API keys, and env variable names.
Misspelled selectors suggest nearby configured connection names.

Any command can also use `--use <name>` to temporarily select a connection without changing the default:

```bash
dbcli query --use staging "SELECT * FROM users LIMIT 10"
dbcli list --use prod
```

**Requires v2 config** (created with `dbcli init --conn-name`).

**Options:** `--list`, `--format <text|json>`, `--confirm-production <name>` (required when explicitly selecting a production connection as the default).

### Agent configuration trust boundary

When `DBCLI_AGENT_MODE=1`, configuration, permission, and credential mutations
are rejected. Agent reads require the V2 directory config and its integrity
record; missing, replaced, non-regular, or tampered records fail closed. Legacy
single-file `.dbcli` configs must be migrated by a human/admin process with
agent mode disabled. A host that needs protection from a same-user hostile
process can set `DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR` to a protected or read-only
directory; trusted writes publish detached digests there.

When a connection's config fails schema validation, dbcli reports the specific field
path(s) that are wrong for that connection's declared `system` — not the raw Zod union
error tree — so a broken `.dbcli` can be fixed without guessing which branch applies.

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

**Options:** `--format <table|json>`, `--refresh`, `--reset`, `--force`, `--use <connection>`, `--sample-size <n>` (mongo only), `--sample-method <random|natural>` (mongo only)
**Permission:** query-only+

**Schema storage (v1.4+):** Schema is persisted as layered files under `.dbcli/schemas/`. With v2 multi-connection config each connection gets its own subdirectory (`.dbcli/schemas/<connection>/`). Run `dbcli schema --use <connection>` once per connection before querying it — otherwise `schema <table>` may return data from the wrong connection's cache.

> **PostgreSQL:** Introspection uses the exact `public` catalog identity throughout. Full catalog/schema/table joins prevent a reused constraint name from contaminating another table; enum lookup includes its namespace; composite primary-key order comes from the exact table OID and index ordinality; and row estimates are scoped to the exact `public` relation. Row-count SQL qualifies and quotes both `"public"` and the exact table identifier, escaping embedded quotes so mixed-case or punctuation-bearing names remain distinct and safe.
> **Redis:** `schema <key>` is required (no full scan). The output exposes `type`, `ttl`, `size`, and a small `sample` (e.g. first 5 hash keys). `--reset` / `--refresh` are rejected — Redis caches no schema.
> **Elasticsearch:** `schema [index]` flattens the `_mapping` properties (nested `a.b.c`) and emits each `.fields` multi-field as a separate column (e.g. `text` + `text.keyword`). Full scan iterates all non-system indices and stores per-connection caches alongside SQL engines.
> **MongoDB:** schema is sampled via `$sample` (default 100, max 1000). `--sample-method natural` switches to `find().limit()`; `random` (default) falls back to natural order on driver error. Output columns surface nested dot-paths with `presence` (0..1) and `redacted: true` flags for blacklist-matched paths. The persisted cache records `sampleMethod` and `sampleSize`; `dbcli doctor` reports them via a `sampled: method=…, size=…` line.

### query

Execute a SQL statement, MongoDB filter/pipeline, allow-listed Redis command, or Elasticsearch DSL/Lucene query.

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

# Interactive HTML dashboard (see "Interactive HTML dashboard" below)
dbcli query "SELECT day, dau FROM dau_daily" --ui                # open in browser
dbcli query "SELECT * FROM orders" --format html > orders.html   # pipe to stdout
```

**Options:** `--format <table|json|csv|html>`, `--ui` (open the dashboard in the system browser; implies `--format html`), `--limit <number>`, `--no-limit`, `--collection <name>` (MongoDB / Elasticsearch), `--index <name>` (Elasticsearch alias for `--collection`), `--fields <list>`, `--truncate <number>` / `--no-truncate`, `-f, --query-file <path>`, `--use <name[,name]>`, `--recovery`
**Permission:** query-only+ (Redis: per-command; Elasticsearch: per HTTP method/path)

Below `admin`, SQL holding more than one statement is rejected, because only the
first statement would decide the permission check while a driver on the simple
query protocol executes them all. Semicolons inside string literals, backtick
identifiers, and `#` comments are not separators. A MongoDB pipeline containing
`$out` or `$merge` requires `data-admin`, and is rejected outright on `export`,
in snippets, and in multi-connection fan-out.

#### Field projection (`--fields`)

```bash
dbcli query "SELECT * FROM bet_log" --fields sn,currency,bet
dbcli query "SELECT * FROM bet_log" --fields=-raw_response,-created_at   # exclusion
dbcli query '{"station_code":"cmg9998"}' --collection raw_bet_log --fields sn,bet
```

Include and exclude forms cannot be mixed. Dotted paths (`user.email`) are supported.
On MongoDB the selection becomes a driver-level `projection` (find) or a trailing
`$project` stage (aggregate), so the omitted fields never leave the server; `_id` is
excluded unless listed explicitly. On SQL the rows are projected after fetch — write
an explicit column list in the `SELECT` when you also want to cut transfer cost.
Blacklisted columns stay blacklisted: naming one in `--fields` yields no value and the
result still carries the blacklist `securityNotification`. A requested field that does
not exist in the result comes back as `null`.

#### Cell truncation (`--truncate`)

```bash
dbcli query "SELECT sn, raw_response FROM bet_log"                 # table: 120-char default
dbcli query "SELECT sn, raw_response FROM bet_log" --truncate 40
dbcli query "SELECT sn, raw_response FROM bet_log" --no-truncate
```

Table output truncates each serialized cell at 120 Unicode code points by default and
appends `…(+N chars)`; counting by code point keeps multi-byte characters and emoji
intact. `--truncate <n>` sets the width, `--no-truncate` disables it. Explicit truncation
flags are rejected with JSON, CSV, HTML, and `--ui` output.

#### Query from a file or stdin (`-f`)

```bash
dbcli query -f report.sql
dbcli query --collection raw_bet_log -f - <<'EOF'
[{"$match": {"sn": {"$regex": "^SN0000"}}}, {"$group": {"_id": "$currency", "n": {"$sum": 1}}}]
EOF
```

Avoids shell quoting entirely — the usual reason a Mongo pipeline containing `$regex`
or nested date objects fails. Supplying both `--query-file` and positional query text
is an error rather than a silent choice, and an empty file or empty stdin is refused.
`-f -` requires piped input: on an interactive terminal dbcli refuses immediately
instead of waiting silently for input that is never coming.

#### One-shot connection selection and read-only fan-out

Selection precedence is explicit `--use`, then `DBCLI_CONNECTION`, then the saved default.
`query`, `schema`, `list`, `export`, and `check` accept command-level `--use`; for other
commands use root-level `dbcli --use <name> <command>`. One-shot selectors never update the
saved default and require a v2 config. A legacy v1 single-connection config rejects them
instead of silently running its only connection.

An explicit comma-separated `--use primary,staging` fans one query out to several named
connections. `DBCLI_CONNECTION` always names one literal connection and never enables
fan-out. SQL permits `SELECT`, `SHOW`, `DESCRIBE`, and `EXPLAIN`; MongoDB permits filters and
read-only pipelines without `$out` / `$merge`; Elasticsearch permits searches.
Redis, writes, `--recovery`, `--ui`, CSV, and HTML are rejected before execution. Each
connection keeps its own blacklist, limit metadata, audit entry, and error. Aggregate exit
codes are `0` when all succeed, `2` for mixed outcomes, and `1` when all fail or preflight
rejects the request.

#### Truncation is stated, not implied

When the query-only auto-limit trims the result, the table footer reads
`Rows: 1000 (truncated; limit 1000)`, `--format json` carries
`metadata.truncated` and `metadata.limit_applied`, and CSV appends a `#` comment line.
dbcli fetches one row past the cap to decide this, so a result of exactly 1000 rows is
reported as `truncated: false` — never infer truncation from a round row count.

> **MongoDB notes:**
> - SQL syntax is rejected — use JSON object (filter) or JSON array (pipeline)
> - `--collection <name>` is required
> - Query-only auto-limit applies to filters and to pipelines without their own
>   `$limit`; the applied cap and truncation are reported in the result metadata

> **Redis notes:**
> - The first token must be an allow-listed command (`GET`/`SET`/`HGET`/`HSET`/`DEL`/...). Unknown commands are refused.
> - Permission tier is derived from the command (read → `query-only`, write → `read-write`, delete → `data-admin`, `KEYS`/`FLUSHDB`/`CONFIG`/... → `admin`).
> - Output is always shaped into rows: scalar replies become `{value: ...}`; arrays become indexed rows; `HGETALL` is folded into a single object.

> **Elasticsearch notes:**
> - `--collection` (or `--index`) is required.
> - A body that begins with `{` is sent as DSL via `POST /<index>/_search`; otherwise the value is URL-encoded into `?q=...` (Lucene query string) via `GET`.
> - Hits are flattened: each result row contains `_id` plus dotted-path fields from `_source`. Pass `--format json` to keep nested structures readable.
> - Query-only mode caps at 1000 hits; `--no-limit` is internally capped at 10 000 (use saved searches / `search_after` for deeper pagination).

### explain

**(v1.23)** Read-only query-plan inspection across MySQL/MariaDB and PostgreSQL,
wrapping `EXPLAIN` / `EXPLAIN ANALYZE` / MariaDB `ANALYZE SELECT` behind one
interface. Output is a unified `ExplainRow` schema plus severity-coded
annotations. SQL `SELECT` only.

```bash
dbcli explain "SELECT * FROM betting_logs WHERE settled_at >= '2026-03-01'"
dbcli explain @analytics/live-summary                 # saved query
dbcli explain @file.sql                               # @file reference
dbcli explain --analyze "SELECT ..."                  # MariaDB ANALYZE SELECT / PG EXPLAIN ANALYZE
dbcli explain --format json "..."                     # markdown (default) | json | table
dbcli explain --bulk @queries.sql                     # batch from file
dbcli explain --bulk @analytics/*                     # glob over saved queries
```

**Options:** `--analyze` (run the query for real — EXPLAIN ANALYZE / ANALYZE SELECT), `--format <markdown|json|table>` (default `markdown`), `--bulk <input>` (comma-separated `@file` / `@glob` / `@saved-query`).
**Permission:** query-only+ (no upgrade required).

**Annotations:**

| Rule | Severity | Triggered when |
|---|---|---|
| `full-scan` | red | MySQL `type=ALL` or `key=NULL`; PG `Seq Scan` |
| `temp-table` | yellow | MySQL `Using temporary` |
| `filesort` | yellow | MySQL `Using filesort`; PG `Sort Method: external merge` |
| `cost-estimate-skew` | gray | `--analyze` actual rows / planner rows > 10× |
| `nested-loop-large` | yellow | PG `Nested Loop` with planner rows > 10,000 |

> Notes:
> - `--analyze` executes the statement, so dbcli accepts it only for SQL that is
>   structurally proven to be a read-only, function-free `SELECT` (including
>   SELECT-only CTEs). Explicit function and table-function calls are unproven
>   because user-defined and built-in functions may have side effects. DML, DDL,
>   data-modifying CTEs, session assignments, function-bearing SQL, and
>   unrecognized SQL are rejected before the adapter is invoked; use plain
>   `dbcli explain` for those statements.
> - Auto-`LIMIT` is **not** applied to EXPLAIN statements (since v1.23 P1).

### lint

Static, report-only SQL anti-pattern analysis for PostgreSQL, MySQL, and
MariaDB. `lint` never opens a database connection, never runs the SQL, and
never applies a rewrite. Schema-aware findings use only the layered schema
cache under `.dbcli/schemas/`.

```text
dbcli lint [queries...]
dbcli lint --bulk <input>
dbcli --use <conn> lint [queries...]
```

An input may be inline SQL, a saved query such as `@analytics/live-summary`, a
SQL file such as `@queries.sql`, or a saved-query/filesystem glob such as
`@analytics/*` or `@queries/**/*.sql`. `--bulk` accepts a comma-separated mix
of those `@file`, `@glob`, and `@saved-query` inputs; quote a filesystem glob
in a shell so the `@` reference reaches dbcli unchanged.

```bash
dbcli lint "SELECT * FROM users WHERE email LIKE '%@example.com'" --format json
dbcli lint --bulk '@queries/**/*.sql' --format markdown
dbcli --use staging lint @analytics/live-summary --min-severity warn
```

| Option | Default | Meaning |
|---|---|---|
| `--format <text\|json\|markdown>` | `text` | Render one report per resolved input. |
| `--min-severity <info\|warn\|error>` | `info` | Omit findings below the selected severity. |
| `--no-schema` | off | Skip schema-only checks without reading schema-cache paths; static `NOT IN` NULL checks still run. |
| `--bulk <input>` | none | Resolve a comma-separated list of `@file`, `@glob`, or `@saved-query` inputs. |
| `--recovery` | off | On command failure, emit and save a linked `RecoveryEnvelope`. |
| global `--use <conn>` | configured default | Select a v2 named connection and its isolated cache; place it before `lint`: `dbcli --use <conn> lint …`. |

**Rules:**

| Rule | Severity | What it reports |
|---|---|---|
| `select-star` | warn | A top-level `SELECT *`; when one table and its cached columns are unambiguous, the finding may include a column-list rewrite draft. |
| `unanchored-like` | warn | A `LIKE` / `ILIKE` pattern beginning with `%`, which a conventional B-tree index cannot anchor. |
| `missing-limit-offset` | info | Deep pagination with `OFFSET >= 1000`; prefer keyset pagination. |
| `non-sargable-where` | warn | A function or arithmetic expression applied to the column side of a predicate. |
| `or-to-union` | info | A top-level `OR` across different columns that can complicate index selection; any UNION alternative must preserve identity and multiplicity. |
| `subquery-to-join` | info | `IN (SELECT …)` where an equivalent `EXISTS`, or a JOIN with proven uniqueness/deduplication, may plan better. |
| `distinct-groupby-abuse` | warn | Redundant `DISTINCT` when simple projected columns exactly cover the `GROUP BY` columns. |
| `implicit-cast` | warn | A schema-verified column/literal type mismatch that can disable index use; safe, unambiguous numeric drafts may be included. |
| `not-in-nullable` | warn | A right-hand `NOT IN` value that can be NULL: explicit `NULL`, outer-join null extension, a nullable subquery projection, or a known nullable CASE/cast/aggregate expression. A nullable left-hand column is not this rule. |

`implicit-cast` and the schema-enriched portion of `not-in-nullable` read the
selected cache through the schema loader abstraction. Static `not-in-nullable`
checks still run without it. All schema caches live beneath `.dbcli/schemas/`. A v2
configuration always uses `.dbcli/schemas/<resolved-connection>/`, including
the configured default. The root `.dbcli/schemas/` directory is only the
v1/legacy unnamed cache. Global `dbcli --use <conn> lint …` selects another
named v2 slot. The command never refreshes the cache and never falls back to
schema embedded in config.

Skipped rules are returned with machine-readable `blocked:` reasons:

- Invalid SQL blocks all nine rules with `blocked: parse failed` and includes
  `parseError`.
- `--no-schema` blocks `implicit-cast` and the schema-dependent portion of
  `not-in-nullable` with `blocked: --no-schema`; static RHS hazards still run.
- A missing layered cache records
  `blocked: schema cache unavailable (run dbcli schema)` for those unavailable
  schema checks while retaining static RHS findings.

Every finding includes its rule, severity, source span, message, and
`schemaVerified` state. Some findings also carry a confidence-labelled rewrite
draft and a shell-safe verification command. It uses
`dbcli explain --analyze` only when the statement is structurally proven read-only;
function-bearing and session-assignment statements are unproven, so lint
falls back to plain `dbcli explain`. These are suggestions only: `lint` neither
executes the verification command nor changes the query.

When schema identifiers collide after case folding, schema-aware findings and
rewrites are withheld. The SQL parser does not preserve reliable quote
provenance, so an exact-looking mixed-case AST identifier cannot disambiguate
that collision. CTE, derived, schema-qualified, and database-qualified
relations also never borrow facts from the unqualified cache.

For `not-in-nullable`, remove or filter right-hand NULL values. In a subquery,
filter the projected value with `IS NOT NULL`; `NOT EXISTS` may be a better
semantic form when appropriate. dbcli does not automatically rewrite this case
unless correlation, type classification, qualified-column resolution, and the
rewrite target are all unambiguous. A direct or `AND`-conjoined `IS NOT NULL`
filter on the exact projected expression suppresses the finding; aggregates
apply the same proof in `HAVING`. Filters under `OR` or ambiguous expression
matches do not. The rule recursively checks projection, JOIN `ON`, `WHERE`, and
`HAVING` expressions, using each nested SELECT/CTE/derived statement's own
scope. Qualified outer-join null extension remains detectable without a cache,
but a join's synthetic NULL row is not applied inside that join's own `ON`;
declared nullability and completed earlier joins still apply there.

Trimmed JSON example:

```json
[
  {
    "sql": "SELECT * FROM users",
    "dialect": "postgresql",
    "findings": [
      {
        "rule": "select-star",
        "severity": "warn",
        "message": "SELECT * fetches every column; list the columns you need.",
        "span": { "start": 0, "end": 8 },
        "schemaVerified": false
      }
    ],
    "skippedRules": [],
    "relatedCommands": [
      "dbcli guide missing-index-for \"SELECT * FROM users\"",
      "dbcli explain --analyze \"SELECT * FROM users\""
    ]
  }
]
```

### plan

Static SQL risk analyzer. Classifies a statement into the same permission tiers
used by `query` (`query-only` / `read-write` / `data-admin` / `admin`) and lists
the underlying signals (DML / DDL / multi-statement / unsafe constructs) without
ever connecting to the database.

```bash
dbcli plan "SELECT * FROM users"
dbcli plan "UPDATE users SET name='x'"           # human-readable text classification
dbcli plan "DROP TABLE users" --format json      # machine-readable risk report
```

**Options:** `--format <text|json>` (default `text`).
**Permission:** n/a (offline analyzer; no connection opened).

Use cases:
- Agents that want to decide whether to call `query` vs `insert` / `update` /
  `delete` before sending SQL.
- Pre-flight safety check before binding parameters into a saved snippet.
- Lint hook for code review pipelines that store SQL in source.

`plan` does not enforce blacklist or auto-`LIMIT`; those still apply when the
SQL is actually executed via `query` / `q`.

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
dbcli q @analytics/revenue --param days=30 --ui                       # open dashboard
dbcli q @analytics/revenue --param days=30 --format html > report.html
```

**Options:**
- `--format <table|json|csv|html>` — output format (default: `table`)
- `--ui` — open the rendered HTML dashboard in the system browser (implies `--format html`; writes to a temp file then invokes `open` / `xdg-open` / `start`)
- `--param <key=value>` — pass a parameter (repeatable)
- `--param-file <path>` — JSON object whose keys are param names
- `--no-limit` — skip the `SELECT * FROM (…) AS _dbcli_guard LIMIT 1000` wrap
- `--dry-run` — print the bound SQL + values without executing
- `--use <name>` — pick a v2 named connection
- `--recovery` — emit a `RecoveryEnvelope` on failure (see `recover`)
- `--verify` — run the snippet's verification assertions after execution (only if the snippet defines them)

**Permission:** query-only+

#### Snippet file format

Each `.sql` file is plain SQL with optional YAML frontmatter inside a leading `-- ---` block. Lines outside frontmatter form the SQL body.

Snippets are read-only by contract, at every permission level including `admin`.
A body must be a single statement opening with `SELECT` or `WITH` **and** free of
write or DDL keywords, so a data-modifying CTE (`WITH x AS (DELETE … RETURNING *)
SELECT * FROM x`) and `SELECT … INTO` are rejected at parse time rather than at
execution. A MongoDB body may not contain `$out` or `$merge`. The same rule
applies to `verify.query` in frontmatter, which `q --verify` executes verbatim.

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
-- intent: perf.slow-query   # optional; consumed by `queries suggest`
-- visual:                   # optional; consumed by `--ui` / `--format html`
--   title: Daily Active Users
--   kpis:
--     - { label: DAU, value_column: dau, format: number }
--   charts:
--     - { type: line, title: DAU trend, x: day, y: [dau] }
-- ---
SELECT COUNT(DISTINCT user_id) AS dau
FROM events
WHERE created_at > NOW() - (:days || ' days')::interval;
```

Param placeholders use `:name`. They are rewritten to `$1, $2, …` (Postgres) or `?, ?, …` (MySQL) at execution time and passed as bind values — string interpolation is never used.

The `visual:` block is documented in detail under [Interactive HTML dashboard](#interactive-html-dashboard) below. Unknown / malformed fields are silently dropped at parse time; the snippet still runs and the dashboard falls back to a sortable table.

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

##### MongoDB snippets

File extension: `.mongodb.sql`. Frontmatter must declare `engine: mongodb` and
`operation: find` or `operation: aggregate`. `target: <collection>` provides a default
collection that `dbcli q --collection <name>` can override. The body is JSON: an object
for `find` and an array for `aggregate`. Each `{{param}}` placeholder is JSON-encoded
at substitution time — strings are quoted and escaped, so an attacker-supplied string
cannot escape into operator position.

Find example (`active-users.mongodb.sql`):

    -- ---
    -- name: active-users
    -- engine: mongodb
    -- operation: find
    -- target: users
    -- description: Active users matching the given status
    -- params:
    --   status:
    --     type: string
    --     required: true
    -- ---
    {
      "status": {{status}}
    }

Aggregate example (`top-orders-by-city.mongodb.sql`):

    -- ---
    -- name: top-orders-by-city
    -- engine: mongodb
    -- operation: aggregate
    -- target: orders
    -- description: Top order counts per city for a given status
    -- params:
    --   status:
    --     type: string
    --     required: true
    --   limit:
    --     type: int
    --     default: 10
    -- ---
    [
      { "$match": { "status": {{status}} } },
      { "$group": { "_id": "$city", "n": { "$sum": 1 } } },
      { "$sort": { "n": -1 } },
      { "$limit": {{limit}} }
    ]

Run with `dbcli q @active-users -p status=active` or `dbcli q @top-orders-by-city -p status=open -p limit=5`. The `q` command applies the same nested-blacklist redaction to results that `query` and `export` do.

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
dbcli queries search slow query         # fuzzy-ranked keyword search across snippets
dbcli queries search cache --engine postgres --source builtin --limit 5
dbcli queries suggest perf              # browse snippets by intent prefix (v1.11+)
dbcli queries suggest perf.cache-hit --format json

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

**`list` options:** `--format <table|json|csv>`, `--tag <tag>`, `--engine <postgres|mysql|redis|elasticsearch|all>`, `--source <local|shared|builtin|all>`
**`show` options:** `--format <table|json|csv>`
**`search` options:** `--format <table|json>`, `--engine <postgres|mysql|redis|elasticsearch|all>`, `--source <local|shared|builtin|all>`, `--limit <n>` (default 10), `--include-internal` (show fuzzy ranking score). Keyword(s) are fuzzy-matched against name, description, tags, intent.
**`suggest` options:** `--format <table|json>`, `--engine <postgres|mysql|redis|elasticsearch|all>`, `--source <local|shared|builtin|all>`. Intent prefix-matched against the snippet's `intent` frontmatter field. Common intents: `perf.slow-query`, `perf.cache-hit`, `capacity.size`, `safety.connections`, `monitor.cluster-health`.
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
dbcli insert users --data '{"name":"Alice"}' --plan --format json   # risk analysis only; no DB connection
```

**Options:** `--data <json>`, `--dry-run`, `--force`, `--plan` (analyze risk without connecting or executing), `--format <text|json>` (`--plan` output), `--recovery`
**Permission:** read-write+

### update

Update existing data.

```bash
dbcli update users --where "id=1" --set '{"name":"Bob"}'
dbcli update users --where "id=1" --set '{"name":"Bob"}' --dry-run
dbcli update users --where "id=1" --set '{"name":"Bob"}' --plan --format json   # risk analysis only; no DB connection
```

**Options:** `--where <condition>` (required), `--set <json>` (required), `--dry-run`, `--force`, `--plan` (analyze risk without connecting or executing), `--format <text|json>` (`--plan` output), `--recovery`
**Permission:** read-write+

> **`--where` grammar (SQL `update` / `delete`)** — equality only: `col=val` or
> `col1=v1 AND col2=v2`. Comparison / pattern operators (`>`, `>=`, `<`, `!=`, `LIKE`, `IN`)
> raise a parse error, and `OR` is **silently folded into the value** (`a=1 OR b=2` parses as
> `a = "1 OR b=2"`, matching nothing intended). For ranges or compound predicates, select the
> target primary keys first, then issue one `update` / `delete --where "id=<pk>"` per key.
> (MongoDB `--where` accepts a full JSON filter and is exempt.)

### delete

Delete data from a table.

```bash
dbcli delete users --where "id=1"
dbcli delete users --where "id=1" --dry-run
dbcli delete users --where "id=1" --force
dbcli delete users --where "id=1" --plan --format json   # risk analysis only; no DB connection
```

**Options:** `--where <condition>` (required), `--dry-run`, `--force`, `--plan` (analyze risk without connecting or executing), `--format <text|json>` (`--plan` output), `--recovery`
**Permission:** data-admin+

### export

Export query results to file or stdout.

```bash
dbcli export "SELECT * FROM users" --format csv --output users.csv
dbcli export "SELECT * FROM users" --format csv --output users.csv --force  # Skip overwrite confirmation
dbcli export "SELECT * FROM users" --format json | jq '.[]'
dbcli export "SELECT * FROM users" --format jsonl --output users.ndjson
dbcli export "SELECT * FROM orders" --format html --output orders.html      # standalone dashboard

# Elasticsearch (v1.22)
dbcli export '{"query":{"match":{"status":"active"}}}' --index orders --format jsonl --output orders.ndjson
dbcli export orders --format csv --output orders.csv      # index name as query → match_all + scroll
dbcli export orders --no-limit --format jsonl             # scroll the whole index in batches
```

**Options:** `--format <json|jsonl|csv|html>` (required), `--output <path>`, `--force`, `--recovery`, `--collection <name>` (MongoDB collection) / `--index <name>` (Elasticsearch index; alias for `--collection`), `--limit <number>` (overrides auto-limit), `--no-limit` (Elasticsearch full-index scroll)
**Permission:** query-only+ — SQL, MongoDB, and **(v1.22)** Elasticsearch.

If the query-only auto-limit would omit rows, export fails closed with exit code `1` and
writes no partial file. Re-run with `--no-limit` to export everything, or `--limit N` to
accept a bounded export explicitly. This applies to SQL, MongoDB, and Elasticsearch.

The `html` format emits the same self-contained dashboard as `query --ui` (see [Interactive HTML dashboard](#interactive-html-dashboard)). Because `export` runs raw SQL (no snippet metadata), the HTML report is always rendered as a sortable / filterable table — no KPIs or charts. Use `dbcli q @<name> --format html` (or `--ui`) for the charted view.

> **Elasticsearch export (v1.22):** pass a search DSL with `--index <index>` to export the hits, or pass an index name as the query to scroll the whole index via `match_all`. Default cap is 1000 rows; reaching it fails closed unless the caller explicitly uses `--limit N`, while `--no-limit` streams the full index via scroll in batches. Index-level blacklist is checked before export and an audit record is written.

### blacklist

Manage sensitive data blacklist to prevent AI access to restricted tables/columns.

```bash
dbcli blacklist list                        # Show current blacklist
dbcli blacklist list --format json          # Stable machine-readable result
dbcli blacklist table add payments          # Block entire table
dbcli blacklist table remove payments       # Unblock table
dbcli blacklist column add users.password   # Block specific column
dbcli blacklist column remove users.password
```

**Subcommands:** `list`, `table add <name>`, `table remove <name>`, `column add <table.column>`, `column remove <table.column>`

**`list` options:** `--config <path>`, `--format <text|json>` (default: `text`). JSON writes one
document to stdout: `{ "tables": string[], "columns": Record<string, string[]>, "warnings":
[{ "collection", "raw", "reason" }] }`. Invalid MongoDB blacklist patterns appear in `warnings`;
the JSON result is otherwise free of human headings and diagnostics.

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

#### `diff --against-orm`

Compare an ORM definition with the local SQL schema cache. This mode reads
`config.schema`; it does not open a database connection, refresh the cache, or
execute a proposal. An empty cache fails with
`Schema cache is empty. Run 'dbcli schema' first.` Snapshot mode remains a
separate `--snapshot` / `--against` workflow.

```bash
# Prisma and normalized JSON accept exactly one file
dbcli diff --against-orm prisma/schema.prisma --format json
dbcli diff --against-orm schema.normalized.json --orm-format json --format table

# Drizzle requires a PostgreSQL drizzle-kit v7 snapshot (generate it first)
drizzle-kit generate
dbcli diff --against-orm drizzle/meta/0001_snapshot.json --orm-format drizzle --format table

# DDL accepts repeatable or comma-separated paths and real filesystem globs
dbcli diff --against-orm "migrations/*.sql" --format markdown
dbcli diff --against-orm migrations/base.sql,migrations/accounts.sql \
  --against-orm migrations/orders.sql --orm-format ddl --format json

# Ignore patterns are comma-separated and match qualified table identity
dbcli diff --against-orm prisma/schema.prisma --ignore 'public.audit_*,public.Legacy'
```

##### TypeORM

TypeORM entities are not parsed directly. `schema:log` prints the SQL that
`schema:sync` would execute without applying it; `-d` is the required data-source
path. Generate that DDL, then select the `typeorm` alias so the report is tagged
`ormSource: typeorm`:

```bash
bunx typeorm schema:log -d <path/to/datasource> > schema.sql
dbcli diff --against-orm schema.sql --orm-format typeorm --format table
```

With `--orm-format typeorm`, `typeorm_metadata` and `migrations` are
default-ignored and appear as `unmanaged` rather than scored drift. Passing a
TypeORM `.ts`, `.js`, `.mjs`, or `.cjs` source file is rejected with the
`schema:log` command to run. See the
[TypeORM CLI documentation](https://typeorm.io/docs/using-cli) and
[`SchemaLogCommand`](https://github.com/typeorm/typeorm/blob/master/src/commands/SchemaLogCommand.ts).

##### Sequelize

Sequelize CLI does not provide a universal `db:migrate --dry-run`. Point the
project's existing Sequelize configuration at an empty scratch database, apply
the migrations there, and dump definitions without row data:

```bash
# Configure Sequelize for an empty scratch database first
bunx sequelize-cli db:migrate

# PostgreSQL scratch database
pg_dump --schema-only <scratch-database> > schema.sql

# MySQL scratch database
mysqldump --no-data <database> > schema.sql

dbcli diff --against-orm schema.sql --orm-format sequelize --format json
```

With `--orm-format sequelize`, `SequelizeMeta` is default-ignored and appears as
`unmanaged` rather than scored drift. Passing a Sequelize `.ts`, `.js`, `.mjs`,
or `.cjs` model file is rejected with the scratch-database and schema-only dump
recipe. See the
[Sequelize CLI migration command](https://github.com/sequelize/cli/blob/main/src/commands/migrate.js),
[PostgreSQL `pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html),
and [MySQL `mysqldump`](https://dev.mysql.com/doc/refman/8.4/en/mysqldump-definition-data-dumps.html)
references.

| Option | Behavior |
| :--- | :--- |
| `--against-orm <paths>` | Repeatable or comma-separated input. DDL-family inputs (raw DDL, TypeORM, and Sequelize) support real filesystem globs; matches are deduplicated and put in deterministic path order, then parsed as one shared ordered context so an index in a later file can attach to a table declared in an earlier file. Prisma, normalized JSON, and Drizzle accept exactly one file, and globs are rejected for those formats. |
| Drizzle input | Run `drizzle-kit generate`, then pass the PostgreSQL drizzle-kit v7 snapshot at `drizzle/meta/<NNNN>_snapshot.json`. TypeScript ORM schema sources (`.ts` or `.TS`) are rejected with that snapshot-generation hint; dbcli does not parse them directly. |
| TypeORM / Sequelize input | Generate DDL with the ORM/database tooling, then pass the SQL file with the matching `typeorm` or `sequelize` alias. Entity/model source files are rejected rather than parsed. |
| `--orm-format prisma\|ddl\|json\|drizzle\|typeorm\|sequelize` | Override extension/content detection. The `typeorm` and `sequelize` aliases use the DDL adapter while preserving the source tag and ORM-specific default ignores. Without an override, dbcli detects Prisma, raw DDL, normalized JSON, or a Drizzle snapshot from the path and content. |
| `--ignore <globs>` | Comma-separated, case-sensitive table globs. Patterns match the qualified display identity (for example `public.Users`). `_prisma_migrations` is always unmanaged; the TypeORM alias additionally ignores `typeorm_metadata` and `migrations`, and the Sequelize alias additionally ignores `SequelizeMeta`. |
| `--format json\|table\|markdown` | Select machine JSON, human table, or Markdown output. Markdown is available only in ORM drift mode. |
| `--recovery` | On an I/O, configuration, empty-cache, invalid-format, or unsupported-engine failure, emit and save a structured recovery envelope. Invalid Prisma/DDL constructs normally become `unparsed` entries instead of throwing. |

The command supports PostgreSQL, MySQL, and MariaDB configurations. Only
error-level **scored drift** determines the report's drift exit code: one or more
scored errors exits `1`; warnings, infos, `unmanaged`, or `unparsed` entries alone
exit `0`. Command/configuration failures independently exit code `1`. The four
drift categories and tolerance rules are:

| Category | Severity and comparison rule |
| :--- | :--- |
| `missing_in_db` | `error` — a table, column, or index exists in the ORM definition but not in the cached DB schema. |
| `missing_in_orm` | `warn` — a table, column, or index exists in the cached DB schema but not in the ORM definition. |
| `mismatch` | `error` when the type family or nullability differs; `info` for same-family type spelling, default, or primary-key differences. |
| `unmanaged` | `info`, excluded from error/warn scoring — the table matched the built-in or user `--ignore` patterns. |

Type-family tolerance deliberately treats engine spellings such as `text` and
`varchar(191)` as the same family: the spelling difference is still visible as
`info`, while an integer/text family difference is an `error`. Indexes compare
by structural index signatures — ordered, case-folded column names plus
uniqueness — rather than by engine-specific index names. Duplicate signatures
are emitted once. Drift entries sort deterministically by table, object, category,
and detail using Unicode code-point order, never locale-dependent collation.

**Schema and table identity.** Storage preserves exact, case-sensitive schema
and table names from the database catalog. Exact, case-sensitive `(schema, table)`
tuples are the comparison key, so PostgreSQL `users` and `"Users"` can coexist.
DDL resolution rules: unquoted SQL identifiers fold to lowercase; quoted identifiers match exactly.
For example, unquoted `Users` resolves to `users`, and quoted
`"Users"` resolves only to `Users`. Quote state comes from the parsed identifier representation;
dbcli never infers it from display text, catalog spelling, or a
Prisma mapping. Qualified components resolve independently, and unqualified ORM
identities use the cached DB default schema when one is known. Qualified display
names and `--ignore` matching remain case-sensitive. Duplicate exact or
duplicate resolved table identities fail closed instead of overwriting one
another.

**Prisma subset.** The parser supports `model` blocks; scalar `String`, `Int`,
`BigInt`, `Float`, `Decimal`, `Boolean`, `DateTime`, `Json`, and `Bytes` fields;
`?`; relation-side `[]`; `@id`, `@unique`, `@default(...)`, `@map("...")`,
`@@map("...")`, `@@index([...])`, `@@unique([...])`; relations with
`fields` / `references`; and the validated native mappings `@db.Text`,
`@db.VarChar(n)`, `@db.Uuid`, `@db.Timestamptz([precision])`, `@db.Date`,
`@db.SmallInt`, and `@db.JsonB`. Views, composite types, enums used as scalar
columns, multi-schema datasource configuration, malformed declarations, unknown
attributes, and unsupported native mappings are never guessed.

Prisma, DDL, and Drizzle constructs outside the supported subset are retained in
`unparsed` with a `blocked:` reason. These entries are separate from scored drift:
inspect and resolve them before treating an otherwise clean summary as complete.
Drizzle enums and other unsupported snapshot constructs therefore appear as blocked
`unparsed` entries rather than managed tables or columns.
Multi-file DDL is consumed as one deterministic shared ordered statement context,
so later `CREATE INDEX` statements can reference tables declared in earlier
files. PostgreSQL `PARTITION BY` and MySQL/MariaDB table engine, charset, and
other `CREATE TABLE` table options are unsupported: the construct produces a
`blocked:` `unparsed` entry and does not emit a managed ORM table.
The normalized JSON escape hatch is Zod-validated and uses an array of tables
with explicit exact `identity` objects; optional parsed identifiers must include
their `quoted` flags, and every normalized JSON `unparsed.reason` must start with
`blocked:`.

```json
{
  "ormSource": "prisma",
  "entries": [
    {
      "category": "missing_in_db",
      "severity": "error",
      "table": "public.users",
      "object": "email",
      "detail": "column 'email' (text) is defined in prisma but absent in the database",
      "proposedCommands": [
        "# escalate: schema-qualified table 'public.users' is not losslessly representable by dbcli migrate — run: dbcli skill tasks plan migration-review"
      ]
    }
  ],
  "unparsed": [],
  "summary": { "errors": 1, "warns": 0, "infos": 0, "unmanaged": 0 }
}
```

Missing unqualified columns and indexes may receive shell-safe, dry-run-by-default
`dbcli migrate add-column` or `add-index` proposal strings. Simple arguments stay
unquoted; unsafe shell characters are POSIX single-quoted. Table creation,
removal, mismatch, and DB-only drift escalate to `migration-review`. A
schema-qualified target, or index columns that the current `migrate --columns`
CLI cannot represent losslessly, also escalates instead of emitting a corrupt
command. Any table, column, or type positional beginning with `-` also escalates
so Commander cannot reinterpret it as an option. A leading-dash option value is
rendered with option-safe attached syntax, for example `--default=-1` or
`--columns=--config,email`. Proposals are text only and never add `--execute`.

For a guided, cache-refreshing review, use the built-in `orm-drift-review` pack:

```bash
dbcli skill tasks plan orm-drift-review \
  --param orm_path=prisma/schema.prisma \
  --format json
```

The plan is `blacklist list` → `schema --format json` →
`diff --against-orm ... --format json`. Run any proposed `migrate` command in its
default dry-run mode, capture the emitted DDL, confirm its exact target, and pass
both values to the separate migration review:

```sh
dbcli skill tasks plan migration-review \
  --param "table=${exact_table}" \
  --param "ddl=${captured_ddl}"
```

Both parameters are required. Keep each expansion as one quoted shell argument;
never use `eval`, and consider `--execute` only after the plan and captured DDL
have been reviewed.

### snapshot

Capture a **result fingerprint** of a query (not schema): `rowCount` plus per-column
aggregates (null/distinct counts, min/max/sum, an order-independent checksum) and a
top-level `resultChecksum`. Blacklisted columns are masked at the source by QueryExecutor,
so the fingerprint is safe to store and share. Use it as a baseline for `assert --against`.

```bash
dbcli snapshot "SELECT * FROM orders WHERE created_at >= '2026-05-01'"   # → .dbcli/snapshots/snap-<timestamp>.json
dbcli snapshot @analytics/daily-revenue --out base.json                  # saved query → explicit path
dbcli snapshot "SELECT status, count(*) FROM orders GROUP BY status" --stdout
dbcli snapshot "SELECT * FROM orders" --rows --out full.json             # also store masked rows
```

**Options:** `--out <path>` (default `.dbcli/snapshots/snap-<timestamp>.json`), `--rows`, `--stdout`, `--format <json|table>`, `--no-limit`
**Engines:** SQL only (PostgreSQL / MySQL / MariaDB)
**Permission:** query-only+

### assert

Assert an **invariant** on a query result. Exits `1` on failure (so it composes in
scripts / CI) unless `--no-fail` is given. Three modes (combinable):

- `--expect <condition>` — inline check against the result:
  - `rows > 0` / `rows == 1` … (row count vs operators `> >= < <= == !=`)
  - `value == 5000` / `value == "done"` (single-cell result; project to one column)
  - `col:email not null` · `col:id unique` · `col:amount between 0 and 100` · `col:age >= 18`
- `--vs <query> --compare rows|value` — reconcile against a second query (cross-check totals/counts).
- `--against <snapshot> --tolerance <pct>` — compare the current result fingerprint to a saved snapshot. `tolerance 0` requires an exact (order-independent) checksum match; `tolerance 0.01` allows ±1% drift on rowCount and each numeric column sum.

```bash
dbcli assert "SELECT count(*) FROM orders" --expect "value > 0"
dbcli assert "SELECT * FROM orders WHERE total < 0" --expect "rows == 0"     # no negative totals
dbcli assert "SELECT email FROM users" --expect "col:email not null"
dbcli assert "SELECT sum(amount) FROM ledger_a" --vs "SELECT sum(amount) FROM ledger_b" --compare value
dbcli assert "SELECT * FROM orders" --against base.json --tolerance 0.01
dbcli assert "SELECT count(*) FROM orders" --expect "value > 100" --no-fail   # report only, exit 0
```

**Options:** `--expect <condition>`, `--vs <query>`, `--compare <rows|value>` (default `value`), `--against <path>`, `--tolerance <pct>` (default `0`), `--no-fail`, `--format <json|table>`
**Output:** `AssertVerdict` = `{ pass, checks: [{ name, expected, actual, pass }] }`
**Engines:** SQL only (PostgreSQL / MySQL / MariaDB)
**Permission:** query-only+

#### Verification artifact (--write-verification-artifact)

Opt-in flag trio that persists a **VerificationArtifact JSON** (schema v1) under `<cwd>/.dbcli/verification/` after the assertion runs. The artifact is always written to `<cwd>/.dbcli/verification/` (relative to the current working directory), regardless of where the `--config` file is located.

| Flag | Required | Description |
| :--- | :--- | :--- |
| `--write-verification-artifact` | opt-in | Trigger artifact write. No-op when no verdict has been produced. |
| `--verification-subject <kind:name>` | yes (when flag is set) | Subject identifier. Format: `<kind>:<name>`. Allowed kinds: `recovery`, `task-pack`, `assertion`, `migration`, `backfill`, `manual`. |
| `--verification-summary <text>` | no | Free-text summary line stored in the artifact. Default when pass: "Assertion verified the expected state." Default when fail: "Assertion did not verify the expected state." |

**Output contract:**

- `--format json` — `AssertVerdict` gains `verificationArtifactPath: string` pointing to the written file.
- `--format table` — an extra `Verification artifact: <path>` line is printed after the verdict table.
- A `--no-fail` assertion that fails still records status `not_verified` and stores `exitCode: 1` in evidence.

**Planned vs Result evidence.** `dbcli skill tasks plan safe-backfill-verify --format json` returns a plan containing a `verification` block with `status: "planned"`. That block is the **planned** evidence definition — it describes which check will run. Running `assert --write-verification-artifact` on the actual data produces **result** evidence (`status: "verified"` or `status: "not_verified"`). The two records are distinct; `"planned"` does **not** indicate that verification has run or passed.

> **Casting note:** Postgres returns `count(*)` and `sum()` as bigint (a string in the result set). `value ==` uses strict equality, so `"0" == 0` is false. Cast to `::int` (`count(*)::int`) to ensure numeric comparison works correctly.

```bash
dbcli assert "SELECT count(*)::int FROM orders WHERE status IS NULL" \
  --expect "value == 0" \
  --write-verification-artifact \
  --verification-subject backfill:safe-backfill-verify

dbcli assert "SELECT count(*)::int FROM orders WHERE status IS NULL" \
  --expect "value == 0" \
  --write-verification-artifact \
  --verification-subject backfill:safe-backfill-verify \
  --verification-summary "Post-backfill null-status count is zero."

# --no-fail: exits 0 but still records not_verified on failure
dbcli assert "SELECT count(*)::int FROM orders WHERE status IS NULL" \
  --expect "value == 0" \
  --no-fail \
  --write-verification-artifact \
  --verification-subject backfill:safe-backfill-verify
```

### proxy

Local-development **observability proxy** for MySQL/MariaDB/PostgreSQL. Inserts dbcli
between an existing application and its real database: it listens on a configurable
port, relays TCP frames to the real server, and appends one JSONL event per query to
`.dbcli/proxy/events.jsonl`. Observe-only — no rewrite, blocking, or query modification.
Not intended as a production gateway.

**Subcommands:** `mysql` · `mariadb` · `postgresql`

```bash
dbcli proxy mysql       --listen 127.0.0.1:3307 --target 127.0.0.1:3306
dbcli proxy postgresql  --listen 127.0.0.1:5434 --target 127.0.0.1:5432
dbcli proxy mysql       --slow-ms 500 --redact literals   # redact SQL literals in events
dbcli proxy mariadb     --events ./logs/proxy.jsonl        # custom event file
dbcli --use prod proxy postgresql                         # infer target from named connection

dbcli proxy analyze                               # analyze .dbcli/proxy/events.jsonl (JSON)
dbcli proxy analyze --format text --top 10        # human-readable top-10 view
dbcli proxy analyze --format markdown             # QueryLens shareable, redacted Markdown report
dbcli proxy analyze --slow-ms 200 --n-plus-one 5  # custom thresholds
```

**Options:**
- `--listen <addr:port>` — Address dbcli will listen on (e.g. `127.0.0.1:3307`)
- `--target <addr:port>` — Address of the real database server to relay to. If omitted, inferred from the active (or `--use`) connection config.
- `--events <path>` — JSONL event log path (default: `.dbcli/proxy/events.jsonl`)
- `--slow-ms <ms>` — Threshold in milliseconds above which events are flagged `slow: true` (default: `1000`)
- `--redact <none|literals>` — Whether to strip SQL literal values from event records (default: `none`; `literals` removes quoted strings and numbers)
- `--format <text|json>` — Startup / status output format (default: `text`)
- `--use <name>` — Target a named v2 connection for `--target` inference

**Event schema (JSONL):** each line is one event. `type` is one of `proxy_started`, `session_started`, `query_observed`, `query_completed`, `query_errored`, `session_ended`, `parse_error`. A representative `query_completed` line:
```json
{ "version": 1, "type": "query_completed", "timestamp": "<ISO-8601>", "engine": "mysql", "sessionId": "pxy_1", "queryId": "qry_pxy_1_1", "client": "127.0.0.1:54321", "target": "127.0.0.1:3306", "sql": "SELECT * FROM users WHERE id = 1", "statement": "SELECT", "tables": ["users"], "durationMs": 42, "requestBytes": 128, "responseBytes": 512, "rowCount": null, "slow": false, "error": null, "tags": [] }
```
`slow` is `true` when `durationMs >= --slow-ms` (also printed as a terminal warning). `rowCount` is best-effort (PostgreSQL command tags; `null` for MySQL). TLS is relayed but not decrypted in v1. Prepared/extended wire protocols are best-effort tagged.

**Log rotation:** all writes are serialized through one in-process chain (concurrent sessions never interleave partial lines). The event log auto-rotates to keep one rolling segment — when the next line would reach ~50 MiB or 200,000 entries, the current file is renamed to `<events>.1` (overwriting any prior segment) and a fresh file starts. Worst-case on-disk footprint is ~2× the byte cap.

**`proxy analyze`** — offline aggregation of the event log (no DB). Flags: `--events <path>` (default `.dbcli/proxy/events.jsonl`), `--format json|text|markdown` (default `json`), `--top <n>` (default 20; text rows + suggestedCommands depth), `--slow-ms <ms>` (default 1000; recomputes slowCount), `--n-plus-one <n>` (default 10), `--no-include-rotated`. JSON report blocks: `summary`, `byFingerprint` (sorted by total time; SELECT entries in the top-N carry `suggestedCommands` for `explain` / `guide missing-index-for`), `slowest`, `errors`, `hotTables`, `repetition` (N+1 suspects). Reads the current log plus the rotated `.1` segment by default. `markdown` is the QueryLens report: it redacts SQL and error-message literals in an in-memory copy before analysis, while leaving the source log untouched.

Every actionable block carries machine-readable next steps so an agent can move from "what is wrong" to "what to run":
- `byFingerprint[]` — top-N SELECT entries get `suggestedCommands`: `dbcli explain "<sql>"` and `dbcli guide missing-index-for "<sql>"`.
- `errors[]` — carries `tables`; emits `suggestedCommands` of `dbcli schema <table>` (capped at the first 3 tables) plus a `hints` note to verify table/column names before fixing (never guess column names). No tables known (e.g. a syntax error) → no `suggestedCommands`, but the hint still appears.
- `repetition[]` — carries `statement` and a runnable `exampleSql` (the slowest occurrence). SELECT N+1 groups get `explain` / `guide missing-index-for` `suggestedCommands`; every group carries a `hints` note suggesting batching (JOIN / `IN (...)`) or caching.

`suggestedCommands` are emitted as strings only — `proxy analyze` never executes them. When the proxy ran with `--redact literals`, `exampleSql` (and therefore the suggested commands) contains `?` placeholders; fill in real values before running them.

**Acting on the report (agent loop):** after `proxy analyze`, for each block read `hints` for the diagnosis, run the entry's `suggestedCommands` to gather schema/plan/index evidence, then propose a concrete fix — add an index (`guide missing-index-for`), rewrite a slow SELECT (`explain`), batch an N+1 (`repetition`), or correct a column/table name (`errors` → `schema`). The text format mirrors this with aggregated `SUGGESTED COMMANDS` and `HINTS` sections; JSON keeps the suggestions attached per-finding.

**Engines:** MySQL / MariaDB / PostgreSQL
**Permission:** n/a (acts as a TCP relay; does not use dbcli's SQL permission model)

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
| `--require-schema-cache` | Throw `SCHEMA_CACHE_MISSING` (recovery code) when the active SQL connection has no usable schema cache |
| `--recovery` | On failure, emit a structured `RecoveryEnvelope` to stdout |

Example:

```bash
dbcli inspect --for-agent
```

Output schema is locked at `schemaVersion: 1`. Sections: `connection`, `permission`, `blacklist`, `objects`, `schemaCache`, `snippets`, `suggestedCommands`, `hints` **(v1.23)**, `warnings`.

**`suggestedCommands` (context-aware, v1.23)** — a three-tier weighted list:
1. *Bootstrap* — always-safe orientation commands (`blacklist list`, `schema <table>`, ...).
2. *Context-aware* — driven by recent activity. When a hot table is detected in the audit log **and** task packs are available, suggests `dbcli skill tasks plan analyze-table-perf --param table=<table>` plus `dbcli queries suggest <intent>` from your snippet intents.
3. *Discovery* — broader exploration commands.

**`hints` (v1.23)** — a parallel array of human-readable, non-executable notes: the most-queried table from recent audit, the number of available task packs, and the schema-cache size with its last-refresh timestamp. In markdown output they render as a `## Hints` section. Audit reads here are read-only and never throw. Both `suggestedCommands` and `hints` are trimmed under `--for-agent` / `--brief` (≤ 3 hints, single safest command).

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

#### guide missing-index-for (v1.23)

A single-query composite-index advisor. Parses one `SELECT`, combines a real
`EXPLAIN` plan with existing indexes, and emits index candidates each carrying a
`confidence` (`high` / `medium` / `low`) and a `reason`. Read-only (EXPLAIN +
index introspection only). MySQL/MariaDB + PostgreSQL.

```bash
dbcli guide missing-index-for "SELECT ... FROM betting_logs b JOIN hoster_machines hm ON ..."
dbcli guide missing-index-for @analytics/live-summary       # @saved-query
dbcli guide missing-index-for "..." --format json           # yaml (default) | json | markdown
dbcli guide missing-index-for "..." --min-confidence medium # drop candidates below low|medium|high
```

**Options:** `--format <yaml|json|markdown>` (default `yaml`), `--min-confidence <low|medium|high>`.

Behaviour:
- Detects existing-index collisions (a single-column index that can be extended into a composite).
- Functional/expression columns (e.g. `DATE(settled_at)`) and SQL it cannot parse are reported under `warnings`, never as recommendations.
- Single `SELECT` only — no INSERT/UPDATE/DELETE, stored procedures, or view bodies.
- Dialects beyond node-sql-parser support fall back to EXPLAIN-only heuristics.

**Permission:** query-only+

### recovery

Machine-readable error envelope. Two surfaces share one `RecoveryEnvelope`
shape (`schemaVersion: 1`):

1. **Standalone lookup**: `dbcli recovery --code <CODE>` synthesizes an
   envelope for any known recovery code without needing a real failure.
2. **Failing-command opt-in**: pass `--recovery` to `dbcli query` or
   `dbcli q`. On failure, the envelope is written to stdout as JSON, the
   human stderr message is suppressed, and the process exits non-zero.

Recovery codes (fixed in v1.15.0):
- `CONFIG_MISSING` — no `.dbcli` config; run `dbcli init`.
- `CONN_REFUSED` / `CONN_AUTH_FAILED` / `CONN_TIMEOUT` / `CONN_HOST_NOT_FOUND` / `CONN_UNKNOWN` — connection failure variants.
- `PERMISSION_DENIED` — active permission level forbids the operation.
- `BLACKLIST_TABLE` / `BLACKLIST_COLUMN_WRITE` — blacklist violations.
- `SNIPPET_NOT_FOUND` / `SNIPPET_AMBIGUOUS` / `SNIPPET_PARAM_MISSING` — saved-query failures.
- `SCHEMA_CACHE_MISSING` — local schema cache missing or stale.
- `UNKNOWN` — fallback for unclassified errors.

Flags (lookup mode):
- `--code <CODE>` — required unless `--list` is set.
- `--list` — list all codes and exit.
- `--format json|markdown` (default: json).
- `--brief` — drop `rationale` + `expects` from steps.
- `--for-agent` — shortcut for `--format json --brief`.
- `--hint <text>` — bind into placeholder steps.
- `--snippet <name>` — bind snippet placeholder.
- `--table <name>` — bind table placeholder.

Examples:

    dbcli recovery --code CONN_REFUSED
    dbcli recovery --code BLACKLIST_TABLE --table users --format markdown
    dbcli recovery --list --for-agent
    dbcli query "SELECT * FROM users" --recovery
    dbcli q @diag/missing --recovery

Boundaries:
- Recovery only **suggests** commands; agents (or humans) execute them. No automatic remediation in v1.15.0.
- As of v1.16.0, `--recovery` is honored on `query`, `q`, `insert`, `update`, `delete`, `export`, `schema`, and `inspect`. Other commands (`report`, `guide`, `doctor`, `migrate`, `init`, `use`, `status`, `list`, `check`, `diff`, `plan`, `shell`, `blacklist`, `completion`, `upgrade`, `skill`) keep their existing error behavior.
- `dbcli inspect --require-schema-cache` throws `SCHEMA_CACHE_MISSING` when the active SQL connection has no usable schema cache. Combine with `--recovery` for the structured envelope.
- `BLACKLIST_COLUMN_WRITE` and `PERMISSION_DENIED` envelopes prepend a `risk: 'dry-run'` step (e.g. `dbcli insert <table> --dry-run`) when the failing operation was an INSERT / UPDATE / DELETE.
- Recovery steps reuse the v1.14.0 `GuideStep` shape, including the full `risk` enum (`readonly` / `dry-run` / `write` / `unknown`).

**Permission:** n/a

### recover

(v1.17.0+) Inspect or apply the last recovery plan saved by `--recovery`.

| Flag | Purpose | Default |
|---|---|---|
| `--apply` | Execute the saved plan under risk gating. | off (inspect only) |
| `--from <path>` | Read the envelope from this file instead of `.dbcli/last-recovery.json`. Accepts raw `RecoveryEnvelope` or `SavedRecoveryEnvelope`. | — |
| `--allow-write <tier>` | Open the risk gate. Values: `readonly-cmd` (local-side writes) \| `write-cmd` (database writes). | `none` |
| `--no-verify` | Skip the verify step appended after a successful `--apply`. | off (verify runs by default) |
| `--write-verification-artifact` | After a successful `--apply`, persist a secret-free `VerificationArtifact` JSON under `.dbcli/verification/`. | off |
| `--format <format>` | `markdown` \| `json`. | `markdown` for inspect, `json` for `--apply` |

#### Plan source resolution

1. `--from <path>` if provided. The file must be either a raw `RecoveryEnvelope` or a `SavedRecoveryEnvelope` wrapper. When the file is a `SavedRecoveryEnvelope`, its `cwd` is reused for child-process execution. Strict zod validation; malformed → exit 2 with structured reason.
2. Otherwise, `.dbcli/last-recovery.json` (auto-saved on every recovery emission). Validated with the same schema; missing fields, unknown `error.code`, or `cwd` that no longer exists → exit 2.
3. Otherwise, exits 2 with `No recovery plan available. Run a command with --recovery to generate one, or pass --from <file>.`

#### Code-owned tier (trust boundary)

`--apply` derives the canonical execution tier from the per-`error.code` allowlist after parsing argv, **not** from the envelope's `risk` / `dbWrite` / `interactive` fields. Envelope hints can only widen safety (skip more steps); they cannot escalate execution.

| Allowlist tier | Meaning | Example commands |
|---|---|---|
| `readonly` | local read-only | `dbcli inspect`, `dbcli doctor`, `dbcli blacklist list`, `dbcli schema <table>` |
| `dry-run` | write subcommand invoked with `--dry-run` | `dbcli update orders --where id=1 --dry-run`, `dbcli q @x --dry-run` |
| `local-write` | writes local config / cache / blacklist | `dbcli blacklist remove <table>`, `dbcli use <name>`, `dbcli schema --refresh` |
| `db-write` | mutates the connected database | `dbcli update orders --where id=1 --set …` (no `--dry-run`), `dbcli q @x` (no `--dry-run`) |
| `interactive` | requires TTY | `dbcli init`, `dbcli init --force` |

`insert` / `update` / `delete` / `q` are tier `dry-run` only when argv contains `--dry-run`; otherwise they are tier `db-write` regardless of envelope `risk` claim.

#### Risk gate matrix

| Allowlist tier | Default | `--allow-write=readonly-cmd` | `--allow-write=write-cmd` |
|---|---|---|---|
| `readonly` | run | run | run |
| `dry-run` | run | run | run |
| `local-write` | `skipped:risk` | run | run |
| `db-write` | `skipped:risk` | `skipped:risk` | run |
| `interactive` | `skipped:interactive` | `skipped:interactive` | `skipped:interactive` |
| unresolved placeholder in `command` | `skipped:placeholder` | `skipped:placeholder` | `skipped:placeholder` |
| command fails parse / allowlist | `skipped:unsafe-command` | `skipped:unsafe-command` | `skipped:unsafe-command` |

Precedence: envelope `interactive: true` > `placeholder` > `unsafe-command` > allowlist `interactive` > tier-based gating.

#### Exit codes

| Code | Condition |
|---|---|
| 0 | At least one step ran successfully and no step failed. |
| 1 | A step exited non-zero (fail-fast); see `stoppedAt`. |
| 2 | Envelope missing or malformed (failed schema validation, or saved `cwd` missing). |
| 3 | Every step was skipped — open `--allow-write` or fill placeholders. |

#### Auto-saved envelope

Every command that emits a `RecoveryEnvelope` (`query`, `q`, `insert`, `update`, `delete`, `export`, `schema`, `inspect` — all with `--recovery`) atomically writes the envelope to `.dbcli/last-recovery.json`. The wrapper carries `schemaVersion`, `savedAt`, a sanitized `command` summary, the workspace `cwd`, and the envelope itself. SQL text and `--where` / `--set` / `--data` / `--param` values are redacted as `<sql>` or `<redacted>`. `.dbcli/` is gitignored.

#### Verification (P4)

Each `RecoveryEnvelope` now carries an optional `verify: GuideStep` (always
`risk: 'readonly'`, never carries placeholders). `dbcli recover --apply` runs
the verify step after the main plan, only when `finalStatus === 'ok'` and
`--no-verify` is not set.

| Recovery code | Verify command | Heuristic |
|---|---|---|
| CONFIG_MISSING | `dbcli inspect --no-connect --format json` | `connection.name` truthy → passed |
| CONN_REFUSED / CONN_TIMEOUT / CONN_UNKNOWN / CONN_AUTH_FAILED / CONN_HOST_NOT_FOUND | `dbcli doctor --format json` | exit 0 → passed |
| PERMISSION_DENIED | `dbcli inspect --for-agent` | exit 0 → passed |
| BLACKLIST_TABLE | `dbcli inspect --for-agent` | exit 0 → passed |
| BLACKLIST_COLUMN_WRITE | `dbcli inspect --for-agent` | exit 0 → passed |
| SNIPPET_NOT_FOUND / SNIPPET_AMBIGUOUS / SNIPPET_PARAM_MISSING | `dbcli queries list --format json` | exit 0 → passed |
| SCHEMA_CACHE_MISSING | `dbcli inspect --format json` | `schemaCache.available === true` → passed |
| UNKNOWN | `dbcli doctor --format json` | exit 0 → passed |

`verifyStatus` values:

- `passed` — heuristic confirmed.
- `failed` — verifier exited non-zero or timed out.
- `indeterminate` — verifier exited 0 but expected shape not present, or the
  step was gated (placeholder / unsafe-command); agents should re-check.

Exit codes are unchanged — `verifyStatus` is signal, not gate.

**Schema additions.** `RecoveryEnvelope.verify?: GuideStep` is additive (no
`schemaVersion` bump). v1.16 consumers ignore the field.

#### Multi-turn `--next` (P2)

`dbcli recover --next` returns the single next step in a saved recovery plan,
given which step the agent just executed and the result of that step. v1 walks
the plan linearly; future codes may branch on `prevResult.stdoutSummary`
deterministically.

| Flag | Required | Description |
|---|---|---|
| `--next` | yes | Activate the multi-turn lookup. |
| `--after-step <n>` | yes | 1-based order of the step the agent just executed. Range: `[1, envelope.recovery.length]` (or `[1, branches[id].steps.length]` when `--branch` is set). |
| `--result <value>` | yes | JSON `StepResultSummary` (inline) or `@<path>` to read from a file. |
| `--branch <id>` | no | Walk a specific branch by id (required on `--next` calls after a fork). See *Connection branching* below. |
| `--from <path>` | no | Override the auto-saved envelope. |
| `--format <fmt>` | no | `json` (default) or `markdown`. |

`--next` and `--apply` cannot be combined. `--allow-write` and `--no-verify`
are silently ignored under `--next` (no execution, no verification).

**`StepResultSummary` shape**

```ts
interface StepResultSummary {
  status: 'ok' | 'failed' | 'skipped'
  exitCode?: number
  stdoutSummary?: string  // last 4 KB; longer rejected
  stderrSummary?: string  // last 4 KB; longer rejected
}
```

`@<path>` resolves relative to the dbcli invocation cwd. File whole-size cap is
64 KB; per-field 4 KB cap still applies.

**`NextResult` shape (output)**

```ts
interface NextResult {
  schemaVersion: 1
  kind: 'step' | 'done'
  source: { kind: 'auto' | 'from'; path: string }
  errorCode: RecoveryCode
  cursor: number       // step.order when kind='step'; totalSteps when 'done'
  totalSteps: number
  step?: GuideStep     // present iff kind='step'
  branchId?: string         // set iff agent is currently traversing a branch
  branchDescription?: string // mirror of branches[branchId].description
}
```

**Connection branching**

For `CONN_*` recovery codes, the envelope ships an additional `branches` map and a `branchFork` descriptor. Step 1 (`dbcli doctor --format json`) is the fork point: pass the doctor JSON in `--result.stdoutSummary` and `--next` will pick one of four labeled branches:

| Branch id | When chosen |
|---|---|
| `doctor-clean` | Doctor reports no errors — likely transient; verify baseline state, then retry. |
| `doctor-config-missing` | Doctor flagged a config-level failure (missing / invalid config). Re-init before reconnecting. |
| `doctor-auth-error` | Doctor confirms credentials were rejected. Re-init with `--force` to overwrite credentials. |
| `doctor-network-error` | Doctor confirms a network-level failure (host / port / DNS / timeout). Inspect and re-init host/port. |

NextResult sets `branchId` and `branchDescription` after the fork; subsequent `--next` calls must echo `--branch <id>` to walk that branch. If the doctor JSON cannot be parsed or no keyword matches, `--next` falls back to the linear `recovery` plan — branching never causes `--next` to fail. `--apply` ignores `branches` entirely (linear walk unchanged).

**Exit codes**

| Exit | Condition |
|---|---|
| 0 | Returned a step or `done`. |
| 2 | Envelope missing/malformed; `--after-step` missing/out-of-range; `--result` missing/malformed; `--next` combined with `--apply`. |

**Examples**

```bash
# Walk a 3-step plan to completion
dbcli recover --next --after-step 1 --result '{"status":"ok"}'   # → step 2
dbcli recover --next --after-step 2 --result '{"status":"ok"}'   # → step 3
dbcli recover --next --after-step 3 --result '{"status":"ok"}'   # → done

# Result read from file (when stdout is large)
dbcli recover --next --after-step 1 --result @/tmp/r1.json

# Markdown for human inspection
dbcli recover --next --after-step 1 --result '{"status":"ok"}' --format markdown
```

**Permission:** n/a (always-allowed lookup; child processes inherit the active permission level).

### audit

(v1.20.0+) Inspect, query, and manage the per-connection audit log written to `.dbcli/audit/<connection>.jsonl`.

Audit entries are metadata-only by design — never raw SQL bodies, `--param` values, or result cell contents (D3 lock). Redaction is sourced from `tests/helpers/sensitive-output.ts` (same source as `inspect` / `guide` / `recover` agent contracts).

#### Subcommands

| Subcommand | Side-effect tier | Purpose |
|---|---|---|
| `audit tail` | `readonly` | List most recent entries on the current (or `--all`) connection. |
| `audit show` | `readonly` | Print a single full entry by id prefix or `--recovery-ref`. |
| `audit clear` | `local-write` | Delete `<conn>.jsonl` + rotated `.jsonl.1` from local disk. Requires `--yes` or interactive confirm. |
| `audit health` | `readonly` | Render `AuditLogger.getHealth()` snapshot (writer state, lock state, rotation usage). |

#### `audit tail`

| Flag | Purpose | Default |
|---|---|---|
| `--n <N>` | Number of recent entries to print (latest at bottom — D5). | `10` |
| `--all` | Merge entries across all connections; output is an envelope array `[{ connection, entry }, ...]` (D-39). | off (current connection only) |
| `--for-agent` | Shortcut for `--format json --brief`. Single-connection JSON is a flat array; `--all` JSON is an envelope array. | off |
| `--brief` | Drop large redaction fields from the entry; keep `ts / command / target / success` (D-33). | off |
| `--no-brief` | Disable brief mode when a higher-level default enables it. | off |
| `--format <fmt>` | `table` \| `json`. | `table` |

Reader behavior (D-41): tail merges `<conn>.jsonl.1` (rotated segment, if present) and `<conn>.jsonl`, sorts by `ts` ascending, then takes the last `--n` entries — so `--n 1000` can span a fresh rotation boundary.

Examples:

    dbcli audit tail --n 10
    dbcli audit tail --all --for-agent --n 20
    dbcli audit tail --format json --brief

#### `audit show`

| Flag | Purpose | Default |
|---|---|---|
| `<id-prefix>` | Positional. UUID or prefix ≥ 4 characters; ambiguous prefix exits 1 with disambiguation hint; prefix < 4 chars exits 1. | — |
| `--recovery-ref <id>` | Find the audit entry whose `recovery_ref` field matches this id (exact, not prefix). Mutually exclusive with positional `<id-prefix>` (D-38). | — |
| `--all` | Search across all connections. Output is an envelope `{ connection, entry }` (single-hit also envelope, for shape stability — D-36). | off |
| `--no-brief` | Disable brief mode when a higher-level default enables it. | off |
| `--format <fmt>` | `table` \| `json`. | `table` |

Examples:

    dbcli audit show 1a2b
    dbcli audit show --recovery-ref 8f0e-1234-... --format json
    dbcli audit show 1a2b --all

#### `audit clear`

| Flag | Purpose | Default |
|---|---|---|
| `--yes` | Skip interactive confirmation. Required in non-TTY contexts. | off (interactive confirm) |

Behavior (D-45 / D-46 / D-47): deletes `<conn>.jsonl` + rotated `<conn>.jsonl.1` for the current connection. Does NOT touch other connections (`--all` is not supported — destructive op cross-connection blast-radius is too high; use `dbcli use` to switch and clear each). Does NOT reset `.dbcli/last-session-id` (D-48). In non-TTY contexts without `--yes`, exits 1 with `Cannot prompt for confirmation in non-interactive session. Use --yes to clear without prompt.`

Examples:

    dbcli audit clear           # interactive (TTY only)
    dbcli audit clear --yes     # CI / scripted

#### `audit health`

| Flag | Purpose | Default |
|---|---|---|
| `--format <fmt>` | `table` \| `json`. | `table` |
| `--no-brief` | Disable brief mode when a higher-level default enables it. | off |

Output reports: writer enabled/disabled, last write result, file-lock state, rotation cap usage (`max_bytes` / `max_entries`). When `audit.enabled = false` (D1 opt-out), `tail` / `show` / `health` still exit 0 and print `Audit is disabled (audit.enabled = false in .dbcli). Use 'dbcli audit health' for details.` (E note).

#### Boundaries

- Entries are append-only JSONL; rotation triggers at `~10 MB` or `~1000` entries (whichever first). Previous segment is preserved as `.jsonl.1`.
- Bi-directional `recovery_ref` / `audit_ref` linkage is wired on every command that accepts `--recovery`: `query`, `inspect`, `insert`, `update`, `delete`, `export`, `q`, and `schema`. Use `audit tail --recovery-ref <id>` to find the audit entry an envelope was emitted alongside.
- Audit writer failures are non-fatal (D6): main command result and exit code are preserved; a stderr warning is emitted. `audit health` surfaces the failure reason.
- Reader truncation tolerance: a crash-truncated last line is skipped with a stderr warn `[dbcli audit] skipping truncated last line in <file>`; a mid-file non-JSON line is treated as corruption, exits 1, and points at `dbcli audit clear`.

#### Exit codes

| Code | Condition |
|---|---|
| 0 | Read/list/clear/health succeeded; also `audit.enabled = false` opt-out path (E note). |
| 1 | `audit show` — id prefix < 4 chars, ambiguous, or not found; `--recovery-ref` not found; `<id>` and `--recovery-ref` both supplied (D-35 / D-37 / D-38). |
| 1 | `audit clear` — non-TTY without `--yes` (D-46). |
| 1 | Reader corruption — mid-file non-JSON line in a `.jsonl` segment. |

**Permission:** n/a

### verify

Run a verification scenario. `verify` **runs** verification scenarios (safe-backfill,
migration, rollback) and never executes writes/DDL. `verification` **inspects and manages**
the local result artifacts those scenarios produce under `.dbcli/verification/`.

```bash
# Preflight (default): read-only guards + the exact after-write command. No artifact.
dbcli verify safe-backfill \
  --table users \
  --query "UPDATE users SET status = 1 WHERE status IS NULL" \
  --verify-query "SELECT count(*)::int AS n FROM users WHERE status IS NULL" \
  --expect "value == 0"

# After-write: re-run guards, run the read-back assertion, write a v1 artifact.
dbcli verify safe-backfill ... --after-write

# JSON for agents.
dbcli verify safe-backfill ... --format json
```

Options: `--table` (req), `--query` (req, analyzed not executed), `--verify-query`
(req, **plain SELECT only**), `--expect` (req), `--after-write`, `--format <table|json>`,
`--subject-name <name>`, `--summary <text>`.

Guard constraints (fail closed): `--verify-query` must be a **plain `SELECT`** —
`EXPLAIN`/`EXPLAIN ANALYZE`, `SHOW`, `DESCRIBE`, and data-modifying CTEs are rejected
(on PostgreSQL `EXPLAIN ANALYZE <write>` actually performs the write). The `--query`
**UPDATE target must equal `--table`**, compared schema-aware (`public.users` ≠
`audit.users`). The persisted artifact stores only a bounded, literal-free label of the
verify-query and `--expect` — string, numeric, and dollar-quoted literals are stripped,
so raw SQL/values are never written to disk. The printed after-write
command is shell-escaped and carries through `--subject-name`/`--summary`/non-default
`--format`. For repeated backfills on the same table, pass a unique `--subject-name` so
each operation is independently traceable (the subject defaults to `backfill:<table>`).

Status: `ready`/`blocked` in preflight (no artifact); `verified`, `not_verified`,
`blocked`, or `indeterminate` in after-write (artifact written). `blocked` = a guard
failed (blacklist/schema/plan/verify-query-not-plain-SELECT/target-table-mismatch);
`not_verified` = the read-back contradicted `--expect`; `indeterminate` = the assertion
could not produce a trustworthy verdict. Inspect the result with
`dbcli verification show <artifact-id>`.

#### `verify migration`

Preflight or after-write verification for a schema migration. **This command never
executes DDL** — it analyzes the proposed `ALTER TABLE`, runs read-only guards, and
(in after-write mode) records evidence after you apply the migration externally.

```bash
# Preflight: read-only guards + the exact after-write command. Returns ready or blocked.
dbcli verify migration \
  --table users \
  --ddl "ALTER TABLE users ADD COLUMN verified_at TIMESTAMPTZ" \
  --verify-query "SELECT count(*)::int AS n FROM users WHERE verified_at IS NOT NULL" \
  --expect "value == 0"

# After the migration is applied externally, record evidence:
dbcli verify migration ... --after-write

# JSON for agents.
dbcli verify migration ... --format json
```

| Option | Required | Description |
| --- | --- | --- |
| `--table <table>` | yes | Table affected by the migration. |
| `--ddl <sql>` | yes | Proposed migration DDL, analyzed but never executed. MVP accepts `ALTER TABLE` only. |
| `--verify-query <sql>` | yes | Plain `SELECT` for post-migration read-back verification. |
| `--expect <expr>` | yes | Assertion expression for the read-back result. |
| `--after-write` | no | Run the post-migration assertion and write a v1 artifact. |
| `--format <table\|json>` | no | Output format, default `table`. |
| `--subject-name <name>` | no | Artifact subject name. Default is the table name. |
| `--summary <text>` | no | Optional artifact summary override. |

Preflight returns `ready` or `blocked` and prints the exact after-write command;
**`ready` is not `verified`** — it only means the guards passed. After-write maps the
read-back assertion to `verified` / `not_verified` / `indeterminate`, and a failed
guard to `blocked`. `CREATE TABLE`, `DROP TABLE`, `CREATE INDEX`, and multi-statement
DDL are blocked in the MVP.

The `ALTER TABLE` target may be `table`, `schema.table`, or `catalog.schema.table`.
Each segment is a simple unquoted name (`[A-Za-z_][A-Za-z0-9_]*`) or a quoted
identifier — double-quoted (`"…"`), backtick-quoted (`` `…` ``), or bracket-quoted
(`[…]`) — so `"user accounts"` or `"tenant-1"."orders"` are accepted. Targets that
cannot be fully parsed under this contract (unterminated quotes, unsupported escapes,
or more than three parts) are blocked before the after-write assertion with a
"could not be parsed" reason, distinct from the `must match --table` mismatch reason.

#### `verify rollback`

(v1.37.0+) Preflight or after-write verification for an **externally-applied rollback** —
confirming that after you reverted a change the database is back to the expected prior
state. **This command never executes the reverting statement** — it analyzes it, runs
read-only guards, and (in after-write mode) records evidence after you apply the rollback
externally. One scenario covers both schema and data rollbacks via a required
`--kind <ddl|dml>` selector:

- `--kind ddl` — revert a schema migration. `--statement` is a single `ALTER TABLE`
  (e.g. dropping a column a forward migration added). Reuses the `migration` DDL gates.
- `--kind dml` — revert a data change. `--statement` is a single `UPDATE` that restores
  prior values. Reuses the `safe-backfill` UPDATE plan gates.

```bash
# Schema rollback (--kind ddl) — preflight, then record evidence after applying it.
dbcli verify rollback \
  --kind ddl \
  --table users \
  --statement "ALTER TABLE users DROP COLUMN verified_at" \
  --verify-query "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'verified_at'" \
  --expect "value == 0"
dbcli verify rollback --kind ddl ... --after-write

# Data rollback (--kind dml) — revert an UPDATE, then read back.
dbcli verify rollback \
  --kind dml \
  --table users \
  --statement "UPDATE users SET status = NULL WHERE status = 1" \
  --verify-query "SELECT count(*)::int AS n FROM users WHERE status = 1" \
  --expect "value == 0"
dbcli verify rollback --kind dml ... --after-write

# JSON for agents (both kinds).
dbcli verify rollback --kind ddl ... --format json
```

| Option | Required | Description |
| --- | --- | --- |
| `--kind <ddl\|dml>` | yes | Reverting-statement grammar: `ddl` (single `ALTER TABLE`) or `dml` (single `UPDATE`). Invalid value fails closed before any DB connection. |
| `--table <table>` | yes | Table affected by the rollback. |
| `--statement <sql>` | yes | Proposed reverting statement, analyzed but never executed. |
| `--verify-query <sql>` | yes | Plain `SELECT` for post-rollback read-back verification. |
| `--expect <expr>` | yes | Assertion expression for the read-back result. |
| `--after-write` | no | Run the post-rollback assertion and write a v1 artifact. |
| `--format <table\|json>` | no | Output format, default `table`. |
| `--subject-name <name>` | no | Artifact subject name. Default is the table name. |
| `--summary <text>` | no | Optional artifact summary override. |

A single `--statement` flag is used for both kinds (instead of reusing `--ddl` / `--query`)
to keep the dual-kind surface honest. The guard sequence, statuses (`ready`/`blocked` in
preflight; `verified` / `not_verified` / `blocked` / `indeterminate` in after-write), and
exit codes are identical to the other two scenarios. **MVP restrictions:** DML rollback is
`UPDATE`-only (INSERT/DELETE reverts deferred); DDL rollback is single `ALTER TABLE` only,
using the same identifier contract as `verify migration`.

The artifact schema is unchanged: a rollback reuses the existing subject kinds —
`--kind ddl` → `migration`, `--kind dml` → `backfill` — and records its provenance via
`subject.command = "verify rollback"` plus the summary, so `verification` filters and
retention are unaffected.

#### `verify constraint`

(v1.38.0+) Preflight or after-write verification that a **data-integrity invariant holds**
across your change — foreign-key consistency, NOT NULL coverage, uniqueness, or a custom
violation query. **This command never executes a write** — it only runs read-only
`COUNT(*)` violation queries against the live table and (in after-write mode) records
evidence. Four check kinds, selected by `--check`:

- `--check fk` — counts orphaned rows in the child table. Requires `--column` (the child
  FK column) and `--references <table.column>` (the referenced parent column).
- `--check not-null` — counts rows where the column value is NULL. `--column` is
  repeatable; each column is checked independently.
- `--check unique` — counts duplicate values in one or more columns. `--column` is
  repeatable; all listed columns are combined into a single uniqueness check.
- `--check custom` — executes the caller-supplied `--violation-query <sql>`, which must
  be a plain read-only `SELECT` returning a single integer count of violations.

```bash
# FK preflight — verify no orphaned orders before a migration.
dbcli verify constraint \
  --table orders \
  --check fk \
  --column customer_id \
  --references customers.id

# NOT NULL preflight — verify the column is fully populated.
dbcli verify constraint \
  --table users \
  --check not-null \
  --column email

# After the write is applied externally — record evidence.
dbcli verify constraint --table orders --check fk --column customer_id \
  --references customers.id --after-write

# JSON output for agents.
dbcli verify constraint --table users --check not-null --column email --format json
```

| Option | Required | Description |
| --- | --- | --- |
| `--table <table>` | yes | Table the invariant is checked on. |
| `--check <kind>` | yes | Constraint kind: `fk` \| `not-null` \| `unique` \| `custom`. |
| `--column <name>` | yes (fk/not-null/unique) | Column to check. Repeatable for `not-null`/`unique`; the child FK column for `fk`. |
| `--references <table.column>` | yes (fk only) | Referenced `<table>.<column>` for the FK parent lookup. |
| `--violation-query <sql>` | yes (custom only) | Read-only `SELECT` returning a single integer count of violations. |
| `--allow-preexisting` | no | Tolerate pre-existing violations: verified when `count ≤ --baseline` (default: `false`). |
| `--baseline <n>` | no | Baseline violation count measured at preflight (use with `--allow-preexisting`). |
| `--after-write` | no | Re-run the violation count and write a v1 verification artifact. |
| `--format <table\|json>` | no | Output format, default `table`. |
| `--subject-name <name>` | no | Artifact subject name. Default is the table name. |
| `--summary <text>` | no | Optional artifact summary override (after-write mode). |

**Verdict rules.** Preflight returns `ready` or `blocked`; **`ready` is not `verified`**.
After-write maps the violation count to `verified` (violations ≤ threshold) or
`not_verified` (violations > threshold), and a failed guard to `blocked`; a query error
yields `indeterminate`. The default threshold is `0` (strict: zero violations allowed).
With `--allow-preexisting`, the threshold is the `--baseline` count captured at preflight,
so the no-regression rule passes as long as the after-write count does not exceed the
preflight count.

**MVP restrictions.** SQL engines only (PostgreSQL / MySQL / MariaDB — requires an active
`--config` connection). FK checks support a single child column; composite FK constraints
are not yet supported. The command never executes any write or DDL statement.

The artifact uses `subject.kind = 'table'` and `subject.command = 'verify constraint'`,
so `verification` filters and retention are unaffected by the new scenario.

### verification

(v1.33.0+) Local **VerificationArtifact** inspection and lifecycle surface over
`<cwd>/.dbcli/verification/` (always relative to the current working directory,
regardless of `--config` location). `list`, `show`, and `summary` are read-only;
`prune` is a local lifecycle command — dry-run by default, deleting only with
`--execute --force`. Requires no database connection and performs no audit writes.

**Subcommands:** `list` · `show` · `summary` · `prune`

#### `verification list`

List verification artifacts on disk, with optional filters.

```bash
dbcli verification list --format json
dbcli verification list --status verified
dbcli verification list --subject backfill
dbcli verification list --subject backfill:safe-backfill-verify
dbcli verification list --limit 20 --format json
dbcli verification list --include-invalid --format json
```

| Flag | Purpose | Default |
|---|---|---|
| `--format <json\|table>` | Output format. | `json` |
| `--limit <n>` | Maximum number of entries to return. | `20` |
| `--status <status>` | Filter by status. One of: `verified`, `not_verified`, `indeterminate`, `blocked`. | all |
| `--subject <kind[:name]>` | Filter by subject kind or exact `kind:name`. Allowed kinds: `recovery`, `task-pack`, `assertion`, `migration`, `backfill`, `manual`. | all |
| `--include-invalid` | Surface malformed artifact files (normally skipped silently). Invalid files are returned as a separate top-level `invalid` array in JSON output, each entry shaped `{ "path": "...", "filename": "...", "error": "..." }`. When off, `invalid` is `[]`. | off |

**Missing directory:** if `.dbcli/verification/` does not exist, exits `0` with an
empty result (list: `[]`, summary: zero counts).

**Malformed files:** by default, files that cannot be parsed as valid VerificationArtifact
JSON are silently skipped. Pass `--include-invalid` to surface them.

#### `verification show`

Print a single verification artifact by its id (the artifact's `id` field) or by
the path to the artifact file.

```bash
dbcli verification show abc123 --format json
dbcli verification show abc123 --format table
dbcli verification show .dbcli/verification/abc123.json --format json
```

| Flag | Purpose | Default |
|---|---|---|
| `<id-or-path>` | Positional. The artifact `id` (format `ver_<base36>_<hex>`), a unique id prefix, the artifact filename, or a path to the file inside `.dbcli/verification/`. | required |
| `--format <json\|table>` | Output format. | `json` |

**Exit codes:**
- `0` — artifact found and valid.
- `1` — id or path not found, or the artifact file is malformed (parse error).

#### `verification summary`

Aggregate verification artifacts into status counts, optionally filtered.

```bash
dbcli verification summary --format json
dbcli verification summary --status not_verified --format json
dbcli verification summary --subject migration --format json
dbcli verification summary --subject migration:add-status-column --format json
```

| Flag | Purpose | Default |
|---|---|---|
| `--format <json\|table>` | Output format. | `json` |
| `--status <status>` | Filter to a single status before summarising. | all |
| `--subject <kind[:name]>` | Filter by subject kind or exact `kind:name`. | all |
| `--latest-only` | Narrow to the latest matching valid artifact plus status counts; the `subjects` breakdown is omitted. Missing artifacts return exit `0` with `latest: null`. | off |

**Output shape (JSON):**
```json
{
  "storageDir": "/abs/path/.dbcli/verification",
  "latest": {
    "path": "...",
    "id": "ver_...",
    "createdAt": "2026-06-19T01:02:03.000Z",
    "status": "verified",
    "subject": { "kind": "backfill", "name": "safe-backfill-verify" },
    "summary": "..."
  },
  "counts": { "total": 4, "verified": 2, "not_verified": 1, "indeterminate": 0, "blocked": 1, "invalid": 0 },
  "subjects": [
    { "subject": { "kind": "backfill", "name": "safe-backfill-verify" }, "total": 3, "latestStatus": "verified", "latestCreatedAt": "2026-06-19T01:02:03.000Z" }
  ]
}
```

`latest` is `null` when no valid artifacts match the filters.

#### `verification prune`

Preview or delete local verification artifacts under `<cwd>/.dbcli/verification/` by
explicit retention criteria. **Dry-run by default**; deletes only with `--execute --force`.

```bash
dbcli verification prune --older-than 30d --format json          # preview candidates
dbcli verification prune --older-than 30d --execute --force      # delete after preview
dbcli verification prune --older-than 90d --status verified --keep-latest 50 --execute --force
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--format <format>` | `json` | `json` or `table`. JSON is the authoritative contract. |
| `--older-than <Nd>` | required | Minimum age in whole days (`7d`, `30d`, `365d`). |
| `--keep-latest <n>` | `20` | Always protect the latest N valid artifacts across all subjects/statuses before filters. `0` protects none. |
| `--status <status>` | none | Select only valid artifacts with this status. |
| `--subject <kind:name>` | none | Select only valid artifacts with this subject. |
| `--include-invalid` | `false` | Also select malformed `verification-*.json` files, by file mtime. |
| `--execute` | `false` | Delete instead of preview. Requires `--force`. |
| `--force` | `false` | Acknowledge deletion; required with `--execute`. |

Safety: deletion is scoped to regular `verification-*.json` files inside
`.dbcli/verification/`; symlinks, directories, and path escapes are skipped with a
reason. No database connection is opened and no audit entry is written. JSON output
includes `storageDir`, `dryRun`, `cutoff`, `criteria`, `protected`, `candidates`,
`deleted`, and `skipped`.

**Statuses:**

| Status | Meaning |
|---|---|
| `verified` | The assertion ran and evidence matched the expected state. |
| `not_verified` | The assertion ran and evidence contradicted the expected state. |
| `indeterminate` | The assertion ran but evidence was ambiguous (JSON parse failure, missing field, gate skip). |
| `blocked` | Verification could not run due to config, permission, schema, placeholder, or safety gates. |

**Subject kinds:**

| Kind | Produced by |
|---|---|
| `recovery` | Post-recovery verification assertions. |
| `task-pack` | Assertions generated by task pack plans. |
| `assertion` | General-purpose inline assertions. |
| `migration` | Schema migration pre/post checks. |
| `backfill` | Data backfill verification assertions. |
| `manual` | Manually triggered or ad-hoc verification runs. |

**Storage root:** `<cwd>/.dbcli/verification/` (cwd-relative; independent of `--config`).

**Permission:** n/a

### backfill

Generate a bounded, reviewable source-to-SQL backfill artifact. The command is
strictly dry-run: it reads a local JSON source catalog, records non-secret
source/target connection identity, and never opens a database connection or
executes generated SQL.

```bash
dbcli backfill artifact \
  --source ./backfill.json \
  --source-use staging \
  --target-use production
dbcli backfill artifact --source ./backfill.json \
  --source-use staging --target-use production --stdout
dbcli backfill artifact --source ./backfill.json \
  --source-use staging --target-use production --out .dbcli/backfills/review.json
```

The source catalog must contain `table`, non-empty `keyColumns`, `rows`, a
read-only `verifyQuery`, and `expect`; no more than 1,000 rows are accepted.
Identifiers are validated and row values are limited to JSON scalars. The
target connection must be PostgreSQL, MySQL, or MariaDB (the source identity
may describe another engine); target selectors in generated commands are
shell-quoted. The artifact includes a SHA-256 source fingerprint, generated parameterized
`UPDATE` statements with per-statement `plan` commands, blacklist/schema
preflight commands, a `verify safe-backfill` read-back command, identity
differences, and a rollback hint. `execution.mode` is always `dry-run` and
`requiresHumanConfirmation` is always true; applying SQL is a separate,
explicit human-reviewed workflow.

**Options:** `--source <path>` (required), `--source-use <name>` (required),
`--target-use <name>` (required), `--stdout`, `--out <path>`

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

> **MongoDB SRV diagnostics:** When the active connection uses `mongodb+srv://` (via a full `uri` or the per-field `srv: true`), `doctor` reports whether the current runtime can resolve SRV records directly or only through the DNS-over-HTTPS fallback used by dbcli. This helps spot execution-environment DNS restrictions even when Compass can connect.

> **MongoDB connection-field warnings:** `doctor` also warns when a config has both `uri` and per-field values (`host` / `user`) present — `uri` silently wins and the per-field values are ignored — and when `srv: true` is combined with a non-default `port`, since SRV records carry their own ports.

**Exit code:** 0 if all pass or warnings only, 1 if any error
**Options:** `--format <text|json>`, `--remediation`

With `--format json --remediation`, large-table warnings include one bounded
sample candidate per table. SQL candidates first run `dbcli plan` for a `LIMIT
100` read; MongoDB and Elasticsearch candidates first run `dbcli schema` as a
preflight. Each then offers a matching bounded `dbcli query` as the
human-confirmed apply step; doctor never runs either command automatically.

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

The REPL flavor depends on the active engine: SQL engines and MongoDB use the
form above; **Redis** opens a single-line command REPL (see [Redis › Interactive
shell](#interactive-shell)); **Elasticsearch** opens a Kibana Dev Tools-style
REPL (v1.22, see [Elasticsearch › Interactive shell](#interactive-shell-v122)).

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

### semantic

Validate or print the optional, version-controlled `dbcli.semantic.json` in the
project root. It supplies business names and descriptions to an agent, but is
not a query language: these commands are offline, read-only, and never execute
SQL or contact an LLM.

```bash
dbcli semantic validate
dbcli semantic validate --format json
dbcli semantic context
dbcli semantic context --format markdown
dbcli semantic context --file ./analytics.semantic.json
dbcli semantic drift --format json
dbcli semantic migrate --to 2 --format json
dbcli semantic search purchases --kind model --format json
dbcli semantic draft validate --input ./draft.json --format json
external-agent | dbcli semantic draft validate --input - --format json
```

The default file has this compact contract:

```json
{
  "version": 2,
  "models": [
    {
      "name": "orders",
      "table": "orders",
      "description": "Completed purchases.",
      "aliases": ["purchases"],
      "fields": [
        { "column": "created_at", "aliases": ["order date"] },
        { "column": "customer_id" }
      ]
    },
    {
      "name": "customers",
      "table": "customers",
      "fields": [{ "column": "id" }]
    }
  ],
  "relationships": [
    {
      "name": "order-customer",
      "from": { "model": "orders", "field": "customer_id" },
      "to": { "model": "customers", "field": "id" },
      "cardinality": "many-to-one",
      "description": "Each order belongs to one customer."
    }
  ],
  "metrics": [
    { "name": "daily-revenue", "query": "@analytics/revenue" }
  ]
}
```

Version 1 remains supported and is normalized with `relationships: []`.
Version 2 relationships must reference a declared model and a declared field on
that model; the field must also be visible in cached schema. Their `cardinality`
is one of `one-to-one`, `one-to-many`, `many-to-one`, or `many-to-many`.
`models[].table` and `models[].fields[].column` must name a visible cached
schema object. Blacklisted tables and columns are not visible and are rejected.
Each metric `query` must name an available saved query. Validation parses its
local file through the normal saved-query safety checks, but never executes or
emits SQL. The semantic file cannot contain SQL, connection data, or
credentials. `semantic validate` reports a
deterministic success summary (`--format text|json`); `semantic context` prints
the validated context (`--format json|markdown`). `semantic drift` returns a
stable `valid`, `stale`, `invalid`, or `unavailable` report and exits non-zero
for every status except `valid`; it never connects to a database. `semantic
migrate --to 2` prints a deterministic v2 JSON document to stdout and never
writes the input file. An absent default file is allowed for `skill context`
and simply omits the semantic section; a stale or invalid present file fails
closed rather than being silently ignored.

`semantic search <terms...>` performs deterministic, case-insensitive matching
over canonical names, aliases, descriptions, and governed model paths. Results
are ranked by exact canonical name, exact alias, prefix, then description token;
kind/name breaks ties. Use `--kind model|field|relationship|metric` and
`--limit <1-100>` (default `20`). It returns only canonical references, matched
terms, aliases, descriptions, and necessary model paths—never SQL bodies,
connection data, or blacklist names. No result is an empty array / text notice
with exit 0.

`semantic draft validate --input <file|-> [--format text|json]` accepts only an
explicit untrusted `QueryDraft` JSON document from a file or stdin. It validates
the contract, read-only single-statement SQL, canonical semantic references,
saved-query names, and local filtered schema/blacklist compatibility without
connecting to a database, reading query results, storing the draft, or calling a
provider. JSON reports contain only status, hashes, canonical references, and
safe violation codes; they never echo candidate SQL or protected names. Exit
`0` means valid, `1` means rejected, and `2` means required local semantic
evidence is unavailable. A valid report is not execution authorization: review
the original draft, then explicitly invoke the normal `dbcli explain` or `dbcli
query` workflow as a separate command when appropriate.

When valid, `dbcli skill context` includes the same bounded data in its JSON,
XML, and Markdown output. To run a metric, an agent must still invoke the named
saved query through `dbcli q`; all ordinary permissions, blacklist masking,
limits, audit, and recovery safeguards remain in force.

**Permission:** n/a (local files only; no database connection).

### skill

Emit `SKILL.md` (and the companion `reference.md`) to stdout, a file, or an
AI-agent platform directory. The skill is the source of truth that lets
Claude Code / Gemini / Antigravity / Copilot / Cursor know how to drive dbcli safely.

```bash
dbcli skill                                  # print SKILL.md to stdout
dbcli skill --output ./SKILL.md              # write to a file (no platform install)
dbcli skill --install claude                 # install to ~/.claude/skills/dbcli/
dbcli skill --install gemini                 # install to ~/.gemini/skills/dbcli/ (being phased out)
dbcli skill --install antigravity            # install to ~/.gemini/antigravity-cli/skills/dbcli/
dbcli skill --install copilot                # install to .github/skills/dbcli/ (repo-local)
dbcli skill --install cursor                 # install to .cursor/skills/dbcli/ (repo-local)
dbcli skill --install codex                  # install to ~/.codex/skills/dbcli/
```

**Options:**
- `--install <platform>` — `claude` | `gemini` | `antigravity` | `copilot` | `cursor` | `codex` | `windsurf`. Writes `SKILL.md` plus `reference.md` next to it so the agent gets progressive disclosure.
- `--output <path>` — write `SKILL.md` to a file instead of stdout. Does not install `reference.md`.
- `--lang <en|zh-TW>` — source language for the emitted SKILL content (default `en`). It selects `assets/SKILL.md` vs `assets/SKILL.zh-TW.md`; the install/output filename stays `SKILL.md` regardless.

**Notes:**
- Both files come straight from `assets/SKILL.md` + `assets/reference.md` inside the dbcli package — no runtime rendering. Keep these in sync when shipping a release.
- `claude` / `gemini` / `antigravity` install paths are user-global; `copilot` / `cursor` are repo-local under `.github/` / `.cursor/`.
- Cursor can install through `/add-plugin dbcli-agent` when available in Cursor's plugin marketplace; this repo includes `.cursor-plugin/plugin.json`. Instruction-file fallback options remain documented in `plugins/dbcli-agent/INSTALL.md#cursor`.
- Codex can consume the repo through the Ponytail-style marketplace layout at `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json`; plugin installs provide the skill from `skills/dbcli/`, and the skill falls back to `bunx @carllee1983/dbcli` when `dbcli` is not on `PATH`.
- Agent plugin installation details live in `plugins/dbcli-agent/INSTALL.md`, including Codex, Claude Code, GitHub Copilot CLI, Antigravity (`agy`), and Cursor targets.
- `gemini` (Gemini CLI) is retained for now but is being phased out in favour of `antigravity` (Antigravity CLI), Google's successor terminal agent.
- Re-running `--install` overwrites the existing skill atomically; no prompt.

**Permission:** n/a.

### skill context

Emit an AI-friendly snapshot of the connected database's schema and saved-query snippets (blacklist-filtered) so an agent can be primed with the current context.

```bash
dbcli skill context                      # XML (default)
dbcli skill context --format json
dbcli skill context --format markdown
```

**Options:**
- `--format <xml|json|markdown>` — output format (default: `xml`)

**Permission:** query-only+ — read-only; blacklisted objects are never emitted.

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

**Builtin packs:** `diagnose-slow-query` and **(v1.23)** `analyze-table-perf` —
a read-only (`plan-only`) pack taking a required `table` parameter that walks
`blacklist list` → `schema <table> --format json` → `guide index-usage --format json`.
`dbcli inspect` suggests `analyze-table-perf` automatically for the hottest table
in recent audit activity. Additional read-only packs ship for common agent
workflows: `audit-permissions` (permission/blacklist audit), `safe-backfill`
(plan a write with blacklist+schema+risk checks), `schema-drift-review` (cached
vs live schema diff), `orm-drift-review` (ORM definition vs cached DB schema),
and `connection-health` (reachability/config/capacity
triage). **MongoDB packs:** `mongo-safe-backfill` (dry-run–previewed backfill)
and `mongo-schema-drift-review` (sampled dot-path drift, with a `sample_size` knob
to damp sampling noise); filter them with `dbcli skill tasks list --engine mongodb`.
Run `dbcli skill tasks list` for the full set.

```bash
dbcli skill tasks plan analyze-table-perf --param table=betting_logs --format json
```

Task storage layers:

| Source | Path | Notes |
| --- | --- | --- |
| builtin | `assets/tasks/` | shipped with dbcli |
| shared | `.dbcli-shared/tasks/` | team-managed, version-controlled |
| local | `.dbcli/tasks/` | personal, gitignored |

Higher tiers override lower tiers by task name. Task name is derived from the
file path under the tier root (e.g. `diag/inspect.md` → `diag/inspect`).

## Recovery Cookbook (agent walkthroughs)

End-to-end recovery sessions for the most common failure codes. All examples
assume the agent invoked a `--recovery`-capable command and received a
`RecoveryEnvelope` (or hit the same envelope via `dbcli recovery --code <CODE>`
lookup). See [§recovery](#recovery) for the envelope shape, [§recover](#recover)
for `--apply` / `--next` / risk-gate semantics, and [§audit](#audit) for the
bi-directional `audit_ref` ⇄ `recovery_ref` pivot.

### Scenario index

| Code | Trigger | Primary remediation | Risk tier |
|------|---------|---------------------|-----------|
| `CONN_REFUSED` | Database process down or wrong host/port. | `dbcli doctor` → fix host/port → retry. | `readonly` |
| `CONN_AUTH_FAILED` | Credentials rejected. | Re-check `.dbcli`/env, rotate credentials, `dbcli init --force` only on explicit user nod. | `readonly` → `interactive` |
| `PERMISSION_DENIED` | Active permission level forbids the verb. | `dbcli inspect` to confirm level → escalate via `dbcli init` (human) or run a `--dry-run` instead. | `readonly` + `dry-run` |
| `BLACKLIST_TABLE` | Target table is blacklisted. | `dbcli blacklist list` → `blacklist table remove <name>` (local-write tier). | `readonly` + `local-write` |
| `BLACKLIST_COLUMN_WRITE` | INSERT/UPDATE touches a blacklisted column. | Re-shape payload to drop the column, or `blacklist column remove`. Envelope prepends a `--dry-run` preview step. | `dry-run` + `local-write` |
| `SCHEMA_CACHE_MISSING` | Fresh checkout / new v2 connection / cache wiped. | `dbcli schema --refresh --force` (or `--use <conn>` per-connection). | `readonly` |
| `SNIPPET_NOT_FOUND` / `SNIPPET_AMBIGUOUS` | Typo or duplicate snippet name. | `dbcli queries list` → `queries search <kw>` → run correct `@name`. | `readonly` |
| `SNIPPET_PARAM_MISSING` | `--param k=v` not supplied. | `dbcli queries show @name` lists required params → re-run with full set. | `readonly` |
| `CONFIG_MISSING` | No `.dbcli` in cwd. | `dbcli init` (human-driven). | `interactive` |

`risk` enum: `readonly` / `dry-run` / `write` / `unknown` (see §recovery boundaries).
Allowlist tier: `readonly` / `dry-run` / `local-write` / `db-write` / `interactive` (see [§recover Risk gate matrix](#risk-gate-matrix)).

### S1 — CONN_REFUSED end-to-end

```bash
# 1. Failing call writes envelope to stdout AND .dbcli/last-recovery.json
$ dbcli query "SELECT 1" --recovery --format json
{
  "schemaVersion": 1,
  "error": { "code": "CONN_REFUSED", "message": "..." },
  "audit_ref": "1f8e...c4d2",
  "recovery": [
    { "order": 1, "command": "dbcli doctor --format json", "risk": "readonly", ... },
    { "order": 2, "command": "dbcli inspect --for-agent",  "risk": "readonly", ... }
  ],
  "verify": { "command": "dbcli doctor --format json", "risk": "readonly", ... }
}

# 2. One-shot apply (only readonly + dry-run run by default)
$ dbcli recover --apply --format json
{ "finalStatus": "ok", "executed": [...], "verifyStatus": "passed" }
# Exit 0 → root cause cleared (verify probe succeeded).

# 3. If verify reported `failed` / `indeterminate`, drop into --next for control
$ dbcli recover --next --after-step 1 --result '{"status":"failed","exitCode":1}'
# → returns a refined step 2 or `kind:"done"` based on the prevResult
```

### S2 — PERMISSION_DENIED with implicit `--dry-run` preview

```bash
$ dbcli update orders --where "id=1" --set '{"status":"shipped"}' --recovery --format json
{
  "error": { "code": "PERMISSION_DENIED", ... },
  "audit_ref": "9ab0...e711",
  "recovery": [
    { "order": 1, "command": "dbcli update orders --where 'id=1' --set '<redacted>' --dry-run", "risk": "dry-run" },
    { "order": 2, "command": "dbcli inspect --for-agent", "risk": "readonly" }
  ]
}

# Default apply runs both steps (dry-run is in-tier).
$ dbcli recover --apply
```

When the failing operation is INSERT/UPDATE/DELETE, the envelope prepends a
`risk: 'dry-run'` step (the same write subcommand with `--dry-run`). Run it
before any escalation — it both teaches the agent what the SQL looks like and
proves the change is well-formed before raising the permission tier.

### S3 — BLACKLIST_TABLE (local-write remediation)

```bash
$ dbcli query "SELECT * FROM audit_logs" --recovery --format json
# error.code: BLACKLIST_TABLE
# recovery[0]: dbcli blacklist list                     (risk: readonly)
# recovery[1]: dbcli blacklist table remove audit_logs  (risk: write — local-write tier)

# Default --apply: step 1 runs, step 2 skipped:risk → exit 3.
$ dbcli recover --apply
# To proceed: open the gate to local-write tier ONLY (does not touch DB).
$ dbcli recover --apply --allow-write=readonly-cmd
{ "finalStatus": "ok", "executed": [step1, step2], "verifyStatus": "passed" }
```

### S4 — BLACKLIST_COLUMN_WRITE (preview-then-drop)

```bash
$ dbcli insert users --data '{"name":"a","ssn":"123"}' --recovery
# recovery[0]: dbcli insert users --data '<redacted>' --dry-run  (risk: dry-run)
# recovery[1]: dbcli blacklist list                              (risk: readonly)
# recovery[2]: dbcli blacklist column remove users.ssn           (risk: write — local-write)

# Preferred path: don't widen the blacklist — re-shape the agent's payload to drop ssn.
# Apply only the diagnostic prefix (steps 1+2) to confirm what columns are masked:
$ dbcli recover --apply
# Then re-issue insert without `ssn`.
```

### S5 — SCHEMA_CACHE_MISSING (fresh / multi-conn)

```bash
$ dbcli inspect --require-schema-cache --recovery --format json
# error.code: SCHEMA_CACHE_MISSING
# recovery[0]: dbcli schema --refresh --force      (risk: readonly — populates .dbcli/schemas/)
# verify:      dbcli inspect --format json         (schemaCache.available === true)

$ dbcli recover --apply
# Per-connection cache lives at .dbcli/schemas/<connection>/. If the failure was on
# a v2 named connection, the envelope's command already carries `--use <name>`.
```

### S6 — SNIPPET_NOT_FOUND with disambiguation

```bash
$ dbcli q @anaytics/revenue --recovery
# typo: anaytics → analytics
# recovery[0]: dbcli queries list --format json
# recovery[1]: dbcli queries search analytics  (or whatever --hint suggests)
$ dbcli recover --apply
# Agent reads stdoutSummary, identifies the correct @name, then re-issues:
$ dbcli q @analytics/revenue --param days=30
```

### Multi-turn `--next` walkthrough (3-step plan)

Use `--next` instead of `--apply` when:

- `--apply` is too coarse-grained (the agent wants step-by-step inspection).
- The plan contains an `interactive` step that `--apply` would skip.
- The agent uses its own runner / sandbox and just wants dbcli to drive cursoring.

`--next` returns one step at a time, given which step the agent **just executed**
and a `StepResultSummary` of how it went. dbcli does not persist the cursor —
the agent owns `--after-step`.

```bash
# Envelope already saved at .dbcli/last-recovery.json (3-step plan, CONN_REFUSED).

# Round 1 — agent reads step 1 from the envelope, executes it itself, then asks
# dbcli for the next step.
$ dbcli recover --next --after-step 1 --result '{"status":"ok","exitCode":0}' --format json
{
  "schemaVersion": 1,
  "kind": "step",
  "errorCode": "CONN_REFUSED",
  "cursor": 2,
  "totalSteps": 3,
  "step": { "order": 2, "command": "dbcli inspect --for-agent", "risk": "readonly", ... }
}

# Round 2 — bigger stdout, save to file and reference it.
$ ./run-step.sh > /tmp/r2.json   # agent's own runner; result is StepResultSummary JSON
$ dbcli recover --next --after-step 2 --result @/tmp/r2.json
{ "kind": "step", "cursor": 3, "step": { "order": 3, ... } }

# Round 3 — last step done.
$ dbcli recover --next --after-step 3 --result '{"status":"ok"}'
{ "kind": "done", "cursor": 3, "totalSteps": 3 }
```

`StepResultSummary` contract (recap of [§recover Multi-turn](#multi-turn---next-p2)):

```ts
interface StepResultSummary {
  status: 'ok' | 'failed' | 'skipped'
  exitCode?: number
  stdoutSummary?: string  // last 4 KB
  stderrSummary?: string  // last 4 KB
}
```

Truncate to the **last** 4 KB before passing — the head of a huge stdout is
usually not what disambiguates next steps.

Verification is **not** automatic under `--next`. If the agent wants the same
verify probe `--apply` runs, it must execute the envelope's `verify` step
itself after the plan completes.

### Bi-directional pivot (envelope ⇄ audit)

Every `--recovery`-capable failure (`query`, `inspect`, `insert`, `update`,
`delete`, `export`, `q`, `schema`) writes **both** sides of a UUID link:

- `RecoveryEnvelope.audit_ref` → the `audit.id` for the same failure.
- `AuditEntry.recovery_ref` → the envelope's id (also the auto-saved
  `.dbcli/last-recovery.json` filename trace).

```bash
# From envelope → audit (forensics on a saved failure)
$ ENV_ID=$(jq -r '.id' .dbcli/last-recovery.json)        # or read from stdout
$ dbcli audit show --recovery-ref "$ENV_ID" --format json
# Returns the matching audit entry (full, not brief).

# From audit → envelope (you have an audit hit, want the structured plan)
$ AUDIT_ID=$(dbcli audit tail --for-agent --n 1 | jq -r '.[0].id')
$ dbcli audit show "$AUDIT_ID" --format json
# Read `recovery_ref` from the entry, then either re-run --recovery against
# the original command or load the saved envelope:
$ jq '.recovery_ref' .dbcli/last-recovery.json | grep -q "$RECOVERY_REF" \
  && dbcli recover --format markdown            # human inspect
  || dbcli recover --from /path/to/archived.json --format markdown
```

Session handoff: a fresh agent that opens `dbcli inspect --for-agent`,
`dbcli guide`, `dbcli recover`, or `dbcli recover --apply` gets an
`audit_recent: AuditEntryBrief[]` field (last 5 entries) embedded in the JSON
output — no extra round-trip to the audit CLI needed for immediate history
context.

### Risk gate cheat sheet

Quick reference for what `--apply` runs at each `--allow-write` level. The
canonical matrix lives at [§recover Risk gate matrix](#risk-gate-matrix); this
table maps it onto common agent intents.

| Agent intent | Recommended flag | What runs | What's skipped |
|---|---|---|---|
| Probe-only (read state, learn) | `--apply` (default) | `readonly` + `dry-run` steps | `local-write`, `db-write`, `interactive` |
| Local config remediation (e.g. `blacklist remove`) | `--apply --allow-write=readonly-cmd` | + `local-write` | `db-write`, `interactive` |
| Database write recovery (rare; trusted plan) | `--apply --allow-write=write-cmd` | + `db-write` | `interactive` |
| Interactive step (e.g. `dbcli init`) | Drive manually OR use `--next` | n/a | All interactive steps always skip under `--apply` |
| Walk plan step-by-step with own runner | `--next --after-step N --result …` | one step per call | n/a — agent owns cursor + execution |

Three rules that always apply regardless of `--allow-write`:

1. **Tier is code-owned, not envelope-claimed.** The risk gate reads the
   per-error-code allowlist after parsing argv. An envelope cannot escalate
   itself by setting `risk: 'readonly'` on a write subcommand — argv decides.
2. **Placeholders block.** A step with unresolved `<token>` placeholders is
   skipped as `skipped:placeholder` even at `--allow-write=write-cmd`. Bind
   them at `recovery` lookup time with `--hint` / `--snippet` / `--table`, or
   ask the user.
3. **Verify is signal, not gate.** `verifyStatus` ∈ `{passed, failed,
   indeterminate}` reports whether the original failure looks resolved.
   `recover --apply` exit code is set by step execution, not verification.

### Common pitfalls

- **Stale `.dbcli/last-recovery.json`.** `recover` (no `--apply`) shows the
  *saved* plan, which may be hours old. Re-run the original command with
  `--recovery` to refresh it, or pass `--from <file>` to load an archived one.
- **`.dbcli/` is gitignored.** Do not check `last-recovery.json` into a repo
  for "reproducibility"; it contains sanitized command snapshots but the
  workspace `cwd` only makes sense locally. Use `recover --from <archived.json>`
  for cross-machine replay.
- **`--apply` exit 3 means every step skipped.** Not a failure — it means the
  default gate was too tight. Either widen with `--allow-write`, fill
  placeholders, or fall back to `--next` and drive steps manually.
- **`--next` does not run verify.** Re-run the original failing command with
  `--recovery` once the plan is done; if it now succeeds (no envelope on
  stdout), recovery is complete. Or invoke `envelope.verify.command` yourself.
- **Audit writer failures are non-fatal.** If `audit health` reports
  `lastWriteOk: false`, the main command still completed — but `recovery_ref`
  ⇄ `audit_ref` linkage is broken for that one call. `audit health` surfaces
  the underlying error (disk full, EACCES, etc.).
- **Cross-connection forensics.** `audit tail --all --for-agent` merges all
  connections; `audit show <id-prefix> --all` returns an envelope `{connection,
  entry}` so a fresh agent can tell which DB the failure was against.

## Interactive HTML dashboard

`query`, `q`, and `export` can render results as a single, fully self-contained
HTML file backed by a bundled React + Recharts template. The template lives at
`assets/ui-template.html` and is installed alongside the binary; no external
network, CDN, or runtime is required to view the report.

### Entry points

| Command form | Behaviour |
|--------------|-----------|
| `dbcli query "<sql>" --ui` | Render to a temp file under `$TMPDIR/dbcli-query-<ts>.html` and open with `open` / `xdg-open` / `start`. |
| `dbcli q @<name> --ui` | Same, with snippet metadata (`name`, `description`, `visual:` block). |
| `dbcli query "<sql>" --format html` | Print HTML to stdout (pipe, redirect, attach). |
| `dbcli q @<name> --format html` | Same, snippet-aware. |
| `dbcli export "<sql>" --format html --output report.html` | Write HTML to an explicit path; respects `--force` / overwrite confirmation. |

`--ui` is a convenience flag — it implies `--format html` and then opens the
file. `--ui` and `--format` are mutually compatible; passing both is allowed and
behaves as `--ui`.

### Data injection contract

The template ships with a single placeholder, `/*DBCLI_PAYLOAD*/`, which dbcli
replaces with:

```js
window.__DBCLI_PAYLOAD__ = { "meta": {...}, "rows": [...] };
```

Hardening rules applied before injection:

- Payload is `JSON.stringify(...)`-encoded.
- Every `<` is replaced with `<` so a malicious row containing `</script>`
  cannot terminate the inline script tag.
- Blacklist redaction (`dbcli blacklist`) runs **before** the formatter — masked
  columns never reach the dashboard.
- The replacement uses a function callback (`html.replace(..., () => injection)`)
  so `$&`-style backreferences in the payload are not interpreted.

### `meta` shape

`meta` is the `SavedQueryMeta` object (see `dbcli queries show @<name> --format json`):

```jsonc
{
  "name": "Revenue Trend",        // display title
  "key":  "@analytics/revenue",   // snippet key, or "raw-sql" / "export"
  "description": "...",           // free text (SQL preview for raw query)
  "params": [...],                // ParamSpec[]
  "tags":   ["analytics"],
  "intent": "perf.slow-query",
  "visual": { ... }               // optional, see below
}
```

For raw `query` / `export` invocations, `meta.params` is `[]` and
`meta.visual` is absent — the dashboard renders a sortable / filterable table.

### `visual:` block (snippet frontmatter)

```yaml
visual:
  title: Revenue (last :days days)   # optional override of meta.name
  kpis:
    - label: Total Revenue
      value_column: total_revenue    # must exist in result rows
      format: currency               # currency | number | percent (optional)
    - label: Orders
      value_column: order_count
      format: number
  charts:
    - type: line                     # line | bar | area | pie | scatter
      title: Daily Revenue
      x: day                         # column for X axis
      y: [revenue]                   # 1..N columns for series
    - type: bar
      title: By Channel
      x: channel
      y: [revenue, refunds]
```

Parser behaviour (`src/core/saved-queries/parser.ts::normaliseVisual`):

- The block is **optional**. Missing → table-only render.
- Items missing required fields (`kpi.label` + `kpi.value_column`, or
  `chart.type` + `chart.x` + `chart.y[]`) are silently dropped.
- Unknown `format` / `type` values are forwarded as strings; the dashboard
  decides how to render them (unknown chart types fall back gracefully).
- The snippet still executes as a normal SQL/DSL query — `visual:` only affects
  the HTML renderer.

### Limitations

- The dashboard is read-only; there is no in-page editor or re-run button.
- Raw `query` / `export` HTML output never shows KPIs or charts (no snippet
  metadata is available). Use `dbcli q @<name>` for the charted view.
- Engine support follows the underlying command: SQL, MongoDB (`--collection`),
  Redis, and Elasticsearch (`--collection`) all render through the same template.
- Very wide / very long result sets render as a single client-side table; for
  >10k rows prefer `--format csv` / `--format jsonl` and a downstream tool.

## MongoDB Support

MongoDB connections use a JSON-based query model instead of SQL. Treat MongoDB support as a narrower document-database path, not as a full SQL feature equivalent.

`init --system mongodb` defaults to a field-by-field wizard (`host`, `srv`, `port`, `user`, `password` + `authSource`, then optional `replicaSet` / `tls`); a full `uri` is an explicit advanced choice in the interactive flow and the unchanged non-interactive path via `--uri`. Optional fields `authSource`, `replicaSet`, `tls`, and `srv` express what previously required embedding options in the `uri` query string. Atlas-style `mongodb+srv://` URIs are supported both as a full `uri` and via the per-field `srv: true` option. `list` and `query` run against the database configured for the connection, and `query` always requires `--collection <name>`.

The 5000ms default server-selection timeout is often too tight for a connection over a VPN or to Atlas. Set a `timeout` field (ms) in the connection config, or override it per invocation with root-level `--timeout`, e.g. `dbcli --timeout 20000 --use <conn> list`.

**Supported commands:** `init`, `use`, `list`, `schema`, `query`, `q`, `insert`, `update`, `delete`, `export`, `status`, `shell`, `doctor`, `upgrade`, `completion`

**Limited support:**

- `schema` samples collection documents to infer field names/types. It does not provide relational constraints, primary keys, foreign keys, or reliable index metadata.
- `query` accepts only JSON object filters or aggregation pipeline arrays and always requires `--collection <name>`.
- `q` saved-query execution accepts JSON `find` / `aggregate` bodies, requires a `collection` frontmatter field (CLI `--collection` overrides), JSON-encodes every `{{param}}` substitution, and enforces table-level blacklist plus document field masking before rendering.
- `insert` inserts one JSON document into the named collection.
- `update` accepts a JSON filter in `--where` or simple `key=value` conditions. If `--set` does not use MongoDB update operators such as `$set`, dbcli wraps it in `$set`.
- `delete` deletes all documents matching the JSON/simple filter.
- `export` accepts the same JSON filter / aggregation syntax as `query`.
- MongoDB write paths do not currently provide the same SQL dry-run, relational schema validation, or column-level blacklist filtering guarantees as SQL writes.
- `shell` blocks raw SQL for MongoDB; use `query <json> --collection <name>` inside the shell.

**Not supported (exit with error):** `diff`, `migrate`

**Not a supported MongoDB target:** `check` is designed for relational health checks and emits SQL-style checks.

### MongoDB-specific workflow

```bash
# 1. Initialize — field-by-field (primary path)
dbcli init --system mongodb --host localhost --port 27017 \
  --user admin --password '<secret>' --auth-source admin --name mydb
# ...or a full URI (advanced fallback, e.g. Atlas SRV clusters)
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

Redis connections speak Redis commands rather than SQL. The adapter uses Bun's native `Bun.RedisClient` and exposes a permission-gated surface with a query size guard and key-glob blacklist enforcement.

**Supported commands:** `init`, `use`, `list`, `schema`, `query`, `shell`, `status`, `doctor`, `upgrade`, `completion`

**Saved queries:** `q` is supported for read-only Redis commands (see "Redis snippets" below).

**Not supported (exit with error or unsupported error):** `insert`, `update`, `delete`, `export`, `check`, `diff`, `migrate`. For writes, run the equivalent Redis command via `query` — the same permission gate applies.

### Connection and configuration

- Required fields: `system: redis`, `host`, `port`. `password` and `database` are optional.
- `database` is the **logical DB index** (`"0"` … `"15"`), kept as a string to play nicely with env-ref bindings. `list` and the connection metadata both label it as the active DB.
- `connection.timeout` (ms, default 5000) maps to the client's `connectionTimeout`; root-level `--timeout <ms>` overrides it for a single invocation.

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

### Size guard (`query --no-limit` / shell `.no-limit`)

The adapter rewrites unbounded reads before dispatch and truncates oversized replies after:

| Strategy | Commands | Behavior |
|----------|----------|----------|
| inject/cap `COUNT` | `SCAN`, `HSCAN`, `SSCAN`, `ZSCAN` | adds `COUNT 1000` when absent; caps a larger `COUNT` to 1000 |
| clamp `stop` | `LRANGE`, `ZRANGE`, `ZREVRANGE` | rewrites `stop` so the span ≤ 1000 (`-1` becomes `start+999`) |
| inject/cap `LIMIT` | `ZRANGEBYSCORE` | appends `LIMIT 0 1000` when absent; caps a larger count |
| client truncate | `HGETALL`, `HKEYS`, `HVALS`, `SMEMBERS`, `KEYS` | keeps the first 1000 entries |

Rewrites emit a `REDIS_SIZE_REWRITE` warning; truncations emit `REDIS_SIZE_TRUNCATE`. Both surface in the result's `warnings[]`. Pass `--no-limit` (CLI) or toggle `.no-limit on` (shell) to disable all guards.

### Blacklist enforcement

Blacklist rules are enforced as **Redis-native key globs** (`*`, `?`, `[abc]`, `[a-z]`):

```bash
dbcli blacklist table add 'secrets:*'    # register a key-glob rule
dbcli query "GET secrets:api_key"        # → BlacklistRejection (exit non-zero)
dbcli query "MGET safe:k secrets:api"    # → rejected (any matching key fails the whole command)
dbcli query "KEYS secrets:*"             # → rejected (pattern overlaps a rule)
dbcli query "KEYS *"                      # → returns only non-blacklisted keys
```

Rejections are written to the audit log with `success: false` and `metadata.rejection_reason: 'blacklist'` + `matched_pattern`.

### Value / hash-field masking (v1.22)

Where the key-glob blacklist *rejects*, masking instead *redacts*: a matched read still
runs, but the sensitive value comes back as `[REDACTED]` so an agent can use the command
without ever seeing it. Add an optional `redis.mask` block to `.dbcli`:

```yaml
redis:
  mask:
    - keyPattern: 'session:*'          # whole value redacted on read
    - keyPattern: 'user:*'
      fields: [password, token]        # only these hash fields redacted
```

- Applies on reads: `GET`, `GETRANGE`, `HGETALL`, `HGET`, `HMGET`, `HVALS`.
- A rule without `fields` redacts the entire value; with `fields` only the named hash fields are redacted.
- Masking and key-glob rejection coexist, and **rejection always wins over masking** — a key that matches a blacklist rule is rejected, never merely masked.

### Interactive shell

`dbcli shell` on a Redis connection opens a single-line REPL:

```text
$ dbcli --use local-redis shell
Redis shell: single-line commands; SCAN/LRANGE auto-capped at 1000. Type `.no-limit on` to bypass (unsafe).
redis> SCAN 0                 # wire args become: SCAN 0 COUNT 1000  (REDIS_SIZE_REWRITE)
redis> HGETALL bighash        # >1000 fields → kept 1000           (REDIS_SIZE_TRUNCATE)
redis> .no-limit on           # bypass size guard for this session
redis> GET secrets:api_key    # → REDIS_BLACKLIST / BlacklistRejection if blacklisted
redis> .exit
```

Tab completion offers Redis command names and known key prefixes; history persists to `~/.dbcli_history`.

### Limitations

- No `--dry-run` for writes — Redis commands execute immediately. Pair writes with a confirming read (`GET`, `HGETALL`, `EXISTS`).
- No transaction wrapping (`MULTI`/`EXEC`). Submit one command at a time.
- `KEYS` requires `admin`. Prefer `SCAN` for routine work.
- Blacklist enforcement covers **keys** (Redis-native globs); value / hash-field **masking** is available via the `redis.mask` config block (v1.22).

## Elasticsearch Support

Elasticsearch connections speak the REST API. The adapter is fetch-based (no SDK) and supports HTTPS, custom CA, API key, basic auth, and Cloud ID.

**Supported commands:** `init`, `use`, `list`, `schema`, `query`, `export` (v1.22), `shell` (v1.22), `status`, `doctor`, `upgrade`, `completion`

**Saved queries:** `q` is supported for ES JSON DSL bodies (see "Elasticsearch snippets" below).

**Not supported (use external tooling):** `insert`, `update`, `delete`, `check`, `diff`, `migrate`. The permission classifier already understands `_doc` / `_update` / `_bulk` so future write surfaces can be wired in without changing tiers.

### Connection and configuration

- Either `host` + `port` (default `https://localhost:9200`) or `nodes: [...]` (first node is used) or `cloudId`.
- Auth precedence: `apiKey` → `user`/`password` (HTTP Basic). Leave both unset for an open cluster.
- `protocol` defaults to `https`. For TLS quirks: `caPath` (path to a PEM bundle) and `rejectUnauthorized: false` (last resort).
- `connection.timeout` (ms, default 5000) is wired to `AbortController` on every request; root-level `--timeout <ms>` overrides it for a single invocation.

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

### Export (v1.22)

`dbcli export` supports two shapes on an ES connection:

```bash
# (a) search DSL + --index → export the hits
dbcli export '{"query":{"match":{"status":"active"}}}' --index orders --format jsonl --output orders.ndjson

# (b) index name as the query → match_all over the whole index (scroll)
dbcli export orders --format csv --output orders.csv
dbcli export orders --no-limit --format jsonl     # full index, scrolled in batches
```

- Outputs JSON / JSONL / CSV. Default cap is 1000 rows; `--no-limit` streams the full index via the scroll API in batches.
- Index-level blacklist is checked before export and the run is written to the audit log.

### Interactive shell (v1.22)

`dbcli shell` on an ES connection opens a Kibana Dev Tools-style REPL:

```text
$ dbcli --use local-es shell
GET /orders/_search
{
  "query": { "match": { "status": "active" } }
}
                              # ← blank line submits the whole block
```

- Enter a request line `<METHOD> /<path>`, then an optional multi-line JSON body; a **blank line** submits the block. Responses render as pretty-printed JSON.
- Read-focused: index-level blacklist rejects protected indices at the front end; a `_search` whose body omits `size` is auto-capped at 1000 hits.

### Doctor and diagnostics

`dbcli doctor` runs a dedicated Elasticsearch path:

- Verifies REST connectivity to `GET /`.
- Reads `version.number` and runs the standard version freshness check.
- Walks every index via `listTables()` + `getTableSchema()` to feed the blacklist completeness check and the large-table heuristic (using `documentCount`).
- Standard schema-cache freshness using `schemaLastUpdated`.

### Limitations

- Writes (`insert`/`update`/`delete`) are not exposed yet — the adapter implements them, but the CLI currently only routes them for SQL and MongoDB. Read-only `export` (v1.22) and the interactive `shell` (v1.22) are available.
- No `_search/scroll` or PIT pagination at the CLI layer; large pulls need a saved external script.
- `check`, `diff`, `migrate`, and `q` are SQL-only and exit with errors (or fall through to a generic "unsupported" path).
- Blacklist column rules are applied to flattened hit rows on `query`; table-level blacklist rejects an index up front.
