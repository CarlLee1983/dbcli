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
    *   [Evidence Packs](#evidence-packs)
    *   [Local Observability Proxy](#proxy)
    *   [QueryLens](#querylens)
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

*   **Permission Guard**: Four tiers of access control (`query-only`, `read-write`, `data-admin`, `admin`). A statement is judged by what it does, not by its leading keyword: SQL holding multiple statements is refused below `admin` because only the first one would determine the check, saved snippets are refused if they contain any write or DDL keyword (so a data-modifying CTE or `SELECT … INTO` cannot hide behind a `SELECT`/`WITH` opening), and MongoDB `$out` / `$merge` require `data-admin` on `query` and are refused outright in snippets and `export`. An Elasticsearch request is judged by scope rather than by the resource it names: deleting one document is `data-admin`, while deleting an index, a wildcard, `_all`, a template or an alias — and rewriting `_mapping` or `_settings` — is `admin`, the tier `DROP TABLE` needs.
*   **Blacklist Manager**: Redacts sensitive tables and columns from all query results. The decision covers *every* table a statement references, not just the leading one — a blacklisted table brought in by a `JOIN`, a comma, a `UNION`, or a subquery is blocked the same way, on `query`, `export`, `q`, `report`, and the shell alike. Redis saved queries and report diagnostics resolve their key targets before execution and use the connection's blacklist and mask rules; protected key names are also removed from `SCAN` evidence. Masking uses the union of the column rules of every referenced table, because a JOINed result returns unqualified column names and attribution is not recoverable from it. Table enumeration deliberately over-reports — every non-keyword identifier in the statement is a candidate — so a column or alias sharing a blacklisted table's name blocks the statement (the message names the match). Elasticsearch's `--index` is an expression (comma lists, wildcards, `_all`, date math, cluster qualifiers), normalized and checked segment by segment, with wildcards refused when they could match a blacklisted index; an ES shell request is checked on the path the server will actually route, on the index names its body carries (`_mget`, `_bulk`, `terms` lookup), and has protected fields removed from its response; one that names no index (`GET /_search` and friends) is refused whenever a blacklist is configured. Masking matches returned column names, so `SELECT password_hash AS x` still returns the value: **table-level entries are enforceable, column-level entries are a display filter, not an access control**. A column rule and a returned name are compared case-insensitively over **the whole dotted path**, so `SELECT Password AS PASSWORD` does not slip past a rule spelled `password` and a rule `profile.ssn` masks `profile.SSN` — but a rename to an unrelated name still does, and the sentence above is unchanged by it. Folding happens at the comparison; rules are stored as written. The cost is that where PostgreSQL holds both `"Password"` and `"password"` (or a MongoDB document holds both `profile.SSN` and `profile.ssn`), a rule naming either redacts both. The fold reads no context: `toLowerCase` gives Greek capital `Σ` a different lower-case letter at the end of a word than in the middle, so `ς` and `σ` are treated as one character — without that, a rule `ΑΣ*` failed to mask the very field it names. `--fields` is unaffected and still matches exactly. Config entries are trimmed and unquoted (`" password "`, `"\"password\""`), a rule qualified with its own table (`{"users": ["users.password"]}`) now fails to load instead of silently matching nothing, and a rule filed under `public.users` applies to `SELECT * FROM users` and the reverse. `blacklist.tables` is now a glob for every engine, not just Redis and Elasticsearch — `tables: ["secrets*"]` blocks the MongoDB collection `secrets_2026` and the SQL table `secrets_2026` alike; this is a breaking change, and a table literally named `report*` needs to be written as `report\*` to match literally again.
*   **Query Risk Analyzer (`plan`)**: Analyzes SQL risk without connecting to the database.
*   **Antigravity Protocol**: A workflow separation between **Architect** (Planning) and **Builder** (Execution) to ensure strategy precedes action.

`permission`, blacklist, dry-run, and agent skills are defence in depth, not a
replacement for database authorization. An autonomous agent must receive only a
least-privilege database credential; a process that can edit its own config can
otherwise raise dbcli's declared permission or use another client.

---

<!-- doc-key: getting-started -->
## Getting Started

### Installation
```bash
bun install -g @carllee1983/dbcli
# or using npm
npm install -g @carllee1983/dbcli
```

dbcli runs on Bun 1.3.3+. npm and npx are supported as distribution channels, but the
installed `dbcli` executable requires Bun on your `PATH`; only the `./agent-core` subpath
export is importable from a plain Node process.

Standalone `dbcli --version` and `dbcli -V` checks use a lightweight launcher and do not load database drivers. Other invocations load the full command runtime as usual.

### Initializing a Connection
The `init` command guides you through setting up your first connection. It can automatically parse existing `.env` files. For MongoDB, `init` walks through connection fields one at a time (Host, SRV, Port, User, Password, `authSource`, then optional `replicaSet` / `tls`) — see "MongoDB connection configuration" in the [Database Engine Support Matrix](#database-engine-support-matrix) section below for the full field list and the `--uri` advanced fallback.

Behind the scenes, `init` writes a small `version: 3` binding stub to `./.dbcli/config.json` in your project, while the real connection settings and any credentials are stored in your home directory at `~/.config/dbcli/projects/<project-name>-<sha1-12>/`. This keeps recoverable secrets out of the project workspace, so tools or AI agents that scan the repo never see them. The project `.dbcli/` only holds the binding plus non-sensitive caches (schema cache, audit log, snapshots, verification artifacts).

For a connection shared by several projects, use the explicit global scope. It stores a v2 registry in `~/.config/dbcli/config.json` and never creates a project binding:

```bash
dbcli --global init --conn-name shared --system postgresql \
  --host db.example.com --port 5432 --user app --password '<secret>' \
  --name appdb --skip-test --no-interactive --force
dbcli --global use --list --format json
dbcli --global status --format json
```

Root-level `--global` must appear before the command. Global and project registries are independent; commands continue to use the project registry unless `--global` is supplied. The global file is protected with the same integrity record and private file mode as home-stored project settings.

```bash
dbcli init
```

Use `--use-env-refs` to keep secrets out of the config file and read them from environment variables instead. At runtime, a missing referenced variable fails closed with an error that identifies both the variable and config field; an empty value remains distinct from a missing variable.

**Masked credential entry**: interactive `init` collects the database password — and a pasted MongoDB connection string, which carries one — through a masked prompt, so the value never lands in terminal scrollback, a session recording, or a screen share. Hosts, ports, usernames, database names, and environment-variable names stay ordinary visible prompts.

There is no plain-text fallback. If masked input cannot be provided — no terminal attached, or the prompt implementation unavailable — `init` stops before writing any configuration and names an input you can use instead: `--password`, a credential parsed from `.env` or the process environment, `--use-env-refs`, or `--uri` for MongoDB. An explicit `--password` or `--uri` is kept exactly as given and is never offered back as a visible prompt default, and `--no-interactive` never reaches a secret prompt at all.

If the connection test then fails, the driver's own message and hints are redacted and bounded before they reach the terminal, because drivers routinely quote the credential or the whole connection URI back in an error.

This is about terminal echo, not storage: dbcli does not encrypt credentials at rest. Keeping them out of the config file is what `--use-env-refs` and home-directory storage are for.

---

<!-- doc-key: connection-management -->
## Connection Management

`dbcli` supports multi-connection configurations (v2) so you can switch between Local, Staging, and Production environments.

Use `--global` to manage or run a named connection from the user-level registry, independent of the current project:

```bash
dbcli --global use --list
dbcli --global use shared
dbcli --global query "SELECT 1"
```

Without `--global`, `dbcli` continues to resolve the current project's `.dbcli` binding. This explicit scope prevents a global connection from being selected accidentally in an unrelated project.

Root-level `--timeout <ms>` overrides the connection timeout for one invocation (integer,
100–600000; must precede the command, like `--global` and `--use`). It overrides the
connection config's `timeout` field; without either, adapters fall back to a built-in
5000ms default. The override applies only when the adapter is created for this
invocation and is never written back to `config.json` — set the connection's `timeout`
field instead for a value that persists across runs. Elasticsearch applies its timeout
per request rather than once for the whole connection. This is useful when the default
is too tight, such as a MongoDB connection over a VPN or to Atlas:

```bash
dbcli --timeout 20000 --use <conn> list
```

Connection time and statement time are two separate limits. `--timeout` caps both, so
`--timeout 3000` also aborts any SQL statement that runs longer than 3 seconds. To
change only how long a statement may run, use root-level `--statement-timeout <ms>`
(integer, 0–3600000; `0` removes the limit) or the connection's `statementTimeout`
field. Without either, statements are not capped by dbcli — the server's own setting
applies, and a six-second analytical query is no longer cut off just because the
connection timeout defaults to five seconds:

```bash
# fail fast on an unreachable host, but let the report run for two minutes
dbcli --timeout 2000 --statement-timeout 120000 query "SELECT ... FROM big_table"
```

*   **List all connections**: `dbcli use --list`; agents and scripts can use
    `dbcli use --list --format json` for a credential-free connection inventory.
*   **Switch default connection**: `dbcli use <name>`
*   **One-shot override**: Put the global selector before any command. `query`,
    `schema`, `list`, `export`, and `check` also accept it after the command.
    ```bash
    dbcli --use staging query "SELECT 1"
    dbcli query --use staging "SELECT 1"
    ```
*   **Environment selector**: Set `DBCLI_CONNECTION` for one process, such as
    `DBCLI_CONNECTION=staging dbcli query "SELECT 1"`. Surrounding whitespace is
    trimmed and an empty value is ignored.

Selection precedence is explicit `--use`, then `DBCLI_CONNECTION`, then the
configured default. A one-shot selector never changes the persistent default.
If root-level and command-level `--use` values conflict, dbcli fails instead of
choosing one silently. Selectors require a v2 configuration: a single-connection
(v1) project has no names to choose between, so `--use` or `DBCLI_CONNECTION`
there is rejected rather than quietly running the only connection.
When `--use` is placed after a command that does not support the command-level form,
dbcli keeps the request rejected and prints the copyable root-level form, such as
`dbcli --use <connection> status`.

For an unambiguous, non-secret environment label, set the optional
`environment` field on a v2 named connection (for example, `"environment":
"production"`). `dbcli use --list --format json` returns each connection's
name, environment label (or `null`), permission, system, server/database
identity, and default marker. Environment-backed identity fields are `null`; so
are URI-only MongoDB and Cloud ID-only Elasticsearch endpoint placeholders. It
deliberately excludes users, passwords, URIs, Cloud IDs, API keys, and env
variable names. A misspelled connection selector suggests nearby configured names.
The resolved v2 connection name is retained while commands run, so audit records
are routed to that connection's own audit stream.

#### Production and automation safeguards

Connections labelled `environment: "production"` fail closed when you try to
make one the persistent default. Repeat the exact name to make that intentional:

```bash
dbcli use production --confirm-production production
```

This confirmation applies only to changing the persisted default; one-shot
`--use production` selection remains explicit and does not alter configuration.
In agent mode (`DBCLI_AGENT_MODE=1`), configuration, permission, and credential
mutations are always rejected. A human or administrator must run the approved
change workflow in a separate process with agent mode disabled; dbcli does not
accept a same-process environment variable as approval. Trusted writes maintain
a config integrity record and secure file modes where the operating system
supports them; agent reads fail closed on a missing, replaced, non-regular, or
tampered record. Agent mode also refuses legacy single-file `.dbcli` configs;
migrate them to V2 home storage through the human/admin workflow first. For a
same-user hostile process, set `DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR` to a
host-protected or read-only directory so the detached digest cannot be replaced
alongside the workspace files.

Every audit entry includes non-secret `metadata.connection_name` and
`metadata.environment` from the resolved connection. It never records connection
credentials or endpoint secrets.

A SQL entry also carries `metadata.blacklist_checked` — every identifier the
blacklist compared this statement against. `target` names one table, derived
separately, and for a JOIN it is whichever table came first: a statement refused
because it reached `salaries` could be filed under `target: "a"`, so asking the
log "did anyone reach the protected table" by `target` found nothing. Query
`metadata.blacklist_checked` for that question. It is stored exactly as the
blacklist saw it, which means it deliberately contains more than table names —
aliases, qualified column references, and SQL keywords such as `CREATE` — because
an extra identifier can only make the blacklist refuse more, and filtering the
list for display would be a second parser disagreeing with the first.

### Server-enforced SQL query-only mode

On PostgreSQL, MySQL, and MariaDB, every caller-controlled statement whose
effective permission is `query-only` runs inside a fresh database-native
read-only transaction on the physical connection that executes it. This covers
`query`, `export`, saved-query bodies and verification, report diagnostics, the
SQL shell, analyzed explain plans, and fan-out even when the selected
connections store a higher permission tier. If dbcli cannot establish that
boundary, it fails before sending the target statement. Classifier, blacklist,
hidden-write, and multi-statement checks still run first. If the target completes
but transaction cleanup fails, dbcli reports the uncertain outcome and discards
the affected connection; the SQL shell reconnects for later statements without
replaying the completed target.

The guarantee covers persistent, non-temporary data and schema. An engine may
still permit temporary or session-local state under its native read-only rules,
and the boundary cannot prevent effects outside the target database, such as a
network call made by an unsafe extension. Database accounts and ACLs remain an
important independent layer.

### Read-only query fan-out

An explicit comma-separated `--use` can run one read-only query against several
named connections. The root-level and command-level forms are equivalent:

```bash
dbcli --use primary,staging query "SELECT count(*) FROM users" --format json
dbcli query --use primary,staging "SELECT count(*) FROM users"
```

Names are trimmed and results preserve selector order. Empty or duplicate names
are rejected. A selector containing one name follows the existing
single-connection path. Fan-out is explicit-only: `DBCLI_CONNECTION` remains one
literal connection name and is never split on commas. Neither form changes the
persistent default connection.

Before any adapter connects, dbcli loads and validates every selected
configuration. SQL fan-out permits only read-only classifications (`SELECT`,
`SHOW`, `DESCRIBE`, and `EXPLAIN`); MongoDB permits filter objects and read-only
aggregation pipelines but rejects top-level `$out` or `$merge` stages;
Elasticsearch permits searches only. Redis fan-out is not supported. A
multi-connection query also rejects `--recovery`, `--ui`, and CSV or HTML output;
use `--format table` (default) or `--format json`.

Each connection runs independently with its own adapter, blacklist filtering,
row-limit/truncation metadata, audit entry, timing, and disconnect. A failure on
one connection does not cancel or hide the others. JSON returns an ordered
`results` array with a labeled `ok` or `error` outcome per connection; table
output renders a separate labeled section for each schema. The aggregate exit
code is `0` when all succeed, `2` for mixed success and failure, and `1` when all
fail or the request is rejected before execution.

### Password rotation

`dbcli password` changes one connection's password without touching any other
setting — built for environments where credentials rotate on a schedule.

```bash
dbcli password                       # Masked prompt, rotates the default connection
dbcli password prod                  # Masked prompt, rotates 'prod'
rotate-secret | dbcli password prod --stdin   # Non-interactive, nothing lands in shell history
dbcli password prod --password "$NEW" --skip-test --format json
```

Where the value lands is read from the config, never guessed: a connection
whose `password` is `{ "$env": "NAME" }` gets `NAME` rewritten in its
`envFile`. A connection that declares no `envFile` has one recorded
(`.env.local`) as part of the rotation — without it the reader would never
load the file. A connection still holding a literal password is converted to
`{ "$env": "DBCLI_<CONN>_PASSWORD" }` once, so later rotations only touch the
env file. Values are written quoted (`NAME="..."`), so leading and trailing
whitespace survives the round trip.

v1 configs rewrite `DBCLI_PASSWORD` in `.env.local`, matching the v1 reader. A
v1 config whose password comes from some other environment variable is
refused with an explanation: v1 has no per-connection env file, so no file
dbcli writes could make that variable resolve — set it in the environment,
or migrate to v2.

The new password is verified by connecting with it before anything is
written, so a bad rotation fails without leaving broken credentials behind.
Pass `--skip-test` when the database is unreachable from where the command
runs. The env file is written with `0600` permissions on POSIX systems (Windows
has no equivalent mode bit — the file inherits the directory's ACL), and the
value is never
echoed or logged.

**Options:** `[connection]`, `--stdin`, `--password <value>` (visible in
shell history and the process list — prefer `--stdin`), `--skip-test`,
`--format <text|json>`.

Blocked under `DBCLI_AGENT_MODE=1` like every other credential mutation.

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
| `capabilities` | Lists the static capability catalog — what dbcli can do — without connecting to a database. |
| `capabilities check` | Checks required capability ids against the local config's engine and permission. Never connects. |

`dbcli blacklist list --format json` emits one machine-readable document with
`tables`, `columns`, and `warnings`; malformed MongoDB blacklist paths are reported in
the structured `warnings` array rather than mixed into stdout as human diagnostics.

For PostgreSQL, `schema` uses exact `public` catalog identity throughout: full catalog/schema/table joins prevent reused constraint names from contaminating another table, composite foreign-key columns remain in declaration order, composite primary-key order comes from the exact table OID and index ordinality, and estimates are scoped to the exact `public` relation. Row counts qualify and quote both `"public"` and the exact table name, escaping embedded quotes so mixed-case and punctuation-bearing identifiers remain distinct and safe. Referenced schema/table spelling is preserved from the catalog.

#### Capability discovery for Skills

`dbcli capabilities` answers "what can this tool do?" in a versioned, parseable shape, so
an external Skill can decide before it starts working. `dbcli capabilities check --require
<ids>` then answers "are those available *here*?" against the local configuration. Neither
opens a database connection.

```bash
dbcli capabilities --format json
dbcli capabilities check --require schema.read,query.read --format json
```

The packaged `assets/integration-kit/` contains a copyable Bun/TypeScript consumer and
Task Pack fixture. It pins both schema versions, strictly parses catalog and Operation
Envelope output, and shows the exit, correlation, and evidence boundary.
Its CRUD, CQRS, and DBA examples remain external consumer requirements; dbcli does not
implement or approve those workflows.

#### Agent output v1

`--agent-output` is a root option and must appear before the subcommand. In PLAT-005,
`dbcli --agent-output capabilities` and `dbcli --agent-output capabilities check --require <ids>`
are supported; either emits one compact UTF-8 JSON document plus a newline on stdout and
nothing on stderr. It is ephemeral: it is not evidence and creates no timestamp.

Use the optional root `--correlation-id <id>` before the subcommand to associate an invocation
with a Story, incident, change request, migration, or backfill. IDs are 1–160 ASCII letters,
numbers, dots, underscores, colons, or hyphens; never use a credential, SQL, personal data, or a
free-form label. For a supported non-static response, the ID appears as `context.correlationId`
and in the existing audit entry as `metadata.correlation_id`; command summaries redact it. Static
`capabilities` output keeps `context: null`. The option creates no evidence and changes no receipt.

The v1 envelope always has these ten keys: `schemaVersion`, `ok`, `operation`, `status`,
`context`, `data`, `warnings`, `evidence`, `recovery`, and `error`. `schemaVersion` is `1`;
`operation` is `capabilities.list` or `capabilities.check`; `status` is `succeeded` or `failed`;
and consumers must address keys by name, not field order. It is capped at 64 KiB including the newline.

Do not combine `--agent-output` with an explicitly supplied `--format` or `--for-agent`;
either conflict, placement after the subcommand, invalid input, or an unsupported operation
fails with one envelope and exit `2`. Success exits `0`; unmet requirements and unexpected
internal failures exit `1`. Existing output behavior is unchanged when `--agent-output` is absent.

Error and warning code/message vocabulary is locale-independent English. Error codes are
`INVALID_AGENT_OUTPUT_OPTIONS` (invalid, misplaced, or conflicting output options),
`UNSUPPORTED_AGENT_OUTPUT_OPERATION` (operation outside PLAT-005),
`INVALID_CAPABILITY_REQUIREMENTS` (invalid `--require`), `CAPABILITY_REQUIREMENTS_UNMET`
(a completed negative capability result), `AGENT_OUTPUT_LIMIT_EXCEEDED` (the 64 KiB limit), and
`AGENT_OUTPUT_INTERNAL_ERROR` (an unexpected safe failure), and `INVALID_CORRELATION_ID` (an
invalid root correlation ID). Warning codes are
`DUPLICATE_CAPABILITY_REQUIREMENT`, `CAPABILITY_CONTEXT_UNAVAILABLE`,
`CAPABILITY_CONTEXT_UNRESOLVABLE`, and `AGENT_MODE_RESTRICTION_ACTIVE`.

A **capability** is one atomic dbcli ability — `schema.read`, `data.delete`. It is never a
job or a method: `dba.tune-production` and `crud.scaffold` belong to the Role Skill or
Method Skill that composes dbcli. The layering is `Story + AGENTS.md + Role Skill + Method
Skill + Tool Skill + dbcli`, and dbcli only ever answers for the last two.

Four things the output deliberately does not mean:

*   **Discovery is not a grant.** A listed capability says the binary can do it, not that
    you may.
*   **`available` is not approval.** It says engine and permission would not refuse.
    Blacklist, write gate, confirmation and audit all still run, and no human has agreed to
    anything. `admin` in a config file is a permission level, not a DBA sign-off.
*   **`schemaVersion` is not the package version.** Pin the contract version, not `7.x`.
*   **A Task Pack plan is not a result.** `status: "planned"` remains distinct from a
    verification outcome.

Statuses are `available`, `unavailable` and `unknown`. The `unavailable` reasons are
`engine`, `agent-mode`, `permission`, `context-unavailable` and `context-unresolvable`,
reported least-fixable first so the reason names the blocker actually in the way. Under
`DBCLI_AGENT_MODE=1`, capabilities that change configuration are refused whatever the
permission level says. `context-unresolvable` is deliberately distinct from
`context-unavailable`: a config whose `{"$env": "..."}` password names an unset variable is
present and readable, and claiming there is no config would be false.

An unrecognised id fails closed and is never resolved to a similar-looking one. Exit codes:
`0` all available, `1` any unavailable or unknown, `2` invalid input.

The catalog covers every public command, `capabilities` itself included, and every engine
claim in it was read out of the implementation. Commands whose code refuses a non-SQL
connection — `explain`, `plan`, `assert`, `snapshot`, `verify`, `proxy` — report
`unavailable` with reason `engine` on MongoDB, Redis and Elasticsearch. Commands where only
one mode needs SQL — `--against-cache` for `impact assess` and `design`, and `draft
validate` for `semantic` — stay `available` and are marked `limited` on those engines.
Nothing is marked supported on an engine the code does not settle.

`required` and `results` hold your ids in first-seen input order, so `results[i]` answers
`required[i]` and a duplicate appears once. Reordering the arguments reorders the output —
identical input is byte-identical output, but a reordered `--require` is different input.
What reordering never changes is a capability's status, its reason, or the overall `ok`.

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
| `query [sql] [-f, --query-file <path>] [--fields <list>]` | Executes raw SQL, MongoDB JSON, Redis commands, or ES DSL; SQL and MongoDB support optional result-field projection. |
| `q @snippet` | Runs a parameterised saved query. Supports `--verify` for automated assertion loops. |
| `export` | Exports results to JSON, CSV, JSONL, or Interactive HTML. |
| `insert` | Inserts data from JSON (SQL & MongoDB). Accepts `--plan` for risk preflight (SQL, MongoDB, Redis, Elasticsearch). |
| `update` | Updates rows/documents with mandatory `--where` clause. Accepts `--plan` for risk preflight (SQL, MongoDB, Redis, Elasticsearch). |
| `delete` | Deletes data with mandatory `--where` clause. Accepts `--plan` for risk preflight (SQL, MongoDB, Redis, Elasticsearch). |
| `blacklist` | Manages the sensitive data redirection rules. |
| `plan "<sql>"` | **Static analyzer**: Classifies SQL risk and gives recommendations. |
| `lint "<sql>"` | **Static advisor**: Reports SQL anti-patterns and optional rewrite drafts without connecting to the database. |

#### Write confirmation gate (2.0.0)

Every write goes through a two-tier gate. Tier one is a question; tier two is a refusal you cannot flag your way past.

**Tier one — ordinary writes.** An INSERT, an UPDATE or DELETE that has a WHERE, a CREATE, an ALTER. At an interactive terminal dbcli prints what it understood the statement to do and asks for confirmation. `--yes` skips it. A non-interactive run — piped stdout, CI, an agent — never sees it, and `--format json` suppresses it even at a terminal.

**Tier two — writes that cannot be taken back.** An UPDATE or DELETE with no WHERE clause, a DROP, a TRUNCATE, a statement the SQL parser cannot read, several statements in one string, a write nested inside another statement (a data-modifying CTE such as `WITH x AS (DELETE FROM t RETURNING *) INSERT INTO …`), a `MERGE` carrying a `WHEN … THEN DELETE` or `THEN UPDATE` action, and — for `dbcli update` / `dbcli delete` — a `--where` that matches on no primary key and no unique index. dbcli asks you to type the target table name. **No flag skips this**, `--yes` and `--force` included. When nobody is watching, dbcli refuses: exit code 1, nothing sent to the database, and a message naming `reason=no_where`, `reason=ddl_destruction`, `reason=unparseable`, `reason=multiple_statements`, or `reason=non_unique_where`, `reason=multi_table`, `reason=nested_write`.

**A write that joins another table is tier two, whatever its WHERE says.** Whether such a write is limited to particular rows depends on the data, not on the statement: `DELETE p FROM p JOIN o ON p.id = o.ref WHERE o.x > 0` deleted 2 of 5 rows against one dataset and all 2000 against another. A join's ON always mentions the target, so it proves nothing. This refuses the standard `UPDATE … FROM`, `UPDATE … JOIN … SET` and multi-table `DELETE` for unattended callers — rewrite the other table into a subquery in the WHERE, or run them where someone can confirm.

**For a single-table write, the WHERE has to be about that table.** A WHERE that lives only inside a subquery does not count: `UPDATE p SET c = (SELECT max(x) FROM o WHERE o.id = 1)` has a WHERE and rewrites every row. A correlated reference back to the target does count, so `DELETE FROM t WHERE EXISTS (SELECT 1 FROM o WHERE o.tid = t.id)` is an ordinary write, while the same statement with `WHERE o.id = 1` inside deletes everything and is tier two. This is a lower bound rather than a guarantee — `WHERE id IS NOT NULL` names the target and still touches every row.

**The escape route lives in the statement, not in a flag.** To run a full-table write unattended, say so in the SQL — add `WHERE 1=1` or a `LIMIT`. This is deliberate: appending `WHERE 1=1` to a statement that already has a WHERE is a syntax error, so "add it everywhere just in case" breaks immediately and cannot become a habit. A flag would have the opposite property. For DROP and TRUNCATE there is no clause to add: whether they are possible at all is decided by the connection's `permission` level, and the typed confirmation still has to come from a person.

**In `dbcli shell`, tier two applies and tier one does not.** Every line in a shell is typed by a person, so a y/N on each write would become reflex; a full-table DELETE, a DROP or a TRUNCATE still asks for the table name. Typing anything else prints a cancellation and returns you to the prompt — the session, the connection and the history survive. Ctrl-C withdraws the question itself: nothing runs, and the next line you type is read as a statement rather than as an answer. Piped input (`dbcli shell < script.sql`) has nobody to answer, so a tier-two statement there is refused and the remaining lines still run. The Redis, MongoDB and Elasticsearch shells do not use the write gate; their writes are bounded by the connection's permission tier instead. **For Elasticsearch that guard did not exist before 4.0.0** — the ES shell reached the cluster with no permission check at all, so a `query-only` connection could delete documents, drop an index or rewrite a mapping, and nothing was recorded. It now classifies every request through the same classifier `dbcli query` uses, refuses what the tier does not permit, and audits both executed and refused requests — one row before the request goes out and one after it returns, each naming the operation as `<METHOD> <path>`. Server-side scripts (`script`, `script_fields`) are refused in the shell as they already were in `dbcli query`: they run arbitrary code on the cluster and can read a blacklisted field back under a name of the request's choosing. A piped shell now finishes writing its audit rows before exiting, so `printf 'DELETE /orders\n\n' | dbcli shell` can no longer reach the cluster without leaving a record; the same fix applies to the SQL shell. **The SQL shell audits every statement from 5.0.0**, in the same two rows the Elasticsearch shell writes — `attempt` before it is sent and `outcome` after it returns, with a refused statement writing only `outcome` because it was never attempted. Before this it recorded nothing but tier-two write-gate decisions, so a `SELECT` typed at the prompt and an `UPDATE` that changed a row were equally invisible while the same statements through `dbcli query` were recorded. Both shells carry the phase in `metadata.shell_phase`. Audit writes are best-effort by default — a full disk or an unwritable `.dbcli/audit` lets the request through with only a warning — so set `audit.strict: true` in your config if an unrecorded request is worse than a refused one. It applies wherever dbcli records an operation *before* performing it: both shells' pre-flight rows and the SQL write gate's decision — which now includes a `SELECT` typed at the `dbcli>` prompt. Records written after the fact are outside it, because refusing then would report a completed operation as a failure rather than prevent one. `dbcli audit health` shows whether it is on. dbcli subcommands typed in the shell (`query "..."`, `\delete ...`) run as separate processes with no stdin and cannot ask anything, so a tier-two statement there is refused with a message pointing you back to the `dbcli>` prompt.

**A subcommand named after a SQL keyword needs a `\` prefix.** `delete users --where id=1` is read as SQL — a shell is for typing SQL, and `DELETE FROM users WHERE …` has to work as typed — so it waits for a semicolon instead of running the subcommand. Type `\delete users --where id=1` to reach the subcommand. The same applies to `insert`, `update` and `explain` — the four subcommands whose names are SQL keywords; the prefix works on every subcommand, so it is one rule rather than a list. While a statement is still accumulating, `.quit` and `.clear` keep working and Ctrl-C cancels — they used to be swallowed into the buffer, which made the shell look frozen.

A subcommand runs in its own process with no stdin, so its ordinary confirmation prompt reads EOF and cancels: `\insert`, `\update` and `\delete` need `--force` from inside the shell, or type the SQL at the prompt instead, where you can answer. The tier-two confirmation is not affected — it is refused in the child and points you back to the prompt, which is where a table name can actually be typed.

Every tier-two evaluation is written to the audit log — allowed, declined and refused alike — so the gate's effect is measurable rather than assumed. `dbcli audit write-gate` is that measurement: how often tier two was reached, under which criterion, and how it was answered. If it reports zero, the criterion is what needs revisiting, not the gate.

```bash
# Refused: no WHERE and nobody to confirm it
dbcli query "UPDATE users SET banned = 1" --format json
# → exit 1, reason=no_where, nothing was sent to the database

# Accepted: the intent is in the statement
dbcli query "UPDATE users SET banned = 1 WHERE 1=1" --format json

# An ordinary write, unattended or with the question skipped
dbcli query "UPDATE users SET banned = 1 WHERE id = 3" --yes

# Structured delete matching on a non-unique column: tier two
dbcli delete users --where "status=active"
```

#### Query input from positional text, files, or stdin

`dbcli query [sql] [-f, --query-file <path>]` requires exactly one query source:

*   Positional query text, such as `dbcli query "SELECT 1"`.
*   A UTF-8 file, such as `dbcli query --query-file ./queries/active-users.sql`.
*   Stdin via `--query-file -`.

Providing no source or combining positional text with `--query-file` is an error. After reading the source, dbcli removes one leading UTF-8 BOM and surrounding whitespace; an input that is then empty is rejected. `--query-file -` requires piped input: when stdin is an interactive terminal dbcli refuses immediately instead of waiting for input with no prompt.

Use stdin for multiline SQL without escaping it as one shell argument:

```bash
dbcli query --query-file - <<'SQL'
SELECT id, email
FROM users
WHERE status = 'active'
ORDER BY id;
SQL
```

MongoDB filters and aggregation pipelines use the same file/stdin sources. If `pipeline.json` contains the pipeline below, either command avoids having to shell-escape the apostrophe in `user's event`:

```json
[{"$match":{"message":{"$regex":"user's event"}}}]
```

```bash
dbcli query --collection raw_logs --query-file ./pipeline.json

dbcli query --collection raw_logs --query-file - <<'JSON'
[{"$match":{"message":{"$regex":"user's event"}}}]
JSON
```

#### Passive slow-query hints

`query` and `q` observe the execution time already returned for a completed query. At the default `1000ms` threshold, a slow result receives a `Performance hint` in table output and a `metadata.performanceAdvisory` object in JSON output. Fast results remain unchanged, so normal queries do not produce repetitive advice.

```bash
# Suggest a review for a query taking 250ms or more
dbcli query "SELECT * FROM events WHERE account_id = 42" --slow-ms 250

# Disable the passive hint for one invocation
dbcli q @daily-active-users --slow-ms 0
```

The hint does not run `EXPLAIN`, inspect schema, or issue a second database request. On PostgreSQL, MySQL, MariaDB, and Redis it recommends the non-mutating next step `dbcli guide slow-query --format markdown`; run deeper diagnostics only after reviewing that guidance and the relevant query. MongoDB and Elasticsearch ship no diagnostic snippet for that goal, so their hint reports the timing without naming a command that would return nothing.

#### Field projection with `--fields`

`--fields` reduces SQL or MongoDB query results to the fields you need. Use an inclusion list to keep fields, in the requested order:

```bash
dbcli query "SELECT * FROM events" --fields id,name,created_at
dbcli query '{}' --collection raw_logs --fields station_code,bet,win,created_at
```

Prefix every field with `-` to exclude it. The portable spelling uses `=` so the leading hyphens are unambiguously part of the option value:

```bash
dbcli query "SELECT * FROM events" --fields=-raw_response,-request_payload
dbcli query '{}' --collection raw_logs --fields=-raw_response,-request_payload
```

An invocation must use either inclusion or exclusion syntax; the two modes cannot be mixed. Empty lists or entries and duplicate paths are rejected. Dotted paths such as `profile.name` are supported, and inclusion output follows the requested order. A MongoDB inclusion excludes `_id` unless `_id` is explicitly requested. A requested field that the result does not contain is reported as `null` rather than raising an error, so a misspelled field name yields a column of nulls — check the spelling against `dbcli schema` before reading meaning into an all-null column.

SQL projection is applied to the returned rows after the query runs. MongoDB pushes the projection into `find` or the aggregation pipeline to reduce transferred data, then normalizes the returned rows again after blacklist masking. Redis and Elasticsearch queries do not support `--fields`.

The blacklist remains the final authority: `--fields` cannot reveal a protected field, and field projection is a result-shaping convenience, not a security boundary.

#### Mutation outcomes

After `insert`, `update`, or `delete` finishes in an interactive terminal, dbcli summarizes what happened in plain language: the affected row count and table, no-match, cancellation, dry-run, or failure outcome, plus elapsed time when work actually ran. Redirected or piped stdout remains the stable JSON result envelope for scripts. Use `--format json` to keep that envelope even in a terminal. The same outcome vocabulary applies across SQL, MongoDB, and Redis; dry runs report `dry_run`, never `success`.

A write that changed rows also states how to get the previous values back — which, for these commands, is a backup: dbcli keeps no automatic undo for a write that succeeded. A failure instead names `--recovery`, the flag that writes a recovery plan for `dbcli recover` to read. Outcomes that changed nothing (cancelled, dry-run, no rows matched) say nothing about reversal, because there is nothing to reverse.

A failure is prose too, and it goes to stderr with the exit code `1`: a blacklist refusal, a malformed `--set`, or a statement the database rejected. `--format` accepts only `text` or `json` here; anything else is refused before dbcli connects, rather than silently meaning `text`.

The confirmation a non-forced mutation asks for — the generated SQL, the parameters, the destructive-delete warning, and the `y/n` question — is written to **stderr**, not stdout. A terminal shows both, so nothing looks different when you run one by hand; a script that captures stdout gets exactly one JSON document whether or not it passed `--force`. Neither a dry run nor a cancellation sends a write to the database, but both do connect and read the table schema, because the SQL they exist to show cannot be built without the column list; use `--plan` for the preflight that opens no connection at all. MongoDB and Redis writes ask the same question — they are issued straight from the command rather than through the SQL executor, and used to run unasked — so `cancelled` is now reachable on every engine. Their prompt shows the statement the dry run would print, with no parameter block, since those statements carry their values inline.

`--recovery` also changes what a failed `insert` / `update` / `delete` writes to stdout: on failure the recovery envelope replaces the JSON result envelope rather than following it, so a caller parsing stdout gets exactly one document either way. Without the flag, a failure prints the result envelope with `status: "error"` and exits `1`, as before.

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
| `doctor` | Runs system and connection diagnostics; JSON config-missing failures include a structured remediation command and risk level. `doctor --format json --remediation` adds candidate-only plans for blacklist coverage, schema refresh, and large tables. SQL large-table candidates use `dbcli plan`; MongoDB/Elasticsearch candidates use `dbcli schema` as preflight, followed by a human-confirmed bounded `dbcli query`. Doctor never changes configuration, blacklist rules, or database data. |
| `check [table]` | Analyzes data health (orphans, nulls, duplicates). |
| `diff` | Compares schema snapshots, or an ORM definition against the local SQL schema cache with `--against-orm`. |
| `report` | Generates a comprehensive health/perf report. |
| `guide <goal>` | Generates a step-by-step troubleshooting plan (e.g., `slow-query`). |
| `recover --apply` | **Automated Recovery**: Applies the last suggested recovery plan. |
| `audit tail` | **Audit Log**: Tails `.dbcli/audit/<conn>.jsonl` (agent-facing JSONL). Use `--for-agent --n 10` for session-handoff JSON. |
| `audit write-gate` | **Gate measurement**: how often the tier-two write gate was reached, by which reason, and whether it was allowed, declined or refused. |
| `--recovery` (supported commands) | **Bi-directional Recovery ↔ Audit Link**: `query`, `inspect`, `insert`, `update`, `delete`, `export`, `q`, `schema`, and `lint` all emit matching `audit.recovery_ref` ↔ `envelope.audit_ref` UUIDs on failure. Use `audit show --recovery-ref <id>` to jump from an envelope to its audit entry. |

`doctor` also reports runtime identity (launcher/source, runtime and package
versions) and flags a bundled-runtime/package version mismatch with the explicit
`dbcli upgrade` remediation. Machine-readable commands (`--format json` and other
non-human formats, `--for-agent`, or `--recovery`) keep stdout payload-only: update
and skill-update notices are suppressed. Human-facing notices are written to stderr
and deduplicated once per CLI session.

#### Source-to-SQL backfill artifacts

`backfill artifact` converts a deliberately bounded JSON source catalog into a
reviewable, dry-run-only artifact; it does not connect to or write either database.
The catalog requires `table`, non-empty `keyColumns`, `rows`, `verifyQuery`, and
`expect`; it accepts at most 1,000 rows. Use named v2 connections so the artifact
captures non-secret source/target identities and their differences:

The target connection must be PostgreSQL, MySQL, or MariaDB; the source identity
may describe another engine.

```bash
dbcli backfill artifact --source ./backfill.json \
  --source-use staging --target-use production
```

The artifact contains generated `UPDATE` statements, per-statement `plan`
commands, blacklist/schema preflight commands, a read-back `verify safe-backfill`
command, and a rollback hint. Review it first; applying any SQL is a separate,
explicitly human-confirmed workflow. Use `--stdout` to print JSON or `--out <path>`
to choose the artifact path.

#### ORM definition drift

`diff --against-orm` compares an application schema with the existing SQL schema cache. The comparison itself is cache-only: it does not connect to the database, refresh the cache, or execute proposals. Run `schema --format json` first when freshness matters; an empty cache exits `1` and asks you to run `dbcli schema`.

Five input paths cover the supported ecosystem:

| Input path | What to pass |
| :--- | :--- |
| Prisma | One `schema.prisma` file. |
| Drizzle | One PostgreSQL drizzle-kit v7 snapshot generated with `drizzle-kit generate`. |
| TypeORM | DDL generated by `schema:log`; entity source files are not parsed. |
| Sequelize | A schema-only dump of a scratch database after applying migrations; model source files are not parsed. |
| Portable schema | Raw PostgreSQL/MySQL/MariaDB DDL (including multiple files or globs), or one normalized JSON file. |

```bash
dbcli skill tasks plan orm-drift-review --param orm_path=prisma/schema.prisma --format json
dbcli diff --against-orm prisma/schema.prisma --format json

drizzle-kit generate
dbcli diff --against-orm drizzle/meta/0001_snapshot.json --orm-format drizzle --format table

bunx typeorm schema:log -d <path/to/datasource> > schema.sql
dbcli diff --against-orm schema.sql --orm-format typeorm --format table

# Point the project Sequelize config at an empty scratch database first
bunx sequelize-cli db:migrate
pg_dump --schema-only <scratch-database> > schema.sql
# For MySQL instead:
mysqldump --no-data <database> > schema.sql
dbcli diff --against-orm schema.sql --orm-format sequelize --format json

dbcli diff --against-orm "migrations/*.sql" --orm-format ddl --format markdown
dbcli diff --against-orm schema.normalized.json --orm-format json --format table
dbcli diff --against-orm prisma/schema.prisma --recovery --format json
```

`--against-orm` is repeatable and accepts comma-separated paths. DDL-family inputs—raw DDL plus the `typeorm` and `sequelize` aliases—support real filesystem globs and multiple files; paths are deduplicated and put in deterministic order, then parsed as one shared ordered context so a later file's index can attach to an earlier file's table. Prisma, normalized JSON, and Drizzle accept exactly one file. Drizzle input must be a PostgreSQL drizzle-kit v7 snapshot at `drizzle/meta/<NNNN>_snapshot.json`. TypeORM `schema:log` prints the SQL that `schema:sync` would execute without applying it. Sequelize CLI has no universal `db:migrate --dry-run`, so migrations must run against a scratch database before `pg_dump --schema-only` or `mysqldump --no-data`. TypeORM entities and Sequelize models (`.ts`, `.js`, `.mjs`, or `.cjs`) are rejected with the exact generation recipe instead of being parsed. Use `--orm-format prisma|ddl|json|drizzle|typeorm|sequelize` to override detection; the TypeORM alias default-ignores `typeorm_metadata` and `migrations`, while the Sequelize alias default-ignores `SequelizeMeta`. Use `--ignore <globs>` for additional comma-separated, case-sensitive qualified table patterns and `--format json|table|markdown` for output. Errors are `missing_in_db`; DB-only objects are `missing_in_orm` warnings; incompatible type families or nullability are error-level `mismatch`; same-family type spelling, default, and primary-key differences are informational. Ignored tables are listed as `unmanaged` but not scored. Only scored errors determine the drift exit code: they exit `1`, while warnings, infos, `unmanaged`, or `unparsed` alone exit `0`; operational failures still exit `1`, and `--recovery` wraps them.

Schema and table storage is exact and case-sensitive. PostgreSQL `users` and `"Users"` coexist. In parsed DDL, unquoted `Users` folds to `users`, while quoted `"Users"` resolves only to `Users`; quote state comes from the parsed identifier, never display capitalization. Qualified names are shown and ignored case-sensitively. Duplicate exact or resolved identities fail closed. A Drizzle snapshot or normalized JSON artifact that is not valid JSON, and a normalized JSON artifact that violates the contract, fail closed naming the offending file and the fields at fault instead of degrading to `unparsed`. Unsupported Prisma/DDL/Drizzle constructs appear in `unparsed` with a `blocked:` reason; this includes Drizzle enums and other unsupported snapshot constructs. Drizzle column defaults are accepted only when the snapshot value is a string, boolean, or finite number; an unsupported default blocks and omits that column. PostgreSQL `PARTITION BY` and MySQL/MariaDB table engine, charset, and other table options are unsupported: they emit a `blocked:` entry without a managed table. Normalized JSON also requires every `unparsed.reason` to start with `blocked:`. Indexes compare and deduplicate by structural columns plus uniqueness; drift entries sort deterministically by table/object/category/detail in Unicode code-point order, independent of locale.

Proposals are shell-safe text and remain dry-run by default. Safe unqualified column/index additions may emit `migrate`; schema-qualified or CLI-lossy index targets escalate to `migration-review` rather than emit a corrupt command. A table, column, or type positional beginning with `-` also escalates; leading-dash option values use option-safe attached syntax such as `--default=-1` or `--columns=--config,email`. Capture the dry-run DDL and pass both exact values as separate quoted parameters:

```sh
dbcli skill tasks plan migration-review \
  --param "table=${exact_table}" \
  --param "ddl=${captured_ddl}"
```

Never add `--execute` until that review is complete.

<!-- doc-key: data-verification -->
### Data Verification

Verify data-processing correctness — capture a result fingerprint, then assert invariants against it, a second query, or inline conditions. SQL engines only (PostgreSQL / MySQL / MariaDB).

| Command | Description |
| :--- | :--- |
| `snapshot <query>` | Captures a **result fingerprint** (row count + per-column null/distinct/min/max/sum + an order-independent checksum). Default file `.dbcli/snapshots/snap-<timestamp>.json`; also `--out`, `--rows`, `--stdout`. Blacklisted columns are masked at the source, so the snapshot is safe to store. Use as a baseline for `assert --against`. |
| `assert <query>` | Verifies an **invariant**; exits 1 on failure unless `--no-fail`. `--expect "rows>0 \| value==X \| col:c not null \| unique \| between a and b \| >= n"`, `--vs <query> --compare rows\|value` (reconcile two queries), `--against <snapshot> --tolerance <pct>` (drift vs a baseline; `0` = exact checksum). |

#### assert --write-verification-artifact

Persist a **result evidence record** (v1 VerificationArtifact JSON) to `.dbcli/verification/` whenever you need a durable audit trail for a read-back assertion. The verification artifact is always written to `<cwd>/.dbcli/verification/` (relative to the current working directory), regardless of where the `--config` file is located.

**Flags:**

| Flag | Required | Description |
| :--- | :--- | :--- |
| `--write-verification-artifact` | opt-in | Write a VerificationArtifact JSON after the assertion runs. |
| `--evidence-receipt <path>` | opt-in | Atomically write safe assert provenance after the verdict, audit attempt, and optional artifact are authoritative; it contains no SQL or rows. |
| `--verification-subject <kind:name>` | yes (when flag is set) | Subject being verified. Allowed kinds: `recovery`, `task-pack`, `assertion`, `migration`, `backfill`, `manual`. |
| `--verification-summary <text>` | no | Human-readable summary line. Defaults: pass → "Assertion verified the expected state."; fail → "Assertion did not verify the expected state." |

`evidence compose` may reference that explicit workspace-contained receipt with `--receipt <path>`; provenance is not execution approval.

`inspect`, `report`, `schema`, `plan`, `lint`, `explain`, and `impact assess` also accept `--evidence-receipt <workspace-relative-path>`. Their receipt records only the command capability, a fixed command subject, timestamp, safe context digests, and an optional correlation ID; it never copies command input, SQL, rows, paths, or raw errors. A receipt write failure is reported separately and does not change the command result.

**Output contract:**

- `--format json` — adds `verificationArtifactPath` to the `AssertVerdict` envelope.
- `--format table` — prints an extra `Verification artifact: <path>` line.
- Status follows assertion truth: `--no-fail` failures still record `not_verified` / evidence `exitCode: 1`.

**Planned vs Result evidence.** `dbcli skill tasks plan safe-backfill-verify` produces a plan JSON with a `verification` block whose `status` is `"planned"` — this is the **planned** evidence definition describing which check will run. The final `assert --write-verification-artifact` step produces **result** evidence (`status: verified` or `not_verified`). These are two different records; `"planned"` does **not** mean verification has run.

> **Note:** Bigint aggregates (`count(*)`, `sum()`) arrive from Postgres as strings and are compared numerically anyway, so `value == 0` works without a cast. Quote the expectation (`value == "0"`) when you mean a text comparison.

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

After an `--after-write` run, add `--evidence-receipt <workspace-relative-path>` to
write a safe, atomic provenance receipt linked to the resulting artifact. A receipt
contains no SQL, rows, credentials, or user paths; it records provenance only and is
**not** execution approval. It is unavailable in preflight mode, which has no executed
result artifact. The receipt outcome (`succeeded`/`failed`) is separate from the
scenario status (`verified`, `not_verified`, `indeterminate`, or `blocked`); task-pack
`planned` evidence remains plan-only.

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

All four guards run and report their individual outcomes even if one fails. After-write
runs the assertion only when all four pass; persisted failure reasons are fixed safe
labels rather than driver error text. Persisted custom labels and SQL evidence also
redact credentials, filesystem paths, and SQL comments.

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

<!-- doc-key: evidence-packs -->
### evidence — compose offline evidence packs

`dbcli evidence` turns existing verification artifacts and audit entries into a
canonical, workspace-contained JSON pack for review or handoff. It never queries a
database and does not copy SQL, targets, audit metadata, verification summaries, or
credentials into the pack. Claims are externally supplied statements, explicitly
labeled as such; they are not dbcli verification verdicts.

- `dbcli evidence compose --claims <file> [--verification <selector...>] [--audit <selector...>] [--receipt <path...>] --output <path> [--format json|markdown]`
  — resolves one or more existing references and writes a new pack. The claims file is
  JSON with exactly `subject` and `claims`; each claim has an `id` and plain-language
  `text`. Claim text cannot contain SQL, credentials, error content, or blacklisted
  identifiers. Output must stay inside the current workspace and will never overwrite
  an existing file.
- `dbcli evidence validate --file <path> [--format json|markdown]`
  — names the pack's format, then validates the SHA-256 integrity digest and checks
  whether the referenced source evidence is still available. A retained pack whose
  audit/artifact has since rotated, been cleared, or disappeared returns
  `references: "source-expired"` and exits `1`; it remains renderable.

#### Artifact format versions

Packs and receipts carry their own `version`, which is **not** the dbcli package
version — see [ADR-0013](https://github.com/CarlLee1983/dbcli/blob/main/docs/adr/0013-evidence-artifact-format-versions-are-independent-of-the-package-version.md).
The current format is `version: 2`; dbcli 3.0.0 and earlier wrote `version: 1` in two
mutually incompatible layouts.

`validate --format json` reports one of three answers in `status`, and only the first
means the pack can be relied on:

| `status` | `trust` | Meaning | Exit |
| --- | --- | --- | --- |
| `current-valid` | `current-valid` | Current format, digest verified, references resolvable. | `0` |
| `current-references-expired` | `current-valid` | Current format and digest, but a referenced source is gone. | `1` |
| `recognized-legacy` | `not-current-valid` | A pack written by an older dbcli. `legacyFormat` and `producedBy` say which; `integrity` reports whether that format's own digest still verifies. References are **not** evaluated. | `1` |
| `unsupported` | `not-current-valid` | The version is unknown, or the version and the structure disagree. | `1` |

Legacy packs and receipts are readable and integrity-checkable but are never treated as
current-valid, and there is no migration: a pack's identity is derived from its digest,
so rewriting one would mint a new artifact wearing an old one's provenance. Compose a
new pack from current evidence instead.
- `dbcli evidence render --file <path> [--format json|markdown]`
  — validates the active blacklist policy and renders a valid pack without rereading
  the original references, so it remains available for historical review after source
  retention expires.

```bash
dbcli evidence compose --claims ./claims.json --verification ver_abcd --audit 1a2b \
  --receipt .dbcli/evidence/verify-receipt.json \
  --output .dbcli/evidence/review.json
dbcli evidence validate --file .dbcli/evidence/review.json --format json
dbcli evidence render --file .dbcli/evidence/review.json
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
dbcli --use local proxy --listen 127.0.0.1:3307
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

`dbcli proxy analyze` — analyze the captured event log offline (no DB). `--format json|text`, `--top`, `--slow-ms`, `--n-plus-one`, `--no-include-rotated`. Produces summary, per-fingerprint stats, slowest queries, error groups, hot tables, and N+1 suspects.

Each actionable block carries machine-readable next steps so an AI agent can move from diagnosis to fix:

*   **SELECT hotspots / N+1** — `suggestedCommands` with `dbcli explain "<sql>"` and `dbcli guide missing-index-for "<sql>"`.
*   **Errors** — `suggestedCommands` with `dbcli schema <table>` (first 3 tables) plus a `hints` note to verify table/column names before fixing — never guess column names.
*   **N+1 suspects** — a `hints` note suggesting you batch the repeated query (JOIN / `IN (...)`) or cache the result.

The recommended loop: run `proxy analyze`, then for each finding read its `hints`, run its `suggestedCommands` to gather schema/plan evidence, and apply the fix. The text format aggregates these into `SUGGESTED COMMANDS` and `HINTS` sections; the JSON format keeps them attached to each finding. Suggestions are printed as strings only — `proxy analyze` never executes them. When the proxy ran with `--redact literals`, the example SQL contains `?` placeholders; fill in real values before running the commands.

#### Limitations (v1)

- **TLS**: TLS is relayed but not decrypted in v1. Encrypted sessions still produce session and byte-count events, but no SQL is parsed or visible — disable SSL for local analysis sessions when you need query visibility.
- **MySQL prepared/binary protocol**: Best-effort parsing; tagged `prepared_statement`.
- **PostgreSQL extended query protocol**: Best-effort parsing; tagged `extended_protocol` or `parse_partial`.

<!-- doc-key: querylens -->
### QueryLens — Proxy Query Analysis

QueryLens is the shareable Markdown report format of `dbcli proxy analyze`. It turns a proxy event log into a local query-analysis report; it is not a complete database-protocol analyzer.

It needs neither a database connection nor a dbcli connection configuration when analyzing: it reads the JSONL file on disk only. The QueryLens Markdown report redacts SQL literals before analysis. Capture with literal redaction as well, so the event file itself does not retain application values.

#### Quick Start

```bash
# 1. Capture local development traffic in a redacted JSONL log.
dbcli proxy mysql --listen 127.0.0.1:3307 --target 127.0.0.1:3306 \
  --events .dbcli/proxy/events.jsonl --redact literals

# 2. Produce the QueryLens Markdown report locally; no database is contacted.
dbcli proxy analyze \
  --events .dbcli/proxy/events.jsonl --format markdown

# The existing proxy JSON report remains available for machine consumption.
dbcli proxy analyze \
  --events .dbcli/proxy/events.jsonl --format json
```

Point the application at the proxy's `--listen` address while it runs. After stopping the proxy, run the analysis command against the resulting log from the repository root.

#### Analysis Options

| Option | Description |
| :--- | :--- |
| `--events <path>` | Path to the proxy JSONL event log. |
| `--format markdown\|json\|text` | `markdown` produces the redacted QueryLens report; JSON and text keep the standard proxy analysis output. |
| `--top <n>` | Limit ranked findings to the top *n* entries. |
| `--slow-ms <ms>` | Threshold used to classify slow queries in the report. |
| `--n-plus-one <n>` | Repetition threshold used to flag N+1 candidates. |
| `--no-include-rotated` | Analyze only the specified log, excluding rotated sibling logs. |

QueryLens focuses on the proxy events it can read; do not rely on it as evidence that every database protocol or query form was captured. Treat its findings as investigation leads, then verify a query and its schema or plan before changing production code.

<!-- doc-key: advanced-tools -->
### Advanced Tools

| Command | Description |
| :--- | :--- |
| `shell` | Launches an interactive REPL with auto-completion and SQL highlighting. |
| `migrate <action>` | **DDL Engine**: CREATE/ALTER/DROP tables and indexes. A destructive action asks for confirmation on stderr unless `--force`, and reports `status: "cancelled"` if declined. |
| `skill --install` | Installs `SKILL.md` instructions for AI agents (Claude, Gemini, Antigravity, etc.). |
| `skill context` | Serializes cached schema, connections, and saved queries into LLM-optimized XML/JSON/Markdown for AI prompt injection. |
| `semantic validate` / `semantic context` / `semantic search` / `semantic drift` / `semantic migrate` / `semantic draft validate` | Validates, prints, searches, checks drift, stdout-migrates, or safely validates an explicit untrusted query draft against locally cached, blacklist-filtered semantic evidence. Offline and read-only. |
| `contract validate` / `contract context` / `contract search` / `contract drift` | Validates, prints, searches, or checks the optional reviewed `dbcli.contracts.json` against semantic evidence. Offline and read-only; ordinary agent context includes approved contracts only. |
| `design init` / `design validate` / `design render` / `design diff` / `design propose` | Creates an explicit local starter file, validates or renders a version-controlled SQL database design, compares it with either the local SQL schema cache or a local ORM definition, and produces a review-only change plan. It never executes DDL or silently writes a design. |
| `impact assess` | Writes an offline, declared-impact report for a design change against a local schema cache or ORM artifact. It never connects, executes SQL, or claims complete coverage. |
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

> **Business semantic context.** Put a reviewable `dbcli.semantic.json` at the project root to describe business models, visible fields, aliases, relationships, and metrics backed by saved queries. Validate it without connecting to a database:
>
> ```bash
> dbcli semantic validate --format json
> dbcli semantic context --format json
> dbcli semantic search purchases --kind model --format json
> dbcli semantic drift --format json
> dbcli semantic migrate --to 2 --format json
> dbcli skill context --format json
> ```
>
> **How it is discovered.** Installed dbcli skills tell agents to check `skill context` when a request uses business aliases, metrics, recurring terms, or relationship/join intent. If a validated `semantic` section is present, it is the governed vocabulary; otherwise the agent falls back to the blacklist-filtered schema and tells you this optional feature could make future requests consistent. dbcli never creates or changes `dbcli.semantic.json` unless you explicitly ask it to.
>
> Version 1 remains compatible; v2 adds relationships between declared visible model fields. The validator rejects tables or columns absent from the cached visible schema, including blacklisted objects, and metrics whose `query` is not an available `@saved-query`. `semantic search <terms...>` is deterministic and offline; use `--kind` and `--limit 1-100` (default 20). It returns only governed metadata and removes blacklist names from free-text results. `semantic drift` is non-zero for `stale`, `invalid`, or unavailable schema cache; `migrate --to 2` prints JSON but never writes the source file.
>
> **Semantic contracts.** Put an optional, reviewable `dbcli.contracts.json` beside the semantic file to add an owner and descriptive evidence expectation to a governed business term. It must use version `1`, canonical contract names, canonical `model:` / `field:` / `relationship:` / `metric:` subjects, a `draft`, `approved`, or `deprecated` status, and an evidence policy of `none`, `receipt-required`, or `verification-required`. It cannot contain SQL, credentials, protected identifiers, or executable rules.
>
> ```bash
> dbcli contract validate --format json
> dbcli contract context --format json
> dbcli contract search customer --format json
> dbcli contract drift --format json
> ```
>
> These commands never connect or execute queries. `context`, `search`, and `skill context` expose only valid `approved` contracts; draft and deprecated terms remain local review artifacts. A missing contract file leaves ordinary semantic context unchanged, while an explicitly requested missing or invalid file fails closed. `contract drift` distinguishes valid, stale, invalid, and unavailable local evidence: a subject that is not one of the four canonical forms is invalid, while a well-formed subject that no longer exists is stale. Diagnostics name the offending property or subject position, never a rejected key, value, or local path taken from the artifact or the local configuration.
>
> **Agent query drafts.** First give the external agent the reviewed output of `dbcli semantic context --format json`; keep its provider account, credentials, prompt, and any other agent context outside dbcli. The agent returns an untrusted `QueryDraft` file shaped like this (use only the models and fields from that semantic context):
>
> ```json
> {
>   "version": 1,
>   "questionHash": "<sha256-of-the-original-question>",
>   "candidate": { "kind": "sql", "sql": "<reviewed-read-only-sql>" },
>   "semanticReferences": ["model:<model>", "field:<model>.<field>"]
> }
> ```
>
> Submit that explicit file or stdin payload for offline validation:
>
> ```bash
> dbcli semantic draft validate --input ./draft.json --format json
> # or: external-agent | dbcli semantic draft validate --input - --format json
> ```
>
> The report contains only status, hashes, canonical references, and safe violation codes—never the candidate SQL. Exit `0` is valid, `1` is rejected, and `2` means required local semantic evidence is unavailable. A valid result is not execution permission: review the original `draft.json`, then separately and explicitly invoke `dbcli explain "<reviewed-read-only-sql>"` or `dbcli query "<reviewed-read-only-sql>"` if execution is intended. Validation neither saves the input nor invokes either command; dbcli does not receive agent provider credentials or make provider requests.

<!-- doc-key: design-assistant -->
> **Database design assistant.** A new project can keep a reviewable `dbcli.design.json` beside its code. It describes the target PostgreSQL/MySQL/MariaDB models, fields, keys, relationships, indexes, access patterns, and design decisions; it does not contain SQL, credentials, database rows, or provider configuration.
>
> ```bash
> # Writes only to this explicit missing path; edit the starter before validation.
> dbcli design init --output ./dbcli.design.json --dialect postgresql
>
> # Both commands are offline and read-only.
> dbcli design validate --format json
> dbcli design render --format mermaid
> dbcli design diff --against-cache --format markdown
> dbcli design diff --against-orm ./prisma/schema.prisma --format markdown
> dbcli design propose --against-orm ./prisma/schema.prisma --format markdown
> ```
>
> `validate` fails closed for malformed artifacts, missing primary keys, invalid relationship endpoints or cardinality, incompatible relation types, and unsafe indexes. It also reports advisory access-pattern index gaps. `render` produces JSON, Markdown, or a Mermaid ERD only after validation has no errors. `diff --against-cache` reads the existing local cache (run `schema` first), never opens a connection, and reports columns, indexes, and foreign keys that differ. `diff --against-orm` is fully local: compare with an explicit Prisma, DDL, Drizzle snapshot, or normalized JSON artifact without configuration or a database connection; DDL files may use globs. Both modes are read-only and choose exactly one comparison target. `propose` adds per-change blacklist/schema preflight, a dry-run command only where existing migration support is lossless, a rollback reminder, and an after-write read-only verification plan; every other change escalates to `migration-review`. It never applies a write. `init` is the only writer, requires `--output`, and refuses to overwrite an existing file. These commands do not call an LLM or query data; an external coding agent may draft the file, but a human should review it before relying on it.

> **New project workflow.** Run `design init`, edit the explicit artifact, then run `design validate` and `design render`. If application models already exist, use the offline `design diff --against-orm <path>` to make the artifact and ORM agree before any database exists.

> **Existing database evolution.** Run `blacklist list`, refresh the cache with `schema --format json`, then use `design diff --against-cache` and `design propose --against-cache`. Review the plan and separately perform any approved migration; afterwards refresh the schema and rerun the same diff. Neither design command writes the database.

> **Impact assessment.** Before presenting a schema change as safe, write a bounded report of the known governed dependencies:
>
> ```bash
> dbcli impact assess --design ./dbcli.design.json --against-cache --events ./.dbcli/proxy/events.jsonl --output ./impact.json --format json --fail-on warn
> dbcli impact assess --design ./dbcli.design.json --against-orm ./prisma/schema.prisma --output ./impact.md --format markdown --fail-on never
> ```
>
> Choose exactly one baseline. The command reads only the explicit design/ORM file or existing local cache, semantic contracts, saved-query names, verification artifact metadata, and optional reviewed `dbcli.data-access.json` operation metadata. That manifest must use canonical semantic references and existing workspace-relative source paths; dbcli never reads or parses those source files. An optional explicit `--events` file is streamed through a redaction-first projection that retains only recent safe table metadata; it never starts a proxy, reads rotated logs, or renders SQL, literals, errors, sessions, or paths. Missing, malformed, stale, unreadable, or redaction-failed workload evidence remains a visible advisory coverage gap and cannot by itself make `--fail-on warn` fail. The command does not connect, refresh the cache, execute SQL, read query bodies, or publish protected identifiers. Missing, invalid, or redacted evidence is a visible `partial` coverage gap; v1 never reports complete coverage. `--fail-on` changes only the exit code (`error`, `warn`, or `never`) after the report has been written.

> **Builtin task pack `analyze-table-perf`.** A read-only (`plan-only`) pack that takes a required `table` parameter and walks `blacklist list` → `schema <table> --format json` → `guide index-usage --format json`. `dbcli inspect` suggests it automatically for the hottest table in recent activity. Other read-only packs ship too — `audit-permissions`, `safe-backfill`, `schema-drift-review`, `orm-drift-review`, `design-review`, and `connection-health`. `design-review` validates/renders the artifact, refreshes the cache, and emits review-only proposals; it never applies them. Every pack requirement is a capability ID checked against the local engine, permission, and agent-mode context before a plan is emitted; unknown IDs and unavailable requirements fail closed. Browse all packs with `dbcli skill tasks list`.

> **`safe-backfill-verify` task plan and the `verification` block.** Running `dbcli skill tasks plan safe-backfill-verify --format json` returns a plan JSON that includes a `verification` block with `status: "planned"`. This block describes the read-back assertion that will be run — it is the **planned** evidence definition, **not** a result. A `status` of `"planned"` does **not** mean verification has run or passed; it means the task plan knows which check to perform when the task executes.

---

<!-- doc-key: html-dashboards -->
## Interactive HTML Dashboards

Use the `--ui` flag to open query results in an interactive React dashboard in your browser.

```bash
dbcli query "SELECT * FROM daily_metrics" --ui
```

**KPIs & Charts**: Add a `visual:` block to your snippet's frontmatter to render custom charts and KPIs directly in the dashboard. Supported chart types are `line`, `bar`, `area`, and `pie`; any other type is rejected at parse time.

When dbcli's lookahead proves that rows were truncated, the dashboard shows a warning **before** every KPI, chart, and table and names the applied limit. Blacklist redaction/omission notices appear there as well. This applies to query HTML/UI, saved-query HTML/UI, and HTML exports whenever that execution path produces the corresponding metadata.

**Execution traceability (saved queries)**: a dashboard generated from a saved query (`dbcli q @name --ui` / `--format html`) carries a standalone **Execution Traceability** section, shown after the truncation and blacklist notices and before the KPIs, charts, and table. It travels inside the HTML file, so a recipient sees it without dbcli, a database, or your workspace.

| Field | Meaning |
| --- | --- |
| Connection | Logical connection name — the v2 connection key, or `default` for a single-connection config. Never a host or endpoint. |
| Engine | `postgresql`, `mysql`, `mariadb`, `mongodb`, `redis`, or `elasticsearch`. |
| Saved Query | The snippet key, such as `@dau`. Never its file path. |
| Snippet Source | `builtin`, `shared`, or `local`. |
| Effective Permission | The permission that actually governed the execution: `query-only`, `read-write`, `data-admin`, or `admin`. |
| Applied Limit | The row cap that actually applied, and whether the result was truncated — or "No limit applied", which is stated explicitly rather than left blank. |

The applied-limit line always agrees with the truncation warning above it; a dashboard whose provenance and warning disagree is refused before the file is written.

Traceability is a closed contract. It never carries raw query bodies, parameter values or enums, credentials, endpoints, source paths, verification queries and expectations, target index or collection names, or rows beyond the ones displayed. The same allowlist governs the whole embedded payload, not just the visible section: only the displayed rows, the applied-limit and security notices, the provenance object, and the display name, description, and chart/KPI definitions that reference displayed fields are serialized. Invalid, oversized, or unknown metadata is rejected before any HTML is written, so a failed dashboard never leaves a partial file behind.

Direct-query dashboards (`dbcli query --ui`, `dbcli export --format html`) are unchanged and carry no traceability section.

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

### MongoDB connection configuration

`dbcli init --system mongodb` defaults to a field-by-field wizard, matching the SQL engines: Host, whether it is an SRV domain, Port (skipped for SRV), User, and — only when a User is set — Password plus `authSource`, followed by an optional advanced step for `replicaSet` / `tls`. Pasting a full connection string is now the explicit second choice ("Paste a full connection string (advanced)"). Non-interactive usage is unchanged: passing `--uri` skips the mode prompt entirely and behaves exactly as before.

Field-based connection options (`ConnectionConfig`, `src/types/index.ts`):

| Field | Type | Purpose |
| --- | --- | --- |
| `authSource` | string or `{"$env": "..."}` | Auth database; defaults to `admin` once a user is configured. |
| `replicaSet` | string or `{"$env": "..."}` | Replica set name. |
| `tls` | boolean | Enable TLS. |
| `srv` | boolean (default `false`) | Build a `mongodb+srv://` URI and resolve hosts via DNS SRV; `port` is ignored when `true`. |
| `timeout` | number (ms, 100–600000) | Connection timeout; overridable per invocation with root-level `--timeout <ms>`. Defaults to the adapter's built-in 5000ms when neither is set. Unlike the other fields in this table, it does not accept an `{"$env": "..."}` reference — only a literal number. |
| `statementTimeout` | number (ms, 0–3600000) | How long one statement may run, independent of the connection timeout; overridable with root-level `--statement-timeout <ms>`. Falls back to `timeout` when unset, and to the server's own setting when neither is given. `0` removes the limit. Literal numbers only, like `timeout`. |

`--auth-source <db>` is available as a non-interactive `init` flag. `replicaSet` and `tls` have no dedicated flag yet — set them through the interactive advanced step, or edit `.dbcli` directly afterward (the same pattern already used for Elasticsearch's `caPath` / `rejectUnauthorized`).

If a config carries both `uri` and per-field values (`host` / `user`), `uri` wins and the per-field values are silently ignored, exactly as before — but `dbcli doctor` now reports this as a warning, so an edited field that "did nothing" is diagnosable instead of mysterious. `doctor` also warns when `srv: true` is combined with a non-default `port`, since SRV records carry their own ports.

A field-mode `user` with no `password` now fails closed with an error instead of silently downgrading to an unauthenticated connection. `user`, `database`, and `password` values are consistently percent-encoded when the URI is assembled, so characters such as `@` or `/` in a username or database name no longer shift where the driver parses the authority.

Connection failures are classified into actionable hints: authentication failures point at `user` / `password` / `authSource` (Atlas and most self-hosted setups use `admin`); DNS/SRV failures point at the `srv` setting and local network DNS restrictions; TLS/certificate failures point at the `tls` field and CA trust configuration.

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

The dbcli config `blacklist.columns[<collection>]` accepts dotted paths, and every segment is a glob (`*`, `?`, character classes like `[abc]`):

```json
{
  "blacklist": {
    "columns": {
      "users": ["password", "profile.email", "profile.tokens.*", "pass*"]
    }
  }
}
```

`pass*` matches `password`; wildcards don't cross dots, so `pass*` does not match `user.password`. A wildcard in a middle segment is legal too — `profile.*.email` matches `profile.<any segment>.email`. The one special form is preserved: a final segment that is exactly `*` still covers the path itself and every descendant, so `profile.tokens.*` covers `profile.tokens` and everything beneath it. A rule that fails to compile — an empty path segment (`a..b`), an empty string, a non-string — now aborts the operation with an error naming the entry and the reason; it used to be dropped silently while the CLI still printed "Some fields may have been redacted". Read masking, request-side checks on `$project` / `$group` and the like, and `insert` and `update` (which now collects fields from every update operator, not just `$set` / `$unset`) all compare against the same compiled rules, so a rule can no longer protect a read while leaving the same write open. SQL and Elasticsearch connections understand entries containing `.` as well: both the literal form (`profile.ssn`) and the wildcard form (`profile.ss*`) descend into a nested record — a PostgreSQL `jsonb` column, an Elasticsearch `_source` object — removing the key they match and leaving its siblings. An Elasticsearch key flattened to `profile.ssn` at the top level matches the same rule.

**A request that names a protected field is refused, not masked.** Masking
matched the keys a document came back under, and in MongoDB the request chooses
those keys: `[{"$project":{"leak":"$password"}}]` returned the value under
`leak`, and `[{"$group":{"_id":"$password"}}]` returned it under `_id`, which
masking exempts so that document references survive. Both ran at `query-only`
before 4.0.0. So `password` appearing anywhere in a pipeline, filter or update —
as a field path, an object key, or a plain string — is refused with
`BlacklistRejection`, and masking stays for the ordinary document shape.

This over-refuses in one direction on purpose: a filter whose *value* happens to
equal a protected field name (`{"status": "password"}`) is refused too. Rename
the query, or the rule.

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

Results carry a `warnings[]` array: `REDIS_SIZE_REWRITE` when arguments were rewritten, `REDIS_SIZE_TRUNCATE` when the reply was trimmed. `dbcli query` prints each one on stderr, and a trimmed reply also reports `truncated` / `limit_applied` the same way every other engine does, so a capped reply is never mistaken for a complete one. Pass `--no-limit` (CLI) or run `.no-limit on` (shell) to bypass.

```bash
dbcli query "LRANGE jobs 0 -1"          # capped to 1000 → REDIS_SIZE_REWRITE
dbcli query "HGETALL bighash" --no-limit  # full reply, no truncation
```

**Blacklist** — rules are enforced as Redis-native key globs (`*`, `?`, `[abc]`, `[a-z]`):

```bash
dbcli blacklist table add 'secrets:*'
dbcli query "GET secrets:api_key"   # rejected (BlacklistRejection); audited with matched_pattern
dbcli query "KEYS secrets:*"        # rejected (pattern overlaps a rule)
dbcli query "SCAN 0 MATCH secrets:*" # rejected (pattern overlaps a rule)
dbcli query "SCAN 0"                 # runs; protected key names removed from the reply
dbcli delete secrets:api_key         # rejected — globs cover writes, not just reads
dbcli list                           # blacklisted keys filtered out
```

The globs cover **writes as well as reads**. Before 4.0.0, `insert`, `update`
and `delete` compared the key name literally, so a rule written `secrets:*` —
the spelling above — protected `dbcli query` and let `dbcli delete
secrets:api_key` through. `SCAN` was the other half: its `MATCH` pattern was
never checked, so it enumerated protected key names at `query-only` while
`KEYS` needed `admin`.

A command dbcli has no key-arity entry for is now **refused** while a blacklist
is configured, rather than passed through unchecked. With no blacklist
configured nothing changes.

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

- **Capped at 1000 rows** by default, and hitting that cap **fails the export** rather than writing a short file. Pass `--no-limit` to export the full index (the full-index form streams in scroll batches) or `--limit N` to accept a cap deliberately.
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
9.  **Shared agent CLI interface**: package consumers can import `@carllee1983/dbcli/agent-core` for `loadEnvFile`, `resolveEnvRef`, `resolveConnectionSelector`, `parseConnectionNames`, and `trimAppliedLimit` plus `AppliedLimitMetadata`, `AppliedLimitResult`, and `ConnectionSelectorInputs`. This small interface is framework- and database-independent and follows semver. The broader `./core` product interface remains separate; CLI option factories, config-storage binding, and connection-string parsing deliberately stay outside `agent-core`.

### Bounded cross-engine context (version 2)

Use `dbcli skill context --context-version 2 --format json` when handing database metadata to an external agent. Version 2 is the stable agent contract; it is offline and never opens a connection, constructs an adapter, scans Redis keys, reads documents, or reads project source. The agent may inspect project code itself, subject to its own workspace safety rules, to supply business meaning that context does not contain.

```bash
dbcli skill context --context-version 2 --format json
```

Give the agent this output and its own safely discovered code context; do not give dbcli source paths or ask it to interpret natural language. Treat `permission` and descriptive `capabilities` as limits, not authority to execute a command. Use only the returned resources and approved semantic/contracts metadata. If metadata is absent or a `gaps` entry is returned, do not infer names, types, relationships, keys, or meanings: inspect permitted project code or ask for the missing evidence.

Version 2 emits only safe fields: configured engine and permission; blacklist policy; capability `command`, `status`, and `sideEffectTier`; resource and field IDs/names/types; visible SQL nullable/primary-key and visible foreign-key links; flattened Elasticsearch field paths/types; declared Redis families/fields; snippet metadata without bodies/defaults; declared data-access metadata without source paths; approved semantic/contracts metadata; truncation counts; and gaps. It never emits credentials, values/results, defaults/counts, raw Elasticsearch mappings or settings, Redis keys/values, query bodies/defaults, or project source paths/contents. Blacklisted identifiers appear only in `blacklist`.

| Engine | Version 2 resources | Boundary |
| --- | --- | --- |
| PostgreSQL, MySQL, MariaDB | Cached visible tables, safe columns, and visible foreign-key links | No defaults, counts, indexes, comments, or filtered endpoints. |
| Elasticsearch | Cached indices with flattened field paths and types | No raw mappings, `_meta`, settings, scripts, analyzers, documents, or counts. |
| Redis | Repository-declared `dbcli.redis-context.json` key families and fields | No discovery, scans, concrete keys, live types, or values. |

Redis declarations are intentionally small: context file ≤512 KiB; ≤500 families; a family name is lowercase kebab-case, pattern ≤200 characters with unique valid `{placeholder}` values and no glob tokens, whitespace, controls, or backslashes; type is `string`, `hash`, `list`, `set`, `zset`, or `stream`. Only `hash` and `stream` may declare fields (≤100); family descriptions/field descriptions are ≤1,000 characters and aliases are ≤20 of ≤100 characters. A declaration that is malformed, concrete, unsafe, blacklisted, or overlaps a Redis field mask fails rather than exposing a partial model.

Missing optional evidence is explicit: `SQL_SCHEMA_UNAVAILABLE`, `ELASTICSEARCH_MAPPING_UNAVAILABLE`, `REDIS_KEY_FAMILIES_UNAVAILABLE`, `SEMANTIC_CONTEXT_UNAVAILABLE`, `SAVED_QUERIES_UNAVAILABLE`, `DATA_ACCESS_UNAVAILABLE`, or `ALL_RESOURCES_FILTERED`; truncation also reports `CONTEXT_TRUNCATED`. Present but invalid evidence fails with the corresponding `INVALID_SCHEMA_CACHE`, `INVALID_SEMANTIC_CONTEXT`, `INVALID_SAVED_QUERY`, `INVALID_DATA_ACCESS_MANIFEST`, `INVALID_REDIS_CONTEXT`, or `INVALID_RESOURCE_REFERENCE`. MongoDB (and unknown engines) reject explicit v2 with `UNSUPPORTED_CONTEXT_ENGINE`.

Omitting `--context-version` keeps byte-compatible version 1 JSON, XML, and Markdown output. `version` remains configuration metadata; v2 adds the integer `contextVersion: 2`. Consumers must ignore unknown optional v2 fields; incompatible required-field or ID-encoding changes require a new context version.

### Intent confirmation for business requests

The installed skill supports three **per-request conversational preferences**; they are
not dbcli flags or saved configuration. An agent must not first ask the meta-question
“do you want questions?”

| Preference | Agent behavior |
| --- | --- |
| `auto` (default) | Resolve terms from governed semantic context and schema evidence. Ask one compact batch only when unresolved ambiguity would materially change the result; otherwise state assumptions and proceed. |
| `confirm` | State the proposed interpretation and wait for approval before the task's data query. |
| `guided` | Ask short, focused questions to establish the request, and retain the answers through the task. |

For example, “show yesterday's sales” is ambiguous when its result shape (total or
detail), metric definition, timezone, status/refund treatment, grouping, or connection
is unknown. The agent should summarize its candidate interpretation and ask only the
result-changing questions. If the user explicitly asks it to decide without more
questions, it proceeds in `auto` mode and discloses its material assumptions. This
preference never bypasses blacklist, schema, permission, dry-run, production-selection,
or write-confirmation gates.

### When dbcli is a better fit than an MCP database server or a direct client

There is no universal winner. A direct database client is the shortest path when a trusted human is working in a disposable local environment. An MCP database server is useful when an agent host needs a conversational, tool-shaped integration for low-risk exploration. `dbcli` is the better boundary when the same database task must be safe and repeatable for an agent, a human, CI, or an incident runbook.

| Choose | Best fit | Trade-off |
| --- | --- | --- |
| A direct database client | A trusted operator is making a one-off change with a least-privilege credential | The safety, review, and evidence conventions must be rebuilt in every client and script. |
| An MCP database server | An agent host needs interactive, low-risk discovery through its tool interface | The host and server define the authorization and audit surface; it is usually not the same surface used by CI or a terminal runbook. |
| `dbcli` | A database operation must have one command contract across people, agents, automation, and recovery | It is deliberately a CLI surface, so an agent needs shell-command authorization rather than a native MCP tool. |

#### Quick visual decision guide

```text
Throwaway local experiment ───────────────────────→ Direct client
Interactive, host-bound exploration ──────────────→ MCP database server
Realistic data, shared fixtures, CI, or a runbook ─→ dbcli
```

The key question is not whether the database is local. It is whether the result must outlive the agent session. When a quick local experiment becomes a shared, repeatable, or reviewable operation, move it onto the dbcli command path.

### Even for local vibe coding

Local development changes the blast radius, not the basic failure modes. A direct client is perfectly reasonable for a throwaway database with synthetic data when you are watching every statement. It is faster because the agent can connect, inspect, and run ad-hoc SQL immediately.

The trade-off is that the client session becomes the entire safety contract. The agent can still guess a column name, query a local production dump, run an unbounded statement against fixtures worth keeping, or leave a change that nobody can replay when the task moves to CI. A database client may offer its own protections, but they are not automatically the same policy or workflow that the rest of the project uses.

`dbcli` adds a small, deliberate pause before the agent acts: inspect the protected surface, read the real schema, and preview a write. The commands are also the handoff artifact. A developer can paste the same sequence into a terminal, a test script, or a PR description instead of reconstructing what happened in an agent-owned client session.

```bash
dbcli blacklist list
dbcli schema <table> --format json
dbcli update <table> --where "<predicate>" --set '<json>' --dry-run
```

That does not mean every local SELECT deserves ceremony. Use the direct client for a disposable experiment whose result has no operational life. Use dbcli as soon as the agent touches realistic data, modifies shared fixtures or migrations, needs a repeatable answer, or is likely to carry the work into CI, staging, or production. The value is not that the CLI makes local development magically safe; it makes the transition from a quick experiment to an accountable workflow explicit.

`dbcli` is stronger in the last case for four practical reasons:

1. **The operator can review and authorize the invocation.** A command is a concrete artifact: a human can inspect the selected connection, operation, and flags before it runs. On hosts that authorize CLI arguments, such as Claude Code, this permits a useful gradient—safe discovery commands can be pre-authorized while queries or writes still require review. MCP permissions are commonly granted at the tool-name boundary; whether finer argument-level policy exists depends on the host and server.
2. **The same guardrails run outside the agent.** Permission tiers, blacklist checks, result limits, schema discovery, dry-run preflights, and machine-readable output live on the CLI path. A CI job and an incident responder can use the same commands and receive the same enforcement instead of relying on a particular editor or agent session.
3. **The workflow leaves operational evidence.** Use `--recovery` on supported commands to emit a structured failure envelope and link it to the audit record. Saved queries and task packs are files that a team can version, review, and reuse rather than instructions that exist only in a chat transcript.
4. **The tool still works when the agent is absent.** A terminal, Makefile, CI job, or runbook can execute the command with meaningful exit codes. That makes dbcli a durable operational interface, not only an AI integration.

For example, the safe baseline for an agent-assisted data change is still a sequence a person or CI can reproduce:

```bash
dbcli blacklist list
dbcli schema <table> --format json
dbcli update <table> --where "<predicate>" --set '<json>' --dry-run
```

Use an MCP server when its conversational interface is the main value and its authorization, logging, and execution model satisfy the environment's requirements. Use a direct client when its simplicity is appropriate for the risk. Choose dbcli when the important product is the governed, reviewable execution path—not merely the ability to send a query.

> **Security boundary:** dbcli is defence in depth, not a substitute for database authorization. Give the agent only a least-privilege database credential. A process that can change its own dbcli configuration can raise its declared permission or choose another client; blacklist and dry-run controls cannot make that credential safe by themselves.

---

<!-- doc-key: developer-workflows -->
## Developer Workflows

Beyond ad-hoc queries, `dbcli` is built for the common development tasks where a database is involved. The agent skill ([`SKILL.md`](../../../assets/SKILL.md)) ships a compact router for these; the same scenarios apply when you drive `dbcli` yourself:

- **DB-backed feature**: map product/code terms to real objects before editing code (`inspect --for-agent` → `blacklist list` → `schema <object>` → `queries suggest <intent>`).
- **Application data bug**: separate stored facts from application-code inference (`inspect --for-agent` → `audit tail --for-agent` → `schema <object>` → a narrow query).
- **ORM or migration work**: ground model and migration edits in cached schema evidence (`schema --format json` → `diff --against-orm <orm-schema>` → review errors → dry-run `migrate` proposal → `migration-review` with captured DDL → snapshot verification after applying).
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

`slow-endpoint-investigation` takes a required `query` and a required `table`, and plans in evidence order: `blacklist list` → `proxy analyze --format json` → `schema <table> --format json` → `explain "<SQL>"` → `guide missing-index-for "<SQL>" --format json`. The schema step comes before explain and index guidance on purpose — a plan or index candidate read against a table whose live shape you have not confirmed is a guess. Planning emits the commands and nothing else: it opens no connection, reads no proxy events or schema, runs no SQL, and invokes none of the steps. A proxy finding is what was observed locally, not the proven cause of endpoint latency, and an index candidate is review material — the workflow creates no index, applies no migration, and runs no DDL. Omitting `query` or `table` fails with a bounded error and emits no partial plan.

```bash
dbcli skill tasks list --format json                       # discover packs
dbcli skill tasks plan <pack> --param k=v --format json    # generate an ordered, risk-labelled plan
```

| Situation (what the user says) | Path | Pack |
| --- | --- | --- |
| "This SQL is slow" (you have the statement) | `skill tasks plan diagnose-slow-query --param query="<SQL>"` → `lint "<SQL>"` → `guide missing-index-for "<SQL>"` | `diagnose-slow-query` |
| "Table X is hot / heavy" (you have the table) | `skill tasks plan analyze-table-perf --param table=<table>` | `analyze-table-perf` |
| "This API endpoint is slow" | `skill tasks plan slow-endpoint-investigation --param query="<SQL>" --param table=<table>` (blacklist → `proxy analyze` → `schema` → `explain` → missing-index) | `slow-endpoint-investigation` |
| Whole-environment perf scan | `report --section perf` → `guide slow-query` | _(report + guide, no pack)_ |
| "Audit access before granting writes" | `skill tasks plan audit-permissions` (optional `--param table=<table>` to spot-check column coverage) | `audit-permissions` |
| "Does the live schema match the committed cache?" | `skill tasks plan schema-drift-review --param table=<table>` | `schema-drift-review` |
| "Does this ORM definition match the cached DB schema?" | `skill tasks plan orm-drift-review --param orm_path=prisma/schema.prisma` | `orm-drift-review` |
| "Is the connection healthy?" | `skill tasks plan connection-health` | `connection-health` |
| "Review this DB-touching PR" | `skill tasks plan pr-database-review`; run any DDL/index idea through `migration-review` before writing | `pr-database-review` / `migration-review` |
| "Backfill column X safely" | `skill tasks plan safe-backfill-verify --param table=<t> --param query="<UPDATE>" --param verify_query="<SELECT count(*)>"` | `safe-backfill` / `safe-backfill-verify` |

Packs resolve **local > shared > builtin**: `assets/tasks/` (builtin), `.dbcli-shared/tasks/` (team), `.dbcli/tasks/` (local override). A plan never overrides blacklist, schema, dry-run, or confirmation requirements — execute its steps one at a time.

### B. Cross-cutting scenarios

- **Switch between environments (v2)**: `dbcli use prod` changes the default; `dbcli query --use staging "<SQL>"` overrides for one call only. Each named connection has its **own schema cache** at `.dbcli/schemas/<conn>/` — run `dbcli schema --use <name>` once after switching, or you may read another connection's columns. (See **Connection Management**.)
- **Reference env vars for secrets in CI**: connection settings already live in home storage (`~/.config/dbcli/…`), never in the project `.dbcli/`. `dbcli init --use-env-refs` goes further and stores `{ "$env": "VAR" }` references resolved at runtime instead of any plaintext. In a non-interactive run you **must** pass all five `--env-*` flags or `init` errors out — it never silently falls back to plaintext. **MongoDB differs**: only `--env-host` is required; `--env-port` / `--env-user` / `--env-password` / `--env-database` are optional, and an omitted one is written as a literal value (empty string for `user` / `password`, the resolved value for `port` / `database`) rather than an `$env` reference that would later fail closed for a field the connection was never meant to have. `init` also skips the connection test in this mode — the `$env` references have no value to connect with yet — regardless of `--skip-test`.
- **Verify an invariant or write outcome**: `snapshot` captures a baseline → `assert --against <snap> --tolerance <pct>` compares; `q @name --verify` runs snippet assertions; `recover --apply --write-verification-artifact` persists secret-free evidence. (See **Data Verification**.)
- **Spot N+1 / slow queries in local dev**: run the app through `dbcli proxy <engine> --listen ... --target ...` to capture events, then `dbcli proxy analyze` aggregates them offline into N+1, slowest-query, and hot-table findings. (See **dbcli proxy**.)

### C. Engine-specific scenarios

- **MongoDB**: schema is `$sample`-based (dot-paths carry `presence` / `redacted`); every blacklist path segment is a glob (`pass*`, `profile.*.email`), a final `*` still covers the whole subtree (`profile.tokens.*`), and read masking and `insert`/`update` writes compare against the same rules. Writes auto-wrap as `$set` unless an explicit operator (`$inc` / `$push` / …) is present.
- **Redis**: `q @snippet` runs **read-only** commands only; `delete` covers `DEL` / `HDEL` / `LREM` / `SREM` / `ZREM` (needs `data-admin`); protect keys with a glob blacklist (`secrets:*`) plus optional value masking. There is no `--dry-run` on `query` — safety is the permission gate; preview a delete with `delete <key> --dry-run`.
- **Elasticsearch**: query with a DSL body or Lucene string (`--collection <index>`); `export` a whole index via `match_all` scroll; `shell` opens a Kibana Dev Tools-style REPL.

---

<!-- doc-key: agent-recovery-workflow -->
## Agent Recovery Workflow

> This section covers the three most common scenarios and the shared flow only. The full error-code matrix, multi-turn `--next` semantics, risk-gate details, and the Audit ↔ Envelope pivot live in [`assets/reference.md` Recovery Cookbook](../../../assets/reference.md#recovery-cookbook-agent-walkthroughs).

When any of `query` / `q` / `insert` / `update` / `delete` / `export` / `schema` / `inspect` / `lint` / `diff --against-orm` is invoked with `--recovery` and fails, a `RecoveryEnvelope` JSON is printed to stdout **and atomically written** to `.dbcli/last-recovery.json`. The agent then inspects it with `dbcli recover` or executes it automatically with `dbcli recover --apply` (which by default only runs `readonly` + `dry-run` steps).

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

One connection-class error does **not** branch: a statement canceled by the server for exceeding the statement timeout (PostgreSQL SQLSTATE `57014`, MySQL `3024`, MariaDB `1969`). It reports as `CONN_TIMEOUT` with `details.connectionCode` set to `STATEMENT_TIMEOUT`, and that field is what separates it from a real connection timeout — the connection is healthy, so the plan works on the query (`dbcli lint`, `dbcli explain`, then a re-run with an explicit `--statement-timeout <ms>`) instead of running `doctor`. Because step 1 is not `doctor`, no `branches` or `branchFork` is emitted, and no `verify` step either — nothing verifies this error except re-running the statement, which only the caller has. All three steps carry placeholders, so `dbcli recover --apply` reports `skipped-only` and runs nothing.

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

Already-categorized errors keep their original code, message, and hints across nested adapter calls, so messages are not prefixed twice. MySQL 8 schema introspection is compatible with the default `ONLY_FULL_GROUP_BY` mode.

When a connection's config fails schema validation, dbcli reports one line per invalid
field path (resolved against that connection's declared `system`) instead of the raw
nested union-error tree, so a broken `.dbcli` can be fixed without guessing which engine
branch applies.

### Bounded CLI error output

Connection-bearing discovery and read failures exit with code `1` and are presented once. In normal mode,
stderr contains a readable message plus a stable error code and actionable hints
when available; it does not contain a JavaScript stack, bundled source excerpt,
or source-code frame. Add `-v` (or `-vv`) before the command to include the stack
for diagnostics — the flag must precede the subcommand (`dbcli -v list`, not
`dbcli list -v`). The write commands (`insert`, `update`, `delete`) and `q` keep
their own localized wording, and honour the same stack switch. That wording is
chosen by error code: only a genuine transport failure (`ECONNREFUSED`,
`ETIMEDOUT`, `AUTH_FAILED`, `ENOTFOUND`, `EHOSTUNREACH`, `CONNECTION_LOST`,
`TOO_MANY_CONNECTIONS`, `TLS_ERROR`, `SERVER_NOT_READY`, `CONNECTION_REJECTED`) is
reported as a connection failure —
a statement-level error such as `TABLE_NOT_FOUND` or `STATEMENT_TIMEOUT` reaches
the server fine, so it is reported as itself, with its hints, rather than as
"failed to connect". When a supported command uses `--recovery`, the existing JSON
recovery envelope remains the only failure output on stdout and the duplicate
human stderr message is suppressed.

### Complete redirected stdout

When stdout is piped or redirected, `dbcli` completes the entire write before
exiting. Large JSON, CSV, and HTML results therefore remain intact through
commands such as `dbcli query --format json | jq ...` and
`dbcli export ... | cat > result.json`; a successful exit never represents a
partially written stdout buffer.

### Query-only mode auto-LIMIT

`dbcli` auto-appends `LIMIT 1000` to `SELECT` queries in `query-only` mode. This
**does not** apply to:

- `SHOW` / `DESCRIBE` statements (LIMIT is not valid syntax here)
- `EXPLAIN` / `EXPLAIN ANALYZE` / MariaDB `ANALYZE SELECT`

Use `--no-limit` on `SELECT` to disable when querying `information_schema`.

For a dbcli-owned limit (the query-only default or an explicit `--limit N`),
dbcli fetches one lookahead row so the output can distinguish an exact N-row
result from a larger result. Truncated table output ends with
`Rows: N (truncated; limit N)`. JSON always includes
`metadata.truncated` and `metadata.limit_applied` when dbcli applied the limit;
`truncated` is `true` only when the lookahead proved that another row existed.
CSV appends a `# truncated; limit N` comment line. These fields are omitted for
`--no-limit` and for a limit already written in the SQL, MongoDB pipeline, or
Elasticsearch request body.

Saved snippets run through `dbcli q` report the same way. The snippet size
guard wraps the body in its own 1000-row cap, and that cap is now stated in the
footer and in `metadata` instead of leaving a round row count to be guessed at.

`dbcli export` does not report truncation — it refuses it. An export whose rows
were capped by the query-only auto-limit exits `1` without writing a file:

```text
Export would silently drop rows — 1000-row auto-limit reached.
  Re-run with --no-limit to export everything,
  or --limit 1000 to accept the cap explicitly.
```

An exported file has nowhere to record that rows are missing — `jsonl` is one
document per line and MongoDB's `--format json` is a bare array — and a stderr
warning does not survive redirection. Naming `--no-limit` or `--limit N` makes
the choice explicit, and only then does the export proceed.

### Bounded table cells

`dbcli query` table output limits each serialized cell to 120 Unicode code
points by default. Use `--truncate N` to set a different positive-integer
limit, or `--no-truncate` to show complete table cells. The two flags are
mutually exclusive.

Cells keep their existing serialization rules before the limit is measured:
null and undefined values become empty text, objects are serialized as JSON,
and primitives use their string representation. If a serialized value exceeds
the limit, dbcli retains the first N code points and appends a marker such as
`…(+3412 chars)`. The marker is outside the retained N-character budget, and
its count is the number of omitted Unicode code points.

This behavior belongs only to table formatting and never mutates the query
rows. JSON and CSV output therefore remain lossless. An explicit `--truncate`
used with JSON, CSV, or HTML output (including `--ui`) is rejected instead of
being silently ignored.

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
