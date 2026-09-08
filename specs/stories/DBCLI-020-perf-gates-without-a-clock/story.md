# Story: DBCLI-020 Perf Gates That Do Not Read a Clock

## Goal

The nineteen assertions DBCLI-019 counted rather than fixed stop being able to
fail for a reason that has nothing to do with the code, so that a loaded
`bun run test:perf` and an idle one reach the same verdict on every case rather
than on five of them.

## Context

DBCLI-019 converted five assertions and left nineteen. That was deliberate and
its Known Limits say why: two ten-run loaded samples after the change failed 3
and 6 times, naming a different subset each time, so what remains is a
population rather than a handful of stragglers. It also names the reason a ratio
cannot finish the job — several of these guard constant-factor regressions, and
a ratio divides the constant out on both sides.

`tests/unit/build/perf-absolute-time-budgets.test.ts` holds the count. It is
this Story's work list and its acceptance both:

| File | Absolute assertions |
| --- | --- |
| `tests/perf/blacklist-performance.bench.ts` | 14 |
| `tests/perf/query.bench.ts` | 4 |
| `tests/perf/startup.bench.ts` | 1 |

The nineteen are not one problem. They are three:

* **Masking cost, in-process (14).** Table lookups, column filtering, dotted
  paths, nested wildcards, config loading. Every one of them measures
  deterministic work on data the test itself builds. The quantity these gates
  actually care about is how much work the masking does — rows visited, rule
  evaluations, path splits — and that quantity does not move when another
  process is busy. Reading it requires the code to be able to report it, which
  is a change to what `BlacklistValidator` exposes, not only to the tests.
* **A CLI round trip against a real database (4).** `query.bench.ts` spawns the
  built CLI and waits: process start, config load, connect, query, format. There
  is no in-process counter for that, and under load the reproduction did not
  merely exceed the budget — one run had its process killed and reported
  `status: null`. Whatever answers this one is not the same answer as above.
* **`--version` startup (1).** The same shape as `--help`, which GATE-004 already
  settled: gate the bytes, print the milliseconds. `dist/cli.mjs` answers
  `--version` by itself, so its budget is one file's size.

Only the third has a decided answer. How the first is closed is a boundary
question — a counter that exists for tests to read is a public surface, and
DBCLI-011's semantic contracts are the precedent for that being a decision
rather than an implementation detail. It is recorded in
`docs/adr/0028-masking-cost-is-observable-without-a-clock.md`, status
`proposed`.

This Story declares no `## Architecture` section, and that is deliberate rather
than an omission. Upstream 0.6.0 resolves a `Decision:` bullet against
`specs/decisions/<id>.md`, a path with no configuration; this repository keeps
every decision in `docs/adr/`. Declaring the section would mean either a second
home for decision records — which the repository's own rule against splitting a
record from its rationale forbids — or moving twenty-eight ADRs to satisfy a
checker. Either is a decision of its own and neither belongs inside a Story
about benchmark gates.

## Classification

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
* Reason: `masking-observability-becomes-public`

Making masking cost observable adds a surface that outlives the tests reading
it. A counter that is wrong is worse than no counter: it would certify masking
that never ran.

## Scope

### In Scope

* The nineteen assertions counted in
  `tests/unit/build/perf-absolute-time-budgets.test.ts`.
* Whatever observability the masking path must expose for its cost to be
  asserted without a clock, and the ADR that records why that surface exists.
* Lowering the recorded counts as each one is closed.

### Out of Scope

* Making masking faster. Every one of these budgets is currently met on an idle
  machine; this Story changes what is asserted, not what it costs.
* The five assertions DBCLI-019 already converted, and the byte budget it
  introduced.
* Any change to `make verify`'s step list or ordering.

## Inputs

* The nineteen assertions and the per-file counts recorded by DBCLI-019.
* The loaded reproduction procedure recorded in DBCLI-019's `task.md`.

## Outputs

* A `bun run test:perf` whose verdict does not depend on machine load.
* `ABSOLUTE_TIME_BUDGETS` at zero, or with each surviving entry carrying a
  written reason no clock-free quantity can replace it.

## Rules

* R1: No assertion in `bun run test:perf` fails because the machine was busy.
* R2: Every regression a replaced assertion was guarding is still rejected. Each
  conversion names that regression and proves the new gate fails on it.
* R3: A counter added for a test to read reports work that actually happened. It
  fails loudly when it measured nothing, the way `medianElapsed` already does.
* R4: The number of assertions covering masking cost does not decrease.
* R5: `ABSOLUTE_TIME_BUDGETS` only shrinks. Any entry left standing states why.

## Expected Errors

* A masking regression fails the replacement assertion.
* A counter that observed no work fails rather than reporting zero cost.

## Dependencies

* A ForgePilot Gate deciding how the masking cost gates are closed. A counter on
  the masking path, a ratio where the regression is not a constant factor, and
  moving the budgets to a controlled runner are different answers with different
  costs and different public surfaces.

## Constraints

* Raising a constant until it stops failing is not one of the options.
* Deleting an assertion is not one of the options unless another assertion in
  the same test already rejects the same regression — the case DBCLI-019 made
  for `deep < 500ms`, which must be argued per case rather than assumed.
* `SKIP_PERF_TESTS=1` is not a fix.

## Superseded Behavior

* `tests/perf/blacklist-performance.bench.ts` — the fourteen cases asserting an
  absolute elapsed time. Their verdicts are load-dependent; changing them is the
  point of this Story.
* `tests/perf/query.bench.ts` — the four cases asserting against
  `QUERY_BUDGET_MS`.
* `tests/perf/startup.bench.ts` — the `--version` case.
* `tests/unit/build/perf-absolute-time-budgets.test.ts` — the recorded counts,
  which this Story lowers.
