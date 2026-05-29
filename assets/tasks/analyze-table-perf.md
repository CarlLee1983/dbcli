---
name: analyze-table-perf
description: Inspect a single table's structure, indexes and read-only performance signals.
tags: [diagnostics, performance, readonly]
engines: [postgres, mysql]
params:
  table:
    type: string
    required: true
    description: The table to analyze (exact name; confirm via `dbcli list`).
safety:
  mode: plan-only
  requires:
    - blacklist-list
    - schema-check
steps:
  - type: command
    command: blacklist list
    reason: Confirm sensitive tables and columns are protected before inspection.
    risk: readonly
  - type: command
    command: schema {{table}} --format json
    reason: Inspect the table's columns and existing indexes.
    risk: readonly
  - type: command
    command: guide index-usage --format json
    reason: Review index-usage guidance to spot missing or unused indexes.
    risk: readonly
---
# Agent Notes

Use this task when a table shows up as the hottest target in recent activity and
you want safe, read-only next steps to assess its performance characteristics.
Do not run write operations. For a single heavy query, prefer
`dbcli guide missing-index-for "<sql>"` instead.
