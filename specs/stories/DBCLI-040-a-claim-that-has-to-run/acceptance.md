# Acceptance Criteria

## Happy Path

* [ ] AC-001: Every `supported` or `limited` entry in `ENGINE_CAPABILITIES.sqlite`
      is proven by at least one CLI scenario that executed and passed.

## Business Rules

* [ ] AC-002: Given a fixture matrix that declares one more supported key than
      the scenarios prove, the reconciliation fails and names that key.
* [ ] AC-003: Given a scenario that names a key the fixture matrix does not
      declare, or declares as unsupported, the reconciliation fails and names
      the scenario and the key.
* [ ] AC-004: With the shared SQL guard replaced in the spawned process by the
      pre-DBCLI-036 engine literal, every scenario that passes through the guard
      fails, while the adapter opened directly in the test still reads rows.
* [ ] AC-005: Read scenarios assert returned data or columns, write scenarios
      assert the database file's contents afterwards, and the export scenario
      asserts the rendered output.
* [ ] AC-006: A scenario registered but not executed is reported as unexecuted
      and its keys count as unproven.

## Failure Cases

* [ ] AC-007: Fixtures are created under a temporary directory with a private
      `HOME`, and nothing is written to the developer's real dbcli configuration.

## Regression Requirements

* [ ] AC-008: `ENGINE_CAPABILITIES` is byte-for-byte unchanged.
* [ ] AC-009: The acceptance-numbered tests of DBCLI-036 in
      `tests/integration/sqlite-init.test.ts` are unchanged in what they assert.
* [ ] AC-010: The new files run under `make verify` with no new step.
* [ ] AC-011: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/integration/sqlite-cli-scenarios.test.ts` | `the real matrix and a seeded temporary database` | `reconciliation reports nothing missing` |
| `AC-002` | test | `tests/unit/sqlite-cli-reconcile.test.ts` | `a fixture matrix with an extra supported key` | `failure naming the key` |
| `AC-003` | test | `tests/unit/sqlite-cli-reconcile.test.ts` | `a scenario naming an undeclared key` | `failure naming scenario and key` |
| `AC-004` | test | `tests/integration/sqlite-cli-gate-mutation.test.ts` | `a preload replacing require-sql-connection` | `guarded scenarios reject, adapter reads` |
| `AC-005` | test | `tests/integration/sqlite-cli-scenarios.test.ts` | `each scenario's assertions` | `data, file state or output asserted` |
| `AC-006` | test | `tests/unit/sqlite-cli-reconcile.test.ts` | `a registered scenario absent from the executed set` | `reported unexecuted, key unproven` |
| `AC-007` | test | `tests/integration/sqlite-cli-scenarios.test.ts` | `HOME pointed at the temporary directory` | `no path outside it is written` |
| `AC-008` | command | `git diff main -- src/adapters/capabilities.ts` | `this branch` | `empty` |
| `AC-009` | command | `git diff main -- tests/integration/sqlite-init.test.ts` | `this branch` | `only the harness import and the regression block differ` |
| `AC-010` | command | `grep -n 'bun run test' Makefile` | `repository checkout` | `the existing step runs all of tests/` |
| `AC-011` | command | `make verify` | `repository checkout` | `exit 0` |

## Verification Notes

```sh
bun test tests/integration/sqlite-cli-scenarios.test.ts
bun test tests/unit/sqlite-cli-reconcile.test.ts
bun test tests/integration/sqlite-cli-gate-mutation.test.ts
make verify
```

AC-004 is the criterion that makes the rest mean something. A registry can be
filled with scenarios that spawn nothing; the mutation shows that the scenarios
which exist fail for the reason the original defect would have caused.
