# Acceptance Criteria

Every criterion names the evidence that decides it: a command and the result
that counts as passing. A criterion whose evidence is "read the diff" is not
acceptance, it is review.

## Happy Path

* [ ] `specs/handoff.md` names no live Story.
      Evidence: `bun run forgeflow:check` → exit `0`, and
      `sed -n '/^workflow:/,/^$/p' specs/handoff.md` shows
      `current_story: none` and `next_story: pending`.
* [ ] The delivery record still reconciles against git.
      Evidence: `bun run forgeflow:check` prints
      `forgeflow handoff reconciliation passed: 24 completed Stories
      (23 by commit trailer, 1 by recorded delivering commit)`.
* [ ] Nothing in the repository reads a next Story from the handoff.
      Evidence: `grep -rn "next_story" scripts src tests` returns only the gate
      rule that refuses a named one, and its tests.
* [ ] ForgePilot answers what is actionable next.
      Evidence: `forgepilot next` on a machine with ForgePilot installed selects
      the Work Item for this Story while it is the only READY one; the delivery
      report records the Work Item ID.

## Business Rules

* [ ] A named current Story is refused.
      Evidence: a fixture lifecycle block with
      `current_story: DBCLI-016` fails the rule, with a message naming
      ForgePilot. Asserted in `tests/unit/scripts/forgeflow-handoff.test.ts`.
* [ ] A named next Story is refused.
      Evidence: a fixture with `next_story: DBCLI-017` fails the same way.
* [ ] A lifecycle key outside the adopted contract is refused, naming the key.
      Evidence: a fixture carrying `verification.detail` fails with
      `verification.detail` in the message.
* [ ] `completed_stories` reconciliation is unchanged.
      Evidence: every existing test in
      `tests/unit/scripts/forgeflow-handoff.test.ts` that does not name a
      current Story passes unmodified, including the shallow-clone refusal, the
      stale-exemption rule and the duplicate-directory refusal.
* [ ] The gate needs no ForgePilot.
      Evidence: `mv .forgepilot "$TMPDIR/fp-016" && env PATH=/usr/bin:/bin
      bun run forgeflow:check` → exit `0`; then move it back.
* [ ] `make verify` says exactly what it said before.
      Evidence: `tests/contract/forgepilot-boundary.test.ts` passes with its
      `REQUIRED_STEPS` roster unedited.
* [ ] ForgePilot state stays out of Git.
      Evidence: `git check-ignore .forgepilot/state.json` → exit `0`.

## Failure Cases

* [ ] A handoff with no lifecycle block still throws rather than passing.
      Evidence: existing fixture test, unmodified.
* [ ] A handoff whose block records no `completed_stories` still throws.
      Evidence: existing fixture test, unmodified.
* [ ] A shallow clone still refuses to render a verdict instead of passing.
      Evidence: `shallowCloneRefusal` fixture tests, unmodified.
* [ ] Reintroducing the duplicated state fails loudly rather than being
      reconciled: a handoff naming a current Story that is also in
      `completed_stories` fails on the refusal, and the failure text tells the
      reader to delete the line, not to fix the contradiction.

## Regression Requirements

* [ ] `make verify` passes on the delivered commit, run by ForgePilot in a
      detached worktree of that exact revision.
* [ ] Upstream `handoff-check` from a `v0.3.2` ForgeFlow checkout no longer
      reports `workflow.current_story must be one Story ID or none`,
      `the same Story cannot be both current and next`,
      `unknown lifecycle key: verification.detail`, or any
      `unsupported lifecycle indentation` failure.
      The `completed Story is not a Story ID: DBCLI-PLAT-*` failures remain and
      are out of scope: 0.3.2's Story ID grammar predates `DBCLI-PLAT-*`, 0.6.0
      widened it, and DBCLI-018 owns the upgrade. This criterion is met when the
      remaining failures are exactly those eight.
* [ ] No dbcli source, test fixture, or package manifest gains a reference to
      ForgePilot.
      Evidence: `tests/contract/forgepilot-boundary.test.ts`, unmodified.

## Verification Notes

`bun run forgeflow:check` is the gate that decides this Story, and it runs
inside `make verify`. No step is added to `make verify`.

The upstream `handoff-check` criterion is run by hand from a ForgeFlow checkout
and is deliberately not wired into `make verify`: the checker lives in a
repository CI does not have, and a gate that needs a second checkout fails for
reasons unrelated to the code it guards. Record its output in the delivery
report.

The count in the second Happy Path criterion assumes this Story is delivered
with its own `Story: DBCLI-016` trailer and added to `completed_stories`. If it
is delivered without being recorded as completed, the expected count is 23 and
the criterion is met with the earlier numbers.
