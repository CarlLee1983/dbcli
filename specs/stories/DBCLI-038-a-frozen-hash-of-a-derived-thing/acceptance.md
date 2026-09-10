# Acceptance Criteria

## Happy Path

* [ ] AC-001: An ADR under `docs/adr/` states what the capability-catalog cases
      protect and which of the three answers was chosen, with its reason.
* [ ] AC-002: Adding a supported command to one engine's matrix row does not
      fail the guard, or fails it with the ADR's stated justification.

## Business Rules

* [ ] AC-003: A catalog missing its schema version fails the guard.
* [ ] AC-004: A capability naming a command path the Commander tree does not
      carry fails the guard.
* [ ] AC-005: The five non-catalog cases in the fixture are unchanged.

## Failure Cases

* [ ] AC-006: The guard's failure message names what broke, not merely that a
      hash differs.

## Regression Requirements

* [ ] AC-007: `src/` is unchanged.
* [ ] AC-008: `baselineCommit` and its assertion are unchanged.
* [ ] AC-009: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | human | `the ADR added by this Story` | `docs/adr/` | `the choice and its reason are stated` |
| `AC-002` | test | `tests/integration/lazy-entry-path.test.ts` | `a matrix row gaining a supported command` | `the guard's verdict matches the ADR` |
| `AC-003` | test | `tests/integration/lazy-entry-path.test.ts` | `a catalog with no schemaVersion` | `failure naming the schema version` |
| `AC-004` | test | `tests/contract/capability-catalog.test.ts` | `a capability naming a dead command path` | `failure naming the capability` |
| `AC-005` | command | `git diff tests/fixtures/plat004/legacy-surface-baseline.json` | `this branch` | `only the catalog cases differ` |
| `AC-006` | test | `tests/integration/lazy-entry-path.test.ts` | `a broken catalog contract` | `the message names what broke` |
| `AC-007` | command | `git diff --stat de3a5dbe -- src` | `repository checkout` | `empty output` |
| `AC-008` | command | `grep -n baselineCommit tests/fixtures/plat004/legacy-surface-baseline.json tests/integration/lazy-entry-path.test.ts` | `this branch` | `both values unchanged` |
| `AC-009` | command | `make verify` | `repository checkout` | `exit 0` |

## Verification Notes

```sh
bun test tests/integration/lazy-entry-path.test.ts
bun test tests/contract
make verify
```

What human review should weigh is whether the replacement can still fail. A
structural assertion is easy to write so loosely that nothing breaks it, which
would trade a guard that cries wolf for one that never speaks. AC-003, AC-004
and AC-006 exist to make the replacement demonstrate a failure, not just a pass.
