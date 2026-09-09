# Story: DBCLI-027 An Authority Declaration Something Checks

## Goal

A Story's `## Authority` says what was actually permitted, because a gate
compares it to the repository's own record of delivery instead of leaving it to
a reader who has never once caught it.

## Context

DBCLI-022 and DBCLI-023 declared `push: no` and their branch was pushed. That
was recorded in `specs/handoff.md` as a known discrepancy and deliberately not
fixed, on the reasoning that Authority records what was granted at approval and
rewriting an approved Story is what DBCLI-021 refused to do.

Measuring it changed the answer. Every Story in this repository that has ever
declared `## Authority` — eight of them — declares `push: no`, and all eight
reached `main` through a merged pull request. Three also declare `commit: no`,
with their commits sitting on `main` carrying their own `Story:` trailers.

**Eight out of eight is not a record of a decision.** It is the template's
default, copied and never filled in, and correcting it destroys nothing because
nobody ever made the statement. The earlier reasoning was right about approved
records and wrong about which kind of thing this was.

What let it survive eight Stories is the more useful half: upstream's checker
validates that Authority's values are `yes` or `no`, and nothing anywhere asked
whether they were true. A declaration nothing compares to anything is not a
control, however carefully it is worded.

The comparison is available and cheap. `completed_stories` in `specs/handoff.md`
is this repository's own statement that a Story reached `main`, which it can only
have done as commits on a pushed branch.

While reconciling that list, a second staleness: DBCLI-022 to DBCLI-026 were
delivered, merged and approved, and none of them had been added to it.

## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: mixed

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: yes
* deploy: no

## Architecture

* Impact: medium
* Decision: `ADR-0030`
* Boundary: `HandoffContract`
* Contract: `a delivered Story's Authority agrees with what delivering it required`
* Owner: `HandoffContract = repository-governance`

## Risk

* Level: medium
* Reason: `retro-edit-of-approved-records`

Correcting a declaration in eight Stories a human has already approved is the
move this repository normally refuses. It is justified here by a measurement,
not by tidiness, and if the measurement is wrong the edit is exactly the kind of
quiet record change the rule exists to prevent.

## Scope

### In Scope

* `reconcileDeliveryAuthority` in `scripts/lib/forgeflow-handoff.ts`, failing any
  Story in `completed_stories` whose Authority declares `commit: no` or
  `push: no`, wired into `bun run forgeflow:check`.
* Correcting the eight existing declarations.
* Adding DBCLI-022 to DBCLI-026 to `completed_stories`.
* ADR-0030, and replacing the handoff paragraph that recorded the discrepancy as
  accepted with what was done about it.

### Out of Scope

* The other five Authority permissions. Delivery implies `commit` and `push` and
  nothing else; checking `deploy` or `migration` against delivery would invent
  implications the contract explicitly denies.
* `specs/stories/_template/story.md`. It is an adoption surface reconciled
  against upstream, and its `push: no` is upstream's default, not a claim about a
  delivered Story.
* Any change to `src/`, and any release.

## Inputs

* The eight Story directories declaring `## Authority`.
* `specs/handoff.md` — `completed_stories`.

## Outputs

* A gate that fails on the discrepancy this Story is fixing.
* Eight declarations that agree with what delivering them required.

## Rules

* R1: A Story in `completed_stories` declaring `commit: no` or `push: no` fails
  `bun run forgeflow:check`, and the message names both exits — correct the
  declaration, or stop recording it as completed.
* R2: A Story with no `## Authority` section, or one omitting a permission,
  declares nothing and is not reported. The section is optional upstream.
* R3: A Story not recorded as completed is not checked. The claim being
  reconciled is the handoff's, not the Story's.
* R4: Only `commit` and `push` are checked.
* R5: The gate stays offline and reads no git history, so a shallow CI clone
  behaves as a local one does.
* R6: No change to `src/`.

## Expected Errors

* A delivered Story left at `push: no` fails the handoff gate by name.
* A Story added to `completed_stories` before its Authority is corrected fails
  the same way.

## Dependencies

* `scripts/lib/forgeflow-handoff.ts` and `scripts/check-forgeflow-handoff.ts`.
* ADR-0030 — the decision and its falsification condition.

## Constraints

* The check reads two files and spawns nothing; the sibling trailer
  reconciliation needs git and has to guard against shallow clones, and this one
  must not inherit that.
