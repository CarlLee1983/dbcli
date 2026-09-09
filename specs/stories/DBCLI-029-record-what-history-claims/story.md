# Story: DBCLI-029 Record What History Already Claims

## Goal

A Story whose delivery this checkout's own history claims is recorded in
`specs/handoff.md`, because the gate now asks the question in both directions
instead of only the one that cannot catch an omission.

## Context

The handoff gate reconciles `completed_stories` against `Story:` commit
trailers, and it has only ever asked one of the two questions that comparison
makes available: *does every recorded Story have evidence?* The other one —
*does every delivered Story get recorded?* — has never been asked, and a list
that is only checked in that direction can only rot toward being incomplete.

It has rotted twice, and both times a human happened to look. DBCLI-027 found
DBCLI-022 to DBCLI-026 delivered, merged and approved with none of them
recorded. Reconciling DBCLI-028's own delivery then found that DBCLI-027 had
left *itself* out of the same list it had just repaired. Two occurrences, two
accidental discoveries, zero gate involvement.

This is the lesson the surrounding gates already encode, applied to the half of
the comparison that was left out: a claim nothing compares to anything survives
by inertia. The missing entries were never false — they were unasked.

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
* Decision: `ADR-0032`
* Boundary: `HandoffContract`
* Contract: `the handoff and this checkout's delivery history state the same set of Stories`
* Owner: `HandoffContract = repository-governance`

## Risk

* Level: medium
* Reason: `governance-gate-change`

The rule fails work that was previously green, and it fails it on `main` if the
recording is left for later. That timing is the decision, and ADR-0032 records
why it is drawn where it is.

## Scope

### In Scope

* A reverse reconciliation in `scripts/lib/forgeflow-handoff.ts`: a Story whose
  `Story:` trailer is reachable from `HEAD` and which has a `specs/stories`
  directory, but which `completed_stories` does not record, is a failure naming
  the Story and the fix.
* One history scope for both directions. The forward rule reads trailers from
  `git log --all` and the reverse rule cannot — an unmerged branch would demand
  entries for Stories this tree has not delivered — so both move to `HEAD`.
* ADR-0032, and the `specs/stories/README.md` or `AGENTS.md` sentence that tells
  the next author when to write the entry.

### Out of Scope

* Stories delivered without a `specs/stories` directory. `DBCLI-PLAT-008`,
  `DBCLI-PLAT-009` and `DBCLI-PLAT-010` were accepted against issues, and
  demanding a handoff entry for a Story this repository does not contain would
  be inventing a Story rather than reconciling one.
* `DELIVERED_BEFORE_TRAILERS`, which stays a shrink-only ratchet.
* Any change to `src/`, and any release.

## Inputs

* `scripts/lib/forgeflow-handoff.ts`, `scripts/check-forgeflow-handoff.ts`,
  `tests/unit/scripts/forgeflow-handoff.test.ts`.
* `specs/handoff.md` — `completed_stories`.

## Outputs

* A gate that fails an unrecorded delivery by name.
* A decision record stating when the entry is written and why not later.

## Rules

* R1: A Story with a `Story:` trailer reachable from `HEAD` and a
  `specs/stories` directory, absent from `completed_stories`, fails
  `bun run forgeflow:check`.
* R2: A trailer naming a Story with no `specs/stories` directory is not
  reported. The gate reconciles the handoff against this repository's Stories,
  and a Story it does not contain is not one of them.
* R3: Both directions read one history — commits reachable from `HEAD`. A rule
  whose verdict differs between a local branch and the same branch in CI is the
  defect DBCLI-028 removed, one level down.
* R4: The existing forward rules are unchanged in substance: a recorded Story
  still needs a trailer or a `DELIVERED_BEFORE_TRAILERS` entry, a stale
  exemption still fails, and an exemption naming an absent commit still fails.
* R5: The shallow-clone refusal still guards both directions; with no trailers
  readable, the reverse rule would report every Story in the repository.
* R6: No change to `src/`.

## Expected Errors

* A Story delivered on this branch and not recorded fails, naming the Story and
  saying to add it to `completed_stories`.
* A shallow clone is refused before either direction runs.

## Dependencies

* ADR-0032 — when the entry is written.
* ADR-0031 — the gate reconciles delivery and derives nothing else from it.

## Constraints

* `scripts/lib/forgeflow-handoff.ts` imports nothing and spawns nothing.
* The reverse rule must be green on `main` at `2594c2c6` without editing
  `completed_stories`, or it is asserting something this repository has not
  actually done.
