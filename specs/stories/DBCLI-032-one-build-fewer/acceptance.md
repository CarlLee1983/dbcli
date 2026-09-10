# Acceptance Criteria

## Happy Path

* [ ] AC-001: `make verify` builds the artifacts twice, not three times, and
      passes.
* [ ] AC-002: The per-step log shows two builds where it showed three. No
      wall-clock claim is made: this machine measured identical builds at 63s,
      94s and 104s, a spread wider than one build's saving.

## Business Rules

* [ ] AC-003: `bun run build` is no longer in the roster, and every step that
      executes `dist/` still runs after the step that produces it.
* [ ] AC-004: `bun run build:determinism` still builds twice, digests four
      artifacts, and fails when they differ.
* [ ] AC-005: `bun run build:determinism` runs on its own from a checkout with
      no `dist/`.

## Failure Cases

* [ ] AC-006: A build that fails inside the determinism check names which of the
      two builds failed and prints the build's own output.
* [ ] AC-007: A roster that executes `dist/` before building it fails the
      contract test.

## Regression Requirements

* [ ] AC-008: `src/` is unchanged.
* [ ] AC-009: `bun run forgeflow:check` and `bun run forgeflow:contract` pass,
      with `PREDATING_FINDINGS` still empty.
* [ ] AC-010: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | command | `make verify` | `repository checkout` | `two building lines, exit 0` |
| `AC-002` | command | `make verify` | `repository checkout` | `no bun run build step in the log, two building lines inside build:determinism` |
| `AC-003` | test | `tests/contract/forgepilot-boundary.test.ts` | `the pinned roster` | `build absent, dist steps after build:determinism` |
| `AC-004` | test | `tests/unit/scripts/build-determinism.test.ts` | `two digest sets that differ` | `the drifted artifact is reported` |
| `AC-005` | command | `rm -rf dist && bun run build:determinism` | `a checkout with no dist` | `exit 0` |
| `AC-006` | test | `tests/unit/scripts/build-determinism.test.ts` | `a failing build's label, status and output` | `the message names the build and carries its output` |
| `AC-007` | test | `tests/contract/forgepilot-boundary.test.ts` | `a roster with a dist step before the build` | `the assertion fails` |
| `AC-008` | command | `git diff --stat 1b22b47c -- src` | `repository checkout` | `empty output` |
| `AC-009` | command | `bun run forgeflow:check` | `this branch` | `reconciliation passed` |
| `AC-010` | command | `make verify` | `repository checkout` | `exit 0` |

## Verification Notes

```sh
bun test tests/contract/forgepilot-boundary.test.ts tests/unit/scripts/build-determinism.test.ts
rm -rf dist && bun run build:determinism
make verify
```

What human review should weigh is the removal itself. The roster's own comment
says a step may be added deliberately but removing one has to be argued for. The
argument is that the step's output is overwritten by the next step before
anything reads it, and that the next step proves the two are byte-identical —
so the check that step 11 performed is performed again, twice, immediately
after. If that reading is wrong, the gate loses a check for a minute of
wall-clock, which is the trade this repository should refuse.
