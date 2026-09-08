# Acceptance Criteria

## Happy Path

* [ ] Blacklist lookup cost is still covered by at least as many assertions as
      before this Story.
* [ ] Running the full suite under concurrent load produces the same verdict for
      that coverage as running it alone.

## Business Rules

* [ ] GATE-002 is resolved before the implementation lands, and the chosen
      option is the one implemented.
* [ ] If a wall-clock budget survives, it lives where the repository's other
      measured budgets live, prints the value it measured, and its constant is
      justified by a measurement on the runner rather than a dev machine.
* [ ] If the assertion becomes a complexity claim instead, it names the property
      it is defending rather than a duration.

## Failure Cases

* [ ] An implementation whose lookup is linear in the number of blacklisted
      tables fails the replacement assertion.
* [ ] The replacement assertion does not pass merely because the work was
      skipped or optimized away.

## Regression Requirements

* [ ] `make verify` passes.
* [ ] Two consecutive ForgePilot verifications of the delivered commit both
      PASS.

## Verification Notes

The load-sensitivity claim cannot be verified by running the test alone — that
is the configuration in which it already passes. Verify it inside a full
`bun run test` run, and preferably with a second full run in parallel, which is
the condition that produced EV-002.
