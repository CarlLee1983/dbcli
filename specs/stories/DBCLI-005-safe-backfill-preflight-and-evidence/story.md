# Story: DBCLI-005 Safe Backfill Preflight and Evidence

## Goal

Give an operator bounded preflight evidence for human approval, then retain
bounded evidence of the post-write read-back result without allowing the
verifier to perform the write or declare the backfill safe.

## Context

The safe-backfill guide separates a read-only preflight from an explicitly
human-approved write and from the post-write verification result. Planned
evidence is not proof that a write or assertion has run.

The repository already exposes this workflow. This baseline-conformance Story
formalizes the published Pages contract: execution begins by verifying current
behavior and changes code only where an acceptance criterion fails.

## Scope

### In Scope

* Provide the `verify safe-backfill` preflight and after-write workflow.
* Validate the backfill target and read-back query before an assertion can run.
* Persist bounded result evidence after a result exists.

### Out of Scope

* Executing, approving, or rolling back the proposed `UPDATE`.
* Generating arbitrary backfill SQL or changing ordinary write permissions.
* Producing an evidence receipt or changing the verification-artifact format;
  receipt provenance belongs to DBCLI-009.

## Inputs

* Required `--table`, proposed `--query`, read-back `--verify-query`, and
  assertion `--expect` values.
* Optional subject name, summary, JSON/table format, and `--after-write`.

## Outputs

* Preflight JSON/table output with `ready` or `blocked`, all guard outcomes,
  the planned update, and a shell-safe after-write command.
* After-write JSON/table output with `verified`, `not_verified`,
  `indeterminate`, or `blocked` plus a local verification artifact.

## Rules

* R1: `verify safe-backfill` must never execute the proposed `UPDATE`.
* R2: Preflight must run blacklist, schema, update-plan, and read-only
  read-back guards; any failed required guard returns `blocked`.
* R3: The proposed statement is exactly one `UPDATE` with a `WHERE`, and its
  schema-aware target must match `--table`.
* R4: The read-back query must be a plain read-only `SELECT`; `EXPLAIN`,
  `SHOW`, `DESCRIBE`, and data-modifying CTEs are rejected.
* R5: `ready` means guards passed, not that a write or verification succeeded.
* R6: After-write reruns every guard before the assertion. A failed guard
  blocks the assertion and emits no assertion evidence.
* R7: Result evidence may record only bounded, literal-free command labels and
  safe references; it must not persist raw SQL, expectations, row values,
  credentials, or user paths.

## Expected Errors

* Missing required inputs, an invalid update shape/target, or a non-read-only
  read-back query fail closed before a result is reported.
* A failed blacklist, schema, plan, or read-only guard returns `blocked` with a
  bounded reason.
* An assertion that cannot produce a trustworthy verdict returns
  `indeterminate`; a contradicting assertion returns `not_verified`.

## Dependencies

* Existing blacklist, schema, plan, assertion, and verification-artifact
  contracts.
* The safe-backfill sections of both user-guide languages and formats.

## Constraints

* Preserve existing verification statuses and artifact compatibility.
* Keep the normal write command and its confirmation boundary separate from
  this verifier.
* Update `docs/user/en/` and `docs/user/zh-TW/`, keeping each Markdown/HTML
  pair in parity when behavior or commands change.
* Use focused Bun tests and `make verify` for completion.
