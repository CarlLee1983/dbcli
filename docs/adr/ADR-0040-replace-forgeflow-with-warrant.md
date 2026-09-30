# Replace ForgeFlow with Warrant

* Status: accepted
* Date: 2026-09-30

This repository specified work with ForgeFlow: a Story was a directory holding
`story.md`, `acceptance.md` and an optional `task.md`, copied from a template,
checked by upstream's own checkers pinned to an adopted revision, and delivered
by a `Story:` commit trailer reconciled against the handoff's
`completed_stories`. Around that protocol this repository grew its own gates and
the records that justify them:
[ADR-0025](ADR-0025-the-handoff-records-delivery-not-a-work-queue.md) (the
handoff records delivery, not a work queue),
[ADR-0027](ADR-0027-upstream-forgeflow-checkers-are-run-not-reimplemented.md)
(upstream's checkers are run, not reimplemented),
[ADR-0029](ADR-0029-decision-records-are-named-so-the-contract-can-resolve-them.md)
(decision records are named so a Story's `Decision:` field resolves),
[ADR-0031](ADR-0031-delivery-does-not-record-who-performed-it.md) (delivery does
not record who performed it),
[ADR-0032](ADR-0032-a-delivery-records-itself.md) (a delivery records itself)
and [ADR-0036](ADR-0036-the-handoff-carries-what-has-no-other-home.md) (the
handoff carries what has no other home).

Every one of those decisions is about maintaining the protocol rather than
about dbcli. Keeping the adoption marker, the template, the upstream contract
job, the trailer reconciliation and the handoff's structure consistent with
each other cost a gate in `make verify`, a second CI checkout, three checker
entry scripts with their `scripts/lib/` libraries and tests, and a section of
`AGENTS.md` an agent had to read before doing any work.

## Decision

**Work is specified with Warrant, with no compatibility layer.** A Story is one
file, `specs/stories/<slug>.md`, with exactly Goal, Out of Scope and Acceptance
Criteria. It is approved when a human commits it to the default branch or
explicitly assigns it in the current session, and completion is proven by
`make verify`. The contract lives in the `## Warrant` section of `AGENTS.md`.

**ForgePilot stays the control plane.** It still decides what is actionable
next, still runs `make verify` against an exact commit, and still has no
completion command. Only the protocol it points at changes.

**The ForgeFlow machinery is removed, not disabled.** The adoption marker, the
Story template, the `story-development` skill, the `forgeflow:check` and
`forgeflow:contract` scripts with their libraries and tests, the
`forgeflow-contract` CI job, and the integration job's full-history checkout
that only existed to read `Story:` trailers are all deleted. Commits no longer
carry a `Story:` trailer.

**The history stays as it was.** The `specs/stories/DBCLI-*` directories,
`specs/stories/SCENARIO-MAP.md` and `specs/handoff.md` are legacy records, not
pending work; they are left byte-identical because other tests still read them.
ADR-0025, ADR-0027, ADR-0029, ADR-0031, ADR-0032 and ADR-0036 are superseded by
this record and keep their bodies. The attestation decisions (ADR-0026,
ADR-0033) are unaffected: ForgePilot still reads the attestation `make verify`
writes.

## Consequences

Nothing now reconciles a delivery claim against commit trailers or checks a
Story's structure mechanically. A Story's shape is checked by the human who
approves it, and whether it is done is checked by `make verify` and Human
Review. Decision records still live in `docs/adr/`, but their file name no
longer has to satisfy a resolver.

**Falsified if:** make verify in `Makefile` starts running a check that
validates the structure or approval of Stories under `specs/stories/`, or reads
commit trailers, or the Warrant section of `AGENTS.md` stops naming make verify
as the verification command. Either means a second
protocol has grown back beside Warrant, and this record no longer describes how
work here is specified and proven.
