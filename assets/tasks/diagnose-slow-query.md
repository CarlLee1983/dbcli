---
name: diagnose-slow-query
description: Diagnose slow query causes using safe read-only dbcli steps.
tags: [diagnostics, performance, readonly]
engines: [postgres, mysql]
params:
  query:
    type: string
    required: true
    description: The slow SQL query or query fingerprint to inspect.
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
    command: plan "{{query}}"
    reason: Analyze SQL risk without executing the query.
    risk: readonly
  - type: command
    command: q @diag/long-running --format json
    reason: Inspect active long-running queries through a saved diagnostic snippet.
    risk: readonly
---
# Agent Notes

Use this task when the user reports a slow SQL query and wants safe diagnostic next steps.
Do not run write operations.
