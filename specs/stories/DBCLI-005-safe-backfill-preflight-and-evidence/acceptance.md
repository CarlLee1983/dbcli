# Acceptance Criteria

## Happy Path

* [ ] Given a matching `UPDATE`, plain `SELECT` read-back query, and passing
  guards, default `verify safe-backfill` returns `ready`, echoes the proposed
  update, and supplies an after-write command without executing a write.
* [ ] After an operator separately performs the approved write, `--after-write`
  reruns the guards, evaluates the read-back assertion, writes a result
  artifact, and reports `verified` when the expectation holds.

## Business Rules

* [ ] Preflight runs all four required guards and reports their individual
  outcomes; `ready` is never presented as `verified`.
* [ ] A failed preflight guard returns `blocked`; after-write also returns
  `blocked` and does not execute the assertion when any required guard fails.
* [ ] A failed assertion reports `not_verified` even when a no-fail assertion
  mode leaves the process non-fatal; an inconclusive assertion reports
  `indeterminate`.
* [ ] Result artifacts exclude raw query bodies, expectation literals, returned
  rows, credentials, and user paths.

## Failure Cases

* [ ] Missing inputs, multi-statement/non-`UPDATE` statements, updates without
  `WHERE`, and schema-aware table mismatches fail closed.
* [ ] `EXPLAIN`, `SHOW`, `DESCRIBE`, and data-modifying CTE read-back inputs are
  rejected before any assertion runs.

## Regression Requirements

* [ ] Existing verification, assertion, artifact, blacklist, schema, and
  task-pack behavior remains compatible.
* [ ] English and zh-TW user-guide Markdown and HTML document the same
  preflight/write/result boundary and safe-evidence limits.

## Verification Notes

Run focused Bun tests for safe-backfill and verification artifacts, then run
`make verify` from the repository root.
