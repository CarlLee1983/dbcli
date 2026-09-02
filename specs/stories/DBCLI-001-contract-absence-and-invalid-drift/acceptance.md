# Acceptance Criteria

## Happy Path

* [ ] With valid semantic context and no `dbcli.contracts.json`, `skill context
  --format json` exits successfully, preserves the semantic payload, and omits
  `contracts`.

## Business Rules

* [ ] `inspectSemanticContractDrift` classifies invalid contract input as
  `invalid` with at least one bounded issue.
* [ ] The serialized invalid drift report does not contain a seeded arbitrary
  input value.

## Failure Cases

* [ ] Both regression paths complete without constructing a database adapter or
  attempting a database connection.

## Regression Requirements

* [ ] Existing contract, context, and skill-context tests remain green; product
  code changes only if the new regression tests expose a defect.

## Verification Notes

Run the focused contract and skill-context tests first, then run `make verify`
from the repository root. If Docker test services are unavailable, report the
environment blocker and do not claim complete PASS.
