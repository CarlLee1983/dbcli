# Acceptance Criteria

## Happy Path

* [ ] AC-001: The artifact assertion passes on an artifact whose generated id
      contains the connection port's digits.

## Business Rules

* [ ] AC-002: The assertion fails when any artifact field carries the port.
* [ ] AC-003: The assertion reads the artifact from disk, as it does today.

## Failure Cases

* [ ] AC-004: The failure names the field carrying the port, not merely that a
      substring was found.

## Regression Requirements

* [ ] AC-005: The other five literal checks in the same test are unchanged.
* [ ] AC-006: Running the test file 20 times in a row gives 20 identical
      verdicts.
* [ ] AC-007: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/integration/verify-rollback-command.test.ts` | `an artifact id of ver_mtvlt4v8_73543356` | `no failure` |
| `AC-002` | test | `tests/integration/verify-rollback-command.test.ts` | `an artifact with the port in a field` | `failure` |
| `AC-003` | test | `tests/integration/verify-rollback-command.test.ts` | `the artifact path from the command output` | `read from disk` |
| `AC-004` | test | `tests/integration/verify-rollback-command.test.ts` | `an artifact with the port in a field` | `the message names the field` |
| `AC-005` | command | `git diff tests/integration/verify-rollback-command.test.ts` | `this branch` | `only the port assertion differs` |
| `AC-006` | command | `for i in $(seq 20); do bun test tests/integration/verify-rollback-command.test.ts; done` | `services running` | `20 identical verdicts` |
| `AC-007` | command | `make verify` | `repository checkout` | `exit 0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `connection.port` | `5433` | omit | `artifact.file` | `tests/integration/verify-rollback-command.test.ts` |
| `artifact.id` | `ver_mtvlt4v8_73543356` | preserve | `artifact.file` | `tests/integration/verify-rollback-command.test.ts` |

## Verification Notes

```sh
bun test tests/integration/verify-rollback-command.test.ts
make verify
```

The two security-matrix rows are the whole point and they pull in opposite
directions: the port must be absent, and an id that merely looks like it
contains the port must survive. A repair that satisfies only the first is what
exists today.
