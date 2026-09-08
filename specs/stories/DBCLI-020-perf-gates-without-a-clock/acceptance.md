# Acceptance Criteria

Every criterion names the evidence that decides it: a command and the result
that counts as passing.

## Happy Path

* [ ] A loaded run and an idle run agree.
      Evidence: `bun run test:perf` run ten times while eight CPU-bound
      processes are running on a ten-core machine gives ten identical verdicts,
      all exit `0`. The same procedure against DBCLI-019's delivered commit
      `012d9b11` is the baseline and is recorded in `task.md` before any change.
* [ ] The count reaches zero, or every survivor is argued.
      Evidence: `ABSOLUTE_TIME_BUDGETS` in
      `tests/unit/build/perf-absolute-time-budgets.test.ts` totals `0`, or each
      remaining entry carries a comment naming the regression it guards and why
      no clock-free quantity rejects that regression.
* [ ] `make verify` passes.
      Evidence: `make verify` → exit `0`, and `.verification/attestation.json`
      reads `PASS` at the delivered revision with `dirty_worktree` `false`.

## Business Rules

* [ ] Every conversion names the regression it must still reject.
      Evidence: each changed case carries a comment naming that regression, and
      a companion assertion feeds it the regression and shows the new gate
      fails — the shape `tests/perf/blacklist-performance.bench.ts:196` uses.
* [ ] A counter cannot certify work that never ran.
      Evidence: a test that runs the masking path over an empty input and
      asserts the counter reports the absence rather than a passing zero.
* [ ] Masking coverage does not shrink.
      Evidence: the number of `it(` cases in
      `tests/perf/blacklist-performance.bench.ts` is not lower than at
      `012d9b11`.
* [ ] The new observability is recorded as a decision.
      Evidence: an ADR under `docs/adr/` states why masking cost is observable
      from outside, what the surface is, and the condition that would falsify
      the decision.

## Failure Cases

* [ ] A masking regression is rejected.
      Evidence: with the per-row recursion decision hoisted out of the loop —
      the regression `blacklist-performance.bench.ts:306` already names — the
      replacement assertions fail.
* [ ] A `test:perf` failure names the case and both numbers.
      Evidence: with one threshold temporarily set to an impossible value, the
      output a caller sees names the case and the values compared.

## Regression Requirements

* [ ] The `make verify` step list is unchanged.
      Evidence: `git diff 012d9b11..HEAD -- Makefile` shows no change to the
      `verify` recipe.
* [ ] `SKIP_PERF_TESTS` is not enabled anywhere in the verification path.
      Evidence: `grep -rn "SKIP_PERF_TESTS" Makefile package.json .github`
      returns no assignment that enables it.
* [ ] Two ForgePilot verifications agree.
      Evidence: two consecutive `forgepilot verify` runs of the delivered commit
      both record PASS.

## Known Limits

* Ten runs under load is a sampling procedure, not a proof. It distinguishes a
  gate from a coin flip; it cannot certify that no load level ever flips a
  verdict.
* A counter measures work, not time. It cannot catch a regression that does the
  same work more slowly — a worse data structure with identical traversal
  counts, for instance. Where that risk is real the case says so and keeps a
  printed measurement for a human to read.

## Verification Notes

The Story's Dependencies name a ForgePilot Gate covering the fourteen masking
assertions. `query.bench.ts` and the `--version` case do not wait on it: the
first has no in-process quantity to count and the second was settled by
GATE-004.
