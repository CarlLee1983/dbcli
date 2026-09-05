---
name: slow-endpoint-investigation
description: Connect proxy, explain and missing-index evidence to investigate a slow endpoint's query.
tags: [diagnostics, performance, readonly]
engines: [postgresql, mysql]
params:
  query:
    type: string
    required: true
    description: The suspected slow SQL statement behind the endpoint (not executed by this task).
  table:
    type: string
    required: true
    description: The exact table the local observation points at (confirm via `dbcli list`).
safety:
  mode: plan-only
  requires:
    - blacklist.manage
steps:
  - type: command
    command: blacklist list
    reason: Confirm sensitive tables and columns are protected before inspecting query internals.
    risk: readonly
  - type: command
    command: proxy analyze --format json
    reason: Aggregate observed slow queries and N+1 patterns from the local proxy event log.
    risk: readonly
  - type: command
    command: schema {{table}} --format json
    reason: Confirm the selected table's live columns and indexes before reading a plan or index advice.
    risk: readonly
  - type: command
    command: explain "{{query}}"
    reason: Inspect the query plan for the suspected statement without running it for effect.
    risk: readonly
  - type: command
    command: guide missing-index-for "{{query}}" --format json
    reason: Get advisory index candidates that could remove the slow scan.
    risk: readonly
---
# Agent Notes

Use this task when an endpoint is slow and you want evidence, not guesses. Start from
`proxy analyze` (requires that the local observability proxy has captured traffic) to
find the hottest query/table, confirm that table's live shape with `schema` before
reading anything into a plan, then `explain` the statement and review
`guide missing-index-for` candidates.

Everything here is a lead, not a cause. A proxy finding is what was observed locally,
not proof of what makes the endpoint slow, and an index candidate is not a fix that has
been shown to work. Index advice is ADVISORY: do not create indexes directly — route any
proposed index through the `migration-review` pack first, then verify before/after with
`snapshot`/`assert` or `report --section perf` deltas.
