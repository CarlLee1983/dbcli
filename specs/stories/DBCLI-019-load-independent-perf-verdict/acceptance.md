# Acceptance Criteria

Every criterion names the evidence that decides it: a command and the result
that counts as passing.

## Happy Path

* [ ] The cases this Story names get the same verdict under load.
      Evidence: `bun run test:perf` run ten times while eight CPU-bound
      processes are running, and not one of the five named cases fails in any
      of the ten. The pre-change baseline for the same procedure is recorded in
      `task.md`: 10 of 10 runs failed.
* [ ] Every absolute wall-clock assertion still in `tests/perf/` is disclosed,
      and the list can only shrink.
      Evidence: `tests/unit/build/perf-absolute-time-budgets.test.ts` counts
      them per file, fails when a new one is added, and fails just as loudly
      when one is fixed without lowering the recorded number. Nineteen remain,
      and until they are gone a loaded `test:perf` can still fail — which is
      why the criterion above is about the named cases and not about the run.
* [ ] The load-sensitive assertions are named from a reproduction.
      Evidence: `task.md` names each case, quotes the numbers it compared and
      how often it failed, and states the procedure. Which of them produced
      EV-018 and EV-019 is not recoverable and is not claimed.
* [ ] `make verify` passes.
      Evidence: `make verify` → exit `0`, and the attestation it writes to
      `.verification/attestation.json` reads `PASS` at the delivered revision.

## Business Rules

* [ ] Every retained wall-clock budget prints what it measured.
      Evidence: a passing `bun run test:perf` prints one line per budget in the
      form `<label> = <value>ms (budget <n>ms)`, and a failing one prints the
      same line for the case that failed.
* [ ] Every retained budget says where its number came from.
      Evidence: each threshold this Story adds or changes carries a comment
      naming the measurement it was derived from, matching the convention in
      `tests/perf/blacklist-performance.bench.ts:364`.
* [ ] No assertion is lost.
      Evidence: the count of `expect(` calls across `tests/perf/` is not lower
      than at `c3230d79`, and the `test:perf` summary reports at least the 24
      passing cases it reported there.

## Failure Cases

* [ ] Each replaced gate still rejects the regression it was there to catch.
      Evidence: for every case this Story changes, a companion case feeds it the
      regression it guards against and asserts the new threshold rejects it —
      the shape `tests/perf/blacklist-performance.bench.ts:196` already uses.
      For `blacklist-performance.bench.ts:306` the regression is the per-row
      recursion decision made once for the whole result set.
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
* The nineteen remaining absolute assertions are a population, not stragglers.
  Two ten-run samples after the change failed 3 and 6 times, naming a different
  subset each time. Several of them guard constant-factor regressions — the
  per-row path re-split in `blacklist-performance.bench.ts:354` is the clearest
  — and no ratio can catch a constant factor: only absolute time can. Closing
  them needs a quantity that is neither time nor a ratio, such as a count of
  operations, and that is a different piece of work from this Story.
* The named cause for EV-018 and EV-019 rests on a reproduction, not on a
  recorded log. The original failing output no longer exists.

## Verification Notes

The Story's Dependencies name a ForgePilot Gate. Implementation does not begin
before it is resolved, and the resolved option decides which of the criteria
above are met by a ratio, by a relative baseline, or by a re-measured budget —
none of them by a larger constant.
