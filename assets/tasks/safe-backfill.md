---
name: safe-backfill
description: Plan a safe data backfill/UPDATE with blacklist, schema and risk checks before any write.
tags: [data, write, safety]
engines: [postgresql, mysql]
params:
  table:
    type: string
    required: true
    description: The table the backfill writes to (exact name; confirm via `dbcli list`).
  query:
    type: string
    required: true
    description: The backfill UPDATE statement to analyze (not executed by this task).
safety:
  mode: plan-only
  requires:
    - blacklist.manage
    - schema.read
steps:
  - type: command
    command: blacklist list
    reason: Confirm the target table and its columns are not protected before planning a write.
    risk: readonly
  - type: command
    command: schema {{table}} --format json
    reason: Verify the exact column names and types the backfill will touch.
    risk: readonly
  - type: command
    command: plan "{{query}}"
    reason: Analyze the UPDATE's risk and scope without executing it.
    risk: readonly
---
# Agent Notes

Use this task when a user wants to backfill or correct existing rows. This task only
PLANS — it never writes. After reviewing the plan, run the real backfill manually:

1. Confirm a narrow `WHERE` clause and capture its scope with a read-only
   `SELECT count(*)` before writing.
2. Preview the structured write with
   `dbcli update <table> --where "<predicate>" --set '<json>' --dry-run`.
   Keep raw SQL writes in `dbcli plan "<sql>"`; `query` does not dry-run arbitrary writes.
3. Once the preview looks correct, re-run the write command without `--dry-run`
   and with the required confirmation/force flag for your environment. The existing
   write gate still applies; execution requires read-write (or higher) permission.
4. Read the rows back afterwards to confirm the backfill achieved its goal. If the
   result does not match, stop and investigate before attempting another write.
