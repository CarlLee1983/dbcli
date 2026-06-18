---
name: safe-backfill-verify
description: Plan a safe backfill/UPDATE and a read-back assertion that verifies the write achieved its goal.
tags: [data, write, safety, verification]
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
  verify_query:
    type: string
    required: true
    description: A read-only SELECT (typically count(*)) that proves the backfill's outcome.
  expect:
    type: string
    required: true
    description: The assertion expression for `assert --expect`, e.g. "rows == 0" or "value > 0".
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
  - type: command
    command: assert "{{verify_query}}" --expect "{{expect}}"
    reason: Read-back verification — confirm the backfill achieved its goal after the write.
    risk: readonly
---
# Agent Notes

Use this task when a backfill must be both safe and provably correct. This task only
PLANS — the execution sequence the agent runs manually is:

1. Review the `plan "{{query}}"` output and confirm a narrow `WHERE` clause.
2. Capture the scope: run `assert "{{verify_query}}" --expect "{{expect}}"` BEFORE the
   write to record the starting count (or run the SELECT directly), so the expected
   delta is known.
3. Preview the write with the matching write command, for example
   `dbcli update <table> --where "<predicate>" --set '<json>' --dry-run`. Keep raw
   SQL in `plan "{{query}}"`; `query` does not dry-run arbitrary writes.
4. Execute once the dry-run looks correct: re-run the write command without `--dry-run`
   and with the required confirmation/force flag for your environment.
5. Verify: re-run `assert "{{verify_query}}" --expect "{{expect}}"` AFTER the write.
   `verified` means the read-back matched; anything else means stop and recover.

Requires read-write (or higher) permission to actually execute the write.
