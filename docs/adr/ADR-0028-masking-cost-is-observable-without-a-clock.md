# Masking cost is observable without a clock

* Status: accepted
* Date: 2026-09-08

DBCLI-019 established that a wall-clock budget is not a gate. Three Evidence
records disagreed about one commit — EV-018 FAIL, EV-019 FAIL, EV-020 PASS at
`c3230d79`, nothing in the repository changing between them — and a loaded
`bun run test:perf` failed ten runs out of ten where an idle one passed. Five
assertions were converted to quantities load cannot move. Nineteen were not, and
fourteen of those measure masking cost: table lookups, column filtering, dotted
paths, nested wildcards, config loading.

A ratio closes some of these and provably not others. The regression
`blacklist-performance.bench.ts:354` guards is a constant factor — every miss
re-splitting the path on each row — and dividing two measurements of the same
work removes exactly that constant. So the quantity has to change, not the
comparison.

The quantity these gates care about is how much work masking does: rows visited,
rule evaluations, path splits. It is deterministic, it is the thing a regression
actually changes, and it does not move when another process is busy. Reading it
requires `BlacklistValidator` to report it, which makes the counter a surface
that outlives the test reading it — a public thing, whether or not it is
documented as one.

It is reported as `cost` on `FilterColumnsResult`, frozen, rather than as a
module-level counter a caller resets between measurements. A global would be
shared state that two callers can interleave and a test can forget to clear; the
result object already belongs to exactly one call, which is the scope the
measurement describes.

That is the cost of this decision and it is not small. A counter that is wrong
is worse than no counter: it would certify masking that never ran. So it fails
when it observed no work, the way `medianElapsed` already refuses to certify a
budget it never measured, and every conversion keeps a printed measurement so a
human can still see the cost move.

The alternative considered and not taken was moving the budgets to a controlled
CI runner. It removes the flake by removing the gate from the place developers
run it, and it leaves the same absolute comparison in place — a quieter version
of raising the constant.

The first version of this written under DBCLI-020 fell into exactly the failure
below and is worth recording: the early return taken when nothing was omitted
reported zero cost, and that is the *expensive* shape — rules that match nothing
are the ones that walk every row. `tests/unit/core/blacklist-masking-cost.test.ts`
now pins both directions, that a rule which omitted nothing still reports the
rows it walked, and that zero is reported only when no rule applied at all.

**Falsified if:** a counter in `src/core/blacklist-validator.ts` or
`src/core/blacklist-manager.ts` can report a passing value for input the masking
path never walked, or a masking regression lands that the counters accept and a
wall-clock budget would have rejected. The first means the observability lies;
the second means work is the wrong quantity and time was doing something the
counters do not.
