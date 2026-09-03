# Acceptance Criteria

## Happy Path

* [ ] On PostgreSQL, MySQL, and MariaDB, ordinary read statements supported by
  each engine continue to succeed through a `query-only` connection.
* [ ] Every caller-controlled SQL statement executes on a physical connection
  with an independently active database-native read-only transaction or session,
  including pooled and reconnected connections.

## Business Rules

* [ ] For each supported SQL engine, an integration test submits a statement
  classified as `SELECT` that invokes a fixture routine with a persistent write;
  the database rejects it and the fixture's persistent state remains unchanged.
* [ ] `query`, `export`, saved-query execution, saved-query verification, report
  diagnostics, SQL shell, and analyzed explain plans are covered by one shared
  read-only execution invariant rather than separate command-specific guards.
* [ ] Multi-connection fan-out uses the read-only invariant according to its
  effective capability even when the selected connections have a higher stored
  permission tier.
* [ ] Existing classifier, blacklist, hidden-write, and multi-statement checks
  still run for `query-only` SQL.

## Failure Cases

* [ ] If native read-only enforcement is unsupported or its initialization
  fails, dbcli does not execute the target statement and returns a bounded,
  actionable error identifying the failed `query-only` boundary.
* [ ] A caller statement that attempts to weaken transaction or session defaults
  cannot make a later statement execute without the read-only boundary.
* [ ] After a rejected or failed statement, a later safe query-only statement can
  succeed, and connection reuse does not leak state into an operation with a
  different effective permission tier.
* [ ] A reconnect retry re-establishes native read-only enforcement before the
  target statement runs, or fails closed without executing it.

## Regression Requirements

* [ ] Existing SQL permission and execution-path contract tests remain green.
* [ ] Existing MongoDB, Redis, and Elasticsearch permission behavior and tests
  remain unchanged.
* [ ] `read-write`, `data-admin`, and `admin` SQL behavior remains unchanged.
* [ ] `docs/user/en/` and `docs/user/zh-TW/` Markdown and HTML documentation state
  the persistent-database guarantee and the temporary/session and external-side-
  effect limitations consistently.
* [ ] `make verify` passes with PostgreSQL, MySQL, and MariaDB test services
  available.

## Verification Notes

Run focused unit and Docker-backed SQL integration tests before `make verify`.
The fixture routine must prove both rejection and unchanged persistent state. If
any required database service is unavailable, report the environment blocker and
do not claim complete PASS.

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `query` command SQL statement (`sqlMode: 'native-read-only'`) invoking a write-capable routine | `SELECT dbcli_query_only_boundary_mutate()` | reject | `dbcli_query_only_boundary_fixture` table row count | `tests/integration/query-only-server-enforcement.test.ts` |
| PostgreSQL native boundary setup (`BEGIN READ ONLY`) rejected by the server | `read-only transactions disabled` | reject | `ConnectionError.code` value `QUERY_ONLY_BOUNDARY_FAILED` | `tests/unit/adapters/query-only-boundary.test.ts::PostgreSQL fails closed when BEGIN READ ONLY is rejected` |
| Caller `weakenDefault` session-default statement before a target statement | `SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE` | preserve | `dbcli_query_only_boundary_fixture` table row count | `tests/integration/query-only-server-enforcement.test.ts` |
| `pool.connect()` transport failure during boundary setup | `Connection terminated unexpectedly` | reject | `ConnectionError.code` value `CONNECTION_LOST` | `tests/unit/adapters/query-only-boundary.test.ts::PostgreSQL preserves no-code transport failures during boundary setup` |
| `ROLLBACK` cleanup failure after the target statement already ran | `socket closed during rollback` | reject | error message fragment `target completed` and hint fragment `target statement ran` | `tests/unit/adapters/query-only-boundary.test.ts::PostgreSQL reports that the target ran when rollback fails` |
| `adapter.execute` retried after `ECONNRESET` during REPL reconnect | `SELECT 1;` | preserve | `adapter.execute` call arguments `{ sqlMode: 'native-read-only' }` on both attempts | `tests/core/repl/repl-engine.test.ts::reconnect retry re-establishes query-only mode before executing again` |
| `q` command saved-snippet CTE statement on a query-only connection | `WITH src AS (SELECT 1 AS dau) SELECT dau FROM src;` | preserve | `mock.lastSql` | `tests/unit/commands/q.test.ts::read-only CTE snippet still reaches the adapter on a query-only connection` |
| Fan-out connection stored with `permission: 'admin'` | `SELECT 1` via `connectionSelector: 'primary,staging'` | preserve | `adapters.primary.sqlModes` and `adapters.staging.sqlModes` equal `['native-read-only']` | `tests/unit/commands/query-fanout.test.ts::narrows admin-stored fan-out connections to the native query-only boundary` |
| `runQueryExplain` `executionMode` forwarded to `adapter.execute` | `SELECT 1` with `executionMode: 'native-read-only'` | preserve | `sqlMode` captured by the adapter's `execute` wrapper | `tests/unit/core/explain/runner.test.ts::runQueryExplain: forwards native read-only mode to analyzed execution` |
| `runDiagnostic` execution on a `permission: 'query-only'` connection | snippet executed with `permission: 'query-only'` | preserve | `sqlMode` captured by the adapter's `execute` wrapper | `tests/unit/core/report/run-diagnostic.test.ts::uses the native boundary for query-only SQL diagnostics` |
| Direct execution on a non-`query-only` connection | `INSERT INTO t VALUES (1)` with `sqlMode: 'normal'` | preserve | ordered adapter `calls` array | `tests/unit/adapters/query-only-boundary.test.ts::normal mode preserves direct execution without transaction setup` |
| Source file `adapter.execute(` call sites scanned by `REGISTERED_PATHS` | the repository's actual `.execute(` call-site count per file | preserve | `REGISTERED_PATHS` gate map compared against `findExecutionPaths()` | `tests/unit/core/execution-path-contract.test.ts::no adapter execution happens outside a registered path` |
