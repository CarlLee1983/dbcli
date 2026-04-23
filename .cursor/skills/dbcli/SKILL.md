---
name: dbcli
description: Database CLI for AI agents with permission-based access control. Use to query, inspect schemas, insert/update/delete data, export results, and manage sensitive data blacklists. Supports MySQL, PostgreSQL, MariaDB, and MongoDB with multiple named connections per project and custom env files. For exhaustive flags and examples, read reference.md next to this skill. Trigger when working with databases, running SQL or MongoDB JSON queries, exploring table/collection structures, switching between database environments, or protecting sensitive columns/tables from AI access.
---

# dbcli

Database CLI for AI agents with permission-based access control.

## Quick start

```bash
dbcli init                          # Initialize .dbcli config (parses .env automatically)
dbcli schema                        # Scan all tables and save to .dbcli
dbcli query "SELECT * FROM users"   # Execute SQL
```

**Full flags, per-command copy-paste blocks, `migrate` DDL, interactive `shell`, and MongoDB walkthroughs** live in [reference.md](reference.md) (sibling file in the npm `assets/` folder, or installed next to this skill for Claude / Gemini / Copilot; for Cursor, also under `.cursor/skills/dbcli/reference.md` after `dbcli skill --install cursor`).

## Command overview

| Command | Min permission | Summary |
|---------|-----------------|---------|
| `init` | n/a (setup) | Create `.dbcli` (v1 single or v2 multi-connection with `--conn-name` / `--env-file`). **Usually run by the human** — do not re-run to strip `{"$env"}` references. |
| `use` | n/a | Show/switch default named connection (v2 only). |
| `list` | query-only+ | Tables (SQL) or collections (MongoDB). |
| `schema` | query-only+ | Per-table or full scan into `.dbcli/schemas/`; use `--use` for the right connection cache. |
| `query` | query-only+ | SQL, or Mongo JSON filter / pipeline with `--collection`. |
| `insert` / `update` | read-write+ | JSON `--data` / `--set`, `--where` (update), `--dry-run` first. |
| `delete` | data-admin+ | `--where` required, `--dry-run` first. |
| `export` | query-only+ | Query to CSV/JSON file or stdout. |
| `blacklist` | n/a | `list` / `table` / `column` subcommands block sensitive data from query results. |
| `check` | query-only+ | Table health: nulls, duplicates, orphans, etc. |
| `diff` | query-only+ | Save/compare schema snapshots. |
| `status` | query-only+ | Safe JSON/text summary (no credentials). |
| `doctor` | n/a | Environment, config, connection, SRV/diagnostics (Mongo), schema cache age. |
| `completion` | n/a | bash / zsh / fish scripts. |
| `upgrade` | n/a | Self-update from npm; all commands can hint on new version (24h cache). |
| `shell` | (same as `query`+) | Interactive REPL. |
| `migrate` | admin | **DDL; dry-run by default** — needs `--execute`, DROP also needs `--force`. |

`--use <name>` on any subcommand targets a v2 connection without changing the default.

## Multi-connection and schema (v2)

- Named connections get isolated schema dirs: `.dbcli/schemas/<connection>/`. Run `dbcli schema --use <name>` before `schema <table>` for that environment.
- `schema --refresh` / `--reset` manage cache; see [reference.md](reference.md) for options.

## MongoDB (at a glance)

- JSON `find` object or `aggregate` array; **`--collection` required**; no SQL. Supported: `init`, `list`, `query`, `status`, `use`, `shell`, `doctor`, `upgrade`, `completion`. **Unsupported:** `schema`, `insert`, `update`, `delete`, `export`, `diff`, `migrate`, `check`.
- See [reference.md](reference.md) (MongoDB section) for query syntax and examples.

## Permission levels

| Level | Allowed |
|-------|---------|
| query-only | SELECT, list, schema, export |
| read-write | + INSERT, UPDATE |
| data-admin | + DELETE (DML, no DDL) |
| admin | + DDL via `migrate` and destructive ops |

## Global options

| Flag | Description |
|------|-------------|
| `--config` | Custom `.dbcli` path (default: `.dbcli`) |
| `--use` | Named connection (v2) |
| `-v` / `-vv` / `-q` | Verbose or quiet |
| `--no-color` | No ANSI (see also `NO_COLOR`) |

## AI agent workflow

**Before any database work:**

1. `dbcli status` — permissions and system (no secrets).
2. `dbcli blacklist list` — sensitive data boundaries.
3. `dbcli schema <table> --format json` — real column names.
4. Then `query` / DML / `export` within permission.

**Never guess column names** — use schema output.

## Workflows (short)

- **Debug odd state:** `schema` → `check` → `query` with a tight `WHERE` → follow FKs from schema JSON; confirm related rows. Prefer evidence over theory.
- **After INSERT/UPDATE:** `--dry-run` → run → `query` read-back; explain mismatches via triggers, defaults, or blacklist.
- **Migrations:** `diff --snapshot` → run migration → `diff --against` → `check` on affected tables. **Migrate:** use [reference.md](reference.md) for dry-run, `--execute`, and `--force` on DROP.
- **Health / growth:** `check --all` (large tables skipped unless `--include-large`); use schema `sizeCategory` before ad-hoc queries.
- **Codegen from live DB:** `dbcli schema --format json` to drive ORM; `check` before trusting data. Compare ORM result with `dbcli query` once.
- **Logic / integration truth:** `query` before → run app or API → `query` after; for multi-table updates, re-check all touched tables. Unit tests with mocks are not a substitute.
- **Natural language (“update order to shipped”):** infer `query` vs DML, map terms to columns via `schema` (and enums/values in data), respect blacklist and `sizeCategory`, **`--dry-run` on all writes** before commit.

## Notes

- Prefer `--format json` for agents.
- Query-only: auto-`LIMIT 1000` unless `--no-limit` (e.g. `information_schema` or statements that break with `LIMIT`).
- Blacklisted tables/columns are redacted in query results.
- `doctor` (Mongo SRV): reports SRV resolution vs DoH fallback when relevant.

## Data volume protection

`schema` includes `estimatedRowCount` and `sizeCategory` (small / medium / large / huge). See [reference.md](reference.md) for row-count bands and `huge`-table query rules. For large or huge tables, add `WHERE` or `LIMIT`.

## Full command reference

See [reference.md](reference.md) for all options, the `migrate` column spec, `shell` meta-commands, and one-block examples for every subcommand.
