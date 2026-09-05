# Story: DBCLI-PLAT-006 Cross-command Correlation ID

## Approval State

Approved — implementation authorized by the user on 2026-09-05.

## Goal

An operator or external agent can attach one safe, stable correlation ID to a dbcli invocation so its supported agent response and resulting audit entry can be associated with the same Story, incident, change request, migration, or backfill.

## Context

DBCLI-PLAT-004 and DBCLI-PLAT-005 establish a strict, bounded Operation Envelope v1 and opt-in agent output for `capabilities` operations. Audit entries already retain non-sensitive metadata and redact command inputs, SQL, and error text. dbcli has no root-level correlation field, so related invocations cannot be reliably joined without parsing redacted command text or adding ungoverned audit metadata.

This Story adds one explicit root option. It is a bounded opaque identifier, never a free-form label or arbitrary metadata map. It joins existing audited operations through `audit.metadata.correlation_id` and supported Operation Envelope contexts. It neither creates nor mutates evidence receipts; DBCLI-PLAT-007 owns evidence persistence.

## Classification

* Security sensitive: yes
* Baseline conformance: no

## Scope

### In Scope

* A root `--correlation-id <id>` option, accepted only before the first subcommand.
* Strict validation of `<id>` as an ASCII identifier matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$`.
* Propagation of a supplied ID to `metadata.correlation_id` in every audit entry produced by an invocation.
* Propagation of a supplied ID to the non-null `context.correlationId` in supported Operation Envelope v1 responses.
* Strict Operation Envelope parser/type/public-export updates required for the optional context field.
* Structured, fail-closed agent-output handling for an invalid correlation ID whenever `--agent-output` is present.
* Focused unit, integration, contract, and security-fixture coverage; root-help and user/Skill documentation in English and Traditional Chinese, Markdown and HTML.

### Out of Scope

* New audit records for commands that do not already audit, audit schema migrations, or backfilling historic audit entries.
* Correlation labels, free-form descriptions, multiple IDs, generated IDs, environment defaults, config-file defaults, or server-side lookup.
* Persisting correlation metadata in evidence receipts or relaxing evidence-reference validation; DBCLI-PLAT-007 owns evidence persistence.
* Changing existing output, audit bytes, or audit metadata when `--correlation-id` is absent.
* Expanding supported `--agent-output` commands beyond the operations already supported by DBCLI-PLAT-005.

## Inputs

* An optional root option: `--correlation-id <id>`, before the first subcommand.
* Existing root selectors and supported `--agent-output` invocations.
* Existing audited command outcomes.

## Outputs

When supplied, the exact validated ID appears only in these safe contract fields:

```text
audit entry metadata: { ..., correlation_id: "<id>" }
Operation Envelope context: { ..., correlationId: "<id>" }
```

When omitted, audit metadata has no `correlation_id` key and Operation Envelope context has no `correlationId` key. A static envelope whose context is already `null` remains `null`.

## Rules

* R1: `<id>` is an opaque, non-secret identifier of 1–160 ASCII characters matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$`. Whitespace, path separators, URL syntax, quotes, SQL syntax, control characters, and values over 160 characters are rejected.
* R2: `--correlation-id` is a root option and must appear before the first subcommand. It is optional and has no environment-variable, config-file, generated, or inherited fallback.
* R3: The supplied value is copied unchanged to `metadata.correlation_id` only after validation. It must be carried by the existing audit write path, so strict-audit behavior, redaction, and audit-write failures are unchanged and cannot be bypassed.
* R4: For the already supported agent operations, a non-null `context` includes optional `correlationId`; a static operation whose context is `null` remains `null`. No raw argv, SQL, path, connection string, credential, error body, or arbitrary metadata is added to the envelope.
* R5: The Operation Envelope parser accepts `correlationId` only when it satisfies the same identifier grammar. It rejects unknown context fields and invalid correlation values. Public types expose the optional field.
* R6: Existing evidence references retain their strict shape. The correlation ID is never inserted into `evidence`, receipt IDs, digest fields, recovery envelopes, or evidence persistence.
* R7: Without `--correlation-id`, all pre-existing command behavior, output, exit code, audit metadata, and Operation Envelope bytes remain unchanged.
* R8: With `--agent-output`, a missing value, an invalid ID, invalid placement, or an incompatible output option fails as one compact safe envelope on stdout, with empty stderr and exit code `2`. Invalid correlation values use the stable code `INVALID_CORRELATION_ID` and curated message `Invalid correlation ID.`.
* R9: Normal CLI validation failures for `--correlation-id` exit `2` and retain existing human-facing conventions.

## Expected Errors

* Missing value: `dbcli --correlation-id` exits `2`; with `--agent-output`, it emits `INVALID_CORRELATION_ID`, exits `2`, and writes no stderr. A syntactically valid value such as `query` is an ID, not an identifiable missing command, so callers must use `--correlation-id <id> query ...`.
* Invalid identifier: `dbcli --correlation-id ../../PLAT006 query ...` exits `2`; with `--agent-output`, it emits `INVALID_CORRELATION_ID`, exits `2`, and writes no stderr.
* Option after subcommand: `dbcli query ... --correlation-id DBCLI-PLAT-006` exits `2`; with `--agent-output`, it emits the existing structured invalid-option failure.
* Existing output conflicts with `--agent-output` remain `INVALID_AGENT_OUTPUT_OPTIONS`, exit `2`.

## Dependencies

* `src/program-root.ts`, `src/cli-runtime.ts`, and `src/utils/agent-output.ts` — root-option declaration, validation, and safe agent-output failures.
* `src/core/operation-envelope.ts` and `src/core/public.ts` — strict context contract and public export.
* `src/core/audit/integration-helper.ts` and `src/utils/redaction.ts` — audited metadata and redaction boundary.
* Existing command audit call sites — option propagation to the shared audit writer.

## Constraints

* Reuse existing Commander, Zod, audit, redaction, and Operation Envelope patterns; add no dependency.
* Core remains pure and does not write stdout or stderr.
* The ID is contract metadata, not a secret channel. Documentation must state that callers must not provide credentials, SQL, personal data, or free-form text.
* No database schema change, migration, or evidence-storage behavior is permitted.
* `make verify` must pass.

## Trust Boundary Fields

* `argv --correlation-id <id>` — caller-controlled root input; validate before command execution, audit metadata, or agent-output serialization.
* `audit.metadata.correlation_id` — persisted audit metadata; may contain only a validated correlation identifier.
* `OperationEnvelope.context.correlationId` — externally emitted metadata; may contain only the same validated identifier and only with a non-null context.
* `evidence`, recovery, error, SQL, and argv fields — must never receive correlation metadata through this Story.
