# Acceptance Criteria

## Happy Path

* [x] Upstream `story-check` at `cb4bc976` reports no `FAIL` line for any Story
      in `specs/stories/`, and the gate's banner reads 0 admitted pre-existing
      findings — `FORGEFLOW_ROOT=<checkout> bun run forgeflow:contract`

## Business Rules

* [x] The eight source-field cells name `ReportFinding.rows`,
      `ConnectionOptions.password`, `ConnectionOptions.uri`, `LintReport.sql`,
      `ConnectionError.message`, `ProxyEvent.sessionId`,
      `DesignValidationError.filePath` and `ReportFinding.rows` — human review
      against those declarations in `src/`
* [x] Each payload is asserted to reach the command's own stdout, stderr or
      on-disk input, and to be absent from the persisted receipt —
      `tests/integration/command-evidence-receipts.test.ts`
* [x] Rows 1 and 8 share `ReportFinding.rows` because both payloads are injected
      as columns of the same diagnostic result; no separate stdout/stderr capture
      feeds a receipt — human review of `src/core/report/`
* [x] The trust-boundary section names fields and states the structural guard:
      an exact allowed key set, and a `context` built from four config-derived
      values plus two fingerprints — human review of `story.md`
* [x] `PREDATING_FINDINGS` is empty and both counts are `0` —
      `tests/unit/scripts/forgeflow-contract.test.ts`

## Failure Cases

* [x] With nothing admitted, any finding upstream reports fails the gate —
      `tests/unit/scripts/forgeflow-contract.test.ts`
* [x] An exemption added back without lowering the counts fails before the gate
      runs — same file

## Regression Requirements

* [x] `src/` is unchanged by this Story — `git diff --stat` against the baseline
* [x] The eight rows keep their payloads, expected results and persisted
      locations — `git diff` of that acceptance file
* [x] The complete repository verification gate passes — `make verify`

## Verification Notes

`PREDATING_FINDINGS` and its two counts stay in the code once empty. They are
what makes the floor a check: an entry may only be added by lowering, never
raising, the counts.
