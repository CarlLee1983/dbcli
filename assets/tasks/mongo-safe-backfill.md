---
name: mongo-safe-backfill
description: Plan a safe MongoDB backfill/update with blacklist, sampled-schema and dry-run checks before any write.
tags: [data, write, safety]
engines: [mongodb]
params:
  collection:
    type: string
    required: true
    description: The collection the backfill writes to (exact name; confirm via `dbcli list`).
  filter:
    type: string
    required: true
    description: JSON filter selecting the documents to update (Mongo `--where`, e.g. '{"status":"pending"}').
  set:
    type: string
    required: true
    description: JSON update document (`--set`; auto-wrapped as $set when it has no $ operator).
safety:
  mode: plan-only
  requires:
    - blacklist.manage
    - schema.read
steps:
  - type: command
    command: blacklist list
    reason: Confirm the target collection and its fields are not protected before planning a write.
    risk: readonly
  - type: command
    command: schema {{collection}} --format json
    reason: Verify the exact sampled dot-path fields and types the backfill will touch.
    risk: readonly
  - type: command
    command: update {{collection}} --where '{{filter}}' --set '{{set}}' --dry-run
    reason: Preview the update as a shell-style plan; --dry-run connects but never writes.
    risk: dry-run
---
# Agent Notes

Use this task when a user wants to backfill or correct existing MongoDB documents. It only
PLANS — it never writes. MongoDB has no static SQL risk analyzer, so the preview is
`dbcli update ... --dry-run` (which prints a shell-style plan and writes nothing) rather
than `dbcli plan`.

Mongo specifics to respect:
- `--where` takes a **full JSON filter** (`'{"status":"pending"}'`), not `col=val`.
- `--set` is a **JSON document**; a plain object is auto-wrapped as `$set`, while explicit
  operators (`$set` / `$inc` / `$push` / …) pass through untouched.
- Blacklisted fields accept dotted paths (`profile.email`) and trailing wildcards
  (`profile.tokens.*`); confirm the write does not touch a protected path.

After reviewing the dry-run preview, scope the change with a read-only find on the same
filter first (`dbcli query '<filter>' --collection <collection> --format json`), then
re-run the update **without** `--dry-run` to execute (requires read-write or higher). Read
the documents back afterwards to confirm the write achieved its goal; explain any mismatch
via schema validators, defaults, or blacklist redaction.
