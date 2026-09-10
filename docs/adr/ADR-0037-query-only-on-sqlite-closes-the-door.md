# query-only on SQLite closes the door instead of refusing the write

* Status: accepted
* Date: 2026-09-10

Every SQL engine dbcli supports enforces `query-only` twice: the hand-written
classifier in `src/core/permission-guard.ts:98-135` refuses the statement, and
the adapter runs whatever survives inside a server-side read-only transaction —
`BEGIN READ ONLY` for PostgreSQL (`src/adapters/postgresql-adapter.ts:150-190`),
`START TRANSACTION READ ONLY` for MySQL and MariaDB
(`src/adapters/mysql-adapter.ts:187-234`), both followed by an unconditional
`ROLLBACK`. That second layer is the one that matters: it is the engine, not
dbcli, saying no, and `tests/integration/query-only-server-enforcement.test.ts`
exists to prove the claim is the server's.

SQLite has no read-only transaction. `BEGIN` is a transaction and nothing more;
a write inside it takes the database's write lock, appends to the WAL, and is
undone only when the `ROLLBACK` runs. Reproducing the existing shape would mean
reproducing its words while losing the property they were chosen for, and doing
so on files that, in the case this engine is for, belong to some other
application that is possibly running.

`bun:sqlite` opens a database with `SQLITE_OPEN_READONLY`
(`node_modules/bun-types/sqlite.d.ts:30-45`). A connection opened that way has
no write channel to refuse a write on.

## Decision

**When the resolved permission is `query-only`, the SQLite adapter opens the
file read-only, and the second enforcement layer is the open mode rather than a
transaction.** The classifier layer is unchanged and still runs first.

This makes the mechanism differ per engine, deliberately. What `query-only`
promises is a property — no write reaches the database — not a procedure. The
adapter is the boundary that knows how its engine delivers that property, which
is already why `sqlMode` lives on the adapter interface
(`src/adapters/types.ts:48`) rather than in the executor. Naming the promise
after PostgreSQL's implementation of it would be an accident of which engine
was written first.

The protection is strictly stronger than the transaction it replaces. A
read-only transaction refuses write *statements*; a read-only handle has no
write path at all, and SQLite enforces it below the SQL layer.

It is also visibly weaker in one place, and that has to be said rather than
discovered. A database left with a hot WAL cannot be opened read-only at all:
SQLite must replay the WAL to present a consistent view, replay is a write, and
the open fails. The adapter therefore must map that failure to an error that
says the file has an unreplayed write-ahead log and that a `query-only`
connection cannot recover it — not the bare `SQLITE_CANTOPEN` the driver
raises, which sends the reader looking for a permissions problem that is not
there.

## Consequences

`ENGINE_CAPABILITIES` cannot describe `queryLimitGuard` for SQLite as
identical to the other SQL engines without qualification, because the failure
mode above is real and belongs in the matrix `note`.

A future decision to unify `query-only` enforcement into one mechanism across
engines would have to break this one, which is why it is recorded rather than
left in the adapter for a reader to reverse-engineer from an open flag.

**Falsified if:** `src/adapters/sqlite-adapter.ts` stops passing the read-only
open flag, or `src/core/query-executor.ts` moves `query-only` enforcement into
a single engine-independent mechanism. Either would mean the promise is no
longer kept by the engine, and the guarantee this record claims would be
dbcli's own again.
