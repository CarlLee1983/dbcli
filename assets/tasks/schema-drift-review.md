---
name: schema-drift-review
description: Detect drift between the cached/committed schema and the live database for one table.
tags: [diagnostics, schema, readonly]
engines: [postgres, mysql]
params:
  table:
    type: string
    required: true
    description: The table to compare against its cached schema (exact name; confirm via `dbcli list`).
safety:
  mode: plan-only
  requires:
    - blacklist-list
    - schema-check
steps:
  - type: command
    command: blacklist list
    reason: Confirm the table is inspectable and not protected before reading its schema.
    risk: readonly
  - type: command
    command: doctor
    reason: Report the schema-cache age so a stale cache can be ruled out as the cause of drift.
    risk: readonly
  - type: command
    command: schema {{table}} --format json
    reason: Pull the current live schema to diff against the cached/committed definition.
    risk: readonly
---
# Agent Notes

Use this task when a migration may have landed out of band, or a query fails on a
column that "should" exist. Compare the live `schema {{table}}` output against the
`schema` block committed in the `.dbcli` config (or the cached snapshot). If they
disagree, the cache is stale or the live DB drifted — surface the specific column
differences. Do not run write operations or DDL. Refresh the cache before acting on a
stale snapshot.
