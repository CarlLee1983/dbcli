# A delivery records itself

* Status: accepted
* Date: 2026-09-09

`specs/handoff.md`'s `completed_stories` was reconciled in one direction: every
recorded Story must have a `Story:` commit trailer or a
`DELIVERED_BEFORE_TRAILERS` entry. That direction cannot catch an omission, so
the list could only rot toward being incomplete — and did, twice.

* DBCLI-027 found DBCLI-022 to DBCLI-026 delivered, merged and approved, with
  none of them recorded.
* Reconciling DBCLI-028's own delivery found that DBCLI-027 had left **itself**
  out of the same list it had just repaired.

Both were found because a human happened to look. Neither entry was ever false;
nothing had asked for them, which is this repository's recurring failure shape
seen from the side that has no gate.

## Decision

**The reconciliation runs in both directions.** A Story whose `Story:` trailer
is reachable from `HEAD`, and which has a `specs/stories` directory, must appear
in `completed_stories`. Absent, it fails `bun run forgeflow:check` by name.

**One history for both directions.** The forward rule read trailers from
`git log --all`; the reverse rule cannot, because an unmerged branch's trailers
would demand handoff entries for Stories this tree has not delivered. Both now
read `git log HEAD` — the checkout in hand, which is the same set locally and in
CI, where `pull_request` checks out the merge commit. Two scopes for one
comparison would rebuild the split verdict ADR-0031 removed.

**The entry is written in the change that delivers the Story**, not after the
merge. That is the whole point of the timing: the trailer and the entry arrive
in the same commit or the same pull request, so every commit carrying a trailer
is green, and the recording cannot be the step that gets forgotten — it is the
step that makes the gate pass.

The cost is that the handoff states a delivery slightly before the merge makes
it true. That is bounded and self-correcting: an unmerged branch's entry dies
with the branch, and the forward rule still demands the trailer that the entry
claims. Recording after the merge is the alternative, and it is what produced
both omissions; it also leaves `main` red between the merge and the follow-up.

**A trailer naming a Story with no `specs/stories` directory is not reported.**
`DBCLI-PLAT-008`, `DBCLI-PLAT-009` and `DBCLI-PLAT-010` were accepted against
issues rather than Stories. Demanding a handoff entry for a Story this
repository does not contain would be inventing one rather than reconciling one.

## Consequences

Delivering a Story now has one more mechanical step, and it is enforced rather
than remembered. Work that predates this record is unaffected: the reverse rule
is green on `main` at `2594c2c6` with no edit to `completed_stories`, which is
the check that it describes what this repository has actually done rather than
what it wishes it had.

There is one uncomfortable window, and it is worth naming rather than
discovering: between writing the entry and making the commit that carries the
trailer, the working tree fails the forward rule — the handoff records a Story
no commit has claimed yet. It closes when the commit lands. The alternative
order fails the other way, so one of the two is red for as long as it takes to
commit, and this is the one where the fix is the next thing you were going to
do anyway.

The shallow-clone refusal becomes load-bearing for a second reason. Without
trailers, the forward rule failed every recorded Story; the reverse rule would
now report every Story in the repository instead. Both are the same wrong answer
from missing evidence, and the refusal still comes first.

**Falsified if:** Stories stop being delivered as commits carrying `Story:`
trailers — a different delivery record, or a repository where the trailer is no
longer the evidence — then the reverse rule in
`scripts/lib/forgeflow-handoff.ts` is demanding entries against a signal that no
longer means delivery, and must be re-pointed at whatever does.
