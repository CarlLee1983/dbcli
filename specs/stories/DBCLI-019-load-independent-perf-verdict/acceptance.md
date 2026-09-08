# Acceptance Criteria

Every criterion names the evidence that decides it: a command and the result
that counts as passing.

## Happy Path

* [ ] The same commit gets the same verdict under load.
      Evidence: at one commit, `bun run test:perf` run ten times while eight
      CPU-bound processes are running gives ten identical verdicts, all exit
      `0`. The pre-change baseline for the same procedure is recorded in
      `task.md`; if it does not reproduce a failure, the load level is raised
      until it does before the change is made, and both numbers are recorded.
* [ ] The assertion that produced EV-018 and EV-019 is named.
      Evidence: `task.md` names the case, quotes the numbers it compared, and
      states how it was reproduced.
* [ ] `make verify` passes.
      Evidence: `make verify` → exit `0`, and the attestation it writes to
      `.verification/attestation.json` reads `PASS` at the delivered revision.

## Business Rules

* [ ] Every retained wall-clock budget prints what it measured.
      Evidence: a passing `bun run test:perf` prints one line per budget in the
      form `<label> = <value>ms (budget <n>ms)`, and a failing one prints the
      same line for the case that failed.
* [ ] Every retained budget says where its number came from.
      Evidence: each budget constant in `tests/perf/startup.bench.ts` and
      `tests/perf/query.bench.ts` carries a comment naming the measurement it
      was derived from, matching the convention in
      `tests/perf/blacklist-performance.bench.ts:364`.
* [ ] No assertion is lost.
      Evidence: the count of `expect(` calls in `tests/perf/startup.bench.ts`
      and `tests/perf/query.bench.ts` is not lower than at `c3230d79`, and the
      `test:perf` summary reports at least the 24 passing cases it reported
      there.

## Failure Cases

* [ ] A real startup regression is still rejected.
      Evidence: a case in `tests/perf/startup.bench.ts` that measures a
      deliberately slowed startup and asserts it exceeds the threshold — the
      shape `tests/perf/blacklist-performance.bench.ts:196` already uses to
      prove its own gate rejects the regression it is there to catch.
* [ ] A `test:perf` failure identifies itself.
      Evidence: with a budget temporarily set to `0`, the output a caller sees
      when the step fails names the case and both numbers, not only
      `error: script "test:perf" exited with code 1`.
* [ ] A run that measures nothing fails.
      Evidence: `medianElapsed` still throws `medianElapsed measured no
      samples`, verified by its existing test.

## Regression Requirements

* [ ] The `make verify` step list is unchanged.
      Evidence: `git diff c3230d79..HEAD -- Makefile package.json` shows no
      change to the `verify` recipe or to the `test:perf` script's step
      ordering.
* [ ] `SKIP_PERF_TESTS` is not set anywhere in the verification path.
      Evidence: `grep -rn "SKIP_PERF_TESTS" Makefile package.json .github`
      returns no assignment that enables it.
* [ ] Two ForgePilot verifications agree.
      Evidence: two consecutive `forgepilot verify` runs of the delivered
      commit both record PASS.

## Known Limits

* Ten runs under load is a sampling procedure, not a proof. It is the same
  standard DBCLI-015 was accepted under, and it is enough to distinguish a gate
  from a coin flip; it cannot certify that no load level ever flips a verdict.
* The named cause for EV-018 and EV-019 rests on a reproduction, not on a
  recorded log. The original failing output no longer exists.

## Verification Notes

The Story's Dependencies name a ForgePilot Gate. Implementation does not begin
before it is resolved, and the resolved option decides which of the criteria
above are met by a ratio, by a relative baseline, or by a re-measured budget —
none of them by a larger constant.
