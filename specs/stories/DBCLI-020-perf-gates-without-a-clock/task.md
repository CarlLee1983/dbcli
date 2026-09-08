# Implementation Progress

This optional file tracks execution progress. Product requirements belong in
`story.md` and `acceptance.md`.

## Plan

* [ ] Record the loaded baseline at `012d9b11`.
* [ ] Close the `--version` case with the byte budget GATE-004 settled.
* [ ] Resolve the Gate on the fourteen masking assertions.
* [ ] Convert them, lowering `ABSOLUTE_TIME_BUDGETS` as each closes.
* [ ] Decide what `query.bench.ts` asserts, and record it.
* [ ] Re-run the loaded procedure and record both numbers.

## Notes

* DBCLI-019's loaded procedure: `bun run test:perf`, ten runs, eight CPU-bound
  shell loops on a ten-core machine. Its own numbers were 10 of 10 failing
  before the change and zero failures of the five named cases after, with 3 and
  6 of 10 runs still failing on the assertions this Story inherits.
