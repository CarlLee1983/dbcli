# dbcli Agent Developer Workflows Design Specification

**Date:** 2026-06-18
**Status:** Implemented — retained as a design record
**Author:** AI Agent
**Context:** The current `dbcli` agent skill is strong at safe database operation, but it mainly triggers when the user explicitly asks for database work. Developers also need the skill to help during normal feature implementation, debugging, review, migration, and performance work where database impact is implicit.

## 1. Goal

Extend the dbcli agent skill so installed agents act as database-aware developer assistants during software development tasks, not only as database query executors.

The enhancement must teach agents when and how to bring dbcli into development workflows:

- implementing DB-backed features
- debugging application data issues
- generating or validating ORM models and migrations
- reviewing PRs for database risk
- investigating slow endpoints or queries
- preparing safe data backfills
- validating staging/production configuration without exposing secrets

This spec is intentionally skill-first. It does not require new CLI behavior for the first implementation pass.

## 2. Non-Goals

- Do not add new dbcli commands in the first pass.
- Do not make agents query production by default.
- Do not weaken blacklist, permission, dry-run, schema, or recovery rules.
- Do not turn the skill into a generic coding workflow. It should activate only where database state, schema, data correctness, migration risk, or query performance matters.
- Do not duplicate the full command reference in `SKILL.md`; detailed flags remain in `reference.md`.

## 3. Design Principles

### 3.1 Development Context First

The skill should map developer intent to database-safe workflows. If the user asks "fix this endpoint" and the endpoint clearly reads or writes database state, the agent should inspect schema and data boundaries before changing code that assumes table or field names.

### 3.2 Safety Rules Are Inherited

Every developer workflow must inherit the existing agent rules:

1. Prefer `--format json`.
2. Run `dbcli blacklist list` before inspecting or operating on sensitive data.
3. Confirm actual names with `dbcli schema <table> --format json`; never guess.
4. Use `--dry-run` before writes.
5. Confirm writes with a read-back query or snippet verification.
6. Use `--recovery` / `dbcli recover` when commands fail.

### 3.3 Progressive Disclosure

`assets/SKILL.md` should get a short `Developer workflows` section with compact command sequences and trigger guidance. Larger examples, engine-specific caveats, and complete flags remain in `assets/reference.md`.

The target is a high-signal skill section, not a long playbook.

## 4. User-Facing Trigger Scenarios

The skill should trigger or guide the agent in these developer scenarios:

| Scenario | Example user prompt | Agent intent |
| --- | --- | --- |
| Feature implementation | "Add order status update support" | Discover schema, identify safe write path, dry-run update behavior, verify after code changes. |
| Bug investigation | "The user profile API returns stale data" | Inspect schema, query minimal records, check blacklist/audit, compare expected app behavior to DB state. |
| ORM/model generation | "Update Prisma models from the live DB" | Export schema JSON, compare to ORM files, propose model/migration changes. |
| Migration authoring | "Add an index for slow order lookup" | Use schema/diff/guide, generate migration draft, dry-run DDL, verify with diff. |
| PR review | "Review this PR for DB risk" | Check for new queries, broad writes, missing WHERE, missing dry-run paths, blacklist exposure, migration risk. |
| Slow endpoint/query | "This report endpoint is slow" | Use proxy analysis, task packs, guide/index commands, and minimal live probes. |
| Data backfill | "Backfill missing customer tiers" | Build a counted scope query, dry-run update/batch plan, require read-back verification. |
| Config validation | "Check staging DB config" | Use status/doctor/inspect without exposing secrets; do not print credentials. |

## 5. Workflow Contracts

### 5.1 Implement DB-Backed Feature

Use when code changes depend on real tables, collections, indices, keys, or field names.

Required flow:

```bash
dbcli inspect --for-agent --format json
dbcli blacklist list --format json
dbcli schema <object> --format json
dbcli queries suggest <intent> --format json
```

Then:

- Map code terms to actual schema names.
- Prefer existing snippets over ad-hoc SQL when available.
- For reads, query the smallest representative slice.
- For writes, run command-level `--plan` when available, then `--dry-run`, then execute only when the user intent and permission level allow it.
- After code changes, validate with a read-back query, snippet `--verify`, or relevant test.

Acceptance criteria:

- Agent does not invent column/table names.
- Agent reports which schema evidence shaped the code change.
- Write paths include dry-run and verification.

### 5.2 Debug Application Data Issue

Use when runtime behavior appears inconsistent with stored data.

Required flow:

```bash
dbcli inspect --for-agent --format json
dbcli audit tail --for-agent --n 10
dbcli blacklist list --format json
dbcli schema <object> --format json
```

Then:

- Reproduce with the narrowest query or saved snippet.
- Compare DB state, application assumptions, and recent audit activity.
- If a dbcli command fails, rerun with `--recovery` and follow `dbcli recover`.

Acceptance criteria:

- Agent distinguishes database facts from application-code inference.
- Agent does not expose blacklisted values in logs, summaries, or generated fixtures.
- Agent identifies whether the fix belongs in code, data, config, or migration.

### 5.3 Generate or Validate ORM Models and Migrations

Use when updating Prisma, Drizzle, TypeORM, Rails migrations, SQLAlchemy models, or similar schema code.

Required flow:

```bash
dbcli schema --format json
dbcli diff --snapshot <name>
```

For migration preview:

```bash
dbcli migrate add-index <table>
dbcli diff --against <snapshot>
```

Then:

- Compare live schema JSON with ORM/migration files.
- Treat live DB schema as evidence, not as automatic authority over intended product design.
- Keep destructive DDL behind explicit human confirmation and required dbcli flags (`--execute`, and `--force` for destructive operations).

Acceptance criteria:

- Generated model/migration changes are grounded in schema JSON.
- DDL preview is shown before execution.
- Destructive operations are not executed by default.

### 5.4 Review PR for Database Risk

Use when reviewing changes that touch persistence, queries, migrations, reports, background jobs, seed scripts, or data exports.

Checklist:

- New query paths confirm schema names with `dbcli schema`.
- Writes have a bounded `WHERE` / filter and a dry-run path.
- Migrations have a preview and rollback/verification plan.
- Large-table reads include filters, limits, or task-pack guidance.
- Blacklisted tables/columns are not exposed in logs, exports, fixtures, screenshots, or generated UI.
- Production-like connections remain query-only unless the user explicitly requests a higher tier.

Acceptance criteria:

- Review findings separate correctness, safety, and performance risks.
- Agent proposes concrete dbcli commands to verify each material DB claim.

### 5.5 Investigate Slow Endpoint or Query

Use when the work involves slow API endpoints, reports, dashboards, or background jobs.

Required flow:

```bash
dbcli report --section perf --format json
dbcli skill tasks plan analyze-table-perf --param table=<table> --format json
dbcli guide missing-index-for "<query>" --format json
```

When proxy logs are available:

```bash
dbcli proxy analyze --format json
```

Then:

- Use task packs before inventing a manual performance sequence.
- Prefer read-only diagnostics.
- Treat index suggestions as proposals that need migration review.

Acceptance criteria:

- Agent can identify query shape, hot table, missing index candidates, and verification command.
- Agent does not create indexes directly without migration review.

### 5.6 Prepare Safe Data Backfill

Use when the user asks to repair, normalize, or fill data.

Required flow:

```bash
dbcli blacklist list --format json
dbcli schema <object> --format json
dbcli query "<count/scope query>" --format json
dbcli update <object> --where "<bounded predicate>" --set '<json>' --dry-run --format json
```

Then:

- Scope the affected rows first.
- Prefer batching for large tables.
- Require read-back verification or snippet `--verify`.
- Do not remove blacklist rules to make a backfill easier unless explicitly requested and justified.

Acceptance criteria:

- Backfill plan includes scope count, dry-run preview, execution command, and verification query.
- Broad updates are blocked or escalated.

### 5.7 Validate Environment Configuration

Use when checking local, staging, CI, or production database configuration.

Required flow:

```bash
dbcli status --format json
dbcli doctor --format json
dbcli inspect --for-agent --no-connect --format json
```

Then:

- Prefer env refs and secret-free summaries.
- Do not print credentials or copied connection strings.
- For production, default to no writes and query-only validation.

Acceptance criteria:

- Agent reports config shape, selected connection, permission tier, schema-cache status, and connectivity state without leaking secrets.

## 6. Skill Content Changes

First implementation pass:

1. Add a compact `Developer workflows` section to `assets/SKILL.md`.
2. Add the same section to `assets/SKILL.zh-TW.md` if it remains a maintained source.
3. Keep detailed command tables in `assets/reference.md`; add a short reference section only if needed for discoverability.
4. Run `bun run plugin:sync` so all plugin copies receive the updated canonical skill content.
5. Update user docs only if the public behavior or install story changes. Pure skill guidance does not require broad docs expansion unless release notes are desired.

## 7. Validation Strategy

Required checks for the first implementation pass:

```bash
bun run plugin:sync
bun run plugin:check
bun run docs:check
python3 /Users/carl/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
python3 /Users/carl/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/dbcli-agent
bun run typecheck
```

Forward-test prompts for manual or subagent validation:

- "Add support for updating an order status from pending to shipped."
- "This user profile endpoint is returning the wrong email."
- "Generate ORM changes for the current users table."
- "Review this PR for database risk."
- "The dashboard query is slow."
- "Backfill missing customer tiers safely."
- "Check staging DB configuration without exposing credentials."

## 8. Open Questions

- Should developer workflows become built-in task packs under `assets/tasks/`, or remain skill-only guidance?
- Should `dbcli inspect --for-agent` explicitly surface "developer workflow suggestions" based on audit history and schema cache?
- Should `dbcli skill context` include a smaller mode optimized for code-review prompts?
- Should the plugin expose Cursor-specific commands or rules for PR review once Cursor plugin indexing is complete?

## 9. Proposed Implementation Order

1. Update canonical skill sources with the compact developer workflow section.
2. Sync plugin assets.
3. Run validation commands.
4. Forward-test the seven prompts against the updated skill.
5. Only after skill validation, consider turning selected workflows into task packs.

## Lifecycle closeout

### Current implementation

The compact developer-workflow routing lives in `assets/SKILL.md` and
`assets/SKILL.zh-TW.md`, with executable plan-only packs in `assets/tasks/` and
generated plugin/platform mirrors kept in sync. The guidance preserves the
blacklist, schema, dry-run, recovery, and read-back rules from this design.

### Completion evidence

- Implementation: `fe8f9d2`, `1c66ed8`, `2eda0cf`, `f3abdc0`, `ae24f62`,
  `22d14ba`, and `43deea6`.
- Verification: the four workflow-pack regression files passed 13 tests;
  `bun run skill:check`, `bun run platform:check`, and `bun run docs:check`
  passed during this audit.
- No new production command was required for the first skill-routing slice;
  later verification commands are recorded by their own specs.

### Deferred decisions

Future built-in task-pack expansion, inspect-time workflow suggestions, and
specialized `skill context` modes remain deferred. Reopen when a concrete user
workflow has a stable acceptance contract and an independent regression surface.
