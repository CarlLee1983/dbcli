# Implementation Progress

This optional file tracks execution progress. Product requirements belong in
`story.md` and `acceptance.md`.

## Plan

* [x] Wait for GATE-002.
* [x] Implement the chosen option: relocate the budget to `bun run test:perf`.
* [x] Reproduce the original failure condition against the replacement.

## Notes

GATE-002 resolved to *relocate into `bun run test:perf`, with the budget set
from a real measurement and the measured value printed*.

The destination already held a strictly larger version of the same measurement
— `Table lookup (1000 tables)` — so the move surfaced two things the Story did
not anticipate.

**A budget at typical scale cannot guard the regression.** Measured on this
machine with `medianElapsed`: the set-backed lookup over 100 blacklisted tables
medians at 0.14 ms, and a linear scan with per-lookup case folding — the shape
the current implementation replaced — medians at 0.98 ms. Any budget loose
enough not to be a coin flip on a runner (this file scales dev measurements by
about 3x) sits above 0.98 ms. So the typical-scale case documents the cost; it
does not defend it.

**The large case's old budget did not guard it either.** 1000 tables medians at
0.099 ms against a 10 ms budget — 100x the measurement — while the linear-scan
regression medians at 7.67 ms, *under* that budget on this machine. It only
failed once a slow runner tripled it. Tightening to 2 ms is what makes R2 true:
6.7x clear of the real measurement, and the regression fails everywhere.

Both scales are kept, so the assertion count does not drop (R4).

Measurements, five runs each where noted:

| Shape | Median | Budget |
| --- | --- | --- |
| 100 tables, set-backed | 0.14 ms | 2 ms |
| 100 tables, linear scan | 0.98 ms | — (not guarded, see above) |
| 1000 tables, set-backed | 0.099 ms | 2 ms |
| 1000 tables, linear scan | 7.67 ms | fails 2 ms |
