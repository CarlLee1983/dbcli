---
name: dbcli
description: Database CLI for AI agents with permission-based access control. Use to query, inspect schemas, insert/update/delete, export results, and blacklist sensitive columns/tables. Supports MySQL, PostgreSQL, MariaDB, and MongoDB with multiple named connections per project and custom env files. Trigger when working with databases, running SQL or MongoDB JSON queries, exploring table/collection structures, switching database environments, or protecting sensitive data from AI access. For exhaustive flags and examples, read the sibling `reference.md`.
---

# dbcli

Database CLI for AI agents with permission-based access control.

## AI agent workflow (follow in order)

1. `dbcli status` — permission level and system summary (no credentials).
2. `dbcli blacklist list` — sensitive data boundaries.
3. `dbcli schema <table> --format json` — real column names. **Never guess.**
4. Run `query` / `insert` / `update` / `delete` / `export` within permission.
5. All writes: `--dry-run` → run → `query` read-back to confirm.

Prefer `--format json` for agent-friendly output.

Full flags, per-command copy-paste blocks, `migrate` DDL, interactive `shell`, and MongoDB walkthroughs are in [reference.md](reference.md) (installed next to this file).

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
| `list` | query-only+ | Tables (SQL) or collections (MongoDB). |
| `schema` | query-only+ | Per-table or full scan into `.dbcli/schemas/`; use `--use` for the correct connection cache. |
| `query` | query-only+ | SQL, or Mongo JSON filter / pipeline with `--collection`. |
| `insert` / `update` | read-write+ | JSON `--data` / `--set`; `--where` required on `update`; `--dry-run` first. |
| `delete` | data-admin+ | `--where` required; `--dry-run` first. |
| `export` | query-only+ | Query → CSV/JSON file or stdout. |
| `blacklist` | n/a | `list` / `table` / `column` subcommands redact sensitive data from query results. |
| `check` | query-only+ | Table health: nulls, duplicates, orphans, rowCount, size. |
| `diff` | query-only+ | Save/compare schema snapshots. |
| `status` | query-only+ | Safe JSON/text summary (no credentials). |
| `doctor` | n/a | Environment, config, connection, SRV diagnostics (Mongo), schema cache age. |
| `completion` | n/a | bash / zsh / fish scripts. |
| `upgrade` | n/a | Self-update from npm; 24h-cached version hints on every command. |
| `shell` | (same as query+) | Interactive REPL. |
| `migrate` | admin | **DDL; dry-run by default** — needs `--execute`; DROP also needs `--force`. |

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
- **Supported:** `init`, `list`, `query`, `status`, `use`, `shell`, `doctor`, `upgrade`, `completion`.
- **Not supported:** `schema`, `insert`, `update`, `delete`, `export`, `diff`, `migrate`, `check`.
- No auto-limit on MongoDB queries — use `$limit` in the pipeline if needed.
- See reference.md MongoDB section for full syntax and examples.

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
