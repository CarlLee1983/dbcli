# Stories

This repository follows Warrant; the contract is the `## Warrant` section of
`AGENTS.md`, and the reasons are in ADR-0040.

A Story is a single file, `specs/stories/<slug>.md`, with a `# Title` heading
followed by exactly three sections: **Goal**, **Out of Scope**, and
**Acceptance Criteria**. It carries no status, owner, priority, or lifecycle
field. Each acceptance criterion is one statement that can be checked by
running something or looking at something.

A Story is approved only when a human commits it to the default branch, or
explicitly assigns it in the current session. A Story an agent drafted or
committed itself is not approved, and approval is not a work queue: the human,
through ForgePilot, chooses which Story to do.

Completion is proven by `make verify`, together with an observation for every
acceptance criterion. Passing makes work eligible for human review; it does not
approve or merge it.

The existing `DBCLI-*` directories, `SCENARIO-MAP.md`, and `specs/handoff.md`
are legacy records from the earlier protocol, not pending work. They stay as
they are because tests still read them.
