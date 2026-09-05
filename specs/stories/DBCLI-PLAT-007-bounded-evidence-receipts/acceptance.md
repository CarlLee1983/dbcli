# Acceptance Criteria

## Happy Path

* [ ] Each of `inspect`, `report`, `schema`, `plan`, `lint`, `explain`, and `impact` accepts `--evidence-receipt <workspace-relative-path>` and writes a parseable bounded receipt after its authoritative result — focused command integration tests
* [ ] Each receipt has its command-specific operation and capability, a timestamp, safe context digests, and optional bounded correlation reference — focused receipt unit and command integration tests
* [ ] The capability contract derives the complete receipt-writer command set from actual writer call sites — `tests/contract/capability-contract.test.ts`

## Business Rules

* [ ] Receipt parsing accepts the seven new operations and preserves existing `assert` and `verify` receipt parsing — `tests/unit/core/evidence-receipt/evidence-receipt.test.ts`
* [ ] A receipt write failure reports exactly `Failed to write evidence receipt` and does not change the original operation's result or exit code — focused command integration tests
* [ ] Receipt output paths remain workspace-confined, atomically created, and non-overwriting — existing receipt unit coverage plus focused command integration tests

## Failure Cases

* [ ] Unknown operations, unknown fields, malformed safe metadata, and invalid receipt paths fail closed without persisting a receipt — receipt unit and command integration tests
* [ ] Receipt-write failures expose no raw filesystem, database, or exception details — focused command integration tests

## Regression Requirements

* [ ] Commands without `--evidence-receipt` retain their pre-existing output and exit behavior — focused command regression tests
* [ ] Existing `assert` and `verify` receipt behavior remains parse-compatible — existing receipt unit and integration tests
* [ ] Complete verification gate passes without failures — `make verify`

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| command rows | `[{"email":"PLAT007_ROW_SENTINEL"}]` | omit | `none` | focused receipt tests |
| command credential | `PLAT007_PASSWORD_SENTINEL` | omit | `none` | focused receipt tests |
| command connection string | `postgresql://plat007:PLAT007_SECRET@db.internal:5432/prod` | omit | `none` | focused receipt tests |
| command SQL | `SELECT * FROM users WHERE email='plat007@example.com'` | omit | `none` | focused receipt tests |
| command error | `PLAT007_RAW_ERROR_SENTINEL` | omit | `none` | focused receipt tests |
| command session secret | `PLAT007_SESSION_SECRET` | omit | `none` | focused receipt tests |
| command absolute path | `/private/PLAT007_ABSOLUTE_PATH` | omit | `none` | focused receipt tests |
| command stdout/stderr | `PLAT007_UNBOUNDED_OUTPUT` | omit | `none` | focused receipt tests |

## Verification Notes

Run the focused receipt and target-command tests during development, then run:

```sh
make verify
```
