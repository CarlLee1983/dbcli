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

The v1→v2 migration is the trap. `src/core/config-v2-mutations.ts:51-58`
refuses anything that is not a SQL engine — and DBCLI-034 puts `sqlite` in
`SqlDatabaseSystem`, so the refusal no longer fires and the connection falls
into a migration path whose field-copying is written for host, port, user and
password. A v1 configuration naming SQLite cannot exist, because v1 predates
the engine entirely; the honest behaviour is an explicit refusal that says so,
not a silent traversal of a path built for a different shape.

`dbcli use` needs nothing new — it already nulls empty host and port for
display (`src/commands/use.ts:83-96`) — but it has never displayed a path, and
`listConnections` (`src/core/config-v2.ts:274-300`) carries an optional `uri`
field for the same purpose that `file` will now need.

## Classification

* Security sensitive: yes
* Baseline conformance: no
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

* Level: medium
* Reason: `silent-migration-path`

A migration gate that stops refusing does not announce that it stopped.

## Scope

### In Scope

* `src/commands/init-sqlite.ts`, dispatched from `init.ts` alongside the
  MongoDB flow: one prompt for the file path, one for the permission.
* The path is checked before the configuration is written — it must exist and
  be readable. A path that does not exist is refused, and no database is
  created.
* `init.ts:257`'s engine list gains `sqlite`, and a test asserts that list
  against `DATABASE_SYSTEMS` so a fourth roster cannot drift again.
* `config-v2-mutations.ts` refuses `system: sqlite` explicitly, with a message
  saying a v1 configuration cannot have named this engine.
* `dbcli use` and `dbcli status` display the file path where they display a
  host, and `listConnections` carries `file`.
* `dbcli doctor` checks a SQLite connection: the file exists, is readable, and
  — where the permission is not `query-only` — is writable.
* `dbcli export` and `dbcli queries` / `q @name` against SQLite.
* `ENGINE_CAPABILITIES` rows for `init`, `use`, `status`, `doctor`, `export`,
  `queries`.
* Documentation parity for what this Story delivers.

### Out of Scope

* `migrate`, `diff`, `report`, `inspect`, `shell` for SQLite. Each stays
  `unsupported` in the matrix, and extending any of them is its own Story.
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
* R4: A v1 configuration naming `system: sqlite` is refused by the migration
  with a message naming the reason, not carried through the SQL path.
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

## Trust Boundary Fields

* `init.prompt.file` — the database path typed at the `dbcli init` prompt or
  passed as its flag
* `v1.connection.system` — the engine name in an existing v1 `config.json`
  offered to the migration
