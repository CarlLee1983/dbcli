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

Two boundaries carry values into this contract, and the same field name means a
different thing at each. dbcli *builds* an envelope from `argv`, the environment
and `config.json`; `parseOperationEnvelope(unknown)`, exported through
`@carllee1983/dbcli/core`, *reads* a whole document from a producer it does not
control. A field listed only under the second is one this Story never populates.

Entering from `argv`, the environment, or `config.json`:

* `process.argv` — scanned by `inspectAgentOutputInvocation` before Commander
  runs, to find the exact `--agent-output` token, its placement relative to the
  subcommand, the operation, and a conflicting explicit `--format` or
  `--for-agent`. No argv token is ever copied into the envelope.
* `data.required[]` and `data.results[].id` — the ids from `--require`, split
  and de-duplicated by `parseRequirements`, then admitted only if every id
  matches `CAPABILITY_ID_PATTERN` and is at most 160 characters and there are at
  most 128 of them (`validAgentRequirements`). Anything else becomes
  `INVALID_CAPABILITY_REQUIREMENTS` with `data: null` and the rejected text
  absent from stdout.
* `warnings[].message` — the duplicate-requirement warning interpolates the id
  the user typed. It is safe because that id has already passed
  `validAgentRequirements`, not because the text is curated; the other three
  warning messages are fixed English.
* `context.connectionName` — `config.effectiveConnectionName` read from
  `config.json`, truncated to 200 characters by the resolver and then refused
  outright above 160, which emits `AGENT_OUTPUT_INTERNAL_ERROR` and exit `1`
  rather than a shortened label.
* `context.engine` and `context.permission` — `config.connection.system` and
  `config.permission` from `config.json`, each admitted only as a member of its
  closed vocabulary; a value outside it resolves to no context at all rather
  than to a reported one.
* `context.agentMode` — the boolean `process.env.DBCLI_AGENT_MODE === '1'`. The
  variable is never echoed.

Entering through `parseOperationEnvelope(unknown)`, which trusts no key of the
document it is handed:

* `schemaVersion` — accepted only as the literal `1`; every other value,
  including a later one, is rejected rather than parsed optimistically.
* `operation` — accepted only from the registered enum, which is additionally
  held to the dotted-identifier pattern and the 160-character bound, so no raw
  argv, SQL, or path can occupy it.
* `ok` and `status` — a closed pair; `ok` must equal `status === "succeeded"`,
  so a document cannot claim success in one and failure in the other.
* `data` — accepted only as the strict per-operation projection, capped at 128
  `required` and 128 `results` that must agree in order, or as `null`. Unknown
  keys, including nested ones, are rejected, which is what refuses `data.rows`
  and `data.sql`.
* `warnings[].code` and `error.code` — bounded uppercase snake-case identifiers
  of at most 160 characters, an extensible grammar rather than a closed enum.
* `error.message` — at most 2,000 characters. An unexpected exception never
  reaches it: the presentation path substitutes the fixed
  `Agent output failed safely.` and the raw `Error.message` is discarded.
* `evidence[].kind`, `evidence[].id`, and `evidence[].digest` — references only:
  `kind` from the three-member enum, `id` matching
  `^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$`, an optional digest matching
  `^sha256:[a-f0-9]{64}$`, at most 16 entries, and no key that could carry a
  path or an embedded body. This Story always emits `evidence: []`.
* `recovery` — `null`, or a document the existing strict Recovery Envelope
  parser accepts whose error code and message match the enclosing error exactly
  and whose every nested string is within the 2,000-character bound. This Story
  always emits `recovery: null`.
* `context` — the same four fields as above plus nothing else; `context.password`,
  `context.connectionString` and `context.configPath` are refused as unknown
  keys, which is what the security fixture matrix asserts.

The 65,536-byte cap on the serialized document and its single-document,
single-trailing-newline framing are not fields and are stated as R12, R13 and
R14.
