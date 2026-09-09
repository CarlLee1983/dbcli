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
script-level `error: script "test:perf" exited with code 1`. A reproduction was
therefore run before this Story's scope was fixed: `bun run test:perf` five
times with eight CPU-bound processes on a ten-core machine, full output kept.
Three assertions fail there, and every one of them compares an absolute elapsed
time to a constant:

| Assertion | Budget | Under load | Failed |
| --- | --- | --- | --- |
| `tests/perf/startup.bench.ts:60` `--help` | 200 ms | 248–337 ms | 5 of 5 |
| `tests/perf/contiguous-section-matcher.bench.ts:66` `redactFields` | 350 ms | 408 ms | 5 of 5 |
| `tests/perf/blacklist-performance.bench.ts:306` flattened docs | 12 ms | 12.65–15.96 ms | 2 of 5 |

Which of the three produced EV-018 and EV-019 stays unknown. That is not a gap
this Story can close after the fact — it is what R5 exists to prevent from
recurring.

The shape of the fix already exists in this repository.
`tests/perf/blacklist-performance.bench.ts:174` asserts a ratio between a small
and a large input: load inflates both sides, so no amount of it flips the
verdict, while an algorithm that stopped scaling still fails.
`tests/helpers/bench.ts` supplies median-of-N sampling and prints every
measurement, passing or failing. The three cases named above have the sampling
and the printing but no ratio — each is one absolute number compared to a
constant, and `startup.bench.ts` measures process spawn, which load inflates
one-sidedly no matter how many samples the minimum is taken over.

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
* commit: yes
* push: yes
* deploy: no

## Risk

* Level: medium
* Reason: `weakened-verification-gate`

The change is to the gate that decides whether every other change is verified.
A gate loosened until it stops failing is invisible until a real regression
passes it.

## Scope

### In Scope

* The three assertions the reproduction named: `startup.bench.ts:60`,
  `contiguous-section-matcher.bench.ts:66`, and
  `blacklist-performance.bench.ts:306`, plus the two more that surfaced when the
  loaded procedure was repeated: the `deep < 500ms` half of
  `contiguous-section-matcher.bench.ts:55` and its
  `findProtectedFieldReference` case.
* The per-test timeout `test:perf` runs under. A benchmark killed at five
  seconds is a verdict flipped by load in the same way, and it reports no
  numbers at all.
* Disclosing every absolute wall-clock assertion that remains, so the ones this
  Story does not fix cannot grow in number or be forgotten.
* Whatever `test:perf` must print for a FAIL to identify itself without a
  reproduction.

### Out of Scope

* The startup cost of the CLI itself. Nothing here claims 171 ms is too slow;
  the measurement is not the complaint.
* Converting the nineteen absolute assertions that remain in
  `tests/perf/blacklist-performance.bench.ts` and `tests/perf/query.bench.ts`.
  They are a population rather than stragglers — two ten-run loaded samples
  after the change failed 3 and 6 times, naming a different subset each time —
  and several of them guard constant-factor regressions, which no ratio can
  catch. Closing them needs a quantity that is neither time nor a ratio, and
  that is its own Story. This one leaves them counted rather than fixed.
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

* R1: The verdict of every assertion this Story names does not depend on
  concurrent load on the machine running it. Every absolute wall-clock
  assertion left behind is counted, and the count can only go down.
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

* `tests/perf/startup.bench.ts` — the `--help` case, `expect(elapsed)
  .toBeLessThan(STARTUP_BUDGETS.help)`. Its verdict is load-dependent, which is
  the defect; changing it is the point of this Story, not a regression. What
  replaces it is not a ratio: process startup has no denominator that load
  moves as well (GATE-004), so the gate becomes the bytes `--help` must load,
  which is a property of the build.
* `tests/perf/contiguous-section-matcher.bench.ts` — the `deep < 500ms` half of
  the `namesProtectedField` case, deleted outright. The ratio in the same test
  guards the same regression; the absolute was a duplicate that load flipped.
* `tests/perf/contiguous-section-matcher.bench.ts` — the
  `findProtectedFieldReference` case, which had only an absolute budget.
* `tests/perf/contiguous-section-matcher.bench.ts` — the `redactFields walks a
  large response without a per-key rescan` case. Its own comment already states
  that the guard against algorithmic regression is the ratio assertion in
  `tests/unit/core/contiguous-section-matcher.test.ts`, which makes the 350 ms
  ceiling a duplicate whose only observed effect is a flipped verdict.
* `tests/perf/blacklist-performance.bench.ts` — the `Column filtering (1000
  flattened docs, 3 parent rules)` case, for the same reason. Unlike the two
  above, its budget is the only thing guarding the per-row recursion decision,
  so what replaces it must still reject that regression.
