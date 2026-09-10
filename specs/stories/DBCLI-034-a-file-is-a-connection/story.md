# Story: DBCLI-034 A File Is A Connection

## Goal

dbcli reads a SQLite database file — `list`, `schema`, `query`, `q` — under the
same permission ladder, blacklist and audit rules as every other engine, with
`query-only` enforced by the engine rather than by dbcli alone.

## Context

dbcli supports six engines. `DatabaseSystem` is the union at
`src/adapters/types.ts:6-12` and `DATABASE_SYSTEMS` the runtime roster at
`:25-32`, held together by a compile-time exhaustiveness alias at `:41-43`;
adding a member without adding it to the roster does not compile.

The connection configuration is already a per-engine union —
`ConnectionConfigSchema` at `src/utils/validation.ts:185-190`, four branches —
and two of those branches require nothing but `system`. A `uri`-only MongoDB
connection lives with `host: ''`, `user: ''` and `port: 27017` supplied by zod
defaults (`validation.ts:120-134`), and Elasticsearch does the same around
`cloudId` (`:168-181`). `src/commands/use.ts:83-96` already nulls out empty
host and port when it displays such a connection. A connection whose target is
not a host is therefore not a new idea here; a connection whose target is a
path is.

What that costs is four dialect rosters, all independently declared and all
three-member today: `SQL_DIALECTS` (`src/core/permission-guard.ts:145-151`),
`SqlTablesDialect` (`src/utils/sql-tables.ts:20`), `SqlIdentifierDialect`
(`src/adapters/identifier-quote.ts:14`) and the lint parser map
(`src/core/lint/parse.ts:16-20`). The first two are not optional for a Story
that ships `query`: the blacklist reaches its table names through
`extractTableReferences(sql, { dialect })` and the permission ladder reaches
its verdict through `classifyStatement`, both before a statement executes.

`findWriteKeyword` (`src/core/permission-guard.ts:175-186`) fails closed across
dialects: with no dialect given it tries every member of `SQL_DIALECTS` and any
dialect that finds a write wins. A fourth member is therefore not additive. A
SQLite write keyword written too broadly changes verdicts for PostgreSQL and
MySQL queries as well, silently and in the safe direction, which is the
direction nobody notices.

The driver costs nothing. `bun:sqlite` is built into the only runtime dbcli
runs on — `engines` declares `bun >=1.3.3` and no Node
(`package.json:43-45`), `dist/cli.mjs` carries `#!/usr/bin/env bun`, and
`tests/integration/runtime-contract.test.ts` asserts the bundles fail under a
bare `node`. Two engines already work this way: Redis through Bun's built-in
`RedisClient` (`src/adapters/redis-adapter.ts:68`) and Elasticsearch through
plain `fetch`.

`ATTACH DATABASE` is in this Story rather than the next one. Under the default
`query-only` permission the existing ladder already refuses it — `classifyStatement`
returns `UNKNOWN` for an unrecognised leading keyword and `TIER_GRANTS`
(`src/core/permission-guard.ts:283-288`) grants `query-only` only
SELECT/SHOW/DESCRIBE/EXPLAIN — but an `admin` connection would execute it, and
this Story is what first makes `query` run against a filesystem path. A
statement that reaches outside the configured file is not a permission question
at any level; it is the connection identity itself, which is why it is refused
here rather than tiered.

## Classification

* Security sensitive: yes
* Baseline conformance: no
* Task mode: mixed

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: no
* deploy: no

## Architecture

* Impact: high
* Decision: `ADR-0037`
* Decision: `ADR-0038`
* Boundary: `SqliteAdapter`
* Boundary: `ConnectionConfig`
* Boundary: `SqlDialectRoster`
* Contract: `SqliteAdapter opens read-only whenever the resolved permission is query-only`
* Contract: `ConnectionConfig accepts a SQLite target only as a configured file path`
* Contract: `SqlDialectRoster gains a fourth member without changing any existing engine's verdict`
* Owner: `SqliteAdapter = adapters`
* Owner: `ConnectionConfig = configuration`
* Owner: `SqlDialectRoster = sql-safety`

## Risk

* Level: high
* Reason: `cross-engine-classifier-widening`
* Reason: `filesystem-reachable-connection`

A fourth dialect changes a fail-closed comparison every other SQL engine runs
through, and this is the first connection target that is a path on the machine
dbcli runs on.

## Scope

### In Scope

* `sqlite` added to `DatabaseSystem` and `DATABASE_SYSTEMS`
  (`src/adapters/types.ts`), and to `SqlDatabaseSystem`.
* `SqliteConnectionConfigSchema` in `src/utils/validation.ts`: `system` and a
  required `file` (`StringOrEnvRef`), `timeout` and `statementTimeout`
  optional, everything else absent. Added to `ConnectionConfigSchema` and to
  the v2 named-connection union.
* `file?: string` added to `ConnectionOptions` (`src/adapters/types.ts`),
  optional there and required in the SQLite schema branch.
* Rejection of `:memory:`, `file::memory:` and `mode=memory` at parse time —
  ADR-0038.
* `src/adapters/sqlite-adapter.ts` on `bun:sqlite`, implementing the
  `DatabaseAdapter` interface: connect, `listTables`, `getTableSchema`,
  `executeQuery`, disconnect. Opens with `readonly: true` when `sqlMode` is
  `native-read-only`, and never with `create` — ADR-0037.
* `AdapterFactory` dispatch for `sqlite` in `createSqlAdapter`, `createAdapter`
  and `createAdapterWithoutRules` (`src/adapters/factory.ts`).
* `sqlite` added to all four dialect rosters, with quoting mapped to the
  double-quote rule PostgreSQL already uses (`identifier-quote.ts:17-19`).
* Refusal of `ATTACH` and `DETACH` at every permission level, with an error
  naming the connection boundary rather than a missing permission.
* Error mapping for a read-only open against a database with an unreplayed WAL.
* `ENGINE_CAPABILITIES` rows for `sqlite`, this Story's set only: `list`,
  `schema`, `schemaSingle`, `query`, `q`, `queryOutput`, `queryLimitGuard`,
  `blacklist`, `status`. Everything else `unsupported`, and `proxy`
  `not-applicable`.
* ADR-0037 and ADR-0038.
* `docs/user/en/` and `docs/user/zh-TW/`, both `index.md` and `index.html`, for
  what this Story delivers.

### Out of Scope

* `PRAGMA`, `VACUUM`, `REINDEX` and `REPLACE INTO` classification, and
  `insert` / `update` / `delete` — DBCLI-035.
* `init` / `use` / `doctor` / `export` / `queries`, and the v1→v2 migration
  gate — DBCLI-036.
* Replacing the unchecked `config.connection as ConnectionOptions` cast at
  `src/adapters/factory.ts:90` with a parse. It carries five engines today and
  its blast radius has nothing to do with SQLite.
* `docker-compose.test.yml` and `scripts/check-test-services.ts`. SQLite has no
  service, and giving it one would forfeit the only engine whose integration
  tests run without Docker.
* `migrate`, `diff`, `report`, `inspect`, `shell` for any engine.

## Inputs

* `src/adapters/types.ts`, `src/adapters/factory.ts`,
  `src/adapters/capabilities.ts`, `src/adapters/identifier-quote.ts`,
  `src/utils/validation.ts`, `src/utils/sql-tables.ts`,
  `src/core/permission-guard.ts`, `src/core/lint/parse.ts`.
* `node_modules/bun-types/sqlite.d.ts` — the driver's open flags.
* ADR-0022, for how the capability catalog derives from the matrix.

## Outputs

* A seventh engine that reads.
* Two records saying why its `query-only` and its rejected `:memory:` are what
  they are.

## Rules

* R1: With `permission: query-only`, a write reaching the adapter fails because
  the handle is read-only, not because dbcli refused it. The test observes the
  SQLite error, and the file's mtime is unchanged.
* R2: A configuration naming `:memory:`, `file::memory:` or a `mode=memory`
  path fails at parse time, naming the field.
* R3: `ATTACH` and `DETACH` are refused at every permission level including
  `admin`, with an error naming the connection boundary.
* R4: A SQLite connection never creates a file. A configured path that does not
  exist fails at connect, saying so.
* R5: A read-only open blocked by an unreplayed WAL reports the WAL, not
  `SQLITE_CANTOPEN`.
* R6: No existing engine's classifier verdict changes. The fixtures in
  `tests/unit/core/permission-guard*` produce identical results before and
  after the fourth dialect.
* R7: `sqlite` claims no capability the matrix does not grant, and the contract
  test relating `COMMAND_CAPABILITY_KEYS` to the catalog still passes both
  directions.
* R8: Integration tests use a temporary file in a test-owned directory,
  removed afterwards. No test uses `:memory:`.

## Expected Errors

* A write under `query-only` — the engine's read-only refusal.
* `:memory:` in configuration — a parse failure naming `file`.
* `ATTACH`/`DETACH` — a connection-boundary refusal, not a permission error.
* A missing file — a connect failure naming the path.
* A hot WAL under `query-only` — a WAL-specific message.

## Dependencies

* ADR-0022 — the matrix is the authority for every engine claim in the catalog.
* ADR-0037, ADR-0038 — decided in this Story, `proposed` until it is delivered.

## Constraints

* No new runtime dependency. `bun:sqlite` is built in.
* `src/core/` gains no engine-specific branch that the adapter could hold.
* Documentation parity is this Story's, not a later one's.

## Trust Boundary Fields

* `connection.file` — the database path, from `config.json` or from the
  environment variable a `{"$env": ...}` reference names
* `query.sql` — the statement text, from the command line, from stdin, or from
  a saved snippet
