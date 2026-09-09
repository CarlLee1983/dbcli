# Upstream ForgeFlow's checkers are run, not reimplemented

* Status: accepted
* Date: 2026-09-08

DBCLI-018 moved the adopted contract from 0.3.2 to 0.6.0, which brings
Authority, Risk, Task mode and an Acceptance Evidence map. Each is enforced by
an upstream checker and by nothing else, and those checkers live in a ForgeFlow
checkout this repository does not contain. So the version bump on its own would
have changed what a Story is permitted to say and nothing about what is checked
— an adoption that exists only as a number, which is the shape DBCLI-013 and
DBCLI-016 each had to close after the fact.

One of the four is not closed by this decision, and saying so is the point of
this paragraph. Authority, Risk and Task mode are checked in `story-check`'s
default mode, which is the mode CI runs. The Acceptance Evidence map is a
readiness check: it runs only under `story-check --ready`, along with checkbox
AC identifiers, Goal and Scope. This gate does not pass `--ready`, so Acceptance
Evidence is available to authors and enforced by nobody — including in
DBCLI-018's own Story, which fails `--ready` on exactly those two findings.
Turning `--ready` on is a decision about every future Story and a second
exemption set for the twenty-five that predate it; it is named out of scope in
the Story rather than left to be discovered.

Two ways to close it. Reimplement the rules in `scripts/`, offline, inside
`make verify` — the shape of every other gate here. Or fetch the adopted
revision in CI and run upstream's own checkers.

Reimplementation was refused. `scripts/lib/forgeflow-handoff.ts` states in its
header that it "deliberately does not overlap upstream's `story-check`", and
that boundary is why the two gates have stayed small and stayed true: one checks
what this repository claims about itself, the other checks structure. Writing a
second implementation of a contract this repository does not own would put those
two on diverging schedules, and the copy would be the one nobody updates.

So CI clones ForgeFlow at the revision `specs/.forgeflow-adoption` records and
runs `story-check` and `handoff-check` through
`scripts/check-forgeflow-contract.ts`. The revision is part of the check: a
checkout at any other one is refused, because a different ForgeFlow enforces a
different contract, and because an upgrade must not be able to land half-done
with the marker moved and the rules still the old ones. An absent checkout is
refused rather than skipped, for the reason the sibling gate refuses a shallow
clone — a gate that passes wherever its evidence is missing passes in CI and
nowhere else.

It is a CI job and not a `make verify` step. The canonical gate has to run from
a clone of this repository alone, and it has to run offline; a step that needs a
second checkout and a network fetch would make `make verify` describe a machine
rather than a checkout. The two offline ForgeFlow gates stay where they are.

## The twenty-one admitted findings

Five delivered Stories fail upstream `story-check`, on findings that failed
identically under 0.3.2 — the upgrade caused none of them, and nothing had ever
run the checker. They are listed exactly, per Story, as a ratchet that may
shrink and never grow: a new finding fails, a fixed one fails as a stale entry,
and any Story without an entry must be clean.

Listing them rather than fixing them is deliberate. Sixteen are matrix cells
whose real values have to be re-derived from the code they describe, and all of
them are edits to acceptance text a human already accepted — a change to the
record, not a formatting pass. That is its own Story. What this decision buys is
that the debt is bounded and visible instead of unknown.

**Falsified if:** the exemption list grows, or a rule from upstream's contract
is reimplemented in `scripts/` rather than run from a checkout. The first means
the gate has become a list of things it has agreed not to check; the second
means there are two answers to what a Story must contain, and the repository has
started maintaining the one it does not own.
