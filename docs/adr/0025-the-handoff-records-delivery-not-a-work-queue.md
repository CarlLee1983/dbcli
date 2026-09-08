---
status: proposed
date: 2026-09-08
---

# The handoff records delivery, not a work queue

`specs/handoff.md` stops stating which Story is current and which is next.
ForgePilot is the only component that answers those two questions. The handoff
keeps what ForgePilot structurally cannot hold: the narrative of why decisions
were made, the risks and assumptions left for the next reader, the repository
baseline, and `completed_stories` — the delivery record that
`bun run forgeflow:check` reconciles against `Story:` commit trailers.

The split is not a preference between two places to write the same thing. It
follows from where each fact can be true. Actionable-next is a function of
dependency edges, gates and evidence that change between commits; recorded in a
committed file it is stale the moment it is written, and it was. Delivery is a
property of git history; ForgePilot cannot hold it, because `.forgepilot/` is
gitignored and twenty-one of the twenty-three delivered Stories predate the
queue entirely.

The duplication had already failed by the time this was written. Measured at
`141cf4c3`, the handoff recorded `current_story: pending` and
`next_story: pending`; upstream `handoff-check` rejects that under both the
adopted 0.3.2 and the current 0.6.0, along with a `verification.detail` key the
contract does not define. Nothing in `make verify` saw it, because upstream's
checkers live in a ForgeFlow checkout CI does not have. The half of the block
that nothing reads is exactly the half that drifted.

Enforcement is a gate rather than a convention. `scripts/lib/forgeflow-handoff.ts`
refuses a handoff that names a current or next Story, and refuses lifecycle keys
outside the adopted contract. A convention would have to be re-argued by every
agent that reads the ForgeFlow handoff template and finds fields to fill in;
the refusal answers once, with a message naming ForgePilot as where that state
belongs. The `workflow:`, `baseline:` and `verification:` sections stay, with
the contract's own sentinels for "no Story is stated" — this repository declares
it adopted ForgeFlow, and quietly deleting required sections would make that
declaration false.

The decision costs one thing worth naming: a reader with no ForgePilot installed
can no longer learn from the repository what is being worked on. That is
accepted, because the answer they were getting was wrong. Verification is
unaffected — cloning dbcli and running `make verify` never needed ForgePilot and
still does not.

**Falsified if:** `bun run forgeflow:check` in `scripts/lib/forgeflow-handoff.ts`
stops being able to decide the delivery record from git alone — because it needs
to read ForgePilot state, reach the network, or require a ForgeFlow checkout — or
if a second component in this repository starts recording which Story is current
in a file under `specs/`. Either means the boundary in `AGENTS.md` no longer
describes the system, and the state this decision separated has merged again.
