# Report Postgres key columns, and check write permission before the write gate

## Goal

On PostgreSQL, a structured `update` or `delete` that matches on the primary
key is refused as if it could touch many rows, and a query-only connection is
told the wrong reason for a refused write. Both were observed on `main` at
`d4ac1e0f` against the `postgres` service of `docker-compose.test.yml`, with a
`customers` table whose `id` is the primary key and whose `email` has a unique
constraint, and an `orders` table with a foreign key to `customers`.

The first fault is in the schema. `PostgreSQLAdapter.getTableSchema` builds the
primary key, the index columns and the foreign key columns with
`array_agg(<pg_attribute>.attname ...)` (`src/adapters/postgresql-adapter.ts:346`,
`:349`, `:402`, `:439`). `attname` is of type `name`, so the aggregate is a
`name[]` (type OID 1003), which the `pg` driver does not parse: it returns the
string `{id}` instead of `['id']`. The adapter then keeps only real arrays
(`:471`, `:476`, `:479`, `:502`), so `dbcli schema customers --format json`
reports `"primaryKey": []` and the unique index with `"columns": []`, and
`dbcli schema orders` reports the foreign key with `"columns": []` and
`"refColumns": []` and no column-level `foreignKey`. Only the column-level
`primaryKey: true` flag is right. The write gate reads the table-level
`primaryKey` and falls back to column flags only when that field is not an array
(`src/commands/write-gate.ts:708-721`), so with an empty array no selector
identifies a row and every structured write is classified `non_unique_where`.

The second fault is ordering. For SQL engines, `update` runs the write gate
(`src/commands/update.ts:354-360`) before the executor checks the permission
level (`src/core/data-executor.ts:140`). A query-only connection that issues an
update the gate would refuse is told that the statement is not limited to
specific rows, rather than that it lacks write permission. `delete` does not
have this fault: it checks permission for every engine before connecting
(`src/commands/delete.ts:131-138`), requires `data-admin`, and refuses with its
own `delete.admin_only` message (`resources/lang/en/messages.json:234`).

When this Story is done, the Postgres schema reports the key columns it already
knows, and a write that the permission level forbids is refused for that
reason before the write gate is consulted.

## Out of Scope

- Schema reading for MySQL, MariaDB, SQLite, MongoDB, Redis and
  Elasticsearch.
- The write gate's classification rules in `src/commands/write-gate.ts`, and the
  wording of any message in `resources/lang/`.
- Permission ordering for `insert`, for raw SQL through `dbcli query`, for
  the MongoDB and Redis branches of `update` (which check permission first, at
  `src/commands/update.ts:150` and `:234`), and any change to `delete`, its
  permission level, or its messages.
- `CHANGELOG.md` and any release or version change.
- The agent demo video Story (`specs/stories/agent-demo-video.md`).

## Acceptance Criteria

1. Against the `postgres` service of `docker-compose.test.yml`, for a table
   with a primary key, a unique index and a foreign key,
   `PostgreSQLAdapter.getTableSchema` returns `primaryKey` listing the primary
   key columns in key order, each unique index with its `columns`, each foreign
   key with its `columns` and `refColumns`, and the `foreignKey` field set on
   the referencing column. An integration test asserts each of these and fails
   on `main` at `d4ac1e0f`.
2. On a Postgres connection with `read-write` permission and no terminal to
   confirm, `dbcli update <table> --where "<primary key> = <value>" --set ...`
   updates exactly that one row and exits 0; on a connection with `data-admin`
   permission, the same holds for `dbcli delete --where "<primary key> = <value>"`.
   An integration test covers both and fails on `main` at `d4ac1e0f`.
3. On those connections (`read-write` for `update`, `data-admin` for `delete`),
   a `--where` that does not match a primary key or unique index is still
   refused with `non_unique_where`.
4. On a Postgres connection with `query-only` permission and no terminal to
   confirm, `dbcli update` exits non-zero with the `permission_requires_level`
   message (`resources/lang/en/messages.json:183`), and `dbcli delete` exits
   non-zero with the `delete.admin_only` message
   (`resources/lang/en/messages.json:234`), both when `--where` matches the
   primary key and when it does not. No row changes, and no write-gate audit
   entry is recorded. An integration test covers the four combinations; the
   two `update` cases fail on `main` at `d4ac1e0f`, and the two `delete` cases
   guard the existing behaviour.
5. Existing tests are not deleted, skipped, or weakened.
6. `git diff --name-only main...HEAD` lists only
   `src/adapters/postgresql-adapter.ts`, `src/commands/update.ts`, new or
   changed files under `tests/`, and this Story
   file (`specs/stories/postgres-schema-key-columns.md`).
7. `make verify` passes.
