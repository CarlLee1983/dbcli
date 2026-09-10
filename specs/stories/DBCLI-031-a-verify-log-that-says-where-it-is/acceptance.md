# Acceptance Criteria

## Happy Path

* [ ] AC-001: A `make verify` run prints, for each step, a line naming it before
      it runs and a line giving its duration and exit status after it.
* [ ] AC-002: The lines carry a step number, so a reader knows how far in a
      running gate is.

## Business Rules

* [ ] AC-003: A step's label and its command are the same string; there is no
      second copy that could name a different command.
* [ ] AC-004: Every step line is `step='<command>' && run`, and a line that is
      not fails the contract test.
* [ ] AC-005: The roster is unchanged in content and order, and every step still
      blocks.
* [ ] AC-006: The recipe stays POSIX and contains no `pipefail`.

## Failure Cases

* [ ] AC-007: A failing step prints its closing line with the non-zero status,
      the chain stops there, and the recipe re-exits with that status.
* [ ] AC-008: The attestation still records `failed_step` naming that step.

## Regression Requirements

* [ ] AC-009: `src/` is unchanged.
* [ ] AC-010: `bun run forgeflow:check` and `bun run forgeflow:contract` pass,
      with `PREDATING_FINDINGS` still empty.
* [ ] AC-011: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | command | `make verify` | `repository checkout` | `a paired ==> and <== line for each step` |
| `AC-002` | command | `make verify` | `repository checkout` | `each line carries its step number` |
| `AC-003` | test | `tests/contract/forgepilot-boundary.test.ts` | `the verify recipe` | `the command is the marker` |
| `AC-004` | test | `tests/contract/forgepilot-boundary.test.ts` | `the verify recipe` | `every step line invokes run` |
| `AC-005` | test | `tests/contract/forgepilot-boundary.test.ts` | `the pinned roster` | `same steps, same order, all blocking` |
| `AC-006` | test | `tests/contract/forgepilot-boundary.test.ts` | `the verify recipe text` | `no pipefail` |
| `AC-007` | command | `make verify` | `the test services stopped` | `services:check closes with exit 1 and the chain stops` |
| `AC-008` | command | `cat .verification/attestation.json` | `the same failing run` | `failed_step is bun run services:check` |
| `AC-009` | command | `git diff --stat bbcdd454 -- src` | `repository checkout` | `empty output` |
| `AC-010` | command | `bun run forgeflow:check` | `this branch` | `reconciliation passed` |
| `AC-011` | command | `make verify` | `repository checkout` | `exit 0` |

## Verification Notes

```sh
bun test tests/contract/forgepilot-boundary.test.ts
docker compose -f docker-compose.test.yml stop && make verify   # AC-007, AC-008
docker compose -f docker-compose.test.yml up -d --wait
make verify
```

What human review should weigh is `eval "$step"` in the recipe. The alternative
is passing the command as arguments, which needs an `env` prefix for the one
step that sets variables and, more importantly, leaves two copies of every
command that a test then has to compare. One string used for both the label and
the execution cannot misattribute a line. ADR-0034 records that trade.
