# Story: DBCLI-016 ForgePilot Is the Lifecycle Authority

## Goal

An agent or maintainer picking up dbcli gets one answer to "what is being worked
on, and what is actionable next", and gets it from ForgePilot. `specs/handoff.md`
can no longer state a second answer that disagrees with it.

## Context

Two components record operational lifecycle state today.

ForgePilot holds READY, RUNNING, gate-blocked, REVIEW and DONE, the dependency
edges between Work Items, and verification Evidence bound to an exact revision.
`forgepilot next` is the only thing in this system that computes what is
actionable. Nothing else can: `.forgepilot/` is gitignored, and a queue that
lives in a committed file is a queue that goes stale between commits.

`specs/handoff.md` carries `workflow.current_story`, `workflow.next_story` and
`workflow.status` as well. Measured on 2026-09-08 at `141cf4c3`:

* Nothing in this repository reads `next_story` or `status`.
  `scripts/lib/forgeflow-handoff.ts` reads `current_story` and
  `completed_stories`, and nothing else parses the block.
* The block is already self-contradictory. It records `current_story: pending`
  and `next_story: pending`. Running upstream `handoff-check` against it — from
  a checkout of the adopted `v0.3.2`, and again from `v0.6.0` — fails both
  times with `workflow.current_story must be one Story ID or none` and
  `the same Story cannot be both current and next`, plus
  `unknown lifecycle key: verification.detail` and six indentation failures from
  the folded prose block under it.
* `make verify` does not see any of that. Upstream's checkers live in a
  ForgeFlow checkout CI does not have, which is the documented reason this
  repository wrote its own gate instead.

So the duplicated state is not a hypothetical conflict: the half nothing reads
has already drifted into a shape the protocol rejects, and it drifted silently.

`completed_stories` is a different thing wearing the same block.
`bun run forgeflow:check` reconciles each entry against a `Story:` commit
trailer, or against a recorded delivering commit for the one Story that predates
trailers. Twenty-one of its twenty-three entries were delivered before ForgePilot
existed and appear in no ForgePilot state; ForgePilot holds two Work Items. The
delivery record is a repository fact, checkable offline from git alone, and
ForgePilot is structurally unable to hold it. It stays.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: yes

## Scope

### In Scope

* `specs/handoff.md` states no live Story: `current_story: none` and
  `next_story: pending`, the two values the adopted handoff contract defines for
  "no Story is stated".
* The prose currently held in `verification.detail` moves out of the lifecycle
  block into the surrounding narrative, where the contract puts prose.
* `scripts/lib/forgeflow-handoff.ts` stops treating a named current Story as a
  claim to reconcile and instead refuses it, and refuses lifecycle keys the
  adopted handoff contract does not define.
* `AGENTS.md` states which component owns which lifecycle question.
* A decision record for the boundary, with the condition that would falsify it.

### Out of Scope

* Removing `completed_stories`, or any change to how it reconciles.
* Removing the `workflow:`, `baseline:` or `verification:` sections. The adopted
  ForgeFlow handoff contract requires all three; this repository does not fork
  the contract it declares it adopted.
* Changing `specs/.forgeflow-adoption`, the Story template, or the adopted
  ForgeFlow version — DBCLI-018 owns that.
* Exporting, committing, or reading ForgePilot state anywhere in this
  repository — DBCLI-017 owns portable evidence.
* Any change to the steps of `make verify`, or their order.
* Any dbcli source, runtime, or packaging dependency on ForgePilot.
* Running upstream `story-check` or `handoff-check` inside `make verify`.

## Inputs

* The `workflow:` block of `specs/handoff.md`.
* `Story:` trailers in git history, and the Story IDs declared by each
  `specs/stories/*/story.md` heading.
* The adopted ForgeFlow handoff contract, `protocol/handoff.md` at 0.3.2.

## Outputs

* A handoff whose lifecycle block names no live or next Story.
* A gate that fails if one is reintroduced.
* One statement in `AGENTS.md` of who owns what.
* An architecture decision record.

## Rules

* R1: `bun run forgeflow:check` fails when `workflow.current_story` is anything
  but `none`, or `workflow.next_story` anything but `pending`. Single-source is
  enforced, not requested.
* R2: `completed_stories` reconciliation is unchanged — the same rules, the same
  `DELIVERED_BEFORE_TRAILERS` ratchet, the same refusal on a shallow clone.
* R3: The lifecycle block carries only keys the adopted handoff contract
  defines. An unknown key fails, naming the key.
* R4: The gate reads no ForgePilot state, requires no ForgePilot install, and
  makes no network call. A clone with ForgePilot absent verifies identically.
* R5: The step list of `make verify` is byte-identical before and after this
  Story.
* R6: Every rule this Story adds is decided in `scripts/lib/forgeflow-handoff.ts`
  against arguments, testable from fixtures without a repository.

## Expected Errors

* A handoff naming a current or next Story fails `bun run forgeflow:check` with
  a message that names ForgePilot as where that state belongs, so the reader
  does not have to guess whether to delete the line or the tool.
* A lifecycle key outside the contract fails, naming the key and the contract
  that defines the permitted set.
* A handoff with no lifecycle block, or with no `completed_stories`, still
  throws rather than passing — unchanged.
* A shallow clone still refuses to render a verdict — unchanged.

## Dependencies

* None. This Story adds no dependency on the ForgePilot binary, and removes
  none.

## Constraints

* The adopted 0.3.2 handoff contract must remain satisfiable: all three
  sections, every required key, and only values the contract permits.
* The gate stays offline and needs no ForgeFlow checkout.
* `specs/handoff.md` remains the place a human reads for why, context,
  decisions, risks and the repository baseline. This Story removes a work queue
  from it, not its narrative.

## Superseded Behavior

Required when `Baseline conformance: yes`; otherwise delete this section. Name
each existing test or documented behavior this Story intentionally replaces.

* `tests/unit/scripts/forgeflow-handoff.test.ts` — the two reconcile rules that
  take a named `current_story` as valid input: "a Story cannot be both current
  and delivered", and "a current Story must have a `specs/stories` directory".
  A named current Story is now refused outright, so these rules are replaced by
  the refusal rather than kept beside it. Keeping both would leave two
  behaviours for one input and a rule nothing can reach.
* `scripts/lib/forgeflow-handoff.ts` — `Lifecycle.currentStory` as a Story ID or
  `null`, and `NO_CURRENT_STORY` as a set of accepted spellings. The protocol
  defines exactly one spelling for "none"; accepting four was this repository
  quietly widening a contract it did not own.
* `specs/handoff.md` — `current_story: pending` and the `verification.detail`
  key, neither of which the contract permits.
* `AGENTS.md` lines 170–174 — the instruction to record "exactly one current
  Story, exactly one next Story or `pending`" in the handoff. That instruction
  is what produced the duplicated state.
