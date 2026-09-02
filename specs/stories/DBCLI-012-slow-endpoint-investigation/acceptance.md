# Acceptance Criteria

## Happy Path

* [ ] Planning `slow-endpoint-investigation` with valid `table` and `query`
  parameters returns resolved commands in this order: `blacklist list`,
  `proxy analyze --format json`, `schema <table> --format json`, the resolved
  `explain` command, and the resolved `guide missing-index-for` command.
* [ ] Every planned step includes a bounded reason and remains classified as
  read-only evidence collection.

## Business Rules

* [ ] Planning does not construct an adapter, connect, read proxy events or
  schema, execute SQL, or invoke any resolved command.
* [ ] The schema step always precedes explain and missing-index guidance.
* [ ] Output describes proxy findings and index candidates as investigative
  leads, never as causation or an approved performance fix.
* [ ] No path creates an index, applies a migration, executes DDL, or changes
  database state.

## Failure Cases

* [ ] Missing `table` or `query` returns a bounded validation error and emits no
  partial plan.

## Regression Requirements

* [ ] Existing task-pack listing, parsing, deterministic planning, parameter
  substitution, and risk classification remain green.
* [ ] Existing proxy, schema, explain, and missing-index command behavior is
  unchanged.
* [ ] English and Traditional Chinese Markdown and HTML documentation describe
  the same evidence-first order and explicitly state that planning executes
  nothing, creates no index, and makes no causation claim.
* [ ] `make verify` passes.

## Verification Notes

Run focused task-pack plan tests for valid and missing `table`/`query` values
before `make verify`. Use adapter-construction and command-execution tripwires
to prove planning remains offline and non-executing.
