# A permission nobody filled in is not a control

* Status: accepted
* Date: 2026-09-09

ForgeFlow 0.6.0's `## Authority` section declares, per operation, what a Story is
permitted to do. AGENTS.md restates the rule that makes it worth having:
Authority is per-permission and nothing implies anything else — `modify` does not
grant `commit`, and `commit` does not grant `push`.

Measured on 2026-09-09 across every Story in this repository that had ever
declared the section:

* eight Stories declared `## Authority`;
* **eight of eight declared `push: no`**;
* three of those also declared `commit: no`;
* all eight reached `main` through a merged pull request — as commits, on a
  pushed branch.

A declaration that was false every time it was made is not recording a decision.
It is the template's default, copied and never filled in. What let it survive
eight Stories is that nothing compared it to anything: upstream's checker
validates that the values are `yes` or `no`, and no checker anywhere asked
whether they were true.

## Decision

**Delivery implies `commit` and `push`, and the handoff gate enforces it.**
`specs/handoff.md`'s `completed_stories` is this repository's own statement that
a Story reached `main`. A Story listed there whose Authority declares
`commit: no` or `push: no` fails `bun run forgeflow:check`, with the message
naming both exits: correct the declaration, or stop recording the Story as
completed.

**Only those two.** `deploy`, `migration`, `add_dependency`, `plan` and `modify`
are unconstrained by delivery, and a delivered Story may still truthfully declare
`deploy: no`. Extending the check to them would be inventing implications the
contract explicitly denies.

**The eight existing declarations are corrected rather than explained.** The
usual rule here is that a record a human approved is not rewritten to tidy it up
— DBCLI-021 refused exactly that. This is not that case: `push: no` was never a
statement anyone made about those Stories, so correcting it destroys no decision.
The discrepancy was first recorded in prose in `specs/handoff.md` and left
unfixed on that reasoning; the 8-of-8 measurement is what changed the answer.

## Consequences

A Story authored today declares `commit: yes` and `push: yes` when it is expected
to be delivered as a pull request, which is every Story in this repository so far.
One that genuinely must not push — an inspection or review Story that changes
nothing — declares `push: no` and simply is not recorded as completed while that
holds, which is the same thing the gate is saying.

The gate is offline and reads two files. It needs no git history, so it behaves
the same in a shallow CI clone as it does locally — the failure mode that the
sibling trailer reconciliation has to guard against explicitly.

**Falsified if:** delivery stops implying a pushed branch — if Stories reach
`main` by some route that does not require `commit` and `push` — then
`reconcileDeliveryAuthority` in `scripts/lib/forgeflow-handoff.ts` is asserting
an implication that no longer holds and must be narrowed or removed.
