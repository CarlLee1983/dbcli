---
name: mongo-schema-drift-review
description: Detect drift between the cached sampled schema and the live collection for one MongoDB collection.
tags: [diagnostics, schema, readonly]
engines: [mongodb]
params:
  collection:
    type: string
    required: true
    description: The collection to compare against its cached schema (exact name; confirm via `dbcli list`).
  sample_size:
    type: number
    default: 200
    description: Documents to sample; raise it to reduce sampling-driven false positives in drift detection.
safety:
  mode: plan-only
  requires:
    - blacklist.manage
    - schema.read
steps:
  - type: command
    command: blacklist list
    reason: Confirm the collection is inspectable and not protected before reading its schema.
    risk: readonly
  - type: command
    command: doctor
    reason: Report the schema-cache age so a stale cache can be ruled out as the cause of drift.
    risk: readonly
  - type: command
    command: schema {{collection}} --sample-size {{sample_size}} --format json
    reason: Pull the current sampled shape to diff against the cached/committed definition.
    risk: readonly
---
# Agent Notes

Use this task when a query starts failing on a field that "should" exist, or a code path
may have begun (or stopped) writing a field. Unlike SQL, MongoDB has no DDL — the schema is
**sampled** via `$sample`, so "drift" means the set of dot-path fields, their types, or
their `presence` (0..1) changed relative to the cached snapshot under
`.dbcli/schemas/<connection>/`.

Read the diff with sampling in mind:
- A **high-presence** dot-path appearing or disappearing is real drift (a writer started or
  stopped populating it).
- A **low-presence** field (presence < ~0.1) flickering between runs is usually sampling
  variance, **not** drift — raise `sample_size` or re-run before trusting it. For very large
  collections, `dbcli schema <collection> --sample-method natural` trades representativeness
  for speed.

Do not run write operations or DDL. If `doctor` reports a stale schema cache, refresh it
(`dbcli schema <collection> --refresh`) before treating the difference as live drift.
