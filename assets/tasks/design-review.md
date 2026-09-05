---
name: design-review
description: Validate and render a version-controlled SQL database design before comparing it with the local schema cache and preparing review-only proposals.
tags: [design, schema, readonly]
engines: [postgresql, mysql]
safety:
  mode: plan-only
  requires:
    - blacklist.manage
    - schema.read
steps:
  - type: command
    command: blacklist list
    reason: Confirm sensitive-data boundaries before reading cached schema details or preparing migration review.
    risk: readonly
  - type: command
    command: design validate --format json
    reason: Fail closed on incomplete keys, invalid relationships, and unsafe indexes before the design is used.
    risk: readonly
  - type: command
    command: design render --format mermaid
    reason: Produce a reviewable ERD from the validated local artifact.
    risk: readonly
  - type: command
    command: schema --format json
    reason: Refresh the local SQL schema cache before comparing an existing database with the target design.
    risk: readonly
  - type: command
    command: design diff --against-cache --format markdown
    reason: Report columns, indexes, and foreign keys that differ without opening a new connection or executing DDL.
    risk: readonly
  - type: command
    command: design propose --against-cache --format markdown
    reason: Prepare only dry-run proposals or migration-review escalations with preflight, rollback, and verification reminders.
    risk: readonly
---
# Agent Notes

`dbcli.design.json` is a review artifact, not an execution request. Do not add
`--execute` to any command in this plan. If a design differs from the cache,
review the drift and prepare an explicit migration separately; this task neither
creates a migration nor applies one.
