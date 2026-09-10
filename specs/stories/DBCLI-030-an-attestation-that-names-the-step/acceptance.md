# Acceptance Criteria

## Happy Path

* [ ] AC-001: A failing `make verify` writes an attestation whose `failed_step`
      names the step that failed.
* [ ] AC-002: A passing `make verify` writes an attestation with no
      `failed_step` field.

## Business Rules

* [ ] AC-003: The step name reaches `finish` through the recipe's own shell; no
      file carries state between `begin` and `finish`.
* [ ] AC-004: Every step in the recipe is preceded by its `step=` marker, and a
      step without one fails the contract test.
* [ ] AC-005: The step roster is unchanged in content and order, and every step
      is still blocking.
* [ ] AC-006: The recipe stays POSIX and contains no `pipefail`.

## Failure Cases

* [ ] AC-007: `finish` given the wrong number of arguments refuses and names
      what it expected.
* [ ] AC-008: A failure to write the attestation still costs a record and never
      a verdict — the recipe re-exits with the run's own status.

## Regression Requirements

* [ ] AC-009: `src/` is unchanged.
* [ ] AC-010: `bun run forgeflow:check` and `bun run forgeflow:contract` pass,
      with `PREDATING_FINDINGS` still empty.
* [ ] AC-011: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/unit/scripts/verification-attestation.test.ts` | `a non-zero exit status and a step name` | `failed_step names the step` |
| `AC-002` | test | `tests/unit/scripts/verification-attestation.test.ts` | `a zero exit status` | `no failed_step key` |
| `AC-003` | test | `tests/contract/forgepilot-boundary.test.ts` | `the verify recipe` | `finish is handed the step, and no step file is written` |
| `AC-004` | test | `tests/contract/forgepilot-boundary.test.ts` | `the verify recipe` | `every step carries a marker naming it` |
| `AC-005` | test | `tests/contract/forgepilot-boundary.test.ts` | `the pinned roster` | `same steps, same order, all blocking` |
| `AC-006` | test | `tests/contract/forgepilot-boundary.test.ts` | `the verify recipe text` | `no pipefail` |
| `AC-007` | test | `tests/unit/scripts/verification-attestation.test.ts` | `finish with four arguments` | `refusal naming five` |
| `AC-008` | test | `tests/contract/forgepilot-boundary.test.ts` | `the epilogue` | `the recipe re-exits with the captured status` |
| `AC-009` | command | `git diff --stat d387498b -- src` | `repository checkout` | `empty output` |
| `AC-010` | command | `bun run forgeflow:check` | `this branch` | `reconciliation passed` |
| `AC-011` | command | `make verify` | `repository checkout` | `exit 0` |

## Verification Notes

```sh
bun test tests/contract/forgepilot-boundary.test.ts tests/unit/scripts/verification-attestation.test.ts
bun run forgeflow:check
FORGEFLOW_ROOT=<clean ForgeFlowV2 checkout> bun run forgeflow:contract
make verify
```

A real FAIL is reproduced in-session by stopping the test services and running
`make verify`, then reading `.verification/attestation.json` — the exact
situation that produced `EV-048` with nothing in it naming `services:check`.

What human review should weigh is removing the subshell grouping from the
recipe that decides every verdict. The grouping never made the chain stop —
`&&` does — and it is what discards the step name. The properties it was added
for, a recorded FAIL and an attestation that cannot change a verdict, are
asserted literally by the contract test and are unchanged.
