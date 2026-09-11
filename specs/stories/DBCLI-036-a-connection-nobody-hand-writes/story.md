# Story: DBCLI-036 A Connection Nobody Has To Hand-Write

## Goal

A SQLite connection can be created, switched to, inspected and exported from
through dbcli's own commands, instead of by editing `config.json` by hand.

## Context

DBCLI-034 and DBCLI-035 leave SQLite fully functional and entirely
undiscoverable. The only way to create one of these connections is to write the
JSON.

`dbcli init` prompts for host, port, user, password and database in that order
(`src/commands/init.ts:378-427`), five questions of which none applies. MongoDB
already established the answer to this: `init.ts:264-275` dispatches to
`src/commands/init-mongodb.ts`, a separate flow asking what MongoDB actually
needs. `init.ts` also carries its own hardcoded copy of the engine list at
`:257`, which is a third roster beside `DATABASE_SYSTEMS` and the config
schemas and will not know about `sqlite` unless it is told.

The v1→v2 migration needs a smaller repair than it first appears to.
`src/core/config-v2-mutations.ts:53` refuses anything outside `SQL_SYSTEMS`,
and that constant is a three-member array declared in that file — it is not
`SqlDatabaseSystem`, so DBCLI-034 classifying SQLite as SQL did not change what
the gate admits. Measured: `migrateV1ToV2` given `system: 'sqlite'` still
throws.

What did change is that the refusal now contradicts itself. It says the upgrade
"only supports SQL connections (mysql/postgresql/mariadb)", and SQLite is a SQL
connection in dbcli's own vocabulary. The behaviour is right and the sentence
explaining it is not, which is the harder half to notice.

A v1 configuration cannot name SQLite in any case: v1 predates the engine. So
the message should say that, rather than describing a category SQLite belongs
to.

The larger surprise was measured after DBCLI-035 landed, not predicted. Every
SQL-shaped command re-declares its own `requireSqlConnection` with a hardcoded
`['postgresql', 'mysql', 'mariadb']`, so `list`, `query`, `insert`, `update`,
`delete` and `export` all refused a working SQLite connection at the CLI while
the capability matrix said they were supported. Nothing failed to compile:
`SqlDatabaseSystem` gained `sqlite` and `SqlConnectionOptions` widened with it,
but a string literal is not a union. DBCLI-034's and DBCLI-035's tests were
adapter- and executor-level, so neither could see it. Repairing it is in scope
here because AC-001 requires `dbcli list` to work on a connection `init` just
wrote, and because a matrix that claims a command the command refuses is worse
than one that claims nothing.

`dbcli use` needs nothing new — it already nulls empty host and port for
display (`src/commands/use.ts:83-96`) — but it has never displayed a path, and
`listConnections` (`src/core/config-v2.ts:274-300`) carries an optional `uri`
field for the same purpose that `file` will now need.

## Classification

* Security sensitive: yes
* Baseline conformance: yes
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: yes
* commit: yes
* push: no
* deploy: no

## Architecture

* Impact: medium
* Decision: `ADR-0038`
* Boundary: `ConnectionConfig`
* Contract: `every engine roster in the repository names the same engines`
* Owner: `ConnectionConfig = configuration`

## Risk

* Level: low
* Reason: `misleading-refusal-text`

The gate was measured before the Story was believed: it still refuses. What is
wrong is the sentence, not the behaviour.

## Scope

### In Scope

* `src/commands/init-sqlite.ts`, dispatched from `init.ts` alongside the
  MongoDB flow: one prompt for the file path, one for the permission.
* The path is checked before the configuration is written — it must exist and
  be readable. A path that does not exist is refused, and no database is
  created.
* `init.ts:257`'s engine list gains `sqlite`, and a test asserts that list
  against `DATABASE_SYSTEMS` so a fourth roster cannot drift again.
* `config-v2-mutations.ts` keeps refusing `system: sqlite` — the gate is
  already correct — and its message stops saying SQLite is not a SQL
  connection. It says a v1 configuration predates the engine and therefore
  cannot name it.
* `dbcli use` and `dbcli status` display the file path where they display a
  host, and `listConnections` carries `file`.
* `dbcli doctor` checks a SQLite connection: the file exists, is readable, and
  — where the permission is not `query-only` — is writable.
* `dbcli export` and `dbcli queries` / `q @name` against SQLite.
* The command-layer SQL gate. Seven commands — `list`, `query`, `export`,
  `doctor`, `insert`, `update`, `delete` — each carried a private
  `['postgresql', 'mysql', 'mariadb']` literal in a local
  `requireSqlConnection`, and all seven refused SQLite at the CLI while
  `ENGINE_CAPABILITIES` said they supported it. Measured after DBCLI-035:
  `dbcli query 'SELECT * FROM users'` on a working SQLite connection printed
  `This command requires a SQL connection, got: sqlite`. The seven read one
  shared guard now, over a `SQL_DATABASE_SYSTEMS` roster tied to
  `SqlDatabaseSystem` by `satisfies`.
* The snippet engine roster. `EngineTag`, the parser's validator, `queries
  search --engine` and `queries suggest --engine` each declared the engine
  names separately; `EngineTag` is derived from one frozen `ENGINE_TAGS` array
  and the two `--engine` filters read it.
* `ENGINE_CAPABILITIES` rows for `init`, `use`, `status`, `doctor`, `export`,
  `queries`.
* Documentation parity for what this Story delivers.

### Out of Scope

* `migrate`, `diff`, `report`, `inspect`, `shell` for SQLite. Each stays
  `unsupported` in the matrix, and extending any of them is its own Story.
  Their own `requireSqlConnection` copies stay untouched: they refuse SQLite
  for reasons of their own — no DDL generator, no snapshot support, no REPL —
  rather than because SQLite is not SQL, and folding them into the shared guard
  would silently claim them.
* A `--file` flag on `query` or any other command. The path comes from the
  configuration; a per-invocation path would make dbcli a file reader pointed
  by its caller, which is the boundary DBCLI-034 spent its Security section
  establishing.
* Creating a SQLite database. dbcli connects to databases; it does not
  bring them into existence from a path.
* Replacing the `as ConnectionOptions` cast, still.

## Inputs

* `src/commands/init.ts`, `src/commands/init-shared.ts`,
  `src/commands/init-mongodb.ts` as the precedent, `src/commands/use.ts`,
  `src/core/config-v2.ts`, `src/core/config-v2-mutations.ts`,
  `src/commands/doctor.ts`, `src/commands/export.ts`.

## Outputs

* `dbcli init` producing a working SQLite connection.
* One engine roster fewer that can drift.

## Rules

* R1: `dbcli init` with SQLite selected asks for a path and a permission, and
  nothing else.
* R2: A path that does not exist, or is not readable, is refused before
  anything is written to `config.json`.
* R3: `dbcli init` never creates a database file.
* R4: A v1 configuration naming `system: sqlite` is refused by the migration,
  as it already is, and the message names the real reason rather than
  describing SQLite as a non-SQL connection.
* R5: `init.ts`'s engine list equals `DATABASE_SYSTEMS`, asserted by a test.
* R6: `dbcli use` and `dbcli status` show the path, and never an empty host and
  port pair.
* R7: `dbcli doctor` reports a missing or unreadable file as a failure, and an
  unwritable file as a failure only when the permission implies writing.
* R8: No command accepts a SQLite path outside the configuration.

## Expected Errors

* A non-existent or unreadable path at `init` — refused before writing.
* A v1 SQLite configuration at migration — refused, naming the reason.
* An unwritable file under a write permission at `doctor` — a failure.

## Dependencies

* DBCLI-034 — the schema branch, the adapter, the roster.
* DBCLI-035 — the write path `doctor`'s writability check corresponds to.
* ADR-0038 — `:memory:` stays refused here too, including at the `init` prompt.

## Constraints

* `init-sqlite.ts` follows `init-mongodb.ts`'s shape rather than inventing one.
* No new prompt library, no new dependency.

## Superseded Behavior

* `tests/integration/lazy-entry-path.test.ts` — the three capability-catalog
  cases, for the third time on this branch and for the same structural reason:
  the catalog is derived from `ENGINE_CAPABILITIES` (ADR-0022), so claiming
  `init`, `use`, `doctor`, `export` and `queries` for SQLite necessarily
  changes all three renderings. Only the three `stdoutSha256` values in
  `tests/fixtures/plat004/legacy-surface-baseline.json` change;
  `baselineCommit` and its assertion do not. Whether that guard should exist in
  this shape is DBCLI-038's question, not this Story's.

* `tests/unit/core/migrate-v1-to-v2.test.ts` — the non-SQL refusal case
  asserted the message text `僅支援 SQL`. DBCLI-034 made that sentence false by
  classifying SQLite as SQL, which is exactly what AC-010 exists to repair, so
  the assertion moves to the engine names the gate actually admits. The gate
  refuses the same set of engines before and after; only the wording changes.

## Trust Boundary Fields

* `init.prompt.file` — the database path typed at the `dbcli init` prompt or
  passed as its flag
* `v1.connection.system` — the engine name in an existing v1 `config.json`
  offered to the migration
