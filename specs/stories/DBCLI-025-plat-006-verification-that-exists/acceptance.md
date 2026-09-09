# Acceptance Criteria

## Happy Path

* [x] Upstream `story-check` at `cb4bc976` reports no `FAIL` line for
      `specs/stories/DBCLI-PLAT-006-correlation-id` —
      `FORGEFLOW_ROOT=<checkout> bun run forgeflow:contract`

## Business Rules

* [x] Rows 3, 4 and 5 — `../../PLAT006_PATH`,
      `postgresql://plat006:PLAT006_SECRET@db.internal:5432/prod` and
      `SELECT * FROM users WHERE email='plat006@example.com'` — are each rejected
      as `--correlation-id` with exit `2` and a stderr naming the option —
      `tests/integration/lazy-entry-path.test.ts`
* [x] Rows 1, 2 and 6 — `DBCLI-PLAT-006`, `INC-2026.09.05` and
      `PLAT006_RAW_ERROR_SENTINEL` — each reach
      `OperationEnvelope.context.correlationId` and parse —
      `tests/integration/capabilities-command.test.ts`
* [x] The same three payloads each reach `audit.metadata.correlation_id`, and an
      outcome-supplied `correlation_id` never overrides the validated one —
      `tests/unit/core/audit/integration-helper.test.ts`
* [x] All six Verification cells name a file that asserts that row's payload at
      that row's source field — human review against those three files
* [x] `PREDATING_FINDINGS` holds no entry for `DBCLI-PLAT-006-correlation-id` —
      `tests/unit/scripts/forgeflow-contract.test.ts`

## Failure Cases

* [x] `tests/unit/core/operation-envelope.test.ts` is not cited for rows 4 and 5:
      it asserts the `OperationEnvelope.context.correlationId` source field, which
      the matrix covers in its own row — human review of the matrix
* [x] A finding upstream reports for a Story with no exemption fails the gate as
      unadmitted — `tests/unit/scripts/forgeflow-contract.test.ts`

## Regression Requirements

* [x] `src/` is unchanged, and the added assertions pass against it — the tests
      named above, run before any other change
* [x] Rows 7 and 8 are unchanged — `git diff` of that acceptance file
* [x] The complete repository verification gate passes — `make verify`

## Verification Notes

```sh
bun test tests/integration/lazy-entry-path.test.ts \
  tests/integration/capabilities-command.test.ts \
  tests/unit/core/audit/integration-helper.test.ts
```

That the added cases pass against unmodified `src/` is the evidence that this
Story closed a coverage gap and not a defect. A failure would have meant the
opposite and belonged to a different Story.
