# Implementation Progress

This optional file tracks execution progress. Product requirements belong in
`story.md` and `acceptance.md`.

## Plan

* [x] Record the loaded baseline at `012d9b11`.
* [x] Close the `--version` case with the byte budget GATE-004 settled.
* [x] Resolve the Gate on the fourteen masking assertions — GATE-005, counters.
* [x] Convert them, lowering `ABSOLUTE_TIME_BUDGETS` as each closes.
* [x] Decide what `query.bench.ts` asserts, and record it.
* [x] Re-run the loaded procedure and record both numbers.

## Notes

* DBCLI-019's loaded procedure: `bun run test:perf`, ten runs, eight CPU-bound
  shell loops on a ten-core machine. Its own numbers were 10 of 10 failing
  before the change and zero failures of the five named cases after, with 3 and
  6 of 10 runs still failing on the assertions this Story inherits.

### Baseline and result

Same procedure both times: `bun run test:perf`, ten runs, eight CPU-bound shell
loops on a ten-core machine.

* **Before**, at `012d9b11`: 1 of 10 runs failed, on `Column filtering (1000
  rows x 7 cols, omits 3): < 5ms`. Two earlier samples of the identical code
  failed 3 of 10 and 6 of 10, naming a different subset each time — which is the
  point: the rate is a property of how busy the machine happened to be.
* **After**: 0 of 10 runs failed.

`ABSOLUTE_TIME_BUDGETS` went 19 → 0. `test:perf` reports 27 passing cases and 80
`expect()` calls, against 24 and 57 before.

### How each kind was closed

| Kind | Count | What the gate is now |
| --- | --- | --- |
| `filterColumns` cases | 8 | Exact `MaskingCost` counts |
| Table / column lookup | 3 | The lookups happened and still answer; scaling ratio already guarded the regression |
| Config loading | 2 | A 1000-vs-100 scaling ratio, threshold 25 (measured 10.34; loading is linear, so `MAX_SIZE_SCALING`'s 3 does not apply) |
| Per-query overhead | 1 | `MaskingCost` counts for one row, three keys, three rules |
| `--version` | 1 | The entry file's size, 5,017 bytes against 8,000 |
| `query.bench.ts` round trips | 4 | The round trip exits 0 and produces output |

### What this gave up

End-to-end query latency no longer has an automated gate. A round trip is mostly
process start and I/O wait, and there is no in-process quantity to divide the
load out with — under load a spawn was killed outright and reported `status:
null`. The measurement is still printed. Catching a latency regression needs a
controlled runner, which is not this repository's `make verify`.

### A counter that lied

The first version reported zero cost from the early return taken when nothing
was omitted. That is the expensive shape, not the cheap one: rules that match
nothing are the ones that walk every row, and a benchmark would have certified a
traversal it never saw. Fixed before any assertion was written against it, and
pinned from both directions in
`tests/unit/core/blacklist-masking-cost.test.ts`.
