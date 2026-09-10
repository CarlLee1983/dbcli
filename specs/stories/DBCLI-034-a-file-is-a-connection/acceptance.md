# Acceptance Criteria

## Happy Path

* [ ] AC-001: A v2 configuration naming `system: sqlite` and a `file` path
      resolves, and `dbcli list` prints the file's tables.
* [ ] AC-002: `dbcli schema <table> --format json` returns the table's columns,
      types, nullability and primary key from the SQLite file.
* [ ] AC-003: `dbcli query "SELECT ..."` returns rows, with the automatic
      `LIMIT 1000` applied exactly as it is for the other SQL engines.

## Business Rules

* [ ] AC-004: With `permission: query-only`, an `UPDATE` fails with SQLite's own
      read-only error and the database file's mtime is unchanged.
* [ ] AC-005: A blacklisted table is refused, and a blacklisted column is masked
      out of SQLite results, through the same rules as PostgreSQL.
* [ ] AC-006: `ATTACH DATABASE` and `DETACH DATABASE` are refused under
      `admin`, with an error naming the connection boundary rather than a
      permission.
* [ ] AC-007: `sqlite` appears in `DATABASE_SYSTEMS`, in all four dialect
      rosters, and in `ENGINE_CAPABILITIES` with `proxy` as `not-applicable`
      and every capability outside this Story's set as `unsupported`.
* [ ] AC-008: A SQLite identifier is quoted with double quotes, and an embedded
      double quote is doubled.
* [ ] AC-017: A parsed SQLite connection carries the path in `file` and an empty
      string in `database`, `host`, `user` and `password`; the path appears in no
      field but `file`.

## Failure Cases

* [ ] AC-009: `file: ":memory:"`, `file: "file::memory:"` and a path carrying
      `mode=memory` each fail at configuration parse time, naming `file`.
* [ ] AC-010: A configured path that does not exist fails at connect, naming the
      path; no file is created.
* [ ] AC-011: A read-only open against a database with an unreplayed WAL reports
      the write-ahead log, not a bare `SQLITE_CANTOPEN`.

## Regression Requirements

* [ ] AC-012: Every existing permission-guard fixture returns an identical
      verdict with the fourth dialect present, PostgreSQL and MySQL included.
* [ ] AC-013: The capability contract test still passes both directions — every
      `COMMAND_CAPABILITY_KEYS` entry has a capability, every capability names a
      live command path.
* [ ] AC-014: No integration test uses `:memory:`, and no test leaves a
      temporary database behind.
* [ ] AC-015: `docs/user/en/index.md`, `docs/user/en/index.html`,
      `docs/user/zh-TW/index.md` and `docs/user/zh-TW/index.html` all describe
      SQLite support, and `bun run docs:check` passes.
* [ ] AC-016: The complete repository verification gate passes.
* [ ] AC-018: The three regenerated capability-catalog hashes are the only
      change to `tests/fixtures/plat004/legacy-surface-baseline.json`, and
      `baselineCommit` is untouched.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/integration/sqlite-read.test.ts` | `a temporary file with two tables` | `both table names listed` |
| `AC-002` | test | `tests/integration/sqlite-read.test.ts` | `a table with a primary key and a nullable column` | `columns, types, nullable and primaryKey returned` |
| `AC-003` | test | `tests/integration/sqlite-read.test.ts` | `a table of 1500 rows` | `1000 rows and a truncation flag` |
| `AC-004` | test | `tests/integration/sqlite-read-only.test.ts` | `permission query-only and an UPDATE` | `SQLite read-only error and unchanged mtime` |
| `AC-005` | test | `tests/integration/sqlite-blacklist.test.ts` | `a blacklisted table and a blacklisted column` | `refusal for the table, masked column in results` |
| `AC-006` | test | `tests/unit/core/sqlite-attach-refusal.test.ts` | `permission admin and ATTACH DATABASE` | `connection-boundary refusal` |
| `AC-007` | test | `tests/unit/adapters/database-systems-roster.test.ts` | `the roster and the matrix` | `sqlite present in both, proxy not-applicable` |
| `AC-008` | test | `tests/unit/adapters/identifier-quote.test.ts` | `an identifier containing a double quote` | `doubled inside double quotes` |
| `AC-009` | test | `tests/unit/utils/validation-sqlite.test.ts` | `each of the three memory forms` | `parse failure naming file` |
| `AC-010` | test | `tests/integration/sqlite-read.test.ts` | `a path under a temporary directory that does not exist` | `connect failure naming the path, no file created` |
| `AC-011` | test | `tests/integration/sqlite-read-only.test.ts` | `a database with an unreplayed WAL` | `error text naming the write-ahead log` |
| `AC-012` | test | `bun test tests/unit/core/permission-guard` | `the existing dialect fixtures` | `unchanged verdicts` |
| `AC-013` | test | `tests/contract/capability-catalog.test.ts` | `the live Commander tree` | `both directions pass` |
| `AC-014` | command | `grep -rn ":memory:" tests/` | `repository checkout` | `no matches` |
| `AC-015` | command | `bun run docs:check` | `repository checkout` | `exit 0` |
| `AC-016` | command | `make verify` | `repository checkout` | `exit 0` |
| `AC-018` | command | `git diff --stat tests/fixtures/plat004/legacy-surface-baseline.json` | `this branch` | `3 insertions, 3 deletions` |
| `AC-017` | test | `tests/unit/utils/validation-sqlite.test.ts` | `a parsed sqlite connection` | `file holds the path, database is empty` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `connection.file` | `:memory:` | reject | `config.json` | `tests/unit/utils/validation-sqlite.test.ts` |
| `connection.file` | `file::memory:?cache=shared` | reject | `config.json` | `tests/unit/utils/validation-sqlite.test.ts` |
| `connection.file` | `file:app.db?mode=memory` | reject | `config.json` | `tests/unit/utils/validation-sqlite.test.ts` |
| `query.sql` | `ATTACH DATABASE '/etc/passwd' AS leak` | reject | `audit log entry` | `tests/unit/core/sqlite-attach-refusal.test.ts` |
| `query.sql` | `DETACH DATABASE main` | reject | `audit log entry` | `tests/unit/core/sqlite-attach-refusal.test.ts` |
| `query.sql` | `UPDATE users SET email = 'x'` | reject | `database file` | `tests/integration/sqlite-read-only.test.ts` |

## Verification Notes

```sh
bun test tests/unit/utils/validation-sqlite.test.ts
bun test tests/unit/core/sqlite-attach-refusal.test.ts
bun test tests/integration/sqlite-read.test.ts tests/integration/sqlite-read-only.test.ts
bun test tests/unit/core/permission-guard
make verify
```

What human review should weigh is AC-012. The fourth dialect enters a
comparison that fails closed across all dialects
(`src/core/permission-guard.ts:175-186`), so a SQLite write keyword written too
broadly re-classifies PostgreSQL and MySQL statements as writes — safely, and
therefore invisibly, until someone's read query starts being refused. An
unchanged-verdict assertion over the existing fixtures is the only thing
standing between that and a silent behaviour change for engines this Story does
not touch.

AC-004 is the claim ADR-0037 rests on, and it is deliberately observed twice:
the error must come from SQLite, and the file must not have been written. Either
alone would pass with a client-side refusal, which is the weaker guarantee the
decision rejects.
