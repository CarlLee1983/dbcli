# Story: DBCLI-015 Deterministic Blacklist Lookup Cost Assertion

## Goal

Two verifications of the same commit reach the same verdict, so that a PASS is
a property of the code rather than of how busy the machine was.

## Context

`tests/unit/core/blacklist-manager.test.ts:177` asserts that 1000 table lookups
complete in under 10 milliseconds of wall-clock time. Run on its own the
assertion passes with room to spare — three consecutive runs, no failures. Run
as part of the full suite it measured 21.43 ms and failed.

DBCLI-014 produced the evidence: three ForgePilot verifications of the same
working tree, EV-001 PASS at `aab45382`, EV-002 FAIL and EV-003 PASS at the
identical commit `d618f196`. Nothing in the repository changed between EV-002
and EV-003. The only difference was load.

That is worse than a slow test. `make verify` is this repository's verification
contract and ForgePilot binds its result to an exact commit; an assertion whose
verdict depends on the machine makes that binding say something it cannot
support. A flake here also trains the reader to re-run rather than read, which
is how a real regression gets waved through.

The repository already has somewhere for timing budgets to live. `bun run
test:perf` runs after the build, each budget there is set from a real runner
measurement rather than a dev machine, and each one prints what it measured, so
a tightening margin is visible before it turns the build red. That was a
deliberate decision (see the CI workflow's note on the four months of masked
benchmark failures). The assertion in the unit suite has none of those
properties: a hand-picked constant, no printed measurement, and it runs
alongside 6,700 other tests competing for the same CPU.

Which way to close the gap is a human decision and is recorded as a ForgePilot
Gate, not chosen here.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: yes

## Scope

### In Scope

* The blacklist lookup cost assertion currently in the unit suite.

### Out of Scope

* Every other timing assertion in the repository. If the same shape exists
  elsewhere it gets its own Story, once this one has settled what the shape
  should be.
* The performance of `BlacklistManager` itself. Nothing here claims the lookup
  is too slow; the measurement says the opposite.
* Any change to `make verify`'s step list or ordering.

## Inputs

* The blacklist configuration the existing test builds: 100 table names, no
  column entries.

## Outputs

* A verdict on blacklist lookup cost that two runs of the same commit agree on.

## Rules

* R1: The assertion's verdict does not depend on concurrent load on the machine
  running it.
* R2: Whatever replaces it still fails when blacklist lookup becomes
  pathological — a regression that made lookup linear in the table count must
  still turn the build red.
* R3: If a wall-clock budget is kept, it is measured on the runner it will run
  on and prints the value it measured, matching the existing convention in
  `bun run test:perf`.
* R4: The number of assertions covering blacklist lookup does not decrease.

## Expected Errors

* A pathological lookup implementation fails the replacement assertion.

## Dependencies

* GATE-002 must be resolved before implementation begins: the Story does not
  choose between relocating the budget and asserting complexity instead of
  absolute time.

## Constraints

* Deleting the assertion is not one of the options. R4 exists to say so.
* Raising the constant until it stops failing is not one of the options either:
  it leaves the verdict load-dependent, which is the defect.

## Superseded Behavior

Required when `Baseline conformance: yes`; otherwise delete this section. Name
each existing test or documented behavior this Story intentionally replaces.

* `tests/unit/core/blacklist-manager.test.ts` — the `performance > completes
  1000 table lookups in < 10ms` case. Its verdict is load-dependent, which is
  the defect; changing it is the point of this Story, not a regression.
