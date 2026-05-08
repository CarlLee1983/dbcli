# dbcli Feature Matrix

This matrix summarizes the current command support by database engine. It is intended for maintainers and AI agents choosing a safe command path.

Legend:

- ✅ Supported
- ⚠️ Supported with limitations or engine-specific behavior
- ❌ Not supported / exits with an error
- N/A Not database-engine-specific

| Command / area | PostgreSQL | MySQL | MariaDB | MongoDB | Redis | Elasticsearch | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `init` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | MongoDB accepts URI or host/port. Redis uses database index (0-15). ES supports Cloud ID/ApiKey. |
| Multi-connection `use` / `--use` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | v2 config isolates connections and schema caches. |
| `list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | SQL: tables; Mongo: collections; Redis: keys (SCAN); ES: indices. |
| `schema [table]` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | Mongo: sampled; Redis: per-key only (type/TTL/size); ES: flattened mapping. |
| `schema` full scan / `--refresh` / `--reset` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ | Redis has no full scan/cache. ES iterates non-system indices. |
| `query` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | SQL: SQL; Mongo: JSON; Redis: commands; ES: DSL/Lucene. |
| Query output `table` / `json` / `csv` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | All engines flow through shared result formatter. |
| Query auto-limit / size guard | ✅ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | SQL/Mongo/ES apply limits. Redis has no limit-rewrite support. |
| `q` saved query execution | ✅ | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | SQL: SELECT/WITH only. Redis: read-only allowlist + range/SCAN size guard. ES: JSON DSL with size guard, scripts rejected, requires `index` frontmatter. |
| `queries` snippet management | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | Management works regardless of active connection. |
| `insert` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | Redis/ES writes not exposed via dedicated subcommand (use `query`). |
| `update` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | Redis/ES writes not exposed via dedicated subcommand. |
| `delete` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | Redis/ES deletes not exposed via dedicated subcommand. |
| `export` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | Currently SQL/Mongo only. |
| `blacklist` config management | ✅ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | Rule CRUD engine-independent. Enforcement varies by engine. |
| `check` data health | ⚠️ | ✅ | ✅ | ❌ | ❌ | ❌ | SQL-only; best on MySQL/MariaDB. |
| `diff` snapshots | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | Relational schema snapshots only. |
| `migrate` DDL | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | SQL-only (Postgres/MySQL/MariaDB). |
| `shell` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | SQL + MongoDB only; Redis/ES not yet in REPL. |
| `status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Safe non-credential config summary. |
| `doctor` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Engine-specific diagnostics. |
| `completion` | N/A | N/A | N/A | N/A | N/A | N/A | Shell completion is engine-independent. |
| `upgrade` | N/A | N/A | N/A | N/A | N/A | N/A | Update checks are engine-independent. |
| `skill` | N/A | N/A | N/A | N/A | N/A | N/A | Skill generation is engine-independent. New: `skill tasks list/show/plan` exposes plan-only Agent Task Packs (built-in + `.dbcli-shared/tasks/` + `.dbcli/tasks/`); plans never execute commands. |

## Required CI validation

The release gate is four commands. CI runs them without `continue-on-error`, and they must also pass locally before tagging a release:

```bash
bun run typecheck
bun test
bun run lint
bun run build
```

- `bun run lint` enforces `--max-warnings=0` — any new ESLint warning blocks release.
- `bun run build` is followed by `dist/cli.mjs --help` / `--version` executable smoke checks (also release-blocking).
- `tests/integration/dist-smoke.test.ts` is part of `bun test` and guards the packaged `assets/` path used by `dbcli skill --install`.
- Benchmark (`bun run test:perf`) remains advisory and is allowed to fail (`continue-on-error: true`).

See [CONTRIBUTING.md → Release Process](../CONTRIBUTING.md#release-process) for the full pre-tag checklist.

## MongoDB limitations summary

MongoDB support is intentionally narrower than SQL support. Treat it as a document-database path, not a full SQL equivalent.

(See [SKILL.md](../assets/SKILL.md) or [reference.md](../assets/reference.md) for detailed MongoDB workflows.)

## Redis limitations summary

Redis connections speak Redis commands. Support is focused on key discovery and basic command execution.

### Connection and configuration

- Required: `host`, `port`. Optional: `password`, `database` (logical index 0-15).
- `list` returns ≤ 100 000 keys via SCAN.

### Query and Schema

- `query` first token must be an allow-listed command. Permission tier is derived from the command.
- `schema <key>` is synthetic and non-cached. No full database scan is available.
- Blacklist rules are **not** enforced for Redis keys/values.

## Elasticsearch limitations summary

Elasticsearch support uses the REST API. It is focused on index discovery and search.

### Connection and configuration

- Supports `host` + `port`, `nodes[]`, or `cloudId`.
- Auth: `apiKey` or `user`/`password`.
- Supports HTTPS and custom CA.

### Query and Schema

- `query` requires `--collection` (or `--index`). Supports JSON DSL or Lucene query strings.
- Hits are flattened into result rows.
- `schema` flattens mappings and surfaces multi-fields. Supports full-scan caching.
- Blacklist column rules apply to flattened rows. Index-level blacklist rejects an index up front.
