# dbcli Comprehensive Documentation

<!-- doc-key: overview -->
`dbcli` is a security-first database CLI for both human developers and AI agents. It puts SQL (PostgreSQL, MySQL), NoSQL (MongoDB), Key-Value (Redis), and Search (Elasticsearch) databases behind one interface, with permission-based access control, sensitive-data blacklisting, and automated diagnostic workflows.

---

## Table of Contents

1.  [Core Philosophy & Security](#core-philosophy--security)
2.  [Getting Started](#getting-started)
3.  [Connection Management](#connection-management)
4.  [Command Reference](#command-reference)
    *   [Discovery & Exploration](#discovery--exploration)
    *   [Querying & Data Operations](#querying--data-operations)
    *   [Snippet Management (Saved Queries)](#snippet-management)
    *   [Health, Diagnostics & Recovery](#health-diagnostics--recovery)
    *   [Data Verification (snapshot, assert)](#data-verification)
    *   [Verification Artifact Inspector](#verification-inspect)
    *   [Local Observability Proxy](#proxy)
    *   [Advanced Tools (DDL, Shell, AI Skills)](#advanced-tools)
5.  [Interactive HTML Dashboards](#interactive-html-dashboards)
6.  [Database Engine Support Matrix](#database-engine-support-matrix)
7.  [AI Agent Integration & Antigravity Protocol](#ai-agent-integration)
8.  [Agent Recovery Workflow](#agent-recovery-workflow)
9.  [Documentation Maintenance & Coverage](#documentation-maintenance--coverage)

---

<!-- doc-key: core-philosophy -->
## Core Philosophy & Security

`dbcli` is built with a "Security-First" mindset, particularly focused on preventing AI agents from accidentally leaking or corrupting sensitive data.

*   **Permission Guard**: Four tiers of access control (`query-only`, `read-write`, `data-admin`, `admin`).
*   **Blacklist Manager**: Redacts sensitive tables and columns from all query results.
*   **Query Risk Analyzer (`plan`)**: Analyzes SQL risk without connecting to the database.
*   **Antigravity Protocol**: A workflow separation between **Architect** (Planning) and **Builder** (Execution) to ensure strategy precedes action.

---

<!-- doc-key: getting-started -->
## Getting Started

### Installation
```bash
npm install -g @carllee1983/dbcli
# or using Bun
bun install -g @carllee1983/dbcli
```

### Initializing a Connection
The `init` command guides you through setting up your first connection. It can automatically parse existing `.env` files.

Behind the scenes, `init` writes a small `version: 3` binding stub to `./.dbcli/config.json` in your project, while the real connection settings and any credentials are stored in your home directory at `~/.config/dbcli/projects/<project-name>-<sha1-12>/`. This keeps recoverable secrets out of the project workspace, so tools or AI agents that scan the repo never see them. The project `.dbcli/` only holds the binding plus non-sensitive caches (schema cache, audit log, snapshots, verification artifacts).

```bash
dbcli init
```

Use `--use-env-refs` to keep secrets out of the config file and read them from environment variables instead.

---

<!-- doc-key: connection-management -->
## Connection Management

`dbcli` supports multi-connection configurations (v2) so you can switch between Local, Staging, and Production environments.

*   **List all connections**: `dbcli use --list`
*   **Switch default connection**: `dbcli use <name>`
*   **One-shot override**: Use the `--use <name>` flag with any command.
    ```bash
    dbcli query --use staging "SELECT 1"
    ```

---

<!-- doc-key: command-reference -->
## Command Reference

<!-- doc-key: discovery-exploration -->
### Discovery & Exploration

| Command | Description |
| :--- | :--- |
| `list` | Lists tables, collections, keys, or indices. |
| `schema [table]` | Displays schema details for a specific object or scans the entire database. |
| `inspect` | Provides a read-only snapshot for AI agents (objects, permissions, suggestions). |
| `status` | Shows a safe summary of the current configuration (no credentials). |

#### `inspect` output for agents

`dbcli inspect` returns two parallel arrays so an agent can orient on the very first call:

*   **`suggestedCommands`** — executable next steps, ordered in three tiers:
    1.  *Bootstrap* — `dbcli schema --refresh` (when the schema cache is missing or stale) and `dbcli list --format json`.
    2.  *Context-aware* — driven by recent activity. When a hot table is detected in the audit log **and** task packs are available, it suggests `dbcli skill tasks plan analyze-table-perf --param table=<table>`, plus `dbcli queries suggest <intent>` from your snippet intents.
    3.  *Discovery* — `dbcli skill tasks list` (when task packs exist) and `dbcli doctor --format json`.
*   **`hints`** — human-readable, non-executable notes: the most-queried table from recent audit, the number of available task packs, and the schema-cache size with its last-refresh timestamp. In markdown output these render as a `## Hints` section.

Both arrays are trimmed under `--for-agent` / `--brief` (≤ 3 hints, and a single safest suggested command).

<!-- doc-key: query-data-operations -->
### Querying & Data Operations

| Command | Description |
| :--- | :--- |
| `query "<cmd>"` | Executes raw SQL, MongoDB JSON, Redis commands, or ES DSL. |
| `q @snippet` | Runs a parameterised saved query. Supports `--verify` for automated assertion loops. |
| `export` | Exports results to JSON, CSV, JSONL, or Interactive HTML. |
| `insert` | Inserts data from JSON (SQL & MongoDB). Accepts `--plan` for risk preflight (SQL, MongoDB, Redis, Elasticsearch). |
| `update` | Updates rows/documents with mandatory `--where` clause. Accepts `--plan` for risk preflight (SQL, MongoDB, Redis, Elasticsearch). |
| `delete` | Deletes data with mandatory `--where` clause. Accepts `--plan` for risk preflight (SQL, MongoDB, Redis, Elasticsearch). |
| `blacklist` | Manages the sensitive data redirection rules. |
| `plan "<sql>"` | **Static analyzer**: Classifies SQL risk and gives recommendations. |
| `lint "<sql>"` | **Static advisor**: Reports SQL anti-patterns and optional rewrite drafts without connecting to the database. |

#### DML `--plan` preflight

`insert`, `update`, and `delete` accept `--plan` to run a static risk analyzer against the planned write, **without connecting to the database**. The planner now supports SQL (`postgresql`, `mysql`, `mariadb`), MongoDB, Redis, and Elasticsearch.

*   The planner is static and planner-only: it never instantiates an adapter, never connects, and never refreshes schema.
*   It honors the connection's `permission`, `blacklist` rules, and the cached `schema` for the selected engine.
*   `--format text` (default) prints a human-readable verdict; `--format json` prints the full `QueryRiskResult`.
*   Analyzer `BLOCK` decisions still exit `0` — the verdict is what the agent reads, not the exit code. Configuration / engine / invalid-DSL errors exit `1`.
*   `--plan` is mutually exclusive with `--dry-run`.

Conservative MVP restrictions per engine:

| Engine | BLOCK examples | WARN examples |
| :--- | :--- | :--- |
| SQL | UPDATE/DELETE without WHERE, DDL, blacklisted table | Schema cache missing, blacklisted column referenced |
| MongoDB | Empty filter `{}`, update operator outside `$set`/`$unset`, `$where` | Filter without `_id`, broad `$in`/`$regex`/`$gte`, missing schema |
| Redis | Wildcard `*` target, blacklisted key/field | Pattern target (e.g. `user:*`), missing field info on update |
| Elasticsearch | update/delete without `_id`, blacklisted index/field | Insert without `_id`, missing schema |

`BLOCK` means the planner found an unsafe intent. Still run `--dry-run` on the real command before executing the write.

Examples:

```bash
dbcli insert users --data '{"name":"Alice","email":"a@b.com"}' --plan --format json
dbcli update users --where '{"_id":"abc"}' --set '{"status":"inactive"}' --plan
dbcli delete products --where '{"_id":"abc"}' --plan --format json
dbcli delete 'user:42' --where '' --plan --format json
```

<!-- doc-key: snippet-management -->
### Snippet Management

Saved queries (Snippets) allow you to store complex SQL in your repository. They resolve from three layers: **Local > Shared > Builtin**.

*   **List snippets**: `dbcli queries list`
*   **Search by keywords**: `dbcli queries search <text>`
*   **Suggest by intent**: `dbcli queries suggest perf`
*   **Create new local snippet**: `dbcli queries new @my/query --local`

<!-- doc-key: diagnostics-recovery -->
### Health, Diagnostics & Recovery

| Command | Description |
| :--- | :--- |
| `doctor` | Runs system and connection diagnostics. |
| `check [table]` | Analyzes data health (orphans, nulls, duplicates). |
| `diff` | Compares schema snapshots to detect changes. |
| `report` | Generates a comprehensive health/perf report. |
| `guide <goal>` | Generates a step-by-step troubleshooting plan (e.g., `slow-query`). |
| `recover --apply` | **Automated Recovery**: Applies the last suggested recovery plan. |
| `audit tail` | **Audit Log**: Tails `.dbcli/audit/<conn>.jsonl` (agent-facing JSONL). Use `--for-agent --n 10` for session-handoff JSON. |
| `--recovery` (supported commands) | **Bi-directional Recovery ↔ Audit Link**: `query`, `inspect`, `insert`, `update`, `delete`, `export`, `q`, `schema`, and `lint` all emit matching `audit.recovery_ref` ↔ `envelope.audit_ref` UUIDs on failure. Use `audit tail --recovery-ref <id>` to jump from an envelope to its audit entry. |

<!-- doc-key: data-verification -->
### Data Verification

Verify data-processing correctness — capture a result fingerprint, then assert invariants against it, a second query, or inline conditions. SQL engines only (PostgreSQL / MySQL / MariaDB).

| Command | Description |
| :--- | :--- |
| `snapshot <query>` | Captures a **result fingerprint** (row count + per-column null/distinct/min/max/sum + an order-independent checksum). Default file `.dbcli/snapshots/snap-<timestamp>.json`; also `--out`, `--rows`, `--stdout`. Blacklisted columns are masked at the source, so the snapshot is safe to store. Use as a baseline for `assert --against`. |
| `assert <query>` | Verifies an **invariant**; exits 1 on failure unless `--no-fail`. `--expect "rows>0 \| value==X \| col:c not null \| unique \| between a and b \| >= n"`, `--vs <query> --compare rows\|value` (reconcile two queries), `--against <snapshot> --tolerance <pct>` (drift vs a baseline; `0` = exact checksum). |

#### assert --write-verification-artifact

Persist a **result evidence record** (v1 VerificationArtifact JSON) to `.dbcli/verification/` whenever you need a durable audit trail for a read-back assertion. The verification artifact is always written to `<cwd>/.dbcli/verification/` (relative to the current working directory), regardless of where the `--config` file is located.

**Flag trio:**

| Flag | Required | Description |
| :--- | :--- | :--- |
| `--write-verification-artifact` | opt-in | Write a VerificationArtifact JSON after the assertion runs. |
| `--verification-subject <kind:name>` | yes (when flag is set) | Subject being verified. Allowed kinds: `recovery`, `task-pack`, `assertion`, `migration`, `backfill`, `manual`. |
| `--verification-summary <text>` | no | Human-readable summary line. Defaults: pass → "Assertion verified the expected state."; fail → "Assertion did not verify the expected state." |

**Output contract:**

- `--format json` — adds `verificationArtifactPath` to the `AssertVerdict` envelope.
- `--format table` — prints an extra `Verification artifact: <path>` line.
- Status follows assertion truth: `--no-fail` failures still record `not_verified` / evidence `exitCode: 1`.

**Planned vs Result evidence.** `dbcli skill tasks plan safe-backfill-verify` produces a plan JSON with a `verification` block whose `status` is `"planned"` — this is the **planned** evidence definition describing which check will run. The final `assert --write-verification-artifact` step produces **result** evidence (`status: verified` or `not_verified`). These are two different records; `"planned"` does **not** mean verification has run.

> **Note:** Cast bigint aggregates (`count(*)`, `sum()`) to `::int` so `value ==` compares numerically — Postgres returns bigint as a string, and `value ==` uses strict equality.

```bash
# 1. plan the workflow (plan-only, planned evidence)
dbcli skill tasks plan safe-backfill-verify \
  --param table=orders \
  --param query="UPDATE orders SET status = 1 WHERE status IS NULL" \
  --param verify_query="SELECT count(*)::int FROM orders WHERE status IS NULL" \
  --param expect="value == 0"

# 2. dry-run the write manually
dbcli update orders --where "status IS NULL" --set '{"status": 1}' --dry-run

# 3. execute the write under existing write permissions
dbcli update orders --where "status IS NULL" --set '{"status": 1}'

# 4. run the final assertion and persist RESULT evidence
dbcli assert "SELECT count(*)::int FROM orders WHERE status IS NULL" \
  --expect "value == 0" \
  --write-verification-artifact \
  --verification-subject backfill:safe-backfill-verify
```

> `dbcli verify` **runs** verification scenarios (safe-backfill, migration, rollback,
> constraint) and never executes writes/DDL. `dbcli verification` **inspects and manages** the local result
> artifacts those scenarios produce under `.dbcli/verification/`.

#### verify safe-backfill

Verify a safe backfill without ever executing the `UPDATE`. Preflight (default) runs
read-only guards and prints the exact after-write command; `--after-write` re-runs the
guards, runs the read-back assertion, and writes a verification artifact.

> ⚠️ `verify safe-backfill` never executes the backfill write. Run the approved write
> through your normal write command first, then run `--after-write`.

Preflight:

    dbcli verify safe-backfill \
      --table users \
      --query "UPDATE users SET status = 1 WHERE status IS NULL" \
      --verify-query "SELECT count(*)::int AS n FROM users WHERE status IS NULL" \
      --expect "value == 0"

After-write (writes the artifact):

    dbcli verify safe-backfill ... --after-write

Inspect the result: `dbcli verification show <artifact-id>`.

Preflight also echoes the **planned update** (the `--query` you must run yourself) so
the printed output is a complete, copy-pasteable record of the operation.

Result status: `verified` (read-back matched `--expect`), `not_verified` (read-back
contradicted `--expect`), `blocked` (a guard failed — blacklist, schema, plan, or a
non-read-only verify-query), `indeterminate` (the assertion ran but could not yield a
trustworthy verdict).

**Guard constraints (fail closed):**

- `--verify-query` must be a **plain `SELECT`**. `EXPLAIN` / `EXPLAIN ANALYZE`,
  `SHOW`, `DESCRIBE`, and data-modifying CTEs (`WITH … (DELETE … RETURNING) …`) are
  rejected — on PostgreSQL `EXPLAIN ANALYZE <write>` actually performs the write, so
  the read-back is restricted to statements that can never mutate data.
- The `--query` **UPDATE target must equal `--table`**, compared **schema-aware**
  (`public.users` does not satisfy `--table audit.users`). An `UPDATE` against any other
  table is blocked, so the read-back you assert on always matches the table you wrote.
- The persisted artifact stores only a **bounded, literal-free label** of the
  verify-query **and `--expect`** — string, numeric, and dollar-quoted (`$$…$$`)
  literals are stripped, so raw SQL and any embedded values are never written to disk.
- The printed after-write command is **shell-escaped**, so it stays correct even when
  the SQL contains quotes; it also carries through `--subject-name`, `--summary`, and a
  non-default `--format`.

> 💡 **Repeated backfills on the same table.** Artifacts default their subject name to
> the table (`backfill:<table>`). When you run multiple distinct backfills against the
> same table, pass `--subject-name <unique-label>` so each operation is independently
> traceable in `dbcli verification list`.

#### verify migration

Preflight or after-write verification for a schema migration. **This command never
executes DDL** — it analyzes the proposed `ALTER TABLE`, runs read-only guards, and
(in after-write mode) records evidence after you apply the migration externally.

> ⚠️ `verify migration` never executes DDL. Apply the migration externally first, then
> run `--after-write` to record evidence.

Preflight:

    dbcli verify migration \
      --table users \
      --ddl "ALTER TABLE users ADD COLUMN verified_at TIMESTAMPTZ" \
      --verify-query "SELECT count(*)::int AS n FROM users WHERE verified_at IS NOT NULL" \
      --expect "value == 0"

After the migration is applied externally:

    dbcli verify migration ... --after-write

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

**Supported `ALTER TABLE` target identifiers.** The target may be `table`,
`schema.table`, or `catalog.schema.table`. Each segment may be a simple unquoted
name (`[A-Za-z_][A-Za-z0-9_]*`) or a quoted identifier — double-quoted (`"…"`),
backtick-quoted (`` `…` ``), or bracket-quoted (`[…]`) — so names with spaces or
hyphens such as `"user accounts"` or `"tenant-1"."orders"` are accepted. Targets
that cannot be fully parsed under this contract (unterminated quotes, unsupported
escapes, or more than three parts) are **blocked before** the after-write
assertion, with a reason that says the target could not be parsed — distinct from
the `must match --table` mismatch reason.

#### verify rollback

Preflight or after-write verification for a rollback you apply externally — either
reverting a schema migration (`--kind ddl`) or reverting a data change
(`--kind dml`). **This command never executes the reverting statement** — it
analyzes the proposed `--statement`, runs read-only guards, and (in after-write
mode) records evidence after you apply the rollback yourself.

> ⚠️ `verify rollback` never executes the rollback statement. Apply the rollback
> externally first, then run `--after-write` to record evidence.

Schema rollback preflight (`--kind ddl`, a single `ALTER TABLE`):

    dbcli verify rollback \
      --kind ddl \
      --table users \
      --statement "ALTER TABLE users DROP COLUMN verified_at" \
      --verify-query "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'verified_at'" \
      --expect "value == 0"

Data rollback preflight (`--kind dml`, a single `UPDATE`):

    dbcli verify rollback \
      --kind dml \
      --table users \
      --statement "UPDATE users SET status = NULL WHERE status = 9" \
      --verify-query "SELECT count(*)::int AS n FROM users WHERE status = 9" \
      --expect "value == 0"

After the rollback is applied externally:

    dbcli verify rollback --kind <ddl|dml> ... --after-write

| Option | Required | Description |
| --- | --- | --- |
| `--kind <ddl\|dml>` | yes | Reverting-statement kind: `ddl` (a single `ALTER TABLE`) or `dml` (a single `UPDATE`). |
| `--table <table>` | yes | Table affected by the rollback. |
| `--statement <sql>` | yes | Proposed reverting statement, analyzed but never executed. |
| `--verify-query <sql>` | yes | Plain `SELECT` for post-rollback read-back verification. |
| `--expect <expr>` | yes | Assertion expression for the read-back result. |
| `--after-write` | no | Run the post-rollback assertion and write a v1 artifact. |
| `--format <table\|json>` | no | Output format, default `table`. |
| `--subject-name <name>` | no | Artifact subject name. Default is the table name. |
| `--summary <text>` | no | Optional artifact summary override. |

`--kind` selects which grammar the statement must satisfy and reuses the same
guards as the sibling scenarios: `ddl` reuses the `verify migration` `ALTER TABLE`
contract (single statement, target must match `--table`); `dml` reuses the
`verify safe-backfill` plan contract (`UPDATE` only, must have a `WHERE`, target
must match `--table`). Preflight returns `ready` or `blocked`; **`ready` is not
`verified`**. After-write maps the read-back assertion to `verified` /
`not_verified` / `indeterminate`, and a failed guard to `blocked`. The artifact
records the rollback under the existing subject kind (`migration` for `ddl`,
`backfill` for `dml`) with `command: verify rollback`. The MVP supports a single
`ALTER TABLE` for `ddl` and a single `UPDATE` for `dml`; `INSERT`/`DELETE` reverts
are not yet supported.

#### verify constraint

Preflight or after-write verification that a **data-integrity invariant holds** across
your change — foreign-key consistency, NOT NULL coverage, uniqueness, or a custom
violation query. **This command never executes a write** — it only runs read-only
`COUNT(*)` violation queries and (in after-write mode) records evidence.

> ⚠️ `verify constraint` never executes a write or DDL statement. Run preflight before
> your change, then run `--after-write` afterward to record evidence.

Four check kinds, selected by `--check`:

- `fk` — counts orphaned rows (child column has no matching parent). Requires `--column`
  and `--references <table.column>`.
- `not-null` — counts NULL values in the column(s). `--column` is repeatable.
- `unique` — counts duplicate values across the column(s). `--column` is repeatable.
- `custom` — executes your `--violation-query <sql>` (a read-only `SELECT` returning a
  single integer count of violations).

FK preflight (verify no orphaned orders before a migration):

    dbcli verify constraint \
      --table orders \
      --check fk \
      --column customer_id \
      --references customers.id

NOT NULL preflight (verify the column is fully populated):

    dbcli verify constraint \
      --table users \
      --check not-null \
      --column email

After the change is applied externally:

    dbcli verify constraint --table orders --check fk --column customer_id \
      --references customers.id --after-write

| Option | Required | Description |
| --- | --- | --- |
| `--table <table>` | yes | Table the invariant is checked on. |
| `--check <kind>` | yes | Constraint kind: `fk` \| `not-null` \| `unique` \| `custom`. |
| `--column <name>` | yes (fk/not-null/unique) | Column to check. Repeatable for `not-null`/`unique`; the child FK column for `fk`. |
| `--references <table.column>` | yes (fk only) | Referenced `<table>.<column>` for FK parent lookup. |
| `--violation-query <sql>` | yes (custom only) | Read-only `SELECT` returning a single integer violation count. |
| `--allow-preexisting` | no | No-regression mode: verified when `count ≤ --baseline`. |
| `--baseline <n>` | no | Baseline violation count from preflight (use with `--allow-preexisting`). |
| `--after-write` | no | Re-run the violation count and write a v1 artifact. |
| `--format <table\|json>` | no | Output format, default `table`. |
| `--subject-name <name>` | no | Artifact subject name. Default is the table name. |
| `--summary <text>` | no | Optional artifact summary override. |

Preflight returns `ready` or `blocked`; **`ready` is not `verified`**. After-write maps
the count to `verified` (violations ≤ threshold) or `not_verified` (violations >
threshold). The default threshold is `0` (strict). With `--allow-preexisting`, the
threshold is the `--baseline` count from preflight — verified as long as violations do
not exceed the pre-existing level. A query error yields `indeterminate`; a failed guard
yields `blocked`. The artifact uses `subject.kind = 'table'` and
`command: verify constraint`. MVP: SQL engines only; single FK column; never executes
writes.

<!-- doc-key: verification-inspect -->
### verification — inspect & manage verification artifacts

`dbcli verification` works on artifacts written under `<cwd>/.dbcli/verification/`.
It never connects to a database and never writes audit entries. `list`, `show`,
and `summary` are read-only filesystem inspection; `prune` is a local lifecycle
command that is dry-run by default and deletes files only with `--execute --force`.
The storage root is the current working directory, independent of `--config`.

- `dbcli verification list [--format json|table] [--limit <n>] [--status <status>] [--subject <kind[:name]>] [--include-invalid]`
  — list artifacts latest-first.
- `dbcli verification show <id-or-path> [--format json|table]`
  — print one artifact by exact id, unique id prefix, filename, or in-bounds path.
- `dbcli verification summary [--format json|table] [--status <status>] [--subject <kind[:name]>] [--latest-only]`
  — latest status, status counts, invalid count, and per-subject breakdown. `--latest-only` narrows to the latest matching valid artifact plus status counts (the `subjects` breakdown is omitted); missing artifacts return exit `0` with `latest: null`.
- `dbcli verification prune --older-than <Nd> [--format json|table] [--keep-latest <n>] [--status <status>] [--subject <kind[:name]>] [--include-invalid] [--execute --force]`
  — preview (dry-run) or delete local artifact files by retention criteria.

Statuses: `verified`, `not_verified`, `indeterminate`, `blocked`.
Subject kinds: `recovery`, `task-pack`, `assertion`, `migration`, `backfill`, `manual`.

A missing `.dbcli/verification/` directory returns an empty result and exits `0`.
Malformed files are skipped during `list`/`summary` (surfaced via `--include-invalid`
and the `summary` invalid count); selecting a malformed file with `show` exits `1`.

`prune` is dry-run by default. `--keep-latest` (default 20) always protects the
newest N **valid** artifacts across all subjects and statuses **before** the
`--status`/`--subject` filters are applied. `prune` deletes files only when both
`--execute` and `--force` are given, and only regular `verification-*.json` files
inside `.dbcli/verification/`; execute-mode table output lists each deleted and
skipped file.

```bash
dbcli verification summary --format json
dbcli verification list --status verified --subject backfill:safe-backfill-verify
dbcli verification show ver_abcd --format json
dbcli verification prune --older-than 30d --format json
dbcli verification prune --older-than 30d --keep-latest 20 --execute --force
```

<!-- doc-key: proxy -->
### dbcli proxy — Local Observability Proxy

A local development observability proxy — point an existing application at the proxy port and `dbcli` relays every query to the real database while recording query text, latency, byte counts, row counts, and error events. **This is NOT a production gateway.** Use it during local development only.

#### Quick Start

```bash
# Explicit upstream/downstream
dbcli proxy mysql --listen 127.0.0.1:3307 --target 127.0.0.1:3306
dbcli proxy postgresql --listen 127.0.0.1:5433 --target 127.0.0.1:5432

# Infer engine + target from a named connection
dbcli proxy --use local --listen 127.0.0.1:3307
```

Change your application's DB host/port to the `--listen` address and leave credentials unchanged. The proxy is fully transparent — the application behaves identically.

#### Options

| Option | Default | Description |
| :--- | :--- | :--- |
| `--listen` | — | Local address to bind (e.g. `127.0.0.1:3307`). Required. |
| `--target` | — | Upstream DB address. Required unless `--use` is given. |
| `--events` | `.dbcli/proxy/events.jsonl` | Path to the append-only JSONL event log. |
| `--slow-ms` | `1000` | Queries whose `durationMs` reaches this threshold are flagged `slow: true` in the `query_completed` event (and a terminal warning is printed). |
| `--redact` | `none` | `none` keeps SQL text as-is; `literals` masks string and number literals. |
| `--format` | `text` | Console output format: `text` or `json`. |

#### Event Log (JSONL)

Each completed query appends one JSON object to the event log:

```json
{"version":1,"type":"query_completed","timestamp":"2026-06-04T12:00:00.000Z","engine":"mysql","sessionId":"pxy_1","queryId":"qry_pxy_1_1","client":"127.0.0.1:54321","target":"127.0.0.1:3306","sql":"SELECT * FROM users WHERE id = ?","statement":"SELECT","tables":["users"],"durationMs":4,"requestBytes":42,"responseBytes":318,"rowCount":1,"error":null,"tags":[]}
```

#### Privacy

SQL text is always stored in the event log. **Result rows are never stored.** Use `--redact literals` to mask string and number literals in SQL before logging (e.g. `WHERE id = ?` instead of `WHERE id = 42`).

#### Analyze the event log offline

`dbcli proxy analyze` — analyze the captured event log offline (no DB). `--format json|text`, `--top`, `--slow-ms`, `--n-plus-one`, `--no-include-rotated`. Produces summary, per-fingerprint stats (with suggested `explain` / `guide missing-index-for` commands), slowest queries, error groups, hot tables, and N+1 suspects.

#### Limitations (v1)

- **TLS**: TLS is relayed but not decrypted in v1. Encrypted sessions still produce session and byte-count events, but no SQL is parsed or visible — disable SSL for local analysis sessions when you need query visibility.
- **MySQL prepared/binary protocol**: Best-effort parsing; tagged `prepared_statement`.
- **PostgreSQL extended query protocol**: Best-effort parsing; tagged `extended_protocol` or `parse_partial`.

<!-- doc-key: advanced-tools -->
### Advanced Tools

| Command | Description |
| :--- | :--- |
| `shell` | Launches an interactive REPL with auto-completion and SQL highlighting. |
| `migrate <action>` | **DDL Engine**: CREATE/ALTER/DROP tables and indexes. |
| `skill --install` | Installs `SKILL.md` instructions for AI agents (Claude, Gemini, Antigravity, etc.). |
| `skill context` | Serializes cached schema, connections, and saved queries into LLM-optimized XML/JSON/Markdown for AI prompt injection. |
| `skill tasks` | Manages "Task Packs" — repeatable expert database workflows. |
| `completion` | Installs shell auto-completion for bash/zsh/fish. |

### Shell completion

`dbcli completion <bash|zsh|fish>` prints a completion script; `dbcli completion --install`
installs it. Installed completions cover **nested subcommands** — for example
`dbcli queries list --<TAB>`, `dbcli migrate add-column --<TAB>`, and
`dbcli verify safe-backfill --<TAB>`. They keep the leaf command scope after
option values or positional arguments, such as `dbcli queries list --format json --<TAB>`.

Inside `dbcli shell`, command completion follows the current command surface, so newly
added commands (`q`, `queries`, `inspect`, `verify`, `proxy`, `snapshot`, …) complete and
dispatch automatically.

`dbcli completion --install` is marker-managed: it writes a single managed block to your
shell rc file and re-running it replaces that block rather than duplicating it.

> **Builtin task pack `analyze-table-perf`.** A read-only (`plan-only`) pack that takes a required `table` parameter and walks `blacklist list` → `schema <table> --format json` → `guide index-usage --format json`. `dbcli inspect` suggests it automatically for the hottest table in recent activity. Other read-only packs ship too — `audit-permissions`, `safe-backfill`, `schema-drift-review`, and `connection-health`. Browse all packs with `dbcli skill tasks list`.

> **`safe-backfill-verify` task plan and the `verification` block.** Running `dbcli skill tasks plan safe-backfill-verify --format json` returns a plan JSON that includes a `verification` block with `status: "planned"`. This block describes the read-back assertion that will be run — it is the **planned** evidence definition, **not** a result. A `status` of `"planned"` does **not** mean verification has run or passed; it means the task plan knows which check to perform when the task executes.

---

<!-- doc-key: html-dashboards -->
## Interactive HTML Dashboards

Use the `--ui` flag to open query results in an interactive React dashboard in your browser.

```bash
dbcli query "SELECT * FROM daily_metrics" --ui
```

**KPIs & Charts**: Add a `visual:` block to your snippet's frontmatter to render custom charts and KPIs directly in the dashboard. Supported chart types are `line`, `bar`, `area`, and `pie`; any other type is rejected at parse time.

---

<!-- doc-key: engine-support -->
## Database Engine Support Matrix

| Feature | PostgreSQL/MySQL | MongoDB | Redis | Elasticsearch |
| :--- | :---: | :---: | :---: | :---: |
| Basic Querying | ✅ | ✅ | ✅ | ✅ |
| Schema Caching | ✅ | ✅ | ❌ | ✅ |
| Saved Snippets | ✅ | ✅ | ✅ | ✅ |
| DML (Insert/Update) | ✅ | ✅ | ✅ (via query) | ❌ |
| DDL (Migrate) | ✅ | ❌ | ❌ | ❌ |
| Interactive UI | ✅ | ✅ | ✅ | ✅ |
| Query Size Guard | ✅ | ✅ | ⚠️ (rewrite + truncate) | ✅ |
| Blacklist Enforcement | ✅ | ✅ | ⚠️ (key globs) | ⚠️ |
| Interactive Shell (`shell`) | ✅ | ✅ | ✅ (single-line) | ⚠️ (Kibana-style) |

### MongoDB write planner (operator tiers)

| Tier | Operators | Plan outcome |
|---|---|---|
| SAFE | `$set`, `$unset` | `ALLOW` |
| RENAME | `$rename` | `WARN` (informational; rename does not exfiltrate data) |
| ARITHMETIC | `$inc`, `$mul`, `$min`, `$max`, `$currentDate` | `WARN` |
| ARRAY | `$push`, `$pull`, `$pullAll`, `$pop`, `$addToSet` | `WARN` |
| BITWISE | `$bit` | `WARN` |
| BLOCK | `$where`, unknown operator | `BLOCK` |

Run `dbcli update --dry-run` to view the plan before executing.

### MongoDB nested blacklist

The dbcli config `blacklist.columns[<collection>]` accepts dotted paths and one trailing wildcard:

```json
{
  "blacklist": {
    "columns": {
      "users": ["password", "profile.email", "profile.tokens.*"]
    }
  }
}
```

`profile.tokens.*` covers `profile.tokens` and every descendant. Wildcards anywhere other than the final segment are skipped with a warning at `dbcli blacklist list`. SQL connections ignore entries containing `.` or `*`.

Note: streaming exports (`dbcli export`) buffer rows before masking. For very large exports, prefer narrower filters until streaming-aware masking is added.

### MongoDB schema sampling

`dbcli schema <collection> [--sample-size 100] [--sample-method random|natural]`

- `random` (default) uses `$sample`; falls back to natural order on driver error.
- Output columns include nested dot-paths with `presence` (0..1) and `redacted: true` for blacklist hits.

### MongoDB saved queries

Snippet locations: `assets/snippets/` (built-in), `.dbcli-shared/queries/` (shared), `.dbcli/queries/` (local). Mongo snippets:

- File name ends in `.mongodb.sql`.
- Frontmatter must declare `engine: mongodb` and `operation: find` or `operation: aggregate`. `target: <collection>` provides a default that CLI `--collection` can override.
- Body is JSON: object for `find`, array for `aggregate`. Each `{{param}}` placeholder is JSON-encoded — strings are quoted and escaped, so injected operator-shaped strings cannot escape into operator position.

Run with `dbcli q @<key>`.

### Redis: size guard, blacklist, and shell (v1.21.0)

**Size guard** — unbounded reads are bounded automatically:

- `SCAN` / `HSCAN` / `SSCAN` / `ZSCAN` get `COUNT 1000` injected (or a larger `COUNT` capped).
- `LRANGE` / `ZRANGE` / `ZREVRANGE` clamp the `stop` index so the span is ≤ 1000; `ZRANGEBYSCORE` gets `LIMIT 0 1000`.
- `HGETALL` / `HKEYS` / `HVALS` / `SMEMBERS` / `KEYS` are truncated to 1000 entries.

Results carry a `warnings[]` array: `REDIS_SIZE_REWRITE` when arguments were rewritten, `REDIS_SIZE_TRUNCATE` when the reply was trimmed. Pass `--no-limit` (CLI) or run `.no-limit on` (shell) to bypass.

```bash
dbcli query "LRANGE jobs 0 -1"          # capped to 1000 → REDIS_SIZE_REWRITE
dbcli query "HGETALL bighash" --no-limit  # full reply, no truncation
```

**Blacklist** — rules are enforced as Redis-native key globs (`*`, `?`, `[abc]`, `[a-z]`):

```bash
dbcli blacklist table add 'secrets:*'
dbcli query "GET secrets:api_key"   # rejected (BlacklistRejection); audited with matched_pattern
dbcli query "KEYS secrets:*"        # rejected (pattern overlaps a rule)
dbcli list                           # blacklisted keys filtered out
```

**Masking (v1.22)** — where the key-glob blacklist *rejects*, masking instead *redacts*: matched reads return `[REDACTED]` so an agent can still run the command without ever seeing the sensitive value. Add an optional `redis.mask` block to your dbcli config:

```json
{
  "redis": {
    "mask": [
      { "keyPattern": "user:*", "fields": ["password", "token"] },
      { "keyPattern": "secret:*" }
    ]
  }
}
```

- `keyPattern` is a Redis-native glob (`*`, `?`, `[abc]`). Each rule applies to keys it matches.
- `fields` present → only those hash fields are redacted (`HGETALL`, `HGET`, `HMGET`).
- `fields` absent → the whole value is redacted (`GET`, `GETRANGE`, and every field of a hash).
- Masking covers `GET` / `GETRANGE` / `HGETALL` / `HGET` / `HMGET` / `HVALS`.
- **Rejection wins over masking:** if a key matches both a `blacklist` rule and a `mask` rule, the command is rejected outright — it never reaches masking.

```bash
dbcli query "GET secret:api_key"   # → { "value": "[REDACTED]" }
dbcli query "HGETALL user:1"        # → password/token redacted, other fields intact
```

**Shell** — `dbcli shell` on a Redis connection opens a single-line REPL with history, tab completion (commands + key prefixes), and a `.no-limit on/off` toggle. Type commands directly, no trailing semicolon (e.g. `GET mykey`).

### Elasticsearch: interactive shell (v1.22.0)

`dbcli shell` on an Elasticsearch connection opens a dedicated Kibana Dev Tools-style REPL. Enter a request line `<METHOD> /<path>`, then an optional multi-line JSON body, and submit the whole block with a **blank line**. Responses render as pretty-printed JSON.

```text
es> GET /_cat/indices
        (blank line submits)

es> POST /users/_search
... {
...   "query": { "match_all": {} }
... }
        (blank line submits)
```

- **Read-focused.** Index-level blacklist rejects protected indices up front, and any `_search` request whose body lacks an explicit `size` is auto-capped at **1000** hits.
- A **blank line** submits the current block; **Ctrl+C** cancels the in-progress block; **Ctrl+D** or typing `exit` / `quit` leaves the shell.

### Elasticsearch: export (v1.22.0)

`dbcli export` on an Elasticsearch connection writes documents to JSON, JSONL, or CSV. It accepts two forms:

```bash
# 1. Export the hits of a search DSL — requires --index
dbcli export '{"query":{"match":{"status":"open"}}}' --index orders --format json

# 2. Export a whole index via match_all + scroll — pass the index name as the query
dbcli export orders --format jsonl --output orders.jsonl
```

- **Capped at 1000 rows** by default. Pass `--no-limit` to export the full index (the full-index form streams in scroll batches).
- The target index is checked against the **index-level blacklist** before any documents are read.
- Each export writes an **audit entry** recording the target index, row count, and output format.

---

<!-- doc-key: ai-agent-integration -->
## AI Agent Integration

`dbcli` is designed to be the "DB driver" for AI agents.

1.  **SKILL.md**: Provide the agent with the `SKILL.md` (via `dbcli skill`) so it knows the safe command paths.
2.  **Recovery Envelopes**: When a command fails, use `--recovery` to get a machine-readable JSON error with a suggested fix.
3.  **Risk Gating**: Agents use `dbcli plan`, the per-command `--plan` preflight on `insert`/`update`/`delete`, and `--dry-run` to verify their actions before committing changes.
4.  **Context Efficiency**: `inspect --for-agent` provides exactly the metadata the agent needs to orient itself without bloating its context window.
5.  **Audit Log**: see [`SKILL.md`](../../../assets/SKILL.md) / [`README §Audit Log`](../../../README.md#audit-log).
6.  **AI Collaboration Prompting**: `dbcli skill context` serializes connection, schema cache, and saved query metadata into a highly-compressed, token-optimized XML, Markdown, or JSON structure designed specifically for AI prompt insertion.
7.  **Self-Verification Loops**: Snippets can define `verify` frontmatter metadata (specifying a `query` and LHS-Operator-RHS `expects` assertions). Running a query with `dbcli q @name --verify` automatically executes the primary command, runs the verification query, and validates assertions against the returned dataset.
8.  **Agent Plugin**: the repo root follows the Ponytail-style plugin layout with `.agents/plugins/marketplace.json`, `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.github/skills/dbcli/`, and `skills/dbcli/`. If `dbcli` is not globally installed, the skill uses `bunx @carllee1983/dbcli <command>` as the fallback command prefix. See `plugins/dbcli-agent/INSTALL.md` for Codex, Claude Code, GitHub Copilot CLI, Antigravity, and Cursor install commands, including Cursor marketplace review/indexing steps.

---

<!-- doc-key: developer-workflows -->
## Developer Workflows

Beyond ad-hoc queries, `dbcli` is built for the common development tasks where a database is involved. The agent skill ([`SKILL.md`](../../../assets/SKILL.md)) ships a compact router for these; the same scenarios apply when you drive `dbcli` yourself:

- **DB-backed feature**: map product/code terms to real objects before editing code (`inspect --for-agent` → `blacklist list` → `schema <object>` → `queries suggest <intent>`).
- **Application data bug**: separate stored facts from application-code inference (`inspect --for-agent` → `audit tail --for-agent` → `schema <object>` → a narrow query).
- **ORM or migration work**: ground model and migration edits in live schema evidence (`schema` → `diff --snapshot` → generate DDL via `migrate add-index`/`add-column` → `diff --against`).
- **PR database review**: check query, write, migration, export, fixture, and blacklist risk in the changed persistence paths.
- **Slow endpoint or query**: prefer read-only diagnostics before proposing indexes (`report --section perf` → `lint "<query>"` → `guide missing-index-for "<query>"`; `proxy analyze` when logs exist).
- **Safe data backfill**: scope affected rows and preview mutations before execution (`schema` → count/scope query → `update ... --dry-run` → read-back or snippet `--verify`).
- **Environment validation**: check config shape and connectivity without leaking secrets (`status` → `doctor` → `inspect --for-agent --no-connect`).

All of these inherit the standard safety rules: prefer `--format json`, run `blacklist list` before touching sensitive data, confirm names with `schema`, dry-run writes, and never print credentials or blacklisted values.

---

<!-- doc-key: usage-scenarios -->
## Usage Scenarios

The Developer Workflows above are the *minimum safe paths*. This section maps concrete situations to an exact command path, grouped by how you arrive at them: a **named task** (prefer a published pack), a **cross-cutting operational need**, or an **engine-specific** job. Everything here inherits the safety baseline (`blacklist list` → `schema` → dry-run writes).

### A. Task-pack scenarios (prefer published packs over improvised steps)

When a request matches a named workflow, discover and plan with a pack instead of inventing steps from memory. All packs are read-only `plan-only` and still inherit the blacklist → schema → dry-run rules.

```bash
dbcli skill tasks list --format json                       # discover packs
dbcli skill tasks plan <pack> --param k=v --format json    # generate an ordered, risk-labelled plan
```

| Situation (what the user says) | Path | Pack |
| --- | --- | --- |
| "This SQL is slow" (you have the statement) | `skill tasks plan diagnose-slow-query --param query="<SQL>"` → `lint "<SQL>"` → `guide missing-index-for "<SQL>"` | `diagnose-slow-query` |
| "Table X is hot / heavy" (you have the table) | `skill tasks plan analyze-table-perf --param table=<table>` | `analyze-table-perf` |
| "This API endpoint is slow" | `skill tasks plan slow-endpoint-investigation --param query="<SQL>"` (pairs `proxy` + `explain` + missing-index) | `slow-endpoint-investigation` |
| Whole-environment perf scan | `report --section perf` → `guide slow-query` | _(report + guide, no pack)_ |
| "Audit access before granting writes" | `skill tasks plan audit-permissions` (optional `--param table=<table>` to spot-check column coverage) | `audit-permissions` |
| "Does the live schema match the committed cache?" | `skill tasks plan schema-drift-review --param table=<table>` | `schema-drift-review` |
| "Is the connection healthy?" | `skill tasks plan connection-health` | `connection-health` |
| "Review this DB-touching PR" | `skill tasks plan pr-database-review`; run any DDL/index idea through `migration-review` before writing | `pr-database-review` / `migration-review` |
| "Backfill column X safely" | `skill tasks plan safe-backfill-verify --param table=<t> --param query="<UPDATE>" --param verify_query="<SELECT count(*)>"` | `safe-backfill` / `safe-backfill-verify` |

Packs resolve **local > shared > builtin**: `assets/tasks/` (builtin), `.dbcli-shared/tasks/` (team), `.dbcli/tasks/` (local override). A plan never overrides blacklist, schema, dry-run, or confirmation requirements — execute its steps one at a time.

### B. Cross-cutting scenarios

- **Switch between environments (v2)**: `dbcli use prod` changes the default; `dbcli query --use staging "<SQL>"` overrides for one call only. Each named connection has its **own schema cache** at `.dbcli/schemas/<conn>/` — run `dbcli schema --use <name>` once after switching, or you may read another connection's columns. (See **Connection Management**.)
- **Reference env vars for secrets in CI**: connection settings already live in home storage (`~/.config/dbcli/…`), never in the project `.dbcli/`. `dbcli init --use-env-refs` goes further and stores `{ "$env": "VAR" }` references resolved at runtime instead of any plaintext. In a non-interactive run you **must** pass all five `--env-*` flags or `init` errors out — it never silently falls back to plaintext.
- **Verify an invariant or write outcome**: `snapshot` captures a baseline → `assert --against <snap> --tolerance <pct>` compares; `q @name --verify` runs snippet assertions; `recover --apply --write-verification-artifact` persists secret-free evidence. (See **Data Verification**.)
- **Spot N+1 / slow queries in local dev**: run the app through `dbcli proxy <engine> --listen ... --target ...` to capture events, then `dbcli proxy analyze` aggregates them offline into N+1, slowest-query, and hot-table findings. (See **dbcli proxy**.)

### C. Engine-specific scenarios

- **MongoDB**: schema is `$sample`-based (dot-paths carry `presence` / `redacted`); blacklist accepts dotted paths and trailing wildcards (`profile.tokens.*`). Writes auto-wrap as `$set` unless an explicit operator (`$inc` / `$push` / …) is present.
- **Redis**: `q @snippet` runs **read-only** commands only; `delete` covers `DEL` / `HDEL` / `LREM` / `SREM` / `ZREM` (needs `data-admin`); protect keys with a glob blacklist (`secrets:*`) plus optional value masking. There is no `--dry-run` on `query` — safety is the permission gate; preview a delete with `delete <key> --dry-run`.
- **Elasticsearch**: query with a DSL body or Lucene string (`--collection <index>`); `export` a whole index via `match_all` scroll; `shell` opens a Kibana Dev Tools-style REPL.

---

<!-- doc-key: agent-recovery-workflow -->
## Agent Recovery Workflow

> This section covers the three most common scenarios and the shared flow only. The full error-code matrix, multi-turn `--next` semantics, risk-gate details, and the Audit ↔ Envelope pivot live in [`assets/reference.md` Recovery Cookbook](../../../assets/reference.md#recovery-cookbook-agent-walkthroughs).

When any of `query` / `q` / `insert` / `update` / `delete` / `export` / `schema` / `inspect` / `lint` is invoked with `--recovery` and fails, a `RecoveryEnvelope` JSON is printed to stdout **and atomically written** to `.dbcli/last-recovery.json`. The agent then inspects it with `dbcli recover` or executes it automatically with `dbcli recover --apply` (which by default only runs `readonly` + `dry-run` steps).

### Scenario 1 — Connection refused (`CONN_REFUSED`)

```bash
# 1. Failing call writes the envelope to stdout and .dbcli/last-recovery.json
dbcli query "SELECT 1" --recovery --format json
# → error.code = CONN_REFUSED
#   recovery: [doctor --format json, inspect --for-agent]
#   verify:    doctor --format json

# 2. Both steps are readonly, so the default gate lets them through
dbcli recover --apply --format json
# → finalStatus=ok, verifyStatus=passed → connection restored
```

### Scenario 2 — Blacklist block (`BLACKLIST_TABLE`)

```bash
dbcli query "SELECT * FROM audit_logs" --recovery
# → error.code = BLACKLIST_TABLE
#   recovery: [blacklist list (readonly), blacklist table remove audit_logs (write)]

# Default --apply runs step 1; step 2 mutates the local blacklist, so the gate skips it → exit 3
dbcli recover --apply

# Confirm the unmask is intentional, then open the local-write tier (still does NOT touch the database)
dbcli recover --apply --allow-write=readonly-cmd
```

### Scenario 3 — Schema cache missing (`SCHEMA_CACHE_MISSING`)

```bash
# Most common on a fresh checkout or right after switching to a new v2 named connection
dbcli inspect --require-schema-cache --recovery --format json
# → error.code = SCHEMA_CACHE_MISSING
#   recovery: [schema --refresh --force]
#   verify:    inspect --format json (checks schemaCache.available === true)

dbcli recover --apply
# For v2 multi-connection setups the envelope already includes --use <name>;
# each connection has its own cache at .dbcli/schemas/<connection>/.
```

### Multi-turn mode — for agents with their own runner

Use `--next` instead of `--apply` when the plan contains an `interactive` step, or when the agent wants to inspect each step individually:

```bash
# Agent executes step 1 itself, reports the result, asks dbcli for step 2
dbcli recover --next --after-step 1 --result '{"status":"ok","exitCode":0}'

# For large outputs, pass a file (StepResultSummary JSON; stdout/stderr are each capped at the last 4 KB)
dbcli recover --next --after-step 2 --result @/tmp/r2.json

# When the plan completes, dbcli returns kind: "done".
# Note: --next does NOT run verify automatically — re-issue the original failing
# command once the plan is done to confirm recovery.
```

#### Branching for connection errors

For connection-class errors (`CONN_REFUSED`, `CONN_AUTH_FAILED`, `CONN_TIMEOUT`, `CONN_HOST_NOT_FOUND`, `CONN_UNKNOWN`), the envelope ships an additional `branches` map and a `branchFork` descriptor. After running step 1 (`dbcli doctor --format json`) the agent passes its output via `--result`; `dbcli recover --next` reads the doctor JSON, picks one of four labeled branches (`doctor-clean`, `doctor-config-missing`, `doctor-auth-error`, `doctor-network-error`), and returns the matching branch's first step. The response sets `branchId` and `branchDescription` so the agent can echo `--branch <id>` on subsequent `--next` calls.

| Flag | Behavior |
| :--- | :--- |
| `--branch <id>` | Walk a specific branch by id. Required on all `--next` calls after the fork. |

If the doctor JSON cannot be parsed or no keyword matches, `--next` falls back to the linear `recovery` plan — branching never causes `--next` to fail. `--apply` continues to walk `recovery` linearly and ignores `branches`.

### Audit ↔ Envelope pivot

Every `--recovery` failure writes a UUID link in both directions:

```bash
# Envelope → audit entry (forensic lookup on a saved failure)
dbcli audit show --recovery-ref "$(jq -r '.id' .dbcli/last-recovery.json)"

# Audit entry → envelope (you have an audit hit, want the structured plan)
dbcli audit tail --for-agent --n 1   # read recovery_ref from the latest entry
dbcli recover --from /path/to/archived.json   # cross-machine / archived replay
```

### `recover --apply` exit-code cheat sheet

| Exit | Meaning |
| :--- | :--- |
| `0` | All steps succeeded (and verify, if present, passed) |
| `1` | A step failed |
| `2` | Envelope missing, unreadable, or malformed |
| `3` | Every step was skipped by the gate — widen `--allow-write` or fill placeholders, then retry |

### Persisting a verification artifact (opt-in)

Pass `--write-verification-artifact` to `recover --apply` to persist a bounded `VerificationArtifact` JSON under `.dbcli/verification/` after the run:

```bash
dbcli recover --apply --write-verification-artifact
```

**Conditions and guarantees:**

- The artifact is written **only when the verify step actually ran** — if the plan had no verify step, nothing is written even when the flag is present.
- Omitting the flag leaves behavior completely unchanged — no file is ever written.
- Artifacts contain **no command transcripts, credentials, or connection secrets** — they carry pointer-oriented evidence only (command name, step reference, outcome status).

---

<!-- doc-key: error-classification -->
## Troubleshooting & Error Reference

### Error categories

`dbcli` distinguishes between **connection errors** (server down, auth failed) and
**SQL errors** (syntax, missing table, missing column). SQL errors now print:

- The specific problem (not "Connection failed")
- A hint pointing to the right next command (`dbcli list`, `dbcli schema <table>`, `--no-limit`)
- For missing tables, top-3 fuzzy-match candidates

### Query-only mode auto-LIMIT

`dbcli` auto-appends `LIMIT 1000` to `SELECT` queries in `query-only` mode. This
**does not** apply to:

- `SHOW` / `DESCRIBE` statements (LIMIT is not valid syntax here)
- `EXPLAIN` / `EXPLAIN ANALYZE` / MariaDB `ANALYZE SELECT`

Use `--no-limit` on `SELECT` to disable when querying `information_schema`.

### Schema cache bootstrap

The first `dbcli schema --refresh` after init writes the cache without `--force`.
Subsequent refreshes that detect changes against an existing cache still require
`--force` to overwrite.

---

<!-- doc-key: documentation-maintenance -->
## Documentation Maintenance & Coverage

The Markdown (`index.md`) and polished HTML (`index.html`) versions are two presentations of the same user guide. Treat them as a single documentation contract.

### Parity Rules

1.  **Update both files in the same change**: Any new command, flag, workflow, warning, example, or support-matrix entry must appear in both `docs/user/en/index.md` and `docs/user/en/index.html`.
2.  **Keep topic order aligned**: Each shared topic is marked with `<!-- doc-key: ... -->`. Do not add a topic to only one format.
3.  **Match semantics, not styling**: The HTML version may use cards, grids, icons, or short labels, but it must communicate the same required usage, safety notes, examples, and limitations as the Markdown version.
4.  **Mirror supported languages**: When English user docs change, apply the same update to `docs/user/zh-TW/index.md` and `docs/user/zh-TW/index.html`.
5.  **Verify before merging**: Run `bun run docs:check` to confirm Markdown/HTML topic parity for every supported language.

### Coverage Checklist

Use this checklist whenever a feature or command behavior changes:

| Area | Required documentation |
| :--- | :--- |
| Installation & setup | Package install commands, first-run initialization, environment-variable guidance, and safe secret handling. |
| Connections | Multi-connection layout, listing, switching, one-shot `--use`, and environment-specific examples. |
| Discovery | `list`, `schema`, `inspect`, `status`, output formats, and when AI agents should inspect before querying. |
| Reads & writes | `query`, `q`, `export`, `insert`, `update`, `delete`, `--dry-run`, write guards, and examples with expected safety constraints. |
| Snippets | `queries list/search/suggest/new`, resolution order, parameters, and visualization frontmatter. |
| Diagnostics & recovery | `doctor`, `check`, `diff`, `report`, `guide`, `recover`, `--recovery`, and safe remediation boundaries. |
| Advanced tooling | `shell`, `migrate`, `skill --install`, `skill tasks`, `completion`, and supported permission levels. |
| Engines | PostgreSQL/MySQL/MariaDB, MongoDB, Redis, Elasticsearch support differences and known limitations. |
| AI usage | Required workflow order: blacklist check, schema confirmation, dry-run/risk planning, then execution. |
| HTML dashboards | `--ui`, export behavior, chart/KPI configuration, and browser/report expectations. |

### Maintenance Workflow

```bash
# 1. Edit both Markdown and HTML for each supported language.
$EDITOR docs/user/en/index.md docs/user/en/index.html
$EDITOR docs/user/zh-TW/index.md docs/user/zh-TW/index.html

# 2. Verify topic parity.
bun run docs:check

# 3. For command behavior changes, run the relevant CLI tests too.
bun test
```

If a topic intentionally exists in only one format, do not bypass the check silently. Either add the matching `doc-key` block with equivalent content or document why the topic is not user-facing.

---

*Generated by Dbcli Documentation Engine.*

## Query plan inspection — `dbcli explain`

Surface query plans across MySQL/MariaDB and PostgreSQL with a unified row schema and severity-coded annotations.

### Basic usage

```bash
dbcli explain "SELECT * FROM betting_logs WHERE settled_at >= '2026-03-01'"
dbcli explain @analytics/live-summary               # saved query
dbcli explain --analyze "SELECT ..."                 # MariaDB ANALYZE SELECT / PG EXPLAIN ANALYZE
dbcli explain --format json "..."                    # JSON dump
dbcli explain --bulk @queries.sql                    # batch from file
dbcli explain --bulk @analytics/*                    # glob over saved queries
```

### Annotations

| Rule | Severity | Triggered when |
|---|---|---|
| `full-scan` | red | MySQL `type=ALL` or `key=NULL`; PG `Seq Scan` |
| `temp-table` | yellow | MySQL `Using temporary` |
| `filesort` | yellow | MySQL `Using filesort`; PG `Sort Method: external merge` |
| `cost-estimate-skew` | gray | `--analyze` actual rows / planner rows > 10× |
| `nested-loop-large` | yellow | PG `Nested Loop` with planner rows > 10,000 |

### Notes

- `--analyze` runs the query for real, so dbcli accepts it only for structurally
  proven read-only, function-free `SELECT` / SELECT-only CTE statements.
  Explicit function and table-function calls are unproven because functions may
  have side effects. Write-capable or uncertain SQL is rejected before adapter
  execution; use plain `dbcli explain`.
- `dbcli explain` is allowed in `query-only` permission — no permission upgrade required.
- Auto-LIMIT is **not** applied to EXPLAIN statements (since v1.23 P1).

<!-- doc-key: lint-command -->
## Static SQL advisor — `dbcli lint`

`lint` analyzes PostgreSQL, MySQL, or MariaDB SQL without opening a database
connection, executing the query, refreshing schema, or applying a rewrite.
Schema-aware rules read only the layered `.dbcli/schemas/` cache.

### Inputs and options

```bash
dbcli lint "SELECT * FROM users WHERE email LIKE '%@example.com'"  # inline SQL
dbcli lint @analytics/live-summary                               # saved query
dbcli lint @queries.sql                                          # SQL file
dbcli lint --bulk '@queries/**/*.sql'                            # filesystem glob
dbcli lint --bulk '@analytics/*,@queries.sql' --format markdown  # mixed bulk inputs
dbcli --use staging lint @analytics/live-summary --format json   # named cache
```

All schema caches live beneath `.dbcli/schemas/`. A v2 configuration always
uses `.dbcli/schemas/<resolved-connection>/`, including the configured default.
The root `.dbcli/schemas/` directory is only the v1/legacy unnamed cache. The
global selector must precede the command: `dbcli --use <conn> lint …`; it
selects another named v2 slot. `lint` never falls back to `config.schema` and
never connects to refresh missing metadata.

| Option | Default | Behavior |
| :--- | :--- | :--- |
| `--format text\|json\|markdown` | `text` | Select human text, machine JSON, or Markdown reports. |
| `--min-severity info\|warn\|error` | `info` | Hide findings below the selected severity. |
| `--no-schema` | off | Do not read schema-cache paths; skip schema-only checks while retaining static `NOT IN` NULL checks. |
| `--bulk <input>` | none | Resolve a comma-separated mix of `@file`, `@glob`, and `@saved-query` inputs. |
| `--recovery` | off | On command failure, emit and save a linked recovery envelope. |

### Rules

| Rule | Severity | Reports |
| :--- | :--- | :--- |
| `select-star` | warn | Top-level `SELECT *`; an unambiguous single-table cache may supply a column-list draft. |
| `unanchored-like` | warn | `LIKE` / `ILIKE` patterns beginning with `%`. |
| `missing-limit-offset` | info | Deep pagination with `OFFSET >= 1000`; consider keyset pagination. |
| `non-sargable-where` | warn | Functions or arithmetic applied to the column side of a predicate. |
| `or-to-union` | info | Top-level `OR` across different columns; any UNION alternative must preserve identity and multiplicity. |
| `subquery-to-join` | info | `IN (SELECT …)` that may benefit from a semantics-preserving `EXISTS` or proven-unique JOIN. |
| `distinct-groupby-abuse` | warn | Redundant `DISTINCT` when projected simple columns exactly cover `GROUP BY`. |
| `implicit-cast` | warn | A schema-verified column/literal type mismatch that can disable index use. |
| `not-in-nullable` | warn | A right-hand `NOT IN` value that is NULL or may be nullable: explicit `NULL`, outer-join null extension, a nullable subquery projection, or a known nullable CASE/cast/aggregate expression. |

`not-in-nullable` is specifically the SQL “NULL poisons `NOT IN`” hazard on
the right-hand side. It checks projections, JOIN `ON`, `WHERE`, and `HAVING`
recursively, with each nested SELECT/CTE/derived statement using its own scope.
A join's synthetic NULL extension is applied only after that join's own `ON`
predicate; declared nullability and completed earlier joins still apply there.
A nullable left-hand column is not this rule. For a
subquery, filter its projected value with `IS NOT NULL`, or consider
`NOT EXISTS` when its correlation and semantics are appropriate. dbcli does
not automatically perform that rewrite unless correlation, types,
qualified-column resolution, and rewrite targeting are all unambiguous. A
direct or `AND`-conjoined `IS NOT NULL` filter on the exact projected
expression suppresses the finding; aggregate projections also honor the same
proof in `HAVING`. `OR` and ambiguous matches remain conservative findings.

Parse failures list all nine rules as `blocked: parse failed`. With
`--no-schema`, `implicit-cast` is skipped and the schema-dependent portion of
`not-in-nullable` is listed as `blocked: --no-schema`; explicit NULL and other
structurally known RHS hazards still run. A missing layered cache reports
`blocked: schema cache unavailable (run dbcli schema)` for the unavailable
schema checks. Findings may include confidence-labelled SQL drafts and
shell-safe verification commands.
`dbcli explain --analyze` is emitted only for structurally proven read-only
SQL without explicit function calls, table-function calls, or session-variable
assignments; other statements fall back to plain `dbcli explain`. If cached
identifiers collide after case folding, or a relation is a CTE, derived,
schema-qualified, or database-qualified binding, unqualified cache facts are
withheld. Both command forms are report-only suggestions and are never run.

## Missing-index advisor — `dbcli guide missing-index-for`

Analyse a single `SELECT` and suggest composite indexes, grounded in a real `EXPLAIN` plan and your existing indexes. Read-only.

```bash
dbcli guide missing-index-for "SELECT ... FROM betting_logs b JOIN hoster_machines hm ON ..."
dbcli guide missing-index-for @analytics/live-summary
dbcli guide missing-index-for "..." --format json        # yaml (default) | json | markdown
dbcli guide missing-index-for "..." --min-confidence medium
```

Each candidate carries a `confidence` (`high` / `medium` / `low`) and a `reason`; the tool never asserts "you must create this". Functional/expression columns (e.g. `DATE(settled_at)`) and unparseable SQL are reported under `warnings`.

**Limits:** single `SELECT` only (no INSERT/UPDATE/DELETE, stored procedures, or view bodies). Functional/partial indexes are flagged, not recommended. Dialects beyond node-sql-parser support fall back to EXPLAIN-only heuristics.
