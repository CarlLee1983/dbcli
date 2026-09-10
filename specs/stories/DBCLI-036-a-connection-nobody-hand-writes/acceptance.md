# Acceptance Criteria

## Happy Path

* [ ] AC-001: `dbcli init` with SQLite selected asks for a file path and a
      permission, asks nothing about host, port, user or password, and writes a
      v2 connection that `dbcli list` can immediately use.
* [ ] AC-002: `dbcli use <name>` and `dbcli status` display the file path, and
      display no host or port.
* [ ] AC-003: `dbcli export` and `q @<snippet>` return SQLite results in every
      supported format.

## Business Rules

* [ ] AC-004: `init.ts`'s engine list equals `DATABASE_SYSTEMS` exactly, and the
      test fails if either gains a member the other lacks.
* [ ] AC-005: `listConnections` carries `file` for a SQLite connection, the way
      it carries `uri` for MongoDB.
* [ ] AC-006: `dbcli doctor` passes for an existing readable file, and reports
      an unwritable file as a failure only when the permission implies writing.
* [ ] AC-007: `ENGINE_CAPABILITIES` for `sqlite` now covers `init`, `use`,
      `status`, `doctor`, `export` and `queries`, and `migrate`, `diff`,
      `report`, `inspect` and `shell` remain `unsupported`.

## Failure Cases

* [ ] AC-008: `dbcli init` given a path that does not exist refuses before
      writing `config.json`, and no database file is created.
* [ ] AC-009: `dbcli init` given `:memory:` at the prompt refuses, naming the
      same reason the schema gives.
* [ ] AC-010: A v1 configuration naming `system: sqlite` is refused by the
      migration — as it already is — and the message says a v1 configuration
      predates the engine, without claiming SQLite is not a SQL connection.
* [ ] AC-011: `dbcli doctor` reports a missing file and an unreadable file as
      distinct failures.

## Regression Requirements

* [ ] AC-012: The existing MongoDB, Redis, Elasticsearch and SQL `init` flows
      are unchanged.
* [ ] AC-013: The v1→v2 migration's existing refusal of MongoDB, Redis and
      Elasticsearch is unchanged.
* [ ] AC-014: No command accepts a SQLite file path from a flag or an argument.
* [ ] AC-015: Documentation parity across both languages and both formats, and
      `bun run docs:check` passes.
* [ ] AC-016: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/integration/sqlite-init.test.ts` | `scripted prompts and a temporary file` | `two prompts, a usable v2 connection` |
| `AC-002` | test | `tests/integration/sqlite-init.test.ts` | `a configured SQLite connection` | `path shown, no host or port` |
| `AC-003` | test | `tests/integration/sqlite-init.test.ts` | `a saved snippet and an export target` | `rows in json, csv and table` |
| `AC-004` | test | `tests/unit/commands/init-engine-roster.test.ts` | `init.ts's list and DATABASE_SYSTEMS` | `exact equality` |
| `AC-005` | test | `tests/unit/core/config-v2.test.ts` | `a SQLite connection in a v2 config` | `file present in the listing` |
| `AC-006` | test | `tests/integration/sqlite-doctor.test.ts` | `a read-only file under data-admin` | `failure naming writability` |
| `AC-007` | test | `tests/unit/adapters/capabilities.test.ts` | `the sqlite matrix rows` | `the six supported, the five still unsupported` |
| `AC-008` | test | `tests/integration/sqlite-init.test.ts` | `a path under a temporary directory that does not exist` | `refusal, no config written, no file created` |
| `AC-009` | test | `tests/integration/sqlite-init.test.ts` | `:memory: typed at the prompt` | `refusal naming the same reason as the schema` |
| `AC-010` | test | `tests/unit/core/migrate-v1-to-v2.test.ts` | `a v1 config with system sqlite` | `refusal whose text names v1, not the SQL category` |
| `AC-011` | test | `tests/integration/sqlite-doctor.test.ts` | `a missing file and a chmod 000 file` | `two distinct failures` |
| `AC-012` | test | `bun test tests/unit/commands/init` | `the existing init fixtures` | `unchanged behaviour` |
| `AC-013` | test | `tests/unit/core/migrate-v1-to-v2.test.ts` | `the existing non-SQL refusal fixtures` | `unchanged refusals` |
| `AC-014` | command | `bun run src/cli.ts query --help` | `repository checkout` | `no file or db path option` |
| `AC-015` | command | `bun run docs:check` | `repository checkout` | `exit 0` |
| `AC-016` | command | `make verify` | `repository checkout` | `exit 0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `init.prompt.file` | `:memory:` | reject | `config.json` | `tests/integration/sqlite-init.test.ts` |
| `init.prompt.file` | `/tmp/does-not-exist.sqlite` | reject | `config.json` | `tests/integration/sqlite-init.test.ts` |
| `init.prompt.file` | `/etc/passwd` | reject | `config.json` | `tests/integration/sqlite-init.test.ts` |
| `v1.connection.system` | `sqlite` | reject | `config.json` | `tests/unit/core/migrate-v1-to-v2.test.ts` |

## Verification Notes

```sh
bun test tests/integration/sqlite-init.test.ts tests/integration/sqlite-doctor.test.ts
bun test tests/unit/commands/init-engine-roster.test.ts
bun test tests/unit/core/migrate-v1-to-v2.test.ts
make verify
```

AC-010 is the one that would not exist without someone going looking for it.
The migration gate at `src/core/config-v2-mutations.ts:51-58` refuses non-SQL
engines, and DBCLI-034 classifies SQLite as SQL — so this gate stops refusing
without anyone editing it, and the path it then permits copies host, port, user
and password fields that a SQLite connection does not have. Nothing fails
loudly. The refusal added here is not new policy; it is the policy that was
already there, restated in terms that survive DBCLI-034.

The `/etc/passwd` row is not about SQLite. It is a readable file that is not a
database, and it stands for the general case: `init` validating readability is
not validating that the target is a database, so the failure must come from the
adapter's open with a message that says what was wrong, not from a corrupted
read.

Superseded behavior is recorded once, in `story.md`.
