---
name: migration-review
description: Capture pre-change schema evidence and preview a migration's DDL before it is applied.
tags: [migration, schema, readonly]
engines: [postgres, mysql]
params:
  table:
    type: string
    required: true
    description: The table the migration alters (exact name; confirm via `dbcli list`).
  ddl:
    type: string
    required: true
    description: The migration DDL statement to preview (not executed by this task).
safety:
  mode: plan-only
  requires:
    - blacklist-list
    - schema-check
steps:
  - type: command
    command: blacklist list
    reason: Confirm the migration's target table and columns are not protected before previewing changes.
    risk: readonly
  - type: command
    command: schema {{table}} --format json
    reason: Capture the pre-change live schema as evidence to diff against after the migration lands.
    risk: readonly
  - type: command
    command: plan "{{ddl}}"
    reason: Preview the migration DDL's risk and scope without executing it.
    risk: readonly
---
# Agent Notes

Use this task before applying a schema migration. It only PLANS — it never runs DDL.
Save the pre-change `schema {{table}} --format json` output as the baseline. After the
migration is applied (out of band, via your migration tool), re-run
`schema {{table}} --format json` and diff the two to confirm the change matches intent.
Always prepare and record an explicit rollback statement before applying. Requires
data-admin permission to actually run DDL — this task does not grant it.
