---
name: orm-drift-review
description: Compare an ORM schema definition (Prisma / DDL / normalized JSON) against the live schema cache and review drift before any corrective migration.
tags: [diagnostics, schema, orm, readonly]
engines: [postgresql, mysql]
params:
  orm_path:
    type: string
    required: true
    description: Path to the ORM schema definition (e.g. prisma/schema.prisma, migrations/*.sql, or a normalized schema JSON).
safety:
  mode: plan-only
  requires:
    - blacklist.manage
    - schema.read
steps:
  - type: command
    command: blacklist list
    reason: Confirm sensitive-data boundaries before reading schema details.
    risk: readonly
  - type: command
    command: schema --format json
    reason: Refresh the local schema cache so the drift comparison runs against current DB state.
    risk: readonly
  - type: command
    command: diff --against-orm "{{orm_path}}" --format json
    reason: Compare the ORM definition against the cached DB schema; error-level entries are app-breaking drift.
    risk: readonly
---

# Agent Notes

Treat `missing_in_db` errors as release blockers: the application expects columns or
indexes the database does not have. `missing_in_orm` warnings usually mean a manual
hotfix was never backfilled into the ORM definition — backfill the definition rather
than dropping the column. Same-family type-spelling differences are reported as
`info` and are usually the ORM's default mapping, not real drift.

Proposals are `dbcli migrate` commands that run in default dry-run mode. Run a
proposed command only in that mode — do not add `--execute` — and capture the emitted
DDL. Identify the exact target table from the drift entry and DDL, then confirm it
against the refreshed schema output. Pass each value as one shell argument. Use the
current shell's safe quoting or argument-array mechanism; never use `eval`. For a
POSIX shell, bind the confirmed values to `exact_table` and `captured_ddl`, then keep
both expansions quoted:

```sh
dbcli skill tasks plan migration-review \
  --param "table=${exact_table}" \
  --param "ddl=${captured_ddl}"
```

Both `--param` values are required: the bare `migration-review` pack command is not a
review. Consider `--execute` only after the resulting migration-review plan and
captured DDL have been checked.
