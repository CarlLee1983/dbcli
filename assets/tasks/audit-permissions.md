---
name: audit-permissions
description: Audit the active permission tier and blacklist coverage before granting an agent write access.
tags: [security, permissions, readonly]
engines: [postgresql, mysql]
params:
  table:
    type: string
    required: false
    description: Optional table to spot-check column-level blacklist coverage (exact name; confirm via `dbcli list`).
safety:
  mode: plan-only
  requires:
    - blacklist.manage
steps:
  - type: command
    command: status
    reason: Read the current permission tier and connection summary (no credentials).
    risk: readonly
  - type: command
    command: blacklist list
    reason: Enumerate every protected table and column so sensitive data is accounted for.
    risk: readonly
  - type: command
    command: guide permissions --format json
    reason: Get the deterministic next-step plan for reviewing what the current tier allows.
    risk: readonly
---
# Agent Notes

Use this task before widening an agent's access (e.g. query-only → read-write) or
when a user asks "what can this connection touch?". Confirm the permission tier is
the minimum required and that every sensitive table/column already appears in the
blacklist. Do not run write operations. If a `table` is supplied, follow up with
`dbcli schema {{table}} --format json` to verify no sensitive column is exposed.
