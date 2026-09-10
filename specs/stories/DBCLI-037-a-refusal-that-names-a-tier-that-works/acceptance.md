# Acceptance Criteria

## Happy Path

* [ ] AC-001: A `query-only` connection refusing `REPLACE INTO` names `admin`,
      the tier that would permit it.
* [ ] AC-002: A `query-only` connection refusing `INSERT` still names
      `read-write`, unchanged.

## Business Rules

* [ ] AC-003: For every statement type and every permission below the granting
      one, the named tier permits the statement.
* [ ] AC-004: For a type no tier grants, the named tier is `admin`.

## Failure Cases

* [ ] AC-005: Obtaining the named tier and retrying is refused in no case that
      previously named a tier.

## Regression Requirements

* [ ] AC-006: Every existing permission-guard fixture returns an identical
      allowed/refused verdict.
* [ ] AC-007: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/unit/core/permission-guard-required-tier.test.ts` | `REPLACE INTO under query-only` | `requiredPermission is admin` |
| `AC-002` | test | `tests/unit/core/permission-guard-required-tier.test.ts` | `INSERT under query-only` | `requiredPermission is read-write` |
| `AC-003` | test | `tests/unit/core/permission-guard-required-tier.test.ts` | `every type by every lower tier` | `the named tier allows the statement` |
| `AC-004` | test | `tests/unit/core/permission-guard-required-tier.test.ts` | `an UNKNOWN statement` | `requiredPermission is admin` |
| `AC-005` | test | `tests/unit/core/permission-guard-required-tier.test.ts` | `retry at the named tier` | `allowed in every case` |
| `AC-006` | test | `bun test tests/unit/core/permission-guard` | `the existing fixtures` | `unchanged verdicts` |
| `AC-007` | command | `make verify` | `repository checkout` | `exit 0` |

## Verification Notes

```sh
bun test tests/unit/core/permission-guard
make verify
```

AC-003 and AC-005 are the same claim from both sides, deliberately. A test that
only asserts the string would pass on any wrong-but-stable value; asserting that
the named tier actually permits the statement is what makes the message true.
