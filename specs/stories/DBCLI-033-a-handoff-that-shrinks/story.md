# Story: DBCLI-033 A Handoff That Can Shrink

## Goal

`specs/handoff.md` says what the next worker needs and stops accumulating what
is already recorded elsewhere, with a gate that keeps it that way.

## Context

The file is 1,132 lines. About 870 of them are delivery narrative for Stories
that `completed_stories` already records, one section per Story, written at
delivery and never removed — because nothing has ever asked for a line to be
removed. It is the same shape as the delivery list before DBCLI-029: a
one-directional record that can only grow.

The file states the answer itself, at line 48:

> 每個 Story 的理由寫在自己的 commit body 裡，比這份摘要完整——要理解某個決定
> 為什麼是那樣，讀 commit，不要從這裡重新推導。

Measured across this history: 38 commits carry a `Story:` trailer, and only four
have a body shorter than eight lines. For every other Story the handoff section
is a lossy copy of a fuller record that travels with the change itself, and the
decisions are in `docs/adr/` besides.

The lifecycle block has the same problem one level down.
`baseline.story_owned_paths` holds about ninety paths accumulated across a dozen
delivered Stories, while `dirty_worktree` is `false` and `current_story` is
`none`. Upstream defines those paths as the working-tree paths *the Story* owns;
with no Story in progress and nothing uncommitted, the honest value is `[]`. The
list grew for the same reason the prose did.

What this file is for, upstream says in one sentence: what one human or agent
leaves for the next one. Prose around the block is explicitly the writer's
business and is ignored by the contract check — which is why the growth was
invisible to every gate this repository has.

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
* Decision: `ADR-0036`
* Boundary: `HandoffContract`
* Contract: `the handoff carries what has no other home, and a delivered Story's narrative lives in its commit`
* Owner: `HandoffContract = repository-governance`

## Risk

* Level: medium
* Reason: `irreversible-prose-deletion`

Prose a human wrote is being removed. The licence for removing a section is that
a fuller record of it exists in a commit body; where that licence does not hold,
the text moves rather than disappears.

## Scope

### In Scope

* Removing the delivery-narrative sections for Stories recorded in
  `completed_stories`, where a commit carrying that Story's trailer holds a body
  of at least eight lines.
* Moving what that licence does not cover: the 2026-09-08 adoption assessment
  becomes a dated document under `docs/`, and notes for deliveries accepted
  against issues rather than Stories stay in the handoff, because the handoff is
  their only home.
* Setting `baseline.story_owned_paths` and `baseline.known_unrelated_paths` to
  `[]`, which is what a clean worktree with no current Story owns.
* Two rules in `scripts/lib/forgeflow-handoff.ts`: a heading naming a Story that
  `completed_stories` records is refused, and a clean worktree declaring owned
  paths is refused.
* ADR-0036.

### Out of Scope

* The lifecycle block's shape, the delivery reconciliation, and every other rule
  in the gate.
* Rewriting or condensing prose that stays. Sections are kept or removed whole;
  editing them is a second kind of change and would hide the first.
* `docs/adr/`, whose records are the decisions themselves rather than narrative
  about them.
* Any change to `src/`, and any release.

## Inputs

* `specs/handoff.md`, `scripts/lib/forgeflow-handoff.ts`,
  `tests/unit/scripts/forgeflow-handoff.test.ts`.
* The 38 `Story:` commit bodies that license the removals.

## Outputs

* A handoff a reader can read.
* Two rules that stop both lists growing again.

## Rules

* R1: A `##` or `###` heading naming a Story ID that `completed_stories` records
  fails `bun run forgeflow:check`, naming the Story and saying where the
  narrative belongs.
* R2: With `dirty_worktree: false`, both path lists are `[]`; anything else
  fails. A clean worktree has no uncommitted paths to attribute.
* R3: A section is removed only where a commit carrying that Story's trailer
  holds a body of at least eight lines. Everything else moves.
* R4: The delivery reconciliation, the trailer evidence, the exemption ratchet,
  the shallow-clone refusal and the lifecycle structure checks are unchanged.
* R5: `bun run forgeflow:contract` still passes: upstream's `handoff-check` reads
  the same block afterwards.
* R6: No change to `src/`.

## Expected Errors

* A handoff that keeps a delivered Story's section fails, naming that Story.
* A clean worktree that declares owned paths fails, naming the field.

## Dependencies

* ADR-0036 — the decision and the removal licence.
* ADR-0032 — the entry is written in the change that delivers the Story, which
  is what makes R1 checkable at the same moment.

## Constraints

* Nothing is deleted whose fuller record cannot be named.
* `scripts/lib/forgeflow-handoff.ts` imports nothing and spawns nothing.
