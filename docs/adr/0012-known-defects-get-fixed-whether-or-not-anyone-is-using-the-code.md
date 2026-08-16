---
status: accepted
date: 2026-08-16
supersedes: 0011
---

# Known defects get fixed whether or not anyone is using the code

[ADR-0011](0011-evidence-subsystem-waits-for-a-user-before-it-is-repaired.md)
made repair of the evidence subsystem's four known defects conditional on
evidence that someone was using it. The condition was met on 2026-08-16 and the
question became live rather than theoretical. It is now settled the other way,
permanently: a defect that is known is repaired, and how many users it currently
has is not part of the decision.

## Decision

Fix the four deviations recorded in ADR-0011, and treat "nobody is using this
yet" as irrelevant to whether a known defect gets repaired. Usage may set
priority. It does not decide whether the work happens.

Where a deviation exists because a schema promises something the code cannot
produce, the repair may change the schema. The evidence-pack format is amended
in place rather than versioned forward: it has no users to keep compatible, and
carrying a compatibility layer for a format nobody has stored would be the same
speculative construction that produced these defects.

## Why the earlier decision was wrong

ADR-0011 argued that an unused subsystem cannot tell us which of its defects
matter, and that repairing all four spends effort at the moment we know least.
Both sentences are true and neither supports the conclusion drawn from them.

A defect that is recorded and left in place does not stay neutral. It becomes
documentation: the `value ==` comparison bug found during the same dogfood had
been written into `assets/reference.md` as a casting note, teaching users to
work around it. That is what a known-and-unrepaired defect turns into given
enough time — not a tracked item, but a described feature. The cost of waiting
is not zero, it is just deferred and disguised.

The second failure was of framing. Deciding repair by usage assumes usage is
observable and that "nobody uses it" is a stable fact rather than a snapshot of
one afternoon. It also invites the reading that correctness is a service level
offered to users who show up, which is not a position this project wants to
hold for a tool whose entire promise is that its output can be trusted.

## Repair status

Two of the four are tracked as acceptance criteria in the ticket backlog and
carry their annotation there. The other two exist only in ADR-0011's list, so
they are tracked here.

- `coverage.gaps` dead schema surface — repaired 2026-08-16; the field is gone.
- Pack digest not reproducible — repaired 2026-08-16; the digest covers content
  and the id derives from it.
- Blacklist substring matching over prose — repaired 2026-08-16; terms match as
  identifiers, the columns map's keys are included, and the refusal names the
  field rather than the term.
- `observation.fingerprint` unsalted over a low-entropy value — repaired
  2026-08-16; the field is replaced by the observation stated plainly, which is
  less than the digest leaked to anyone who inverted it.

## Consequences

- Each of the four deviations gets its own change, with the ticket annotation in
  `docs/plans/2026-08-08-agent-data-evidence-and-change-intelligence-ticket-backlog.md`
  updated in the same change, as ADR-0011's falsification condition requires.
- `— known deviation:` in a plan is a statement about the present, not a
  permanent exemption. A deviation that is not being repaired needs a reason
  that is not "no one has hit it yet".
- The evidence-pack schema changes without a version bump. Any pack written
  before this change fails validation, which is correct: its digest was computed
  under rules that no longer hold.
- ADR-0011 keeps its record of what the dogfood found. Only its decision clause
  is superseded.

**Falsified if:** a defect in `docs/plans/` is annotated
`— known deviation:` with a justification that rests on the code having no
users, or ADR-0011's four deviations are still unrepaired when the backlog
stops naming them.
