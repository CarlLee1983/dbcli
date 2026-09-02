# Story: DBCLI-001 Contract Absence and Invalid Drift

## Goal

Protect the offline semantic-contract workflow with explicit regression evidence
for an absent optional contract file and invalid contract drift input.

## Context

CON-01 acceptance criterion 3 in
`docs/plans/2026-08-08-agent-data-evidence-and-change-intelligence-ticket-backlog.md`
records two remaining verification gaps: no test proves that an absent
`dbcli.contracts.json` leaves skill context unchanged, and the contract-drift
`invalid` branch has no direct coverage.

## Scope

### In Scope

* Add the smallest stable tests for both recorded gaps.
* Preserve a valid semantic context when the optional contract file is absent.
* Confirm invalid contract drift returns bounded, non-leaking evidence.
* Make the smallest product correction only if a regression test exposes a real
  defect.

### Out of Scope

* New semantic-contract behavior or file formats.
* Contract evaluation, database access, provider generation, or impact analysis.
* Dependency upgrades or new packages.
* Refactoring unrelated contract, context, or command code.

## Inputs

* A workspace with valid config and semantic context but no
  `dbcli.contracts.json`.
* A workspace containing an invalid `dbcli.contracts.json` payload.

## Outputs

* Regression tests proving both offline behaviors.
* A minimal product fix only if existing behavior fails those tests.

## Rules

* R1: An absent optional contract file must not remove or alter valid semantic
  context and must not add a `contracts` field.
* R2: Contract drift must classify invalid input as `invalid` rather than throw
  or report `valid`/`unavailable`.
* R3: Drift evidence must not reproduce arbitrary invalid input contents.
* R4: These paths remain offline and must not create a database adapter or make a
  database connection.

## Expected Errors

* Invalid contract input produces a bounded `invalid` drift report.

## Dependencies

* Existing semantic-contract, context, and Bun test helpers.

## Constraints

* Preserve all existing behavior and tests outside this Story.
* Use `bun test` for focused checks and `make verify` for completion.
