# Acceptance Criteria

## Happy Path

* [ ] A valid versioned contract artifact can be validated, inspected, searched,
  and checked for drift using local semantic evidence only.
* [ ] Ordinary agent context contains the valid approved contracts with their
  canonical name, subject, owner, and evidence policy.

## Business Rules

* [ ] Contracts accept only supported semantic subject forms and valid review
  statuses.
* [ ] Validation enforces artifact version `1`, canonical contract names, exact
  `draft|approved|deprecated` statuses, and exact
  `none|receipt-required|verification-required` evidence policies.
* [ ] Draft and deprecated contracts do not enter ordinary context or approved
  search results.
* [ ] An absent optional contract artifact preserves ordinary semantic context;
  an explicitly requested absent or invalid artifact fails closed.
* [ ] Drift distinguishes valid, stale, invalid, and unavailable local evidence
  without exposing arbitrary invalid input.
* [ ] Contract input containing SQL, credentials, protected identifiers, or
  executable rules is rejected.

## Failure Cases

* [ ] Invalid or explicitly missing contract input returns bounded, actionable
  local diagnostics and no approved contract context.
* [ ] Every contract command remains offline and read-only: tests prove it does
  not construct a database adapter, connect, execute SQL, or write an artifact.

## Regression Requirements

* [ ] Existing semantic context and contract behavior remain green, including
  absent-artifact and invalid-drift coverage.
* [ ] English and Traditional Chinese user documentation describe the same
  offline/read-only boundary, approval filtering, and missing/invalid behavior
  in both Markdown and HTML formats.
* [ ] `make verify` passes.

## Verification Notes

Run focused contract and semantic-context tests before `make verify`. If a
required service or repository gate is unavailable, report that blocker rather
than claiming completion.
