# Story: DBCLI-007 ORM Schema Drift Review

## Goal

Give a developer a bounded, offline review of drift between an explicit ORM
schema artifact and the cached SQL schema before changing models or migrations.

## Context

The documented ORM workflow compares an explicit ORM/DDL artifact with cached
database schema evidence. It is review-only: the comparison must not connect,
refresh the cache, execute SQL, or apply migrations.

The repository already exposes this workflow. This baseline-conformance Story
formalizes the published Pages contract: execution begins by verifying current
behavior and changes code only where an acceptance criterion fails.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: yes

## Scope

### In Scope

* Provide `diff --against-orm` review over supported explicit ORM schema
  artifacts and the existing SQL schema cache.
* Report normalized schema differences and a machine-readable/non-machine
  readable review result with a meaningful exit status.
* Give actionable, bounded errors for absent cache, unsupported inputs, and
  malformed schema artifacts.

### Out of Scope

* Connecting to a database, refreshing schema cache, executing SQL, or applying
  migrations.
* Parsing TypeScript ORM entities directly or adding ORM runtime integrations.
* Auto-fixing ORM files, generating migration files, or deciding which side of
  a drift is correct.

## Inputs

* One explicit `--against-orm` path, or DDL paths/globs where supported.
* Optional declared ORM format and explicit ignore patterns.
* Existing cached schema for a configured PostgreSQL, MySQL, or MariaDB
  connection.

## Outputs

* A normalized drift report in supported table, JSON, or Markdown output.
* A zero exit status when the report has no error-level drift and nonzero when
  error-level drift is present.

## Rules

* R1: `--against-orm` chooses the ORM comparison mode and is mutually exclusive
  with snapshot-save and snapshot-compare modes.
* R2: The review reads only the explicit artifact(s), configuration needed to
  locate the selected cache, and the existing cache; it never opens a database
  connection or refreshes cache data.
* R3: Supported inputs are Prisma schema, DDL, Drizzle normalized snapshot, or
  normalized JSON. Multiple paths and globs are supported only for DDL.
* R4: TypeScript Drizzle, TypeORM, and Sequelize sources are not parsed
  directly; the error must name the supported generated snapshot or DDL route.
* R5: An empty cache, absent file, malformed artifact, unsupported engine, or
  conflicting diff mode fails closed with an actionable error.
* R6: Ignore patterns affect only the review comparison and must not mutate the
  cache or supplied artifact.
* R7: Findings identify normalized schema differences without exposing
  credentials or requiring a live database.

## Expected Errors

* No selected mode, multiple selected modes, or no ORM input is rejected.
* Missing/empty cached schema, missing artifact, malformed schema, unsupported
  input combination, or unsupported connection engine is rejected.
* Direct TypeScript ORM source input explains the required generated artifact
  or DDL alternative.

## Dependencies

* Existing diff command, ORM parsers/normalizers, cached schema contract, and
  output formatters.
* The ORM/migration and named task-pack workflows in both user-guide languages
  and formats.

## Constraints

* Preserve normal snapshot diff behavior and existing supported ORM formats.
* Keep this command local, read-only, and deterministic for the supplied inputs
  and cache.
* Update `docs/user/en/` and `docs/user/zh-TW/`, keeping each Markdown/HTML
  pair in parity when behavior or supported formats change.
* Use focused Bun tests and `make verify` for completion.

## Superseded Behavior

* `tests/unit/commands/diff-against-orm.test.ts` — its mode-exclusivity and
  input-validation assertions are the baseline; this Story's R1–R5 take
  precedence where an accepted/rejected input differs.
* `tests/unit/agent-tasks/pack-orm-drift-review.test.ts` — its task-pack
  guidance for the offline ORM-drift review is the baseline; this Story's
  Rules take precedence where documented workflow behavior differs.
* `tests/unit/skill-assets/orm-drift-docs.test.ts` — its documented parser
  support and TypeScript-source rejection assertions are the baseline; R4
  takes precedence where the required alternative artifact differs.
* `docs/guides/en/orm-schema-drift.html` — its published offline
  ORM-comparison narrative is the baseline; this Story's Rules take
  precedence where a documented step or boundary differs.
* `docs/user/en/index.md` and `docs/user/zh-TW/index.md` — their existing
  `diff --against-orm` usage descriptions are the baseline; this Story's
  Rules take precedence where documented behavior differs.
