# Acceptance Criteria

## Happy Path

* [x] Each of `inspect`, `report`, `schema`, `plan`, `lint`, `explain`, and `impact` accepts `--evidence-receipt <workspace-relative-path>` and writes a parseable bounded receipt after its authoritative result — `tests/integration/command-evidence-receipts.test.ts`
* [x] Each receipt has its command-specific operation and capability, a timestamp, safe context digests, and optional bounded correlation reference — `tests/integration/command-evidence-receipts.test.ts`
* [x] The capability contract derives the complete receipt-writer command set from actual writer call sites — `tests/contract/capability-contract.test.ts`

## Business Rules

* [x] Receipt parsing accepts the seven new operations and preserves existing `assert` and `verify` receipt parsing — `tests/unit/core/evidence-receipt/evidence-receipt.test.ts`
* [x] A receipt write failure reports exactly `Failed to write evidence receipt` and does not change the original operation's result or exit code — `tests/integration/command-evidence-receipts.test.ts`
* [x] Receipt output paths remain workspace-confined, atomically created, and non-overwriting — `tests/unit/core/evidence-receipt/evidence-receipt.test.ts` and `tests/integration/command-evidence-receipts.test.ts`

## Failure Cases

* [x] Unknown operations, unknown fields, malformed safe metadata, and invalid receipt paths fail closed without persisting a receipt — `tests/unit/core/evidence-receipt/evidence-receipt.test.ts`
* [x] Receipt-write failures expose no raw filesystem, database, or exception details — `tests/integration/command-evidence-receipts.test.ts`

## Regression Requirements

* [x] Commands without `--evidence-receipt` retain their pre-existing output and exit behavior — `tests/integration/command-evidence-receipts.test.ts`
* [x] Existing `assert` and `verify` receipt behavior remains parse-compatible — existing receipt unit and integration tests
* [x] Complete verification gate passes without failures — `make verify`

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| command rows | `[{"email":"PLAT007_ROW_SENTINEL"}]` | omit | `none` | `tests/integration/command-evidence-receipts.test.ts` |
| command credential | `PLAT007_PASSWORD_SENTINEL` | omit | `none` | `tests/integration/command-evidence-receipts.test.ts` |
| command connection string | `postgresql://plat007:PLAT007_SECRET@db.internal:5432/prod` | omit | `none` | `tests/integration/command-evidence-receipts.test.ts` |
| command SQL | `SELECT * FROM users WHERE email='plat007@example.com'` | omit | `none` | `tests/integration/command-evidence-receipts.test.ts` |
| command error | `PLAT007_RAW_ERROR_SENTINEL` | omit | `none` | `tests/integration/command-evidence-receipts.test.ts` |
| command session secret | `PLAT007_SESSION_SECRET` | omit | `none` | `tests/integration/command-evidence-receipts.test.ts` |
| command absolute path | `/private/PLAT007_ABSOLUTE_PATH` | omit | `none` | `tests/integration/command-evidence-receipts.test.ts` |
| command stdout/stderr | `PLAT007_UNBOUNDED_OUTPUT` | omit | `none` | `tests/integration/command-evidence-receipts.test.ts` |

## Verification Notes

Run the focused receipt and target-command tests during development, then run:

```sh
make verify
```
