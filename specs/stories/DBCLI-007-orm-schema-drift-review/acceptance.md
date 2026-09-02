# Acceptance Criteria

## Happy Path

* [ ] Given a populated SQL schema cache and a supported explicit ORM artifact,
  `diff --against-orm <path>` completes offline and produces a normalized drift
  report in table, JSON, and Markdown formats.
* [ ] Matching normalized schemas complete with a zero exit status; error-level
  drift completes with a nonzero exit status and bounded findings.
* [ ] A supported DDL glob or multiple DDL inputs are merged for one review.

## Business Rules

* [ ] ORM comparison is mutually exclusive with snapshot-save and
  snapshot-compare modes.
* [ ] The command does not create an adapter, connect to a database, refresh
  cache, execute SQL, or mutate an ORM artifact/cache.
* [ ] Prisma, DDL, Drizzle snapshot, and normalized JSON inputs retain their
  documented parsing behavior; ignore patterns only affect comparison output.
* [ ] Multiple inputs/globs are rejected for non-DDL formats, and direct
  TypeScript ORM source is rejected with a generated-artifact/DDL alternative.

## Failure Cases

* [ ] Missing mode/input, mixed diff modes, missing/empty cache, missing file,
  malformed artifact, unsupported input combination, and unsupported engine
  fail closed with actionable errors.
* [ ] Failure cases complete without creating a database connection or mutating
  supplied files/cache.

## Regression Requirements

* [ ] Existing snapshot diff modes, ORM parser coverage, normalized comparison,
  formatter output, and exit-code behavior remain compatible.
* [ ] English and zh-TW user-guide Markdown and HTML keep the offline
  ORM-drift workflow, supported artifacts, and task-pack guidance in parity.

## Verification Notes

Run focused Bun tests for diff-mode validation, ORM input loading/parsing,
normalization/comparison, and formatter/exit behavior, then run `make verify`
from the repository root.
