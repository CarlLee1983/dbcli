# Implementation Progress

This optional file tracks execution progress. Product requirements belong in
`story.md` and `acceptance.md`.

## Plan

* [x] Reproduce the flake and name the load-sensitive cases.
* [x] Record the pre-change baseline.
* [x] Resolve the ForgePilot Gate on how the gap is closed — GATE-003, ratio
      assertion.
* [x] Implement the resolved option for `blacklist-performance.bench.ts:306`
      and `contiguous-section-matcher.bench.ts:66`.
* [x] `startup.bench.ts:60` — GATE-004 chose a quantity that does not move with
      load: the bytes `--help` loads.
* [x] Convert the two cases the repeated procedure surfaced.
* [x] Disclose what is left: `tests/unit/build/perf-absolute-time-budgets.test.ts`.
* [x] Re-run the loaded procedure and record both numbers.

## Notes

### Reproduction, 2026-09-08

Procedure: `bun run test:perf`, five consecutive runs, with eight CPU-bound
shell loops running on a ten-core machine. Full output kept per run. Baseline
before any change: **5 of 5 runs failed**. A first pass at the same load over
ten runs also failed 10 of 10.

Three assertions fail, all of them a single absolute elapsed time against a
constant:

| Assertion | Budget | Under load | Failed |
| --- | --- | --- | --- |
| `tests/perf/startup.bench.ts:60` `--help` | 200 ms | 248.06, 259.33, 268.15, 286.24, 337.09 ms | 5 of 5 |
| `tests/perf/contiguous-section-matcher.bench.ts:66` `redactFields` | 350 ms | 408.34 ms | 5 of 5 |
| `tests/perf/blacklist-performance.bench.ts:306` flattened docs | 12 ms | 12.65, 13.35, 13.61, 15.52, 15.96 ms | 2 of 5 |

Idle, at the same commit `c3230d79`, all three pass: 24 pass / 0 fail in the
main checkout and again in a fresh detached worktree, with `CLI startup
(--help)` reading 187.32 ms and 171.36 ms.

Which of the three produced EV-018 and EV-019 cannot be recovered. The Evidence
keeps an exit status, and the surfaced output ended at bun's script-level
`error: script "test:perf" exited with code 1`.

`--version` (100 ms budget) never failed: 17.86–24.95 ms under the same load.
The four `QUERY_BUDGET_MS` cases never failed either. Both stay out of scope.

### Note on the contiguous case

`contiguous-section-matcher.bench.ts:66`'s own comment states that the guard
against algorithmic regression is the ratio assertion in
`tests/unit/core/contiguous-section-matcher.test.ts`. Its 350 ms ceiling is
therefore a duplicate, and the only effect it has been observed to have is a
flipped verdict.

### Why the startup case needed a second Gate

GATE-003 chose a ratio assertion. A ratio only cancels load when both sides are
comparable work on the same machine, and for process startup there is no such
denominator. Measured on this ten-core machine, fastest of nine spawns, idle and
then under eight CPU-bound processes:

| Quantity | Idle | Under load |
| --- | --- | --- |
| bare interpreter (`node -e ''`) | 6.79, 7.48, 7.62 ms | 7.28, 6.76, 7.02, 6.48 ms |
| `dist/cli.mjs --help` | 172.32, 177.15, 157.52 ms | 264.83, 213.42, 235.73, 285.27 ms |
| `--help` / bare | 25.37, 23.67, 20.66 | 36.37, 31.59, 33.56, 44.04 |
| `--help` / `--version` | 10.79, 10.21, 8.37 | 14.33, 12.08, 12.43, 11.59 |

The denominator does not move: a process that exits in 7 ms is scheduled
immediately no matter what else is running, while `--help` spends ~170 ms of CPU
competing for a core. Both candidate ratios therefore drift further than the
absolute number they were meant to replace. GATE-004 records the choice.

### After the change

Same procedure, ten runs, eight CPU-bound processes. **Baseline 10 of 10 runs
failed. After: none of the five named cases failed in any run.**

Three of ten runs failed the first time and six of ten the second, every one of
them on an absolute assertion this Story did not convert, and a different subset
each time:

| Assertion | Budget | Measured |
| --- | --- | --- |
| `blacklist-performance.bench.ts:354` 60 dotted rules | 6 ms | 6.62, 6.65, 7.59 ms |
| `blacklist-performance.bench.ts` nested wildcard rules | 35 ms | 39.39 ms |
| `blacklist-performance.bench.ts` 1000 rows x 7 cols | 5 ms | — |
| `query.bench.ts` Redis `PING` | 800 ms | spawn killed, status `null` |

That is what decided the Story's shape: nineteen remain, they are a population
rather than stragglers, and several guard constant-factor regressions that no
ratio can catch. They are counted by
`tests/unit/build/perf-absolute-time-budgets.test.ts`, which fails if the number
grows and fails if one is fixed without lowering it.

### Delivered

* `startup.bench.ts` — `--help` is gated on the bytes it loads
  (2,156,743 against a 2,600,000 budget); the millisecond reading is printed,
  not asserted.
* `blacklist-performance.bench.ts:306` — ratio of one-nested-row to all-flat,
  threshold 3 (measured 0.77–0.94 idle, 0.50–1.25 loaded).
* `contiguous-section-matcher.bench.ts` — `redactFields` gated on a depth-24 to
  depth-3 ratio, threshold 15 (3.81–4.14 idle, 4.01–4.78 loaded);
  `findProtectedFieldReference` on a depth-40 to depth-5 ratio, threshold 20
  (6.00–6.22 idle, 5.44–7.68 loaded); the duplicate `deep < 500ms` deleted.
* `package.json` — `test:perf` runs with `--timeout 30000`. Bun's default 5000ms
  per-test timeout flipped two cases under load and reported no numbers when it
  did.
* `tests/unit/build/perf-absolute-time-budgets.test.ts` — the shrink-only count.
