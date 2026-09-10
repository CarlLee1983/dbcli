# Acceptance Criteria

## Happy Path

* [ ] AC-001: `dbcli insert`, `dbcli update` and `dbcli delete` write to a
      SQLite file under a `data-admin` connection and report affected rows.
* [ ] AC-002: `--dry-run` prints the SQL with SQLite double-quoted identifiers
      and does not touch the file.

## Business Rules

* [ ] AC-003: `REPLACE INTO users ...` is classified as a write, with a
      statement type rather than `UNKNOWN`, and refused for `query-only` and
      `read-write` naming the required tier.
* [ ] AC-004: `INSERT OR REPLACE INTO users ...` keeps the verdict it has today.
* [ ] AC-005: `PRAGMA table_info(users)` and `PRAGMA journal_mode=WAL` are both
      admin-only, and both carry `isDangerous`.
* [ ] AC-006: `VACUUM` and `REINDEX` are admin-only because they are declared
      so; the test fails if they are reaching that verdict as unrecognised
      keywords.
* [ ] AC-007: A SQLite statement carrying a `--` comment, a `/* */` block, a
      doubled single quote and a double-quoted identifier is classified on its
      real leading keyword.

## Failure Cases

* [ ] AC-008: `REPLACE INTO` on a `query-only` connection fails at the SQLite
      handle as well as at the ladder, and the file's mtime is unchanged.
* [ ] AC-009: A `PRAGMA` on a `read-write` connection fails with a permission
      error naming `admin`.

## Regression Requirements

* [ ] AC-010: Every existing PostgreSQL, MySQL and MariaDB classifier fixture
      returns an identical verdict after `REPLACE` is added.
* [ ] AC-011: `ENGINE_CAPABILITIES` for `sqlite` gains only the rows this Story
      delivers, and the capability contract test passes both directions.
* [ ] AC-012: Documentation parity across both languages and both formats, and
      `bun run docs:check` passes.
* [ ] AC-013: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/integration/sqlite-write.test.ts` | `a data-admin connection and a seeded table` | `rows affected and file contents changed` |
| `AC-002` | test | `tests/integration/sqlite-write.test.ts` | `--dry-run on an update` | `double-quoted SQL printed, mtime unchanged` |
| `AC-003` | test | `tests/unit/core/sqlite-statements.test.ts` | `REPLACE INTO under query-only` | `write type and a tier-naming refusal` |
| `AC-004` | test | `tests/unit/core/sqlite-statements.test.ts` | `INSERT OR REPLACE under read-write` | `verdict identical to the pre-change baseline` |
| `AC-005` | test | `tests/unit/core/sqlite-statements.test.ts` | `both PRAGMA forms` | `UNKNOWN, isDangerous, admin-only` |
| `AC-006` | test | `tests/unit/core/sqlite-statements.test.ts` | `VACUUM and REINDEX` | `admin-only by declaration, asserted on the declared type` |
| `AC-007` | test | `tests/unit/core/permission/sql-analysis.test.ts` | `a statement carrying all four lexical forms` | `leading keyword found correctly` |
| `AC-008` | test | `tests/integration/sqlite-read-only.test.ts` | `REPLACE INTO on a query-only connection` | `SQLite read-only error and unchanged mtime` |
| `AC-009` | test | `tests/unit/core/sqlite-statements.test.ts` | `PRAGMA under read-write` | `permission error naming admin` |
| `AC-010` | test | `bun test tests/unit/core/permission-guard` | `the existing dialect fixtures` | `unchanged verdicts` |
| `AC-011` | test | `tests/contract/capability-catalog.test.ts` | `the live Commander tree` | `both directions pass` |
| `AC-012` | command | `bun run docs:check` | `repository checkout` | `exit 0` |
| `AC-013` | command | `make verify` | `repository checkout` | `exit 0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `query.sql` | `REPLACE INTO users VALUES (1, 'x')` | reject | `database file` | `tests/unit/core/sqlite-statements.test.ts` |
| `query.sql` | `PRAGMA journal_mode=WAL` | reject | `database file` | `tests/unit/core/sqlite-statements.test.ts` |
| `query.sql` | `PRAGMA table_info(users)` | reject | `audit log entry` | `tests/unit/core/sqlite-statements.test.ts` |
| `query.sql` | `VACUUM` | reject | `database file` | `tests/unit/core/sqlite-statements.test.ts` |
| `query.sql` | `SELECT 1 -- ; REPLACE INTO users VALUES (1)` | reject | `database file` | `tests/unit/core/permission/sql-analysis.test.ts` |

## Verification Notes

```sh
bun test tests/unit/core/sqlite-statements.test.ts
bun test tests/unit/core/permission/sql-analysis.test.ts
bun test tests/integration/sqlite-write.test.ts
bun test tests/unit/core/permission-guard
make verify
```

AC-006 is the one worth reading carefully. `VACUUM` and `REINDEX` already reach
the right answer today by not being recognised, so a test that only asserts
"refused below admin" passes before any code is written and proves nothing. The
assertion has to be on the declared statement type, so that the test fails if
the declaration is removed and the fallthrough silently takes over again.

AC-010 carries the same weight it did in DBCLI-034: `REPLACE` enters a
fail-closed cross-dialect scan, and PostgreSQL has no `REPLACE INTO` but does
have `REPLACE(` as a string function. A keyword pattern that does not require
the statement position will re-classify `SELECT REPLACE(name, 'a', 'b') FROM t`
as a write for every SQL engine.
