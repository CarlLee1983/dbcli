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
