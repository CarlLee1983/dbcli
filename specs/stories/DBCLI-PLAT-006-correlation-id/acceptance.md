# Acceptance Criteria

## Happy Path

* [ ] `dbcli --correlation-id DBCLI-PLAT-006 <audited command>` records exactly `metadata.correlation_id: "DBCLI-PLAT-006"` in its existing audit entry — focused audit integration test.
* [ ] A supported non-static agent response invoked with `--correlation-id INC-2026.09.05` contains `context.correlationId: "INC-2026.09.05"` and still satisfies the strict Operation Envelope parser — `tests/unit/core/operation-envelope.test.ts` and `tests/integration/capabilities-command.test.ts`.
* [ ] A supported static agent response invoked with a valid correlation ID retains `context: null` — `tests/integration/capabilities-command.test.ts`.
* [ ] The root help and all required English/Traditional-Chinese Markdown/HTML and Skill documentation describe the option, grammar, placement, audit behavior, and non-secret restriction — `make verify`.

## Business Rules

* [ ] The accepted values are exactly identifiers matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$`; 1- and 160-character boundary values pass, and no other form does — focused root-option validation test.
* [ ] The exact validated ID is propagated to every audit entry produced by one invocation through the shared audit integration path, without new per-command audit implementations — focused audit integration test.
* [ ] `parseOperationEnvelope(unknown)` accepts an optional valid `context.correlationId`, rejects invalid values and unknown context keys, and the public core export reflects the optional field — `tests/unit/core/operation-envelope.test.ts` and `tests/unit/core-public.test.ts`.
* [ ] Existing evidence references, recovery envelopes, and envelope size limits retain their current schemas and bounds — `tests/unit/core/operation-envelope.test.ts`.

## Failure Cases

* [ ] An absent `--correlation-id` value, empty value, invalid character, whitespace, path, URL, quote, SQL-shaped value, or 161-character value fails before the command action with exit `2` — focused root-option validation test. A syntactically valid value immediately following the option is its value, even if it matches a command name.
* [ ] With `--agent-output`, each invalid correlation input produces exactly one compact failure envelope with `INVALID_CORRELATION_ID`, `Invalid correlation ID.`, empty stderr, and exit `2` — `tests/integration/lazy-entry-path.test.ts`.
* [ ] A root correlation option after the subcommand is rejected; in agent-output mode it follows the established invalid-agent-option envelope path — `tests/integration/lazy-entry-path.test.ts`.

## Regression Requirements

* [ ] Invocations without `--correlation-id` retain byte-identical output, exit codes, audit metadata, and Operation Envelope bytes — focused CLI, audit, and envelope regression tests.
* [ ] Existing audit redaction and strict-audit failure behavior remain in force when a valid correlation ID is supplied — focused audit integration test.
* [ ] No command gains a new audit record merely because a correlation ID was supplied — focused audit integration test.
* [ ] Existing supported `--agent-output` operations and all unsupported-operation failures remain unchanged except for the optional valid non-null context field — existing capabilities and lazy-entry integration tests.
* [ ] Complete verification gate passes without failures — `make verify`.

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `argv --correlation-id` | `DBCLI-PLAT-006` | preserve | `audit.metadata.correlation_id`, `OperationEnvelope.context.correlationId` | focused audit and envelope tests |
| `argv --correlation-id` | `INC-2026.09.05` | preserve | `audit.metadata.correlation_id`, `OperationEnvelope.context.correlationId` | focused audit and envelope tests |
| `argv --correlation-id` | `../../PLAT006_PATH` | reject | `none` | root-option validation test |
| `argv --correlation-id` | `postgresql://plat006:PLAT006_SECRET@db.internal:5432/prod` | reject | `none` | root-option validation test |
| `argv --correlation-id` | `SELECT * FROM users WHERE email='plat006@example.com'` | reject | `none` | root-option validation test |
| `argv --correlation-id` | `PLAT006_RAW_ERROR_SENTINEL` | preserve | `audit.metadata.correlation_id`, `OperationEnvelope.context.correlationId` | focused audit and envelope tests |
| `OperationEnvelope.context.correlationId` | `../../PLAT006_PATH` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `evidence[0]` | `{ "kind": "receipt", "id": "DBCLI-PLAT-006", "correlationId": "DBCLI-PLAT-006" }` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |

## Verification Notes

Run focused root-option, audit, Operation Envelope, public-contract, capabilities, and lazy-entry tests while implementing. Then run:

```sh
make verify
```

Confirm all eight security fixture cases, including that rejected input never reaches audit metadata, an envelope, evidence, recovery data, stderr, or command execution.
