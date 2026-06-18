---
name: safe-backfill
description: Plan a safe data backfill/UPDATE with blacklist, schema and risk checks before any write.
tags: [data, write, safety]
engines: [postgres, mysql]
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
    - blacklist-list
    - schema-check
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
PLANS — it never writes. After reviewing the plan, run the real backfill manually in
two steps: first `dbcli update ... --dry-run` (or `dbcli query "<sql>" --dry-run`) to
preview the generated SQL, then re-run with `--execute` only once the dry-run looks
correct. Prefer a narrow `WHERE` clause and verify the affected row count with a
read-only `SELECT count(*)` before writing. Requires read-write (or higher) permission
to actually execute.
