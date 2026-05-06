---
name: dbcli
description: Database CLI for AI agents with permission-based access control. Use to query, inspect schemas, insert/update/delete, export results, and blacklist sensitive columns/tables. Supports MySQL, PostgreSQL, MariaDB, MongoDB, Redis, and Elasticsearch with multiple named connections per project and custom env files. Trigger when working with databases, running SQL / MongoDB JSON / Redis commands / Elasticsearch DSL, exploring table/collection/key/index structures, switching database environments, or protecting sensitive data from AI access. For exhaustive flags and examples, read the sibling `reference.md`.
---

# dbcli

Database CLI for AI agents with permission-based access control.

## AI agent workflow (follow in order)

1. `dbcli status` — permission level and system summary (no credentials).
2. `dbcli blacklist list` — sensitive data boundaries.
3. `dbcli schema <table> --format json` — real column names (SQL/Mongo/ES) or `schema <key>` (Redis). **Never guess.**
4. Run `query` / `insert` / `update` / `delete` / `export` within permission.
5. All writes: `--dry-run` (SQL/Mongo) → run → `query` read-back to confirm.

Prefer `--format json` for agent-friendly output.

Full flags, per-command copy-paste blocks, `migrate` DDL, interactive `shell`, and MongoDB/Redis/ES walkthroughs are in [reference.md](reference.md) (installed next to this file).

## Quick start

```bash
dbcli init                          # Create .dbcli config (parses .env automatically)
dbcli schema                        # Scan all tables → .dbcli/schemas/
dbcli query "SELECT * FROM users"   # Execute SQL (auto LIMIT 1000)
```

## Command overview

| Command | Min permission | Summary |
|---------|-----------------|---------|
| `init` | n/a | Create `.dbcli` (v1 single or v2 multi via `--conn-name` / `--env-file`). **Usually run by the human** — do NOT re-run to strip `{"$env"}` references; that format is intentional. |
| `use` | n/a | Show/switch default named connection (v2 only). |
| `list` | query-only+ | Tables (SQL), collections (MongoDB), keys (Redis), or indices (Elasticsearch). |
| `schema` | query-only+ | SQL: per-table or full scan into `.dbcli/schemas/`. MongoDB: sampled. ES: flattened mapping. Redis: per-key only (type/TTL/size). |
| `query` | query-only+ | SQL, Mongo JSON (`--collection`), Redis command, or ES DSL/Lucene (`--collection`). |
| `insert` / `update` | read-write+ | SQL or MongoDB only. JSON `--data` / `--set`; `--where` required on `update`; `--dry-run` first. Redis writes go through `query`. |
| `delete` | data-admin+ | SQL or MongoDB only. `--where` required; `--dry-run` first. |
| `export` | query-only+ | SQL or MongoDB only. Query → CSV/JSON(L) file or stdout. |
| `blacklist` | n/a | `list` / `table` / `column` subcommands redact sensitive data from query results. |
| `check` | query-only+ | SQL only (best on MySQL/MariaDB). |
| `diff` | query-only+ | SQL only. Save/compare schema snapshots. |
| `status` | query-only+ | Safe JSON/text summary (no credentials). |
| `doctor` | n/a | Environment, config, connection, SRV diagnostics (Mongo), schema cache age. |
| `completion` | n/a | bash / zsh / fish scripts. |
| `upgrade` | n/a | Self-update from npm; 24h-cached version hints on every command. |
| `shell` | (same as query+) | Interactive REPL. SQL engines + MongoDB shell only. |
| `migrate` | admin | SQL only. **DDL; dry-run by default** — needs `--execute`. |

`--use <name>` on any subcommand targets a v2 connection without changing the default.

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
- **Supported:** `init`, `list`, `schema` (sampled), `query`, `insert`, `update`, `delete`, `export`, `status`, `use`, `shell`, `doctor`, `upgrade`, `completion`.
- **Not supported:** `q` (saved queries), `diff`, `migrate`, `check`.
- Schema is **sampled** (default 50 docs); types are JS `typeof` strings.
- See reference.md MongoDB section for full syntax and examples.

## Redis

- Command-style execution; `query` runs a whitelisted Redis command (e.g. `GET`, `HSET`, `DEL`).
- **Supported:** `init`, `list` (keys via SCAN), `schema <key>` (type / TTL / size / sample), `query`, `status`, `use`, `doctor`, `upgrade`, `completion`.
- **Not supported:** `schema` full scan, `insert`, `update`, `delete`, `export`, `check`, `diff`, `migrate`, `q`.
  Use `query "DEL <key>"` etc. for writes — they go through the same permission gate.
- Permission tiers map to commands: read commands → `query-only`; mutators (`SET`, `HSET`, ...) → `read-write`; `DEL` / `UNLINK` → `data-admin`.
- `database` field is the logical DB index (default `0`); `list` returns ≤ 100 000 keys via SCAN.
- See reference.md Redis section.

## Elasticsearch

- DSL (JSON body) or Lucene query string; `--collection <index>` is required on `query`.
- **Supported:** `init`, `list` (indices with doc count), `schema [index]` (flattened mapping), `query`, `status`, `use`, `doctor`, `upgrade`, `completion`.
- **Not supported:** `insert`, `update`, `delete`, `export`, `check`, `diff`, `migrate`, `q`.
  Writes are not exposed via dedicated subcommands yet — use `query` if the cluster allows or external tools.
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

Snippets resolve from three layers, **local > shared > builtin** (local wins):
- `builtin` — bundled with dbcli (e.g. `@diag/*`); read-only at runtime
- `.dbcli-shared/queries/` — committed, team-shared
- `.dbcli/queries/` — gitignored, personal override

Manage local snippets with `queries new | edit | delete | rename | copy | import | export`
(see reference.md). Use `copy` / `import` to fork a builtin or shared snippet into the
local layer for editing.

Each `.sql` file may declare YAML frontmatter inside `-- ---` blocks
(name, description, engine, params, tags). See `dbcli queries show @<name> --format json`
for the machine-readable contract.

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

Engine variants are picked automatically based on the active connection.
Override any of them by placing a same-named file under `.dbcli-shared/queries/`
or `.dbcli/queries/`.

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
