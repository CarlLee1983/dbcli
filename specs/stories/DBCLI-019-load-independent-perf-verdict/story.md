# Story: DBCLI-019 Load-Independent `test:perf` Verdict

## Goal

Two verifications of the same commit reach the same verdict, so that a
`make verify` PASS is a property of the code rather than of how busy the machine
was when the gate ran.

## Context

DBCLI-015 fixed this defect for one assertion. The same defect is still in the
suite that assertion was moved into.

Measured on 2026-09-08, all at the identical commit `c3230d79`, with nothing in
the repository changing between runs:

* `forgepilot verify WI-003` → EV-018 FAIL, `bun run test:perf` exit 1.
* `forgepilot verify WI-003` → EV-019 FAIL, same step, machine otherwise idle.
* `forgepilot verify WI-003` → EV-020 PASS.

Run on its own at the same commit, `bun run test:perf` passes: 24 pass / 0 fail
in the main checkout and again in a fresh detached worktree, with
`CLI startup (--help)` reading 187.32 ms and 171.36 ms against a 200 ms budget.
`tests/perf/startup.bench.ts`'s own header records the same workload reading
between 84 ms and 283 ms on `main` against that budget, "failing CI on commits
that touched nothing related".

Which assertion produced EV-018 and EV-019 is not recorded. ForgePilot's
Evidence keeps the exit status, and the output it surfaced ended at bun's
script-level `error: script "test:perf" exited with code 1`. Naming the case
from a reproduction is therefore the first piece of work, not an assumption this
Story makes: the startup budget is the documented suspect, not a proven one.

The shape of the fix already exists in this repository.
`tests/perf/blacklist-performance.bench.ts` pairs each wall-clock ceiling with a
scaling-ratio assertion — the ratio between a small and a large input, which
load inflates on both sides and therefore cannot flip. `tests/helpers/bench.ts`
supplies median-of-N sampling and prints every measurement, passing or failing.
The spawn-based budgets have neither counterpart: `startup.bench.ts` takes the
fastest of nine samples and `query.bench.ts` compares a single elapsed time to
`QUERY_BUDGET_MS`, and in both the entire quantity being measured is process
startup, which load inflates one-sidedly.

This matters beyond a slow test. `make verify` is this repository's verification
contract and ForgePilot binds its result to an exact commit; an assertion whose
verdict depends on the machine makes that binding say something it cannot
support. Three Evidence records disagreeing about one commit is exactly the
signal ADR-0026 says an attestation is not allowed to lose.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: yes
* Task mode: mixed

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: no
* push: no
* deploy: no

## Risk

* Level: medium
* Reason: `weakened-verification-gate`

The change is to the gate that decides whether every other change is verified.
A gate loosened until it stops failing is invisible until a real regression
passes it.

## Scope

### In Scope

* Reproducing EV-018 / EV-019 and naming the assertion that failed.
* The spawn-based wall-clock budgets in `tests/perf/startup.bench.ts` and
  `tests/perf/query.bench.ts` — the assertions in `bun run test:perf` whose
  verdict is an absolute elapsed time with no load-independent counterpart.
* Whatever `test:perf` must print for a FAIL to identify itself without a
  reproduction.

### Out of Scope

* The startup cost of the CLI itself. Nothing here claims 171 ms is too slow;
  the measurement is not the complaint.
* The budgets in `tests/perf/blacklist-performance.bench.ts` and
  `tests/perf/contiguous-section-matcher.bench.ts`. DBCLI-015 already gave them
  the paired shape; if one of them turns out to be the case that failed, it
  comes into scope by name and the rest stay out.
* Any change to `make verify`'s step list or ordering.
* ForgePilot's Evidence format. That FAIL evidence keeps only an exit status is
  a real gap, and it belongs to ForgePilot, not to this repository.

## Inputs

* The three Evidence records EV-018, EV-019 and EV-020, all at `c3230d79`.
* The existing budgets and their provenance comments in `tests/perf/`.

## Outputs

* A `bun run test:perf` whose verdict two runs of the same commit agree on.
* A named cause for EV-018 and EV-019, recorded in the Story's `task.md`.

## Rules

* R1: The verdict of every assertion in `bun run test:perf` does not depend on
  concurrent load on the machine running it.
* R2: A real startup regression still turns the build red. A change that makes
  the CLI meaningfully slower to start must fail the replacement assertion.
* R3: Every retained wall-clock budget prints the value it measured, passing or
  failing, and carries the measurement its number came from — the convention
  `tests/helpers/bench.ts` already documents.
* R4: The number of assertions covering CLI startup and query latency does not
  decrease.
* R5: A `test:perf` failure names the case and the numbers it compared, in the
  output a caller sees when the step fails.

## Expected Errors

* A deliberately slowed CLI startup fails the replacement assertion.
* A `test:perf` run that measures no samples fails rather than certifying
  a budget it never met — the existing `medianElapsed` guard, kept.

## Dependencies

* A ForgePilot Gate deciding how the gap is closed. Relative baseline, scaling
  ratio, or a budget re-measured on the runner are different answers with
  different costs, and choosing between them is a human decision — the same
  reason DBCLI-015 waited on GATE-002.

## Constraints

* Raising the constant until it stops failing is not one of the options. It
  leaves the verdict load-dependent, which is the defect.
* Deleting an assertion is not one of the options. R4 exists to say so.
* `SKIP_PERF_TESTS=1` in `make verify` is not a fix. It turns the gate off and
  reports the same PASS.

## Superseded Behavior

* `tests/perf/startup.bench.ts` — the `--help` and `--version` cases. Their
  verdicts are load-dependent, which is the defect; changing them is the point
  of this Story, not a regression.
* `tests/perf/query.bench.ts` — the four cases asserting against
  `QUERY_BUDGET_MS`, for the same reason.
