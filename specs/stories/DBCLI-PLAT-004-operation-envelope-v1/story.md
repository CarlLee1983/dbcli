# Story: DBCLI-PLAT-004 Operation Envelope v1

## Goal

An external Skill or agent can explicitly request one bounded, versioned JSON
response for a finite dbcli invocation and can strictly parse success, negative
domain results, and failures without scraping prose or risking sensitive output.

## Context

Existing `--format json` output is command-specific and is already consumed by
users. It must not change. Agent mode currently has no common response contract,
while `DBCLI_AGENT_MODE` governs configuration safety rather than output and
command-local `--for-agent` flags select existing brief formats.

ADR-0024 defines a separate invocation-scoped `--agent-output` mode. This Story
defines its v1 contract and proves it end to end only with
`capabilities check`, an offline command that already has deterministic success,
requirements-unmet, invalid-input, and safe context behavior. DBCLI-PLAT-005 owns
broader command coverage.

## Classification

* Security sensitive: yes
* Baseline conformance: no

## Scope

### In Scope

* A strict, independently versioned Operation Envelope contract, parser, types,
  and bounded serializer.
* Public export of the pure contract types, schema-version constant, and
  `parseOperationEnvelope(unknown)` through `@carllee1983/dbcli/core`.
* A visible root `--agent-output` option that must precede the subcommand.
* End-to-end envelope output for `capabilities check` only.
* Fail-closed envelope presentation for invalid placement, conflicting output
  options, unsupported operations, Commander validation, command-tree load
  failures, and unexpected runtime failures once the exact option token appears.
* Unit, contract, integration, regression, and six-category leak tests.
* ADR-0024, the root glossary, root help, user documentation in both languages
  and both formats, and all dbcli Skill documentation mirrors.

### Out of Scope

* Changing any existing `--format json`, text, Markdown, or `--for-agent` bytes
  or semantics.
* Envelope support for `capabilities` catalog or any command other than
  `capabilities check`; DBCLI-PLAT-005 owns that expansion.
* Interactive, streaming, lifecycle, and meta invocations including `shell`,
  `es-shell`, `proxy`, `--help`, and `--version`.
* NDJSON, event streaming, timestamps, working directories, or raw argv.
* Correlation ids (DBCLI-PLAT-006), evidence creation or expansion
  (DBCLI-PLAT-007), and a second recovery format.
* Changing the safety meaning of `DBCLI_AGENT_MODE`.

## Inputs

* The exact root token `--agent-output`, valid only before the first subcommand.
* `capabilities check --require <ids>` and existing root selectors such as
  `--config`, `--use`, and `--global`.
* The resolved capability-check context: `engine`, `permission`, bounded
  `connectionName`, and `agentMode`, or no resolvable context.
* Existing strict Recovery Envelopes and bounded evidence identifiers when
  those optional fields are populated by later supported operations.

## Outputs

One compact UTF-8 JSON document followed by one newline on stdout, with stderr
empty:

```text
{
  schemaVersion: 1,
  ok: boolean,
  operation: string,
  status: "succeeded" | "failed",
  context: { engine, permission, connectionName, agentMode } | null,
  data: { required, results } | null,
  warnings: Array<{ code, message }>,
  evidence: Array<{ kind, id, digest? }>,
  recovery: RecoveryEnvelope | null,
  error: { code, message } | null
}
```

All ten top-level keys are always present and emitted in that order. Consumers
must address keys by name rather than depend on ordering.

## Rules

* R1: `OPERATION_ENVELOPE_SCHEMA_VERSION` is the integer `1`, independent of
  the npm, Capability Contract, Recovery Envelope, and Evidence Receipt
  versions. The v1 parser rejects every other version and every unknown field,
  including nested operation data. It also rejects an operation for which its
  build has no registered strict data schema; adding a supported operation
  extends v1 and requires an updated consumer parser, not a schema-version bump.
* R2: `operation` is a stable dotted identifier matching
  `^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$`. This Story emits only
  `capabilities.check`; it never contains raw argv, SQL, or paths.
* R3: `status` is transport state only. Its closed values are `succeeded` and
  `failed`, with `ok === (status === "succeeded")`. Capability availability and
  other domain outcomes remain in `data`.
* R4: Successful envelopes have `error: null`. Failed envelopes have a strict,
  non-null `{ code, message }`. Known messages are curated English; unknown
  exceptions become exactly `Agent output failed safely.` and raw
  `Error.message` is never emitted.
* R5: Requirements-unmet is a completed negative result: it retains safe
  `required` and `results` data, uses error code
  `CAPABILITY_REQUIREMENTS_UNMET`, and exits `1`. Pre-execution and unexpected
  internal failures use `data: null`.
* R6: Error and warning codes match
  `^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$` and are stable operation vocabulary rather
  than a closed envelope enum. A code's documented meaning never changes; new
  supported operations may add codes without changing the envelope schema
  version.
* R7: PLAT-004 capabilities and activation paths emit
  `INVALID_AGENT_OUTPUT_OPTIONS`, `UNSUPPORTED_AGENT_OUTPUT_OPERATION`,
  `INVALID_CAPABILITY_REQUIREMENTS`, `CAPABILITY_REQUIREMENTS_UNMET`,
  `AGENT_OUTPUT_LIMIT_EXCEEDED`, and `AGENT_OUTPUT_INTERNAL_ERROR`. The parser's
  safe code grammar is extensible; when recovery is non-null, the top-level
  error may instead use the matching existing Recovery Envelope code.
* R8: PLAT-004 warning codes are `DUPLICATE_CAPABILITY_REQUIREMENT`,
  `CAPABILITY_CONTEXT_UNAVAILABLE`, `CAPABILITY_CONTEXT_UNRESOLVABLE`, and
  `AGENT_MODE_RESTRICTION_ACTIVE`.
* R9: `context` is only the existing safe capability projection or `null`.
  `data` is the strict per-operation projection and does not repeat envelope
  `schemaVersion`, `ok`, `context`, or `warnings`.
* R10: Evidence entries are strict references with `kind` equal to `receipt`,
  `audit`, or `verification-artifact`; `id` matches
  `^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$`, and an optional digest matches
  `^sha256:[a-f0-9]{64}$`. They contain no path or embedded evidence body.
* R11: `recovery` is `null` or an existing strict `RecoveryEnvelope`. When
  present, its error `code` and `message` exactly match the top-level error. The
  enclosing contract additionally applies its 2,000-character free-text bound
  to embedded recovery strings without changing the standalone recovery schema.
* R12: Operation, code, and id strings are at most 160 characters; free-form
  messages are at most 2,000; `required`, `results`, and `warnings` are each
  capped at 128; `evidence` is capped at 16; and the final document is at most
  65,536 UTF-8 bytes including the trailing newline. Final-size overflow emits a
  small failed `AGENT_OUTPUT_LIMIT_EXCEEDED` envelope and exits `1`; it is never
  truncated into success.
* R13: The serializer emits compact JSON and one trailing newline in a stable
  field order. Identical inputs on the same build produce byte-identical output.
* R14: Once the exact `--agent-output` token occurs anywhere in argv, stdout is
  owned by agent presentation and stderr remains empty. A token after the
  subcommand is recognized only to return a structured invalid-options failure;
  it is never accepted there.
* R15: `--agent-output` conflicts with explicitly supplied `--format` and
  command-local `--for-agent`; defaults do not conflict. Unsupported and meta
  invocations fail before their action runs and never fall back to prose.
* R16: Existing exit semantics remain: `0` success, `1` unmet requirements or
  unexpected internal failure, and `2` invalid input or unsupported operation.
* R17: Agent envelope codes and messages are locale-independent English.
  Human-oriented output continues to honor its existing locale behavior.
* R18: The envelope is ephemeral. It is not persisted, is not evidence, and
  introduces no timestamp, correlation id, cwd, credential, connection string,
  raw row, unmasked SQL, absolute path, or raw error body.

## Expected Errors

* Missing, empty, or malformed `--require`: failed envelope with
  `INVALID_CAPABILITY_REQUIREMENTS`, `data: null`, exit `2`.
* Any unavailable or unknown required capability: failed envelope with
  `CAPABILITY_REQUIREMENTS_UNMET`, the complete bounded result data, exit `1`.
* `--agent-output` after the subcommand, or combined with an explicitly supplied
  `--format` or `--for-agent`: failed envelope with
  `INVALID_AGENT_OUTPUT_OPTIONS`, exit `2`.
* An unsupported command or meta invocation: failed envelope with
  `UNSUPPORTED_AGENT_OUTPUT_OPERATION`, exit `2`, and no action side effect.
* A missing or malformed `--require` caught by Commander or the command maps to
  `INVALID_CAPABILITY_REQUIREMENTS`; other unknown or conflicting options map to
  `INVALID_AGENT_OUTPUT_OPTIONS`. Both exit `2` without Commander prose.
* Unexpected command-tree load or runtime failure: failed envelope with
  `AGENT_OUTPUT_INTERNAL_ERROR`, the fixed safe message, and exit `1`.
* A field-level input overflow maps to its input error and exit `2`. Final
  serialized-size overflow maps to `AGENT_OUTPUT_LIMIT_EXCEEDED`, replaces the
  oversized result with one complete bounded failure envelope, and exits `1`.

## Dependencies

* `src/core/capabilities/` — existing strict check report and safe context.
* `src/core/recovery/` — existing strict Recovery Envelope and parser.
* `src/core/evidence-pack/` and `src/core/evidence-receipt/` — identifier and
  digest vocabulary; path-bearing shapes are not reused.
* `src/program-root.ts`, `src/program-lazy.ts`, `src/cli.ts`, and
  `src/cli-runtime.ts` — root option declaration and pre-Commander failure seam.
* ADR-0024 — activation, versioning, cardinality, and safety decisions.

## Constraints

* The implementation must reuse the existing Zod and strict-schema patterns; no
  new runtime dependency or second command tree.
* Core remains pure and writes no stdout or stderr. CLI presentation validates
  an envelope before writing it.
* `capabilities check` remains offline and does not mutate the filesystem.
* Existing `--format json`, `--for-agent`, `DBCLI_AGENT_MODE`, and version
  behavior are byte- and exit-compatible when `--agent-output` is absent. Root
  help changes only by intentionally documenting the new option and its one
  supported operation.
* PLAT-004 must not add speculative adapters for PLAT-005 through PLAT-007.

## Trust Boundary Fields

* `argv[]` — identifies the exact opt-in token, placement, operation, and
  conflicting user-supplied output options before Commander may emit prose.
* `--require <ids>` — user-controlled capability ids projected into bounded
  `required` and `results` arrays.
* `context.connectionName` — config-derived label projected through the existing
  bound; connection credentials and endpoints are never accepted.
* `context.engine`, `context.permission`, and `context.agentMode` — externally
  derived evaluation context constrained to existing vocabularies.
* `data` — operation-owned result projection constrained by the
  `capabilities.check` strict schema.
* `warnings[].code` and `warnings[].message` — derived diagnostic vocabulary and
  curated English text.
* `evidence[].kind`, `evidence[].id`, and `evidence[].digest` — external artifact
  references stripped of paths and embedded bodies.
* `recovery` — existing strict recovery data; its error must agree with the
  enclosing envelope.
* `error.code` and `error.message` — stable classification and curated text;
  arbitrary exception details never cross the boundary.
* Serialized stdout bytes — final 65,536-byte limit and single-document framing.
