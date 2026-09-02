# Story: DBCLI-002 Server-Enforced Query-Only SQL

## Goal

Prevent an AI agent using a `query-only` SQL connection from accidentally
changing persistent database data or schema, even when the submitted statement
looks read-only to dbcli's SQL classifier.

## Context

dbcli already rejects known write statement shapes before execution. That
client-side classification cannot determine whether a user-defined function,
routine, or other database object invoked by a `SELECT` has persistent side
effects. For example, the current permission check allows
`SELECT mutate_accounts()` in `query-only` mode because its statement shape is
`SELECT`.

The database must therefore provide the final read-only enforcement boundary
for SQL execution. Existing classifier, blacklist, hidden-write, and
multi-statement checks remain earlier defense layers.

## Scope

### In Scope

* Enforce a database-native read-only transaction or session for effectively
  `query-only` execution on PostgreSQL, MySQL, and MariaDB, including operations
  such as multi-connection fan-out that narrow a higher configured tier.
* Apply the invariant to every dbcli path that can execute caller-controlled SQL,
  including `query`, `export`, saved queries, saved-query verification, report
  diagnostics, SQL shell, and analyzed explain plans.
* Fail closed before every caller-controlled SQL statement, including after a
  reconnect, when the native read-only boundary cannot be established.
* Add cross-engine regression evidence and update English and Traditional
  Chinese user documentation in both Markdown and HTML formats.

### Out of Scope

* Permission behavior changes for MongoDB, Redis, or Elasticsearch.
* SQL function-purity allowlists or rejection of all function calls.
* Creating or changing database accounts, grants, roles, or ACLs.
* Preventing changes to temporary or session-local state where an engine's
  native read-only semantics permit them.
* Preventing side effects outside the target database, such as network calls
  made by unsafe database extensions.
* Dependency upgrades, new packages, or a new cross-engine permission framework.

## Inputs

* A dbcli SQL connection configured with `permission: query-only`, or an
  operation whose effective capability is narrowed to query-only.
* Caller-controlled SQL submitted through any supported dbcli execution path.

## Outputs

* Read results for statements permitted by both existing dbcli checks and the
  database-native read-only boundary.
* A bounded, actionable error when read-only enforcement cannot be established
  or the database rejects a persistent side effect.

## Rules

* R1: `query-only` must protect persistent, non-temporary data and schema at the
  database execution boundary, not only through SQL text classification.
* R2: The boundary must be independently active for every caller-controlled
  statement on the physical connection that executes it, including pooled and
  reconnected connections.
* R3: Failure or lack of support for native read-only enforcement must stop
  execution; dbcli must not silently fall back to classifier-only protection.
* R4: All SQL execution paths must share the same invariant rather than duplicate
  command-specific guards.
* R5: Existing classifier, blacklist, hidden-write, and multi-statement checks
  remain in force.
* R6: `read-write`, `data-admin`, and `admin` behavior remains unchanged.
* R7: Caller-controlled SQL must not be able to weaken the boundary for a later
  statement by changing transaction or session defaults.
* R8: Query failure and connection reuse must leave later query-only operations
  usable without leaking read-only transaction or session state into an
  operation with a different effective permission tier.

## Expected Errors

* Native read-only setup fails or is unsupported: reject before executing the
  target statement and identify that the `query-only` boundary was not
  established.
* A reconnect cannot re-establish read-only enforcement: reject the retried
  target statement rather than execute on an unprotected connection.
* A read-shaped statement attempts a persistent write: surface the database
  rejection without changing the protected fixture state.

## Dependencies

* Existing SQL adapters, permission configuration, execution-path registry, and
  Docker-backed PostgreSQL, MySQL, and MariaDB test services.

## Constraints

* Do not access production databases or credentials.
* Do not add or upgrade dependencies.
* Preserve existing CI checks and use `make verify` as the completion gate.
* Tests must distinguish an unavailable test environment from a passing result.
