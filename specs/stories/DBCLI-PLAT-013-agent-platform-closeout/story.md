# Story: DBCLI-PLAT-013 Agent Platform Closeout

## Goal

A reader of this repository gets one answer to three questions that currently
have two: what `dbcli capabilities check --require` promises about argument
order, which Story is being worked on, and whether the ForgeFlow delivery gate
can see a `DBCLI-PLAT-*` Story at all.

## Context

`DBCLI-PLAT-001` shipped and merged. Three loose ends came with it, and each is
the same shape: a written claim that nothing compares to the repository.

**The ordering claim contradicts the code.** `story.md` R5 says output is
"independent of `--require` argument order" and `acceptance.md` ticks "Output
is byte-identical across calls and independent of input order". The
implementation preserves first-seen input order in both `required` and
`results`, its own test asserts exactly that, and the design record never
claimed otherwise. So `schema.read,data.delete` and `data.delete,schema.read`
produce different byte streams by design, and two of the four surfaces say they
do not. The tick was written against a test that proves the narrower property —
that the *verdicts* are order-independent — and the sentence above it grew.

The narrower property is the one worth having. Sorting `results` would make a
caller lose the correspondence between the list it sent and the list it got
back; it would have to re-index by id to read its own answer. Preserving input
order costs nothing and keeps `results[i]` about `required[i]`.

**The handoff still says PLAT-001 is in progress.** Its lifecycle block records
`current_story: DBCLI-PLAT-001`, `status: in_progress`, and a `baseline.branch`
pointing at a feature branch that has been merged and deleted. Its
`verification` block says `release:check` never completed. All of that was true
when written and none of it is true now.

**The delivery gate cannot parse a PLAT Story ID.**
`scripts/check-forgeflow-handoff.ts` derives a Story ID from its directory name
with `/^(DBCLI-\d+).*$/`. `DBCLI-PLAT-001-capability-contract` does not match,
`String.replace` returns the input unchanged, and the directory is keyed under
its own full name. Adding `DBCLI-PLAT-001` to `completed_stories` would
therefore fail with "has no specs/stories directory" — a true-sounding message
about a directory that exists.

Widening the regex would work once. The next ID family breaks it again, and the
failure is silent until someone adds a Story of that family to the list. Each
`story.md` already declares its own ID in its `# Story: <ID> …` heading, which
is metadata the Story owns rather than a shape the gate guesses at.

## Classification

* Security sensitive: no
* Baseline conformance: yes

## Scope

### In Scope

* One stated semantics for `--require` ordering, applied to `story.md`,
  `acceptance.md`, the design record, `assets/reference.md` and both user-doc
  locales in both formats.
* `scripts/lib/forgeflow-handoff.ts`: the reconciliation rules as pure
  functions, with `scripts/check-forgeflow-handoff.ts` reduced to the git and
  filesystem shell around them.
* Story IDs read from each `story.md` heading rather than parsed out of a
  directory name.
* A new rule: a Story may not be `current_story` and `completed_stories` at
  once.
* Unit tests for the gate, over fixtures rather than the live repository.
* `specs/handoff.md` brought level with the repository: `DBCLI-PLAT-001`
  completed, this Story current, `DBCLI-PLAT-012` next, real baseline and real
  verification.

### Out of Scope

* Any change to what `capabilities check` computes or emits. The ordering work
  is a documentation correction; the code is already right.
* `DBCLI-PLAT-012`'s schema-cache seam, and every later platform capability.
* Anything the upstream `story-check` / `handoff-check` scripts already do.
  This gate reconciles claims against the repository; structure is theirs.
* Network access of any kind, including the GitHub API.

## Inputs

* `specs/handoff.md` — the lifecycle block.
* `specs/stories/DBCLI-*/story.md` — one Story ID per heading.
* `git log --all --format=%b` — `Story:` trailers.
* `git rev-parse --is-shallow-repository`.

## Outputs

* A reconciliation verdict: pass with a count, or a list of unbacked claims and
  exit `1`.
* Corrected Story, design-record and user documentation.

## Rules

* R1: Identical input to `capabilities check` produces byte-identical output.
* R2: `required` and `results` preserve first-seen input order.
* R3: Argument order changes neither any capability's verdict nor `ok`.
* R4: A duplicate id is de-duplicated in first-seen order and warned about.
* R5: A Story's ID comes from its `story.md` heading. The gate recognises no
  ID *shape*, so a new ID family needs no change to it.
* R6: A directory whose heading declares an ID that is not the directory's own
  prefix fails: the two names must agree, or neither can be trusted.
* R7: A completed Story with no directory fails closed, and so does one with
  no `Story:` trailer and no `DELIVERED_BEFORE_TRAILERS` entry.
* R8: A Story recorded as both current and completed fails closed.
* R9: A shallow clone is refused, never skipped.
* R10: The gate performs no network access.

## Expected Errors

* `specs/handoff.md` with no lifecycle block, or a lifecycle block with no
  `completed_stories`: refuse and say which.
* A `story.md` with no `# Story: <ID>` heading: refuse, naming the file.
* Two Story directories declaring the same ID: refuse, naming both.

## Dependencies

* `scripts/check-forgeflow-adoption.ts` and `scripts/lib/forgeflow-adoption.ts`
  — the sibling gate whose lib/shell split this one adopts.
* `src/core/capabilities/check.ts` — the behaviour the corrected prose describes.

## Constraints

* `DELIVERED_BEFORE_TRAILERS` stays a ratchet: entries may be removed, never
  added.
* No change to `check-forgeflow-adoption.ts`. The two gates stay disjoint.
* The documentation correction may not be made by loosening a test. The tests
  already assert the true behaviour; the prose moves to them.

## Superseded Behavior

* `specs/stories/DBCLI-PLAT-001-capability-contract/story.md` R5 — "and
  independent of `--require` argument order" is withdrawn. Determinism per
  input stands; order-independence of the emitted list never held and was never
  implemented.
* `specs/stories/DBCLI-PLAT-001-capability-contract/acceptance.md`, business
  rule "Output is byte-identical across calls and independent of input order" —
  restated as the two separable properties its cited tests actually prove.
* No test is superseded. `tests/unit/core/capabilities/check.test.ts` — "input
  order is preserved and does not change the verdict" — already asserts R2 and
  R3 exactly, `ok` comparison included. That is what makes this a documentation
  correction rather than a behaviour change: the prose moves to the test, and
  the test does not move.
