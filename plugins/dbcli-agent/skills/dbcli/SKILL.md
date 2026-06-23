---
name: dbcli
description: Database CLI for AI agents with permission-based access control. Use to set up new connections, query, inspect schemas, insert/update/delete, export results, and blacklist sensitive columns/tables. Supports MySQL, PostgreSQL, MariaDB, MongoDB, Redis, and Elasticsearch with multiple named connections per project and custom env files. Trigger when configuring a database connection (`.dbcli` / `.env`), choosing between v1 single and v2 multi-connection layouts, picking auth modes (URI, env refs, Cloud ID, API key), running SQL / MongoDB JSON / Redis commands / Elasticsearch DSL, exploring table/collection/key/index structures, switching database environments, protecting sensitive data from AI access, or performing automated recovery and guided remediation after command failures. For exhaustive flags and examples, read the sibling `reference.md`.
---

# dbcli

Database CLI for AI agents with permission-based access control.

If the `dbcli` executable is not available in `PATH`, use
`bunx @carllee1983/dbcli <command>` as the command prefix. This is the expected
fallback for Codex plugin installs where the skill is installed by the plugin but
the CLI package has not been installed globally.

## How to use dbcli

**Safety baseline — apply to every operation:**

1. `dbcli blacklist list` — confirm sensitive-data boundaries.
2. `dbcli schema <object> --format json` — confirm real column/field names. **Never guess.**
3. All writes: `--dry-run` (SQL/Mongo) → run → `query` read-back to confirm.

> `report` and `guide` already embed an `inspect` snapshot — you do **not** need to run
> `dbcli inspect` first. Run `dbcli inspect --for-agent` manually only when you want the
> audit-recent context or to diagnose a connection problem.

**Then route by task:**

| Task | Path |
| --- | --- |
| A named workflow fits ("diagnose slow query", "audit permissions") | `skill tasks list` → `skill tasks plan <pack>` — **prefer this; do not invent steps** |
| A fixed diagnostic goal | `guide <goal>` (`slow-query` / `capacity` / `health` / `index-usage` / `permissions` / `schema-overview`; `guide --list`) |
| Setting up a connection | see **Connection setup** |
| Anything else | run commands manually; consult the **Developer workflows** cheat-sheet |

Slow-query diagnosis has three canonical paths (pick by what you already know):

- Known slow SQL → `skill tasks plan diagnose-slow-query --param query="<SQL>"` → `guide missing-index-for "<SQL>"`
- Known hot table → `skill tasks plan analyze-table-perf --param table=<table>`
- Whole-environment scan → `report --section perf` → `guide slow-query`

`report --section perf` already runs the slow-query, index-usage, and cache-hit diagnostics —
afterwards add only the `@diag/*` it does not cover (`missing-indexes`, `locks`, `connections`,
`table-sizes`). Once you have a specific slow statement, `explain --analyze "<SQL>"` shows its plan.

**On failure:** pass `--recovery` to `query` / `q` / `insert` / `update` / `delete` /
`export` / `schema` / `inspect`. The command emits a `RecoveryEnvelope` to stdout and saves
it to `.dbcli/last-recovery.json`; then `dbcli recover` inspects it and `dbcli recover --apply`
runs the saved plan under risk gating. Multi-turn `--next`, connection branching, and the
post-apply verify probe are documented in reference.md §Recovery Cookbook.

When reporting a check's outcome use the vocabulary `verified` (evidence matched) /
`not_verified` (check ran and contradicted) / `indeterminate` (ran but ambiguous) /
`blocked` (could not run due to config, permission, schema, placeholder, or safety gate).

Prefer `--format json` for agent-friendly output.

## Agent Task Packs

When the user asks for a database workflow ("diagnose this slow query", "audit
permissions", "review long-running operations"), **prefer published task templates over
inventing steps from memory.**

```bash
dbcli skill tasks list --format json                              # discover
dbcli skill tasks show <task>                                     # inspect
dbcli skill tasks plan <task> --param key=value --format json     # generate plan
```

The plan is an ordered list of dbcli commands with rationale and risk labels. Execute them
one at a time — task plans do **not** override blacklist, schema, dry-run, or confirmation
requirements.

Builtin packs: `diagnose-slow-query` (targets a specific SQL), `analyze-table-perf` (targets
a specific table; `dbcli inspect` auto-suggests it for the hottest table in recent audit
activity), `audit-permissions`, `safe-backfill`, `schema-drift-review`, `connection-health`.
Review/verify packs: `pr-database-review`, `migration-review`, `safe-backfill-verify`,
`slow-endpoint-investigation`. All are read-only `plan-only` — pick the pack matching the
situation, and run any index/DDL proposal through `migration-review` before writing.

Tasks live under `assets/tasks/` (builtin), `.dbcli-shared/tasks/` (shared), and
`.dbcli/tasks/` (local override).

## Developer workflows

Use these workflows when database impact is implicit in a development task. The safety baseline
in **How to use dbcli** still applies.

| Situation | Minimum safe path |
| --- | --- |
| DB-backed feature | `blacklist list` → `schema <object>` → `queries suggest <intent>` |
| Application data bug | `audit tail --for-agent --n 10` → `blacklist list` → `schema <object>` → narrow query |
| ORM or migration work | `schema --format json` → `diff --snapshot <name>` → `migrate add-index`/`add-column` (preview SQL) → `diff --against <snapshot>` |
| PR database review | Review changed persistence paths, then propose concrete `schema` / `plan` / `dry-run` / `report` / `guide` commands per material claim. |
| Slow endpoint or query | `report --section perf` → task pack `analyze-table-perf` → `guide missing-index-for "<query>"`; use `proxy analyze` when logs exist. |
| Safe data backfill | `blacklist list` → `schema <object>` → count/scope query → `update … --dry-run` → read-back or snippet `--verify`. |
| Environment validation | `status --format json` → `doctor --format json` → `inspect --for-agent --no-connect`. |

Copy-paste command anchors:

```bash
dbcli inspect --for-agent --format json
dbcli blacklist list --format json
dbcli schema <object> --format json
dbcli queries suggest <intent> --format json
dbcli audit tail --for-agent --n 10
dbcli diff --snapshot <name>
dbcli report --section perf --format json
dbcli skill tasks plan analyze-table-perf --param table=<table> --format json
dbcli guide missing-index-for "<query>" --format json
dbcli update <object> --where "<bounded predicate>" --set '<json>' --dry-run --format json
dbcli inspect --for-agent --no-connect --format json
```

Guardrails:

- Never invent table, collection, key, index, or field names. Confirm with `schema`.
- Separate database facts from application-code inference. Report which dbcli output shaped the conclusion.
- For writes and backfills, include scope count, dry-run preview, execution command, and read-back.
- Do not create indexes directly from a performance suggestion; turn them into reviewed migrations.
- Do not print credentials, copied connection strings, or blacklisted values.
- Durable evidence: `assert … --write-verification-artifact --verification-subject <kind:name>`;
  inspect with `verification summary` / `list` / `show <id>`. The `verify safe-backfill` /
  `migration` / `rollback --kind <ddl|dml>` / `constraint --check <fk|not-null|unique|custom>`
  family runs preflight + `--after-write` checks and **never executes the write**. Full flags
  and the per-command blocks are in reference.md.

## Audit log

Use the audit log for cross-session history or failure forensics instead of re-querying
live DB state.

```bash
dbcli audit tail --for-agent --n 10          # last N entries (JSON envelope, metadata-only)
dbcli audit show <id-prefix>                 # full entry by id prefix (≥4 chars)
dbcli audit show --recovery-ref <env-id>     # find the entry that emitted an envelope
```

The `inspect` / `guide` / `recover` agent JSON embeds `audit_recent` (last 5 entries) — a
fresh session has immediate history. An envelope's `audit_ref` and an audit entry's
`recovery_ref` point at each other, so you can pivot either way. Audit is on by default
(`audit.enabled = false` to opt out); entries are metadata-only (never SQL bodies, `--param`
values, or result cells) and rotate at ~10 MB / 1000 entries. Full flags: reference.md §audit.

## Quick start

```bash
dbcli init                          # Create .dbcli config (parses .env automatically)
dbcli schema                        # Scan all tables → .dbcli/schemas/
dbcli query "SELECT * FROM users"   # Execute SQL (auto LIMIT 1000)
```

If `.dbcli` does not yet exist, route through **Connection setup** below before
touching `schema` / `query`.

## Connection setup (helping the user wire up a database)

When the user asks "how do I connect to X?", "set up dbcli for our staging DB",
or `doctor` / `status` reports a missing or invalid config, follow this flow.

> **Default to guiding, not running.** `init` writes credentials to disk. Only
> execute it for the user with explicit permission and confirmed values.
> If a `.dbcli` already contains `{"$env": "..."}` references, **do not** rerun
> `init` to "fill them in" — the env-ref form is intentional for CI/multi-env.

### Decision tree (ask before writing)

1. **One DB or many environments?** One → v1 (single connection). Multiple
   environments / tenants / replicas → v2 (`--conn-name <name>`, optionally
   `--env-file <path>` per connection).
2. **Where do credentials live?**
   - Already in a `.env` (`DATABASE_URL` or `DB_HOST` / `DB_PORT` / `DB_USER` /
     `DB_PASSWORD` / `DB_NAME` | `DB_DATABASE`) → `init` parses it automatically.
   - Need to keep secrets out of `.dbcli` (CI/CD, multi-env) → `--use-env-refs` (see below).
   - Plain values are acceptable → pass `--host` / `--port` / `--user` /
     `--password` / `--name` (and `--system`).
3. **What permission tier?** Default to the **lowest** that satisfies the task:
   `query-only` → `read-write` → `data-admin` → `admin`. Set with `--permission`
   (defaults to `query-only`).
4. **Verify, never assume.** After init: `dbcli status` (system + permission +
   blacklist summary, no creds) and `dbcli doctor --format json` (env, config
   shape, connectivity, schema-cache age, Mongo SRV path).

### Per-engine essentials

```bash
# PostgreSQL / MySQL / MariaDB (v1, plain values)
dbcli init --system postgresql --host localhost --port 5432 \
  --user app --password '<secret>' --name appdb --permission query-only

# Reuse an existing .env (DATABASE_URL=postgresql://user:pw@host:5432/db)
dbcli init                                                # parses .env in cwd

# MongoDB — full URI (Atlas / replica sets / authSource)
dbcli init --system mongodb \
  --uri "mongodb+srv://user:pw@cluster.example.mongodb.net/mydb?authSource=admin"
# MongoDB — discrete params (no auth = omit --user/--password)
dbcli init --system mongodb --host localhost --port 27017 --name mydb

# Redis — `--name` is the LOGICAL DB INDEX ("0".."15"), not a database name
dbcli init --system redis --host localhost --port 6379 --password '<secret>' --name 0

# Elasticsearch — basic auth, Cloud ID, or API key
dbcli init --system elasticsearch --host localhost --port 9200 \
  --user elastic --password '<secret>'
dbcli init --system elasticsearch \
  --cloud-id "myCluster:dXMtZWFzdC0xLmF3..." --api-key "<base64>"
# Multi-node / custom CA / self-signed: edit `.dbcli` directly to add
# `nodes: [...]`, `protocol: https`, `caPath`, `rejectUnauthorized: false`.
```

### Multi-connection (v2)

```bash
dbcli init --conn-name staging --env-file .env.staging --permission query-only
dbcli init --conn-name prod    --env-file .env.production --use-env-refs --skip-test
dbcli use --list                          # show all, * marks default
dbcli use prod                            # switch default
dbcli query --use staging "SELECT 1"      # one-shot override on any subcommand
dbcli init --rename staging:stg           # rename
dbcli init --remove stg                   # remove
```

Each named connection has its own schema cache at `.dbcli/schemas/<connection>/`. Run
`dbcli schema --use <name>` once per connection **before** `schema <table>` — otherwise the
cache may serve another connection's columns. `schema --refresh` / `--reset` manage the cache
(reference.md). `--skip-test` skips the init-time TCP connection test; it is implied
automatically when `--use-env-refs` is set (the `$env` refs have no value to connect with yet).
`--system` is optional for v2 — without it the engine is inferred from `--env-file` / `.env`
(`DATABASE_URL` scheme), defaulting to `postgresql`.

### env-refs (keep secrets out of `.dbcli`)

Store credentials as `{ "$env": "VAR" }` references resolved at runtime, never plaintext:

```bash
# Default key names: DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_DATABASE
dbcli init --use-env-refs

# Non-default key names — name each one explicitly (required in CI):
dbcli init --conn-name prod --env-file .env.production --use-env-refs --skip-test \
  --env-host PROD_DB_HOST --env-port PROD_DB_PORT \
  --env-user PROD_DB_USER --env-password PROD_DB_PASSWORD --env-database PROD_DB_NAME
```

In an **interactive terminal**, omitting the `--env-*` flags prompts for each key name
(defaults above) — you can type a non-default name like `PROD_DB_PASSWORD` and it is stored
as a `$env` ref. In a **non-interactive / CI** run you **must** pass all five `--env-*`
flags; otherwise `init` exits with an error — it never silently falls back to plaintext.
`--env-file <path>` is the path to the env file, independent of the `$env` key names.

### Common gotchas

- **MongoDB `mongodb+srv://`** — `dbcli doctor` reports whether SRV resolves
  natively or via the DoH fallback; useful when the runtime restricts DNS.
- **MySQL/Postgres password with `@` `:` `/`** — when using `DATABASE_URL`,
  percent-encode (`@` → `%40`); discrete `--password` flags do not need encoding.
- **Redis `--name`** — accepts only the logical DB index string; non-numeric
  values are rejected.
- **Elasticsearch TLS** — `caPath` and `rejectUnauthorized` are not exposed as
  flags; edit `.dbcli` after `init` to add them.
- **Re-running `init`** — refuses to overwrite without `--force`; never use
  `--force` to "fix" a config full of `{ "$env": "..." }` refs.

Full flags and edge cases: see [reference.md](reference.md) `init` section.

## Command overview

| Command | Min permission | Summary |
|---------|-----------------|---------|
| `init` | n/a | Create `.dbcli` (v1 single or v2 multi via `--conn-name` / `--env-file`). **Usually run by the human** — do NOT re-run to strip `{"$env"}` references; that format is intentional. |
| `use` | n/a | Show/switch default named connection (v2 only). |
| `list` | query-only+ | Tables (SQL), collections (MongoDB), keys (Redis), or indices (Elasticsearch). |
| `schema` | query-only+ | SQL: per-table or full scan into `.dbcli/schemas/`. MongoDB: sampled. ES: flattened mapping. Redis: per-key only (type/TTL/size). Supports `--recovery`. |
| `query` | query-only+ | SQL, Mongo JSON (`--collection`), Redis command, or ES DSL/Lucene (`--collection`). `--format table\|json\|csv\|html`, `--ui` to open the interactive dashboard in a browser. Supports `--recovery`. |
| `explain` | query-only+ | **(v1.23)** Read-only query plan with annotations. SQL only. Single query, `@saved-query`, `@file.sql`, or `--bulk @glob/*`. `--analyze` (EXPLAIN ANALYZE / MariaDB ANALYZE SELECT), `--format markdown\|json\|table`. |
| `plan` | n/a | Static SQL risk analyzer (`--format text\|json`); classifies a statement without connecting to the database. |
| `q` | query-only+ | Run a saved snippet by `@name` with `--param k=v`. Supports `--verify` to run assertions. |
| `queries` | n/a | Manage saved snippets: `list` / `show` / `search` / `suggest` / `new` / `edit` / `check` / `delete` / `rename` / `copy` / `import` / `export`. |
| `insert` / `update` | read-write+ | SQL or MongoDB only. JSON `--data` / `--set`; `--where` required on `update`; `--dry-run` first. Redis writes go through `query`. Supports `--recovery`. |
| `delete` | data-admin+ | SQL or MongoDB; Redis has a basic implementation (see Redis section). `--where` required; `--dry-run` first. Supports `--recovery`. |
| `export` | query-only+ | SQL, MongoDB, or **(v1.22)** Elasticsearch (DSL `--index` or whole-index scroll). Query → `--format json\|jsonl\|csv\|html` file or stdout. `html` emits a standalone interactive dashboard. Supports `--recovery`. |
| `blacklist` | n/a | `list` / `table` / `column` subcommands redact sensitive data from query results. |
| `check` | query-only+ | SQL only (best on MySQL/MariaDB). |
| `diff` | query-only+ | SQL only. Save/compare schema snapshots. |
| `snapshot` | query-only+ | **(v1.25)** SQL only. Capture a result fingerprint (`rowCount` + per-column null/distinct/min/max/sum + order-independent checksum). `--out` (default `.dbcli/snapshots/snap-<ts>.json`), `--rows`, `--stdout`, `--format`, `--no-limit`. Baseline for `assert --against`. |
| `assert` | query-only+ | **(v1.25)** SQL only. Verify an invariant; exit 1 on failure unless `--no-fail`. `--expect "rows>0\|value==X\|col:c not null\|unique\|between a and b\|>= n"`, `--vs <query> --compare rows\|value` (reconcile), `--against <snapshot> --tolerance <pct>`. |
| `verification` | n/a | Inspect and manage local verification artifacts. `list` / `show <id-or-path>` / `summary` are read-only; `prune` is dry-run by default and deletes only with `--execute --force`. Reads `<cwd>/.dbcli/verification/`; no DB connection, no audit writes. |
| `proxy` | n/a | **(v1.26)** MySQL/MariaDB/PostgreSQL only. Local-dev observability proxy — relays app traffic to the real DB and appends query/latency/byte/error events to `.dbcli/proxy/events.jsonl`. Subcommands: `mysql` \| `mariadb` \| `postgresql`. `--listen`, `--target`, `--events`, `--slow-ms` (default `1000`), `--redact none\|literals`. Observe-only. **(v1.27)** `proxy analyze` aggregates the event log offline into a JSON/text report (summary, byFingerprint with suggestedCommands, slowest, errors, hotTables, N+1) — errors out if no events exist yet. |
| `status` | query-only+ | Safe JSON/text summary (no credentials). |
| `inspect` | query-only+ | Read-only context snapshot (connection, permission, blacklist, objects, snippets, context-aware `suggestedCommands`, and **(v1.23)** human-readable `hints`). `--for-agent` / `--brief` / `--no-connect` / `--require-schema-cache`. Supports `--recovery`. |
| `report` | query-only+ | Diagnostic report built from `@diag/*` snippets. `--section <health\|capacity\|perf>` (comma-separated to combine), `--brief`, `--for-agent`, `--no-connect`. |
| `guide` | query-only+ | Deterministic next-command plan for a fixed goal (`slow-query`, `capacity`, `health`, `index-usage`, `permissions`, `schema-overview`). `--list` to enumerate. **(v1.23)** `guide missing-index-for <query>` suggests composite indexes for a single SELECT (`--format yaml\|json\|markdown`, `--min-confidence`). |
| `recovery` | n/a | Look up the structured `RecoveryEnvelope` for a known error code (`--code <CODE>` or `--list`). Standalone synthesizer; does not require a real failure. |
| `recover` | n/a | Inspect (default) or `--apply` the auto-saved recovery plan in `.dbcli/last-recovery.json`. `--allow-write=readonly-cmd\|write-cmd`, `--no-verify`, `--from <file>`, `--next --after-step <n> --result <json\|@file>` for multi-turn step-at-a-time. |
| `doctor` | n/a | Environment, config, connection, SRV diagnostics (Mongo), schema cache age. |
| `completion` | n/a | bash / zsh / fish scripts. |
| `upgrade` | n/a | Self-update from npm; 24h-cached version hints on every command. |
| `shell` | (same as query+) | Interactive REPL. SQL engines, MongoDB, and Redis (single-line; `.no-limit on/off`). **(v1.22)** Elasticsearch opens a Kibana Dev Tools-style REPL (`<METHOD> /<path>` + optional JSON body, blank line submits). |
| `skill` | n/a | Generate / install AI skill docs (`--install <claude\|gemini\|antigravity\|copilot\|cursor\|codex\|windsurf>`); `skill tasks list/show/plan` for Agent Task Packs; `skill context` for an LLM prompt-context payload (for injecting into another LLM, not needed for normal operation). |
| `migrate` | admin | SQL only. **DDL; dry-run by default** — needs `--execute`. |

`--use <name>` on any subcommand (including `status` / `doctor`) targets a v2 connection
without changing the default. `--recovery` is honoured by `query`, `q`, `insert`, `update`,
`delete`, `export`, `schema`, and `inspect` (see **On failure** above).

**Write & query flag semantics** (SQL/Mongo `insert`/`update`):

- `--set` (update) / `--data` (insert) take a **JSON object string**, not a SQL fragment:
  `dbcli update users --where "id=42" --set '{"email":"new@example.com"}'`. For MongoDB, a
  JSON without `$` operators is auto-wrapped as `$set`; explicit operators pass through.
  `insert --data` can also read the object from stdin.
- `--where` (SQL) accepts only `col=val` or `col1=val1 AND col2=val2` — **not** full SQL
  (no `>=`, `!=`, `LIKE`, `OR`). MongoDB `--where` takes a full JSON filter
  (`'{"status":"pending"}'`), falling back to `col=val` when it is not valid JSON.
- `--dry-run` prints the parameterized SQL (with `$1` / `?` placeholders, not real values)
  and `rows_affected: 0`; proceed once `status:"success"` and the SQL shape matches the
  intended `--where` / `--set`. MongoDB prints a shell-style preview.
- `--recovery` is recommended for automated agent pipelines (enables `dbcli recover --apply`
  after a failure); optional for one-off manual writes.

## Permission levels

| Level | Allowed |
|-------|---------|
| query-only | SELECT, list, schema, export |
| read-write | + INSERT, UPDATE |
| data-admin | + DELETE (DML, no DDL) |
| admin | + DDL via `migrate` and destructive ops |

## MongoDB

- `query` takes a JSON filter object (`find`) or array (`aggregate`); SQL is rejected.
  `--collection <name>` is required on `query`.
- **Supported:** `init`, `list`, `schema` (sampled), `query`, `insert`, `update`, `delete`,
  `export`, `q`, `status`, `use`, `shell`, `doctor`. **Not supported:** `diff`, `migrate`, `check`.
- Schema is **sampled** by `$sample` (default 100 docs, max 1000; `--sample-method natural`
  uses `find().limit()`). Columns surface as dot-paths (e.g. `profile.tokens.access`) with
  `presence` (0..1) and `redacted` flags.
- Writes: `--set` / `--data` JSON is auto-wrapped as `$set` when no `$` operator is present;
  explicit operators (`$set`/`$inc`/`$push`/…) pass through. Nested blacklist accepts dotted
  paths (`profile.email`) and trailing wildcards (`profile.tokens.*`). Saved snippets end in
  `.mongodb.sql` (frontmatter `engine: mongodb`, `operation: find|aggregate`). Full
  write-planner tiers and syntax: reference.md MongoDB section.

## Redis

- `query` runs a single **whitelisted** Redis command (e.g. `GET`, `SET`, `HSET`, `DEL`).
  The full whitelist and the per-command permission tier are defined in reference.md.
- **Supported:** `init`, `list` (keys via SCAN), `schema <key>` (type / TTL / size / sample),
  `query`, `q` (saved snippets — **read-only commands only**), `delete` (basic implementation:
  `DEL` / `HDEL` / `LREM` / `SREM` / `ZREM`, needs `data-admin`; `query "DEL <key>"` also
  works), `shell`, `status`, `use`, `doctor`. **Not supported:** `schema` full scan,
  `insert`, `update`, `check`, `diff`, `migrate`.
- **Permission tiers:** reads (`GET`/`HGET`/`SCAN`/…) → `query-only`; mutators
  (`SET`/`HSET`/`INCR`/`EXPIRE`/`SETEX`/`RENAME`/…) → `read-write`; `DEL`/`UNLINK`/`HDEL`/`XDEL`
  → `data-admin`. A command not in the whitelist is refused.
- **No `--dry-run` for Redis `query`** — write safety comes from the permission gate and key
  blacklist (matching reads/writes are rejected). To preview a delete, use `delete <key> --dry-run`.
- `database` is the logical DB index (default `0`). `dbcli blacklist add 'secrets:*'`
  registers a key glob; an optional `redis.mask` block masks values on read. Size guards
  (SCAN/HGETALL truncation, `--no-limit` to bypass) and masking details: reference.md Redis section.

## Elasticsearch

- `query` takes a DSL (JSON body) or Lucene query string; `--collection <index>` is required.
- **Supported:** `init`, `list` (indices with doc count), `schema [index]` (flattened mapping),
  `query`, `export` (v1.22), `shell` (v1.22), `status`, `use`, `doctor`. **Not supported:**
  `insert`, `update`, `delete`, `check`, `diff`, `migrate`.
- `export` takes a search DSL with `--index <index>`, or an index name as the query to scroll
  the whole index via `match_all`. Query-only caps at 1000 hits; `--no-limit` is bounded at 10 000.
- Schema flattens nested fields (`a.b.c`) and surfaces `.fields` multi-fields. `shell` opens a
  Kibana Dev Tools-style REPL. Full syntax and examples: reference.md Elasticsearch section.

## Saved queries

Run reusable parameterised snippets stored in your repo.

| Step | Command |
|------|---------|
| 1. Discover | `dbcli queries list` (or `queries search <keywords>` / `queries suggest <intent>`) |
| 2. Inspect | `dbcli queries show @<name>` |
| 3. Run     | `dbcli q @<name> --param k=v` (blacklist always enforced) |

Common intents: `perf.slow-query`, `perf.cache-hit`, `capacity.size`, `safety.connections`,
`monitor.cluster-health`.

Snippets resolve **local > shared > builtin** (local wins): `builtin` (bundled `@diag/*`,
read-only) / `.dbcli-shared/queries/` (team) / `.dbcli/queries/` (personal). Manage local
snippets with `queries new | edit | delete | rename | copy | import | export`. Each `.sql`
file declares YAML frontmatter inside `-- ---` blocks (name, description, engine, params, tags,
optional `intent`, optional `visual`).

Body format by `engine`:

| Engine            | Body format            | Notes |
|-------------------|------------------------|-------|
| postgres / mysql  | Single SELECT or WITH  | `:name` → driver bind (`$1` / `?`) |
| elasticsearch     | JSON DSL               | `:name` → JSON-aware substitution; `index:` field required |
| redis             | Single Redis command   | `:name` → raw text; **only read commands allowed** |

Mixed-family `engine` arrays (e.g. `[postgres, elasticsearch]`) are rejected at parse time.

### Built-in diagnostic snippets

Run with `dbcli q @diag/<topic>` (engine variant auto-picked by the active connection):

| key                     | purpose                                  |
|-------------------------|------------------------------------------|
| `@diag/connections`     | active sessions                          |
| `@diag/long-running`    | queries above `min_seconds` (`--param min_seconds=N`, default 30) |
| `@diag/table-sizes`     | table data/index size with row counts    |
| `@diag/index-usage`     | indexes by scan count                    |
| `@diag/missing-indexes` | tables dominated by sequential scans     |
| `@diag/locks`           | lock-wait chains                         |
| `@diag/db-size`         | database size summary                    |
| `@diag/cache-hit`       | buffer cache hit ratios                  |
| `@diag/es-cluster-health` | document counts per index (ES)         |
| `@diag/redis-key-stats`   | sample SCAN over keyspace (Redis)      |

## Interactive HTML dashboard

`query`, `q`, and `export` can render results as a standalone, self-contained HTML report
(bundled React + Recharts template).

```bash
dbcli query "SELECT day, dau FROM dau_daily" --ui          # open in browser
dbcli query "SELECT * FROM orders" --format html > out.html # pipe HTML to stdout
dbcli export "SELECT * FROM orders" --format html --output orders.html
```

`--ui` implies `--format html` and opens the file; `--format html` alone prints to stdout.
Blacklist redaction is applied **before** rendering. To get KPIs and charts instead of a plain
table, add a `visual:` block (`title`, `kpis[]`, `charts[]`) to the snippet frontmatter — see
reference.md for the full `visual:` schema. Raw `query` invocations render a sortable table only.

## Common workflows

- **Debug odd state:** `schema` → `check` → `query` with tight `WHERE` → follow FKs from schema JSON. Evidence over theory.
- **After INSERT/UPDATE:** follow the write sequence in **How to use dbcli** (`--dry-run` → run → `query` read-back); explain mismatches via triggers, defaults, or blacklist.
- **Migrations:** `diff --snapshot` → `migrate` (dry-run → `--execute`) → `diff --against` → `check` affected tables. DROP requires `--force`.
- **Health / growth:** `check --all` (huge tables skipped unless `--include-large`); consult schema `sizeCategory` before ad-hoc queries.
- **Codegen from live DB:** `schema --format json` to drive an ORM; cross-check once with `dbcli query`.
- **Integration truth:** `query` before → run app → `query` after. Unit-test mocks are not a substitute.
- **Natural language requests** (e.g. "update order to shipped"): pick `query` vs DML, map terms → columns via `schema` (and enum values in data), respect blacklist and `sizeCategory`, **always `--dry-run` writes first**.

## Notes

- Query-only mode auto-appends `LIMIT 1000`; add `--no-limit` for `information_schema` or statements that break with `LIMIT`.
- Blacklisted tables and columns are redacted from query output.
- `schema` reports `estimatedRowCount` and `sizeCategory` (small / medium / large / huge). For large/huge tables add `WHERE` or `LIMIT` — bands in reference.md.
- `doctor` on `mongodb+srv://` reports whether SRV resolves natively or through the DoH fallback — useful when the runtime restricts DNS.
- **Global flags:** `--config <path>`, `--use <name>`, `-v` / `-vv` / `-q`, `--no-color` (also honours `NO_COLOR`).
