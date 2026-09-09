# Delivery does not record who performed it

* Status: accepted
* Date: 2026-09-09
* Supersedes: ADR-0030

[ADR-0030](ADR-0030-a-permission-nobody-filled-in-is-not-a-control.md) decided
that delivery implies `commit` and `push`, and had the handoff gate fail any
Story in `completed_stories` declaring either as `no`. That rule is removed.

The measurement ADR-0030 rests on is still accurate: eight of eight Stories that
had ever declared `## Authority` declared `push: no`, three also declared
`commit: no`, and all eight reached `main` through a merged pull request. What it
got wrong is what follows from that. `completed_stories` records that a Story was
delivered. It records nothing about **who** performed each operation, and the
ordinary division of labour in this repository is precisely the case the rule
refuses: an agent is granted `modify` and at most a local `commit`, and a human
commits, pushes, opens the pull request and merges it. The delivery is real and
the agent's `push: no` was true the whole time.

ADR-0030 wrote its own falsification condition as *delivery stops implying a
pushed branch*. Delivery does still imply a pushed branch. It never implied the
**agent** pushed, and that is the step the rule was actually making.

A second symptom points the same way. Upstream ForgeFlow's Execution Contract
(`protocol/execution.md`, revision `cb4bc97673ad3098a4689a1589e1f2c4b5175c63`,
the revision `specs/.forgeflow-adoption` pins) defaults every operation but
`plan` and `modify` to `no`, and states in one sentence that *being able to
commit, push, deploy, add a dependency, or run a migration is never authorization
to do it*. So an omitted `push:` says what an explicit `push: no` says. The
removed rule failed the explicit spelling and passed the omission — one claim,
two verdicts, with the lenient one available to anyone who deleted a line.

## Decision

**The handoff gate reconciles delivery claims and derives no permission from
them.** `scripts/lib/forgeflow-handoff.ts` reads no `## Authority` section, and
`scripts/check-forgeflow-handoff.ts` calls nothing that does. A Story recorded as
completed while declaring `commit: no` or `push: no` passes: a human performing
the operation is a supported flow, not a discrepancy.

**Everything else in that gate stays.** Story-directory existence, `Story:`
trailer evidence, the `DELIVERED_BEFORE_TRAILERS` ratchet, the shallow-clone
refusal and the lifecycle structure checks are unchanged, and each keeps a test
that fails if it goes. The lesson DBCLI-027 was right about — a declaration
nothing compares to anything is not a control — was never a lesson about
Authority; it is what those rules already do.

**Authority stays upstream's.** Its format, its defaults and which combinations
are legal are checked by `bun run forgeflow:contract` against the adopted
revision. Whether a declaration is *true* is Human Review's question, and this
repository builds no second authorization parser, identity store or approval
database to answer it.

**The eight rewritten declarations are left as they stand, and what is
unconfirmed about them is recorded here.** ADR-0030 changed `push: no` to
`push: yes` in DBCLI-019 to DBCLI-026, and `commit: no` to `commit: yes` in
DBCLI-019, DBCLI-020 and DBCLI-021, on the inference this record withdraws. No
approval record was found that states, per operation, what those Stories granted
their implementing agent. Reverting them would be the same error mirrored —
inferring a withheld permission from the absence of evidence — so they are not
reverted. Only an approval record can correct a historical declaration; a merge
or a push is not one.

## Consequences

A Story declares what its implementing agent may do, which for an agent that
hands its branch to a human is `commit: yes, push: no` or `commit: no, push: no`.
Such a Story is delivered like any other, and the gate no longer objects.

DBCLI-028 was authored that way and then changed: it was implemented and verified
under `push: no`, and the human granted `push` to open the pull request, so its
declaration says `push: yes`. That is the correction mechanism this record names
working as intended — a permission moves because someone who can grant it granted
it, not because a branch turned out to be pushed.

Nothing now compares an Authority declaration to anything, which is the state
ADR-0030 objected to. That objection was right in general and had the wrong
subject: this repository cannot observe who ran a command, so a gate here can
only guess, and a gate that guesses is worse than an unchecked declaration
because its verdict looks like evidence. Human Review is where the question is
answerable, and the ForgeFlow contract already puts it there.

**Falsified if:** this repository acquires a record that attributes an operation
to an actor — a signed commit policy, a CI-enforced push identity, or an approval
log naming who was granted what. Then `scripts/lib/forgeflow-handoff.ts` can
compare an Authority declaration against something real instead of against the
fact of delivery, and the question this record closes is open again on evidence
rather than on inference.
