---
status: accepted
date: 2026-08-04
---

# Documentation source of truth and lifecycle

The project uses scoped sources of truth: code and tests define actual behavior,
active specs and user documentation define the current product contract, ADRs
capture durable rationale, and completion evidence proves a plan or spec is
finished. Completed implementation plans move to `docs/plans/done/`, while
design records remain in place with their current implementation, evidence, and
known deviations appended rather than rewriting the historical design.

## Considered options

- Keep every plan permanently active and treat its checklist as the current
  implementation state.
- Use one document as the permanent authority for behavior, contract, rationale,
  and completion state.
- Use scoped authority and explicit lifecycle states.

The third option was selected because the first two allowed stale plans to
contradict shipped behavior and made historical rationale difficult to preserve.

## Consequences

- Statuses must be evidence-based: `Draft`, `Ready for implementation`,
  `Implemented — retained as a design record`, `Deferred — <reopen trigger>`,
  or `Superseded by <document>`.
- A completed document records commits, checks, and remaining risks instead of
  relying on historical step checkboxes.
- GitHub issue and pull-request links provide traceability but do not, by
  themselves, prove that remote work is closed.
