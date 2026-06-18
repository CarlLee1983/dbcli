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

## AI agent workflow (follow in order)

0. `dbcli skill context --format xml` — LLM prompt context payload: serializes connection metadata, schema caches, and saved queries into a compressed XML/JSON structure for prompt injection.
1. `dbcli inspect --for-agent` — bounded snapshot: connection, permission, blacklist, objects, snippets, suggested next commands.
2. `dbcli report --format json` — diagnostic report (health/capacity/perf) using built-in snippets.
3. `dbcli guide <goal> --format json` — deterministic next-command plan for a fixed goal (`slow-query`, `capacity`, `health`, `index-usage`, `permissions`, `schema-overview`). Use `dbcli guide --list` to see goals.
4. `dbcli recovery --code <CODE>` — look up structured recovery commands for a known error code (e.g. `CONN_REFUSED`, `PERMISSION_DENIED`, `SNIPPET_NOT_FOUND`). Pass `--recovery` to `dbcli query` / `dbcli q` to have failures emit a `RecoveryEnvelope` directly. In v1.16.0 the `--recovery` flag is also accepted by `dbcli insert`, `dbcli update`, `dbcli delete`, `dbcli export`, `dbcli schema`, and `dbcli inspect` (which also gained `--require-schema-cache` for the `SCHEMA_CACHE_MISSING` path).
   - **v1.17.0** `dbcli recover` reads the auto-saved envelope (`.dbcli/last-recovery.json`) written by any prior `--recovery` failure. Inspect it (Markdown by default) or pass `--apply` to execute the saved plan under risk gating.
   - **v1.17.0** `dbcli recover --apply` runs `risk=readonly` and `risk=dry-run` steps by default. Open the gate one tier with `--allow-write=readonly-cmd` (run local-side writes such as `blacklist remove`) or `--allow-write=write-cmd` (also run steps that mutate the connected database). Pass `--from <file>` to read an explicit envelope instead of the auto-saved one. Use `--format json` for an aggregated machine-readable result.
   - Exit codes: `0` ok, `1` step failed, `2` envelope missing/malformed, `3` every step skipped (open `--allow-write` or fix interactive/placeholder).
   - GuideStep optional fields agents should respect:
     - `interactive: true` — step requires a TTY (`dbcli init` family). `dbcli recover --apply` skips with `skipped:interactive`.
     - `dbWrite: true` — step mutates the connected database. Gates the highest risk tier; reserved for future write-side recovery steps.
     - `placeholders: ['<token>', ...]` — agent must replace these tokens before `--apply` will execute. Skipped with `skipped:placeholder`.
   - **v1.17.0 P4 Verification.** After `--apply` finishes the main plan, dbcli runs **one extra read-only step** (`envelope.verify`) to probe whether the original failure is gone. The output gains `verifyResult` (the executed step) and `verifyStatus`:
     - `passed` — verifier exited 0 and (where applicable) the expected JSON shape was found.
     - `failed` — verifier exited non-zero or timed out.
     - `indeterminate` — verifier exited 0 but the heuristic could not confirm the fix (JSON parse failure, missing field, gate skip).
     Verify is **only run when** `finalStatus === 'ok'`. Pass `--no-verify` to skip it. Heuristic is intentionally cheap; agents should still re-run their own check against the original failing operation when correctness matters.

Verification outcome vocabulary: use `verified` only when required evidence matched;
use `not_verified` when the check ran and contradicted the expected state; use
`indeterminate` when the check ran but evidence was ambiguous; use `blocked` when
verification could not run because of config, permission, schema, placeholder, or
safety gates.

   - **v1.17.0 P2 Multi-turn `--next`.** When `--apply` is too coarse — interactive blocks it, the plan needs per-step inspection, or the agent wants to drive recovery with its own tools — execute steps one at a time and ask dbcli for the next:

     ```bash
     # The agent reads step 1 from the envelope, runs it, then asks dbcli for step 2:
     dbcli recover --next --after-step 1 --result '{"status":"ok","exitCode":0}'
     # Returns a NextResult envelope:
     # {
     #   "schemaVersion": 1,
     #   "kind": "step",
     #   "errorCode": "BLACKLIST_TABLE",
     #   "cursor": 2,
     #   "totalSteps": 3,
     #   "step": { "order": 2, "command": "dbcli inspect --for-agent", ... }
     # }
     # After the last step, dbcli returns kind: "done".
     ```

     `--result` accepts inline JSON `StepResultSummary` or `@<path>` to read from a file. `stdoutSummary` and `stderrSummary` are capped at 4 KB each — pre-truncate to the **last** 4 KB before passing. `--next` is mutually exclusive with `--apply`. Each call is independent (no persisted cursor) — the agent tracks `--after-step` itself.

     **Connection branching.** For `CONN_*` codes, the envelope ships a `branches` map + `branchFork` descriptor. Step 1 (`dbcli doctor --format json`) is the fork point: pass the doctor JSON in `--result.stdoutSummary` and `--next` will pick one of four labeled branches (`doctor-clean` / `doctor-config-missing` / `doctor-auth-error` / `doctor-network-error`). NextResult then carries `branchId` and `branchDescription`; subsequent calls must echo `--branch <id>` to walk that branch. Parse failure / unmatched keywords fall back to linear `recovery`. `--apply` ignores branches entirely.
5. `dbcli blacklist list` — sensitive data boundaries.
6. `dbcli schema <table> --format json` — real column names (SQL/Mongo/ES) or `schema <key>` (Redis). **Never guess.**
7. Run `query` / `insert` / `update` / `delete` / `export` within permission.
8. All writes: `--dry-run` (SQL/Mongo) → run → `query` read-back to confirm.
   - **v1.21.0 Self-Verification Loops**: If a snippet defines a `verify` block in its frontmatter, run the snippet with `dbcli q @name --verify` to automatically run primary changes, execute the verification query, and validate assertions.

Prefer `--format json` for agent-friendly output.

## Agent Task Packs

When the user asks for a database workflow (e.g. "diagnose this slow query", "audit
permissions", "review long-running operations"), prefer published task templates
over inventing steps from memory.

```bash
dbcli skill tasks list --format json                              # discover
dbcli skill tasks show <task>                                     # inspect
dbcli skill tasks plan <task> --param key=value --format json     # generate plan
```

The plan output is an ordered list of dbcli commands with rationale and risk
labels. Execute them one at a time — task plans do **not** override blacklist,
schema, dry-run, or confirmation requirements.

Builtin packs: `diagnose-slow-query` and **(v1.23)** `analyze-table-perf` — a
read-only `plan-only` pack taking a required `table` parameter that walks
`blacklist list` → `schema <table> --format json` → `guide index-usage`. `dbcli
inspect` suggests `analyze-table-perf` automatically for the hottest table in
recent audit activity. Additional read-only packs: `audit-permissions`,
`safe-backfill`, `schema-drift-review`, `connection-health` — run
`dbcli skill tasks list` for the full set.

Review & verification packs: `pr-database-review` (assess a PR's changed queries,
migrations and blacklist risk), `migration-review` (capture pre-change schema and
preview DDL), `safe-backfill-verify` (backfill planning with a read-back `assert`),
and `slow-endpoint-investigation` (chain `proxy analyze` → `explain` →
`guide missing-index-for`). All are read-only `plan-only` — pick the pack matching the
user's situation before improvising, and run any index/DDL proposal through
`migration-review` before writing.

Tasks live under `assets/tasks/` (builtin), `.dbcli-shared/tasks/` (shared), and
`.dbcli/tasks/` (local override).

## Developer workflows

Use these workflows when database impact is implicit in a development task. Keep
the normal dbcli safety rules: prefer `--format json`, run `blacklist list`
before touching sensitive data, confirm names with `schema`, dry-run writes, and
use `--recovery` / `recover` after failures.

| Situation | Use dbcli for | Minimum safe path |
| --- | --- | --- |
| DB-backed feature | Map product/code terms to real objects before editing code. | `inspect --for-agent` -> `blacklist list` -> `schema <object>` -> `queries suggest <intent>` |
| Application data bug | Separate stored facts from application-code inference. | `inspect --for-agent` -> `audit tail --for-agent --n 10` -> `blacklist list` -> `schema <object>` -> narrow query/snippet |
| ORM or migration work | Ground model and migration edits in live schema evidence. | `schema --format json` -> `diff --snapshot <name>` -> generate DDL via `migrate add-index`/`add-column` (preview SQL) -> `diff --against <snapshot>` |
| PR database review | Check query, write, migration, export, fixture, and blacklist risk. | Review changed persistence paths, then propose concrete `schema`, `plan`, `dry-run`, `report`, or `guide` commands for each material claim. |
| Slow endpoint or query | Prefer read-only diagnostics before index proposals. | `report --section perf` -> task pack `analyze-table-perf` -> `guide missing-index-for "<query>"`; use `proxy analyze` when logs exist. |
| Safe data backfill | Scope affected rows and preview mutations before execution. | `blacklist list` -> `schema <object>` -> count/scope query -> `update ... --dry-run` -> read-back or snippet `--verify`. |
| Environment validation | Check config shape and connectivity without leaking secrets. | `status --format json` -> `doctor --format json` -> `inspect --for-agent --no-connect --format json`. |

Copy-paste command anchors:

```bash
dbcli inspect --for-agent --format json
dbcli blacklist list --format json
dbcli schema <object> --format json
dbcli queries suggest <intent> --format json
dbcli audit tail --for-agent --n 10
dbcli schema --format json
dbcli diff --snapshot <name>
dbcli migrate add-index <table>
dbcli diff --against <snapshot>
dbcli report --section perf --format json
dbcli skill tasks plan analyze-table-perf --param table=<table> --format json
dbcli guide missing-index-for "<query>" --format json
dbcli proxy analyze --format json
dbcli query "<count/scope query>" --format json
dbcli update <object> --where "<bounded predicate>" --set '<json>' --dry-run --format json
dbcli status --format json
dbcli doctor --format json
dbcli inspect --for-agent --no-connect --format json
```

Developer workflow guardrails:

- Never invent table, collection, key, index, or field names. Confirm them with
  `schema` before writing code that depends on them.
- Separate database facts from application-code inference. Report which dbcli
  output shaped the code or review conclusion.
- For writes and backfills, include scope count, dry-run preview, execution
  command, and read-back or snippet verification.
- Do not create indexes directly from a performance suggestion; turn them into reviewed migrations.
- Do not print credentials, copied connection strings, or blacklisted values.
- To persist result evidence for a read-back assertion, run `assert ... --write-verification-artifact --verification-subject <kind:name>` (kinds: `recovery`, `task-pack`, `assertion`, `migration`, `backfill`, `manual`).

Full flags, per-command copy-paste blocks, `migrate` DDL, interactive `shell`, and MongoDB/Redis/ES walkthroughs are in [reference.md](reference.md) (installed next to this file).

## Audit Log usage

Use the audit log when you need cross-session history or forensics on what dbcli
has done on this database, rather than re-querying live DB state from scratch.

**Scenario 1 — Session handoff (picking up where another agent left off):**

```bash
dbcli audit tail --for-agent --n 10           # last 10 entries as JSON envelope
dbcli audit tail --all --for-agent --n 20     # cross-connection merged view (D4)
```

Returns an agent-facing JSON envelope with `session_id` / `engine` / `command` /
`target` / `success` per entry. Metadata-only by design — never raw SQL bodies,
`--param` values, or result cell contents (D3 lock).

**Scenario 2 — Forensics (reconstructing a failure):**

```bash
dbcli recover --format json                   # inspect audit_recent embed + recovery_ref
dbcli audit show <id-prefix>                  # full entry by id prefix (>=4 chars)
dbcli audit show --recovery-ref <envelope-id> # find entry that emitted an envelope
```

The `inspect` / `guide` / `recover` / `recover --apply` agent JSON output embeds
`audit_recent: AuditEntryBrief[]` (last 5 entries) — a fresh session has immediate
history context. The envelope's `audit_ref` and the audit entry's `recovery_ref`
point at each other; agents can pivot either direction.

Bi-directional `recovery_ref` / `audit_ref` linkage is wired on every command
that accepts `--recovery`: `query`, `inspect`, `insert`, `update`, `delete`,
`export`, `q`, and `schema`. Agents can pivot from an envelope to its audit
entry via `audit tail --recovery-ref <id>`.

Audit entries are written to `.dbcli/audit/<connection>.jsonl` with rotation at
~10 MB or 1000 entries. `audit.enabled = false` in `.dbcli` opts out (default ON
since v1.20.0). For flag reference see [`reference.md`](./reference.md) §audit.
For end-to-end recovery walkthroughs (per-code scenarios, `--next` multi-turn,
envelope ⇄ audit pivot, risk-gate cheat sheet) see
[`reference.md`](./reference.md) §Recovery Cookbook.

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
   - Need to keep secrets out of `.dbcli` (CI/CD, multi-env) → `--use-env-refs`
     plus `--env-host` / `--env-port` / `--env-user` / `--env-password` / `--env-database`.
   - Plain values are acceptable → pass `--host` / `--port` / `--user` /
     `--password` / `--name` (and `--system`).
3. **What permission tier?** Default to the **lowest** that satisfies the task:
   `query-only` → `read-write` → `data-admin` → `admin`. Set with `--permission`.
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
dbcli query --use staging "SELECT 1"      # one-shot override
dbcli init --rename staging:stg           # rename
dbcli init --remove stg                   # remove
```

Per-connection schema cache lives at `.dbcli/schemas/<connection>/`. Run
`dbcli schema --use <name>` once per connection before `schema <table>` —
otherwise the cache may serve another connection's columns.

### env-refs (keep secrets out of `.dbcli`)

```bash
dbcli init --use-env-refs \
  --env-host DB_HOST --env-port DB_PORT \
  --env-user DB_USER --env-password DB_PASSWORD --env-database DB_NAME
```

Stored as `{ "$env": "DB_HOST" }` etc. and resolved at runtime. Pair with
`--env-file <path>` (v2) when each connection has its own env file.

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
| `delete` | data-admin+ | SQL or MongoDB only. `--where` required; `--dry-run` first. Supports `--recovery`. |
| `export` | query-only+ | SQL, MongoDB, or **(v1.22)** Elasticsearch (DSL `--index` or whole-index scroll). Query → `--format json\|jsonl\|csv\|html` file or stdout. `html` emits a standalone interactive dashboard. Supports `--recovery`. |
| `blacklist` | n/a | `list` / `table` / `column` subcommands redact sensitive data from query results. |
| `check` | query-only+ | SQL only (best on MySQL/MariaDB). |
| `diff` | query-only+ | SQL only. Save/compare schema snapshots. |
| `snapshot` | query-only+ | **(v1.25)** SQL only. Capture a result fingerprint (`rowCount` + per-column null/distinct/min/max/sum + order-independent checksum). `--out` (default `.dbcli/snapshots/snap-<ts>.json`), `--rows`, `--stdout`, `--format`, `--no-limit`. Baseline for `assert --against`. |
| `assert` | query-only+ | **(v1.25)** SQL only. Verify an invariant; exit 1 on failure unless `--no-fail`. `--expect "rows>0\|value==X\|col:c not null\|unique\|between a and b\|>= n"`, `--vs <query> --compare rows\|value` (reconcile), `--against <snapshot> --tolerance <pct>`. |
| `proxy` | n/a | **(v1.26)** MySQL/MariaDB/PostgreSQL only. Local-dev observability proxy — relays app traffic to the real DB and appends query/latency/byte/error events to `.dbcli/proxy/events.jsonl`. Subcommands: `mysql` \| `mariadb` \| `postgresql`. `--listen`, `--target`, `--events` (default `.dbcli/proxy/events.jsonl`), `--slow-ms` (default `1000`), `--redact none\|literals` (default `none`). Observe-only. **(v1.27)** `proxy analyze` aggregates the event log offline into a JSON/text report (summary, byFingerprint with suggestedCommands, slowest, errors, hotTables, N+1) — `--format`, `--top`, `--slow-ms`, `--n-plus-one`. |
| `status` | query-only+ | Safe JSON/text summary (no credentials). |
| `inspect` | query-only+ | Read-only context snapshot (connection, permission, blacklist, objects, snippets, context-aware `suggestedCommands`, and **(v1.23)** human-readable `hints`). `--for-agent` / `--brief` / `--no-connect` / `--require-schema-cache`. Supports `--recovery`. |
| `report` | query-only+ | Diagnostic report (health / capacity / perf) built from `@diag/*` snippets. `--section`, `--brief`, `--for-agent`, `--no-connect`. |
| `guide` | query-only+ | Deterministic next-command plan for a fixed goal (`slow-query`, `capacity`, `health`, `index-usage`, `permissions`, `schema-overview`). `--list` to enumerate. **(v1.23)** `guide missing-index-for <query>` suggests composite indexes for a single SELECT (`--format yaml\|json\|markdown`, `--min-confidence`). |
| `recovery` | n/a | Look up the structured `RecoveryEnvelope` for a known error code (`--code <CODE>` or `--list`). Standalone synthesizer; does not require a real failure. |
| `recover` | n/a | Inspect (default) or `--apply` the auto-saved recovery plan in `.dbcli/last-recovery.json`. `--allow-write=readonly-cmd\|write-cmd`, `--no-verify`, `--from <file>`, `--next --after-step <n> --result <json\|@file>` for multi-turn step-at-a-time. |
| `doctor` | n/a | Environment, config, connection, SRV diagnostics (Mongo), schema cache age. |
| `completion` | n/a | bash / zsh / fish scripts. |
| `upgrade` | n/a | Self-update from npm; 24h-cached version hints on every command. |
| `shell` | (same as query+) | Interactive REPL. SQL engines, MongoDB, and Redis (single-line; `.no-limit on/off`). **(v1.22)** Elasticsearch opens a Kibana Dev Tools-style REPL (`<METHOD> /<path>` + optional JSON body, blank line submits). |
| `skill` | n/a | Generate / install AI skill docs (`--install <claude\|gemini\|antigravity\|copilot\|cursor\|codex\|windsurf>`); `skill tasks list/show/plan` for Agent Task Packs; `skill context` for LLM prompt context payload. |
| `migrate` | admin | SQL only. **DDL; dry-run by default** — needs `--execute`. |

`--use <name>` on any subcommand targets a v2 connection without changing the default.
`--recovery` is honoured by `query`, `q`, `insert`, `update`, `delete`, `export`, `schema`, and `inspect`; on failure these emit a `RecoveryEnvelope` JSON to stdout, suppress the human stderr message, and atomically save the envelope to `.dbcli/last-recovery.json` for `dbcli recover` to consume.

## Permission levels

| Level | Allowed |
|-------|---------|
| query-only | SELECT, list, schema, export |
| read-write | + INSERT, UPDATE |
| data-admin | + DELETE (DML, no DDL) |
| admin | + DDL via `migrate` and destructive ops |

## Multi-connection (v2)

- Each named connection has its own schema dir: `.dbcli/schemas/<connection>/`.
- Run `dbcli schema --use <name>` once per connection before `schema <table>` — otherwise the cache may return another connection's columns.
- `schema --refresh` / `--reset` manage the cache; see reference.md.

## MongoDB

- JSON filter object (`find`) or JSON array (`aggregate`); SQL is rejected. `--collection <name>` is required on `query`.
- **Supported:** `init`, `list`, `schema` (sampled), `query`, `insert`, `update`, `delete`, `export`, `q` (saved queries), `status`, `use`, `shell`, `doctor`, `upgrade`, `completion`.
- **Not supported:** `diff`, `migrate`, `check`.
- Schema is **sampled** by `$sample` (default 100 docs, max 1000). Pass `--sample-method natural` to use `find().limit()` instead. Columns surface as dot-paths (e.g. `profile.tokens.access`) with `presence` (0..1) and `redacted: true` flags for blacklist hits.
- **Write planner tiers:** `$set`/`$unset` → `ALLOW`; `$rename` → `WARN` (informational); `$inc`/`$mul`/`$min`/`$max`/`$currentDate` → `WARN`; `$push`/`$pull`/`$pullAll`/`$pop`/`$addToSet` → `WARN`; `$bit` → `WARN`; `$where` and unknown operators → `BLOCK`.
- **Nested blacklist:** `blacklist.columns[<collection>]` accepts dotted paths (`profile.email`) and trailing-wildcard prefixes (`profile.tokens.*`); middle wildcards are rejected with a warning at `dbcli blacklist list`. Read paths replace matched values with the literal string `[REDACTED]`.
- **Saved queries:** snippet file ends in `.mongodb.sql`. Frontmatter requires `engine: mongodb` and `operation: find` or `operation: aggregate`. `target: <collection>` is the default collection (override with `--collection`). Body is JSON (object for `find`, array for `aggregate`); `{{param}}` placeholders are JSON-encoded.
- See reference.md MongoDB section for full syntax and examples.

## Redis

- Command-style execution; `query` runs a whitelisted Redis command (e.g. `GET`, `HSET`, `DEL`).
- **Supported:** `init`, `list` (keys via SCAN), `schema <key>` (type / TTL / size / sample), `query`, `shell`, `status`, `use`, `doctor`, `upgrade`, `completion`.
- **Not supported:** `schema` full scan, `insert`, `update`, `delete`, `export`, `check`, `diff`, `migrate`, `q`.
  Use `query "DEL <key>"` etc. for writes — they go through the same permission gate.
- Permission tiers map to commands: read commands → `query-only`; mutators (`SET`, `HSET`, ...) → `read-write`; `DEL` / `UNLINK` → `data-admin`.
- `database` field is the logical DB index (default `0`); `list` returns ≤ 100 000 keys via SCAN.
- **Size guard:** `SCAN`/`HSCAN`/`SSCAN`/`ZSCAN` inject `COUNT 1000`; `LRANGE`/`ZRANGE` clamp `stop`; `ZRANGEBYSCORE` injects `LIMIT 0 1000`; `HGETALL`/`HKEYS`/`HVALS`/`SMEMBERS`/`KEYS` truncate at 1000. Results carry `warnings[]` (`REDIS_SIZE_REWRITE` / `REDIS_SIZE_TRUNCATE`). Pass `--no-limit` (CLI) or `.no-limit on` (shell) to bypass.
- **Blacklist:** `dbcli blacklist add 'secrets:*'` registers a Redis-native key glob. Reads/writes whose keys match are rejected (`BlacklistRejection`, audited with `metadata.matched_pattern`); `KEYS`/`SCAN MATCH` overlapping a rule are rejected; non-overlapping listings filter blacklisted keys.
- **Masking (v1.22):** add a `redis.mask` block to `.dbcli` — keys matching a `keyPattern` glob have their value (or named hash `fields`) returned as `[REDACTED]` on reads (`GET`, `GETRANGE`, `HGETALL`, `HGET`, `HMGET`, `HVALS`). Masking coexists with key-glob rejection, and **rejection always wins over masking**.
- **Shell:** `dbcli shell` on a Redis connection opens a single-line REPL (history, tab completion of commands + key prefixes, `.no-limit on/off`).
- See reference.md Redis section.

## Elasticsearch

- DSL (JSON body) or Lucene query string; `--collection <index>` is required on `query`.
- **Supported:** `init`, `list` (indices with doc count), `schema [index]` (flattened mapping), `query`, `export` (v1.22), `shell` (v1.22), `status`, `use`, `doctor`, `upgrade`, `completion`.
- **Not supported:** `insert`, `update`, `delete`, `check`, `diff`, `migrate`, `q`.
  Writes are not exposed via dedicated subcommands yet — use `query` if the cluster allows or external tools.
- **Export (v1.22):** `dbcli export` takes a search DSL with `--index <index>` to export hits, or an index name as the query to scroll the whole index via `match_all`. Outputs JSON / JSONL / CSV (default 1000 rows; `--no-limit` scrolls the full index in batches). Index-level blacklist + audit apply.
- **Shell (v1.22):** `dbcli shell` opens a Kibana Dev Tools-style REPL — request line `<METHOD> /<path>` plus an optional multi-line JSON body, submitted with a blank line; index-level blacklist rejects protected indices and `_search` auto-caps at 1000 when `size` is omitted.
- Query-only mode caps at 1000 hits; `--no-limit` is bounded at 10 000.
- Schema flattens nested fields (`a.b.c`) and surfaces `.fields` multi-fields.
- See reference.md Elasticsearch section.

## Saved queries

Run reusable parameterised SELECT snippets stored in your repo.

| Step | Command |
|------|---------|
| 1. Discover | `dbcli queries list` |
| 2. Inspect | `dbcli queries show @<name>` |
| 3. Run     | `dbcli q @<name> --param k=v` |

### When you don't know which query to run

1. `dbcli queries search <keywords>` — natural keywords, fuzzy ranked
2. `dbcli queries suggest <intent>` — browse a category
   Common intents: perf.slow-query, perf.cache-hit, capacity.size,
                   safety.connections, monitor.cluster-health
3. Once you find one: `dbcli q @<name>` (blacklist always enforced)

Snippets resolve from three layers, **local > shared > builtin** (local wins):
- `builtin` — bundled with dbcli (e.g. `@diag/*`); read-only at runtime
- `.dbcli-shared/queries/` — committed, team-shared
- `.dbcli/queries/` — gitignored, personal override

Manage local snippets with `queries new | edit | delete | rename | copy | import | export`
(see reference.md). Use `copy` / `import` to fork a builtin or shared snippet into the
local layer for editing.

Each `.sql` file may declare YAML frontmatter inside `-- ---` blocks
(name, description, engine, params, tags, optional `intent`, optional `visual`).
The `visual:` block drives the interactive dashboard (see "Interactive HTML dashboard"
below). See `dbcli queries show @<name> --format json` for the machine-readable contract.

### Engine-specific bodies

Each snippet's body format is determined by the `engine` frontmatter field:

| Engine            | Body format            | Notes |
|-------------------|------------------------|-------|
| postgres / mysql  | Single SELECT or WITH  | `:name` → driver bind (`$1` / `?`) |
| elasticsearch     | JSON DSL               | `:name` → JSON-aware substitution; `index:` field required |
| redis             | Single Redis command   | `:name` → raw text; only read commands allowed |

Mixed-family `engine` arrays (e.g. `[postgres, elasticsearch]`) are rejected at parse time.

### Built-in diagnostic snippets

dbcli ships ready-made diagnostic queries. Run with `dbcli q @diag/<topic>`:

| key                     | purpose                                  |
|-------------------------|------------------------------------------|
| `@diag/connections`     | active sessions                          |
| `@diag/long-running`    | queries above `min_seconds` (default 30) |
| `@diag/table-sizes`     | table data/index size with row counts    |
| `@diag/index-usage`     | indexes by scan count                    |
| `@diag/missing-indexes` | tables dominated by sequential scans     |
| `@diag/locks`           | lock-wait chains                         |
| `@diag/db-size`         | database size summary                    |
| `@diag/cache-hit`       | buffer cache hit ratios                  |
| `@diag/es-cluster-health` | document counts per index (ES connections) |
| `@diag/redis-key-stats`   | sample SCAN over keyspace (Redis connections) |

Engine variants are picked automatically based on the active connection.
Override any of them by placing a same-named file under `.dbcli-shared/queries/`
or `.dbcli/queries/`.

## Interactive HTML dashboard

`query`, `q`, and `export` can render results as a standalone, self-contained HTML
report powered by a bundled React + Recharts template (`assets/ui-template.html`,
injected via a hardened `window.__DBCLI_PAYLOAD__ = {...}` block — `<` is escaped
to neutralise `</script>` payloads).

```bash
# Open in browser (writes to a temp file, then `open`/`xdg-open`/`start`)
dbcli query "SELECT day, dau FROM dau_daily" --ui
dbcli q @analytics/revenue --param days=30 --ui

# Pipe HTML to stdout (CI artifacts, email, static hosting)
dbcli query "SELECT * FROM orders" --format html > orders.html

# Export to a file (interchangeable with json/jsonl/csv)
dbcli export "SELECT * FROM orders" --format html --output orders.html
```

`--ui` implies `--format html` and opens the file; `--format html` alone prints to
stdout. Blacklist redaction is applied **before** rendering — the dashboard never
sees masked columns.

### Snippet `visual:` block

To get KPIs and charts (rather than just a sortable table), add a `visual:` block
to the snippet's frontmatter. Column names must exist in the result row.

```sql
-- ---
-- name: Revenue Trend
-- engine: postgres
-- params:
--   days: { type: int, default: 30 }
-- visual:
--   title: Revenue (last :days days)
--   kpis:
--     - { label: Total Revenue,  value_column: total_revenue, format: currency }
--     - { label: Orders,         value_column: order_count,   format: number   }
--     - { label: Conversion,     value_column: conv_rate,     format: percent  }
--   charts:
--     - { type: line, title: Daily Revenue, x: day, y: [revenue] }
--     - { type: bar,  title: By Channel,    x: channel, y: [revenue, refunds] }
-- ---
SELECT ...
```

- `kpis[].format`: `currency` / `number` / `percent` (omit for raw value).
- `charts[].type`: `line` / `bar` / `area` / `pie` / `scatter`.
- Raw `query` invocations (no snippet) render a sortable/filterable table only —
  there is no `visual:` to attach.

## Common workflows

- **Debug odd state:** `schema` → `check` → `query` with tight `WHERE` → follow FKs from schema JSON. Evidence over theory.
- **After INSERT/UPDATE:** `--dry-run` → run → `query` read-back; explain mismatches via triggers, defaults, or blacklist.
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
