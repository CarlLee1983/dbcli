# dbcli Feature Matrix

This matrix summarizes the current command support by database engine. It is intended for maintainers and AI agents choosing a safe command path.

Legend:

- ✅ Supported
- ⚠️ Supported with limitations or engine-specific behavior
- ❌ Not supported / exits with an error
- N/A Not database-engine-specific

Maintenance note: command support statuses in this table are mirrored by `src/adapters/capabilities.ts` and guarded by `tests/unit/adapters/capabilities.test.ts`. Update both together when support changes.

| Command / area | PostgreSQL | MySQL | MariaDB | MongoDB | Redis | Elasticsearch | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `init` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | MongoDB accepts URI or host/port. Redis uses database index (0-15). ES supports Cloud ID/ApiKey. |
| Multi-connection `use` / `--use` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | v2 config isolates connections and schema caches. |
| Read-only query fan-out (`--use a,b`) | ✅ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | SQL read-only statements, Mongo filters/read-only pipelines, and ES search only. Rejects writes, recovery, UI, CSV, and HTML; mixed outcomes exit 2. |
| `list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | SQL: tables; Mongo: collections; Redis: keys (SCAN); ES: indices. |
| `schema [table]` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | Mongo: sampled; Redis: per-key only (type/TTL/size); ES: flattened mapping. |
| `schema` full scan / `--refresh` / `--reset` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ | Redis has no full scan/cache. ES iterates non-system indices. |
| `query` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | SQL: SQL; Mongo: JSON; Redis: commands; ES: DSL/Lucene. |
| Query output `table` / `json` / `csv` / `html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | All engines flow through shared result formatter; HTML and `--ui` show truncation/security warnings before KPIs, charts, and raw rows. |
| Query auto-limit / size guard | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | SQL/Mongo/ES apply limits. Redis: SCAN/LRANGE/ZRANGE rewrite + HGETALL/SMEMBERS/KEYS truncate at 1000; `--no-limit` bypasses. |
| `q` saved query execution | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | SQL: SELECT/WITH only. Mongo: JSON `find` / `aggregate` body, requires `collection` frontmatter (CLI `--collection` overrides), parameter substitutions are JSON-encoded. Redis: read-only allowlist + range/SCAN size guard. ES: JSON DSL with size guard, scripts rejected, requires `index` frontmatter. |
| `queries` snippet management | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | Management works regardless of active connection. |
| `insert` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | Redis/ES writes not exposed via dedicated subcommand (use `query`). |
| `update` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | Redis/ES writes not exposed via dedicated subcommand. |
| `delete` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | Redis/ES deletes not exposed via dedicated subcommand. |
| `export` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | SQL/Mongo plus ES. An auto-limit hit fails closed without writing a partial file; use `--no-limit` for all rows or `--limit N` to accept a bound. ES full-index export scrolls in batches. Redis not supported. |
| `blacklist` config management | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | Rule CRUD engine-independent. Enforcement varies by engine. Redis: key-glob rejection (Redis-native pattern) plus value/hash-field masking (`[REDACTED]`) via the `redis.mask` config block. |
| `check` data health | ⚠️ | ✅ | ✅ | ❌ | ❌ | ❌ | SQL-only; best on MySQL/MariaDB. |
| `diff` snapshots | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | Relational schema snapshots only. |
| `migrate` DDL | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | SQL-only (Postgres/MySQL/MariaDB). |
| `shell` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | SQL + MongoDB + Redis + ES. ES: Kibana Dev Tools-style REPL (`<METHOD> /<path>` + optional JSON body, blank-line submit), read-focused, `_search` auto-capped at 1000. Redis: single-line; SCAN/LRANGE auto-capped at 1000; `.no-limit` to bypass. |
| `status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Safe non-credential config summary. |
| `doctor` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Engine-specific diagnostics. |
| `completion` | N/A | N/A | N/A | N/A | N/A | N/A | Shell completion is engine-independent. |
| `upgrade` | N/A | N/A | N/A | N/A | N/A | N/A | Update checks are engine-independent. |
| `recover` | N/A | N/A | N/A | N/A | N/A | N/A | Automated remediation and multi-turn protocol; engine-independent logic operating on saved envelopes. |
| `skill` | N/A | N/A | N/A | N/A | N/A | N/A | Skill generation is engine-independent. New: `skill tasks list/show/plan` exposes plan-only Agent Task Packs (built-in + `.dbcli-shared/tasks/` + `.dbcli/tasks/`); plans never execute commands. |
| `verify` | N/A | N/A | N/A | N/A | N/A | N/A | Runs non-executing verification scenarios: `safe-backfill` (analyzes UPDATE, never writes), `migration` (analyzes ALTER TABLE DDL, never executes DDL), `rollback` (analyzes a restore statement via `--kind ddl\|dml`, never executes it), and `constraint` (generates a read-only `COUNT(*)` violation query via `--check fk\|not-null\|unique\|custom`, never writes). All scenarios produce local `.dbcli/verification/` artifacts in `--after-write` mode. SQL engines only. |
| `verification` | N/A | N/A | N/A | N/A | N/A | N/A | Inspects and manages local VerificationArtifact files. Subcommands: `list` / `show` / `summary` / `prune` (all `local-write` or `readonly`). `summary --latest-only` narrows to the latest matching artifact plus status counts. Never connects to a database. |
| `audit` | N/A | N/A | N/A | N/A | N/A | N/A | Cross-engine local capability writing `.dbcli/audit/<conn>.jsonl`. Subcommands: `tail` / `show` / `health` (`readonly`), `clear` (`local-write`). See `assets/reference.md` §audit. |
| Package `./agent-core` export | N/A | N/A | N/A | N/A | N/A | N/A | Semver-stable, database-independent agent CLI helpers: env loading/references, connection selection/name parsing, and applied-limit trimming plus public types. Purity is release-gated. |

## Side-effect tiers

These tiers mirror `SideEffectTier` in `src/adapters/capabilities.ts` and are used by maintainers and AI agents to choose safe command paths.

| Tier | Meaning | Examples |
| --- | --- | --- |
| `readonly` | Reads remote or local state without mutating the connected database. Local schema-cache refreshes are still treated as readonly when the command contract says so. | `list`, `schema`, `query`, `inspect`, `report`, `guide`, `audit tail`, `audit show`, `audit health` |
| `dry-run` | Produces or applies a gated plan only when an explicit dry-run or allow flag is present. | `recover`, write commands with `--dry-run` |
| `local-write` | Writes local project or user configuration/artifacts, but does not mutate the connected database. | `use`, `queries`, `blacklist`, `skill`, `upgrade`, `audit clear` |
| `db-write` | Mutates the connected database or datastore. Requires permission checks and command-specific safeguards. | `insert`, `update`, `delete`, `migrate` |
| `interactive` | Requires prompt/TTY interaction and may write local configuration after user input. | `init`, `shell` |
| `none` | Command is unsupported or not applicable for the engine. | Unsupported engine/command combinations |

## Required CI validation

The release gate is 9 shell steps encoded in `scripts/release-check.sh`. The documentation/skill drift-guards (`skill:check`, `platform:check`, `plugin:check`, `docs:check`, plus the `reference.md` command-coverage test in `bun test`) run in CI on every push/PR via the `docs-parity` job; the full 9-step gate must pass locally via `bun run release:check` before tagging a release:

```bash
bun audit                                                              # 1/9
bunx prettier --check "src/**/*.ts" "tests/**/*.ts" "scripts/**/*.ts" # 2/9
bun run agent-core:check                                               # 3/9
bun run typecheck                                                      # 4/9
bun run lint                                                           # 5/9
bun test                                                               # 6/9
bun run build                                                          # 7/9
bun test tests/integration/dist-smoke.test.ts                          # 8/9
bash scripts/release-check.sh   # 9/9 doc-presence (audit row + CHANGELOG version)
```

- Step 3/9 (`bun run agent-core:check`) rejects database-specific terms and dependencies outside the stable agent-core boundary.
- Step 5/9 (`bun run lint`) enforces `--max-warnings=0` — any new ESLint warning blocks release.
- Step 8/9 (dist smoke) guards the packaged `assets/` path used by `dbcli skill --install` (including `SKILL.zh-TW.md` since v1.20.0).
- Step 9/9 (doc-presence) is a shell-grep gate: confirms `docs/feature-matrix.md` has the `audit` row and `CHANGELOG.md` has a `## [<package.json version>]` heading. Catches doc-vs-version drift before tagging.
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

### Size guard

- `SCAN` / `HSCAN` / `SSCAN` / `ZSCAN` inject `COUNT 1000` when missing; `LRANGE` / `ZRANGE` / `ZREVRANGE` clamp the `stop` index; `ZRANGEBYSCORE` injects `LIMIT 0 1000`.
- `HGETALL` / `HKEYS` / `HVALS` / `SMEMBERS` / `KEYS` are client-truncated at 1000 entries with a `REDIS_SIZE_TRUNCATE` warning.
- `--no-limit` (CLI) or `.no-limit on` (shell) bypasses all size guards.

### Blacklist enforcement

- Blacklist rules are enforced as **Redis-native key globs** (`*`, `?`, `[abc]`, `[a-z]`). Reads and writes whose keys match a rule are rejected with a `BlacklistRejection`.
- `KEYS` / `SCAN MATCH` patterns that overlap a blacklist pattern are rejected; non-overlapping listings filter out blacklisted keys.
- Value and hash-field **masking** is available via the `redis.mask` config block: keys matching a `keyPattern` glob have their value (or named hash `fields`) returned as `[REDACTED]` on read (`GET`, `GETRANGE`, `HGETALL`, `HGET`, `HMGET`, `HVALS`). Key-glob **rejection** always takes precedence over masking.

### Shell

- `dbcli shell` opens an interactive single-line Redis REPL with history, tab completion (commands + key prefixes), and a `.no-limit on/off` toggle.

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

### Shell

- `dbcli shell` opens a dedicated Kibana Dev Tools-style REPL: enter `<METHOD> /<path>` then an optional multi-line JSON body, and submit with a blank line. Responses render as pretty JSON.
- Read-focused. Index-level blacklist rejects protected indices up front, and `_search` requests without an explicit `size` are auto-capped at 1000.
- A blank line submits the current block; Ctrl+C cancels the in-progress block; Ctrl+D or `exit`/`quit` leaves the shell.
