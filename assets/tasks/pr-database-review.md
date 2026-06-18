---
name: pr-database-review
description: Review a PR's changed persistence paths, queries and migrations for database risk before merge.
tags: [review, safety, readonly]
engines: [postgres, mysql]
params:
  query:
    type: string
    required: true
    description: The most significant changed SQL/persistence statement to analyze (not executed by this task).
safety:
  mode: plan-only
  requires:
    - blacklist-list
    - schema-check
steps:
  - type: command
    command: blacklist list
    reason: Confirm the tables and columns touched by the PR are protected as expected before reviewing changed queries.
    risk: readonly
  - type: command
    command: inspect --format json
    reason: Capture connection, permission tier and schema-cache context for the review.
    risk: readonly
  - type: command
    command: plan "{{query}}"
    reason: Analyze the riskiest changed statement's scope and safety without executing it.
    risk: readonly
---
# Agent Notes

Use this task when reviewing a pull request that changes persistence: queries, ORM
models, migrations, data exports or fixtures. It only PLANS — it never writes. Walk
the changed files and, for each risky persistence path, re-run `plan "<sql>"` on the
specific statement. Cross-check the `blacklist list` output against any new columns
the PR exposes (exports, logs, serializers). For schema/migration changes prefer the
`migration-review` pack; for index/perf concerns prefer `slow-endpoint-investigation`.
Do not run write operations or DDL as part of the review.
