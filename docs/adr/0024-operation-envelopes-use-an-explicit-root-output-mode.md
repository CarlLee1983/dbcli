---
status: accepted
date: 2026-09-04
---

# Operation envelopes use an explicit root output mode

An Operation Envelope is an ephemeral, versioned response for one finite dbcli
invocation. It is enabled by an invocation-scoped root option rather than an
environment variable or proxy subcommand: the choice is explicit at the call
site, does not conflate output with the safety semantics of `DBCLI_AGENT_MODE`,
and does not require a second command tree. Existing `--format json` and
command-local `--for-agent` behavior remain unchanged.

DBCLI-PLAT-004 defines the strict contract and parser and wires one representative
finite command as an end-to-end proof. DBCLI-PLAT-005 owns broader command and
subcommand coverage. Interactive, streaming, lifecycle, and meta invocations such
as `shell`, `es-shell`, `proxy`, `--help`, and `--version` are outside the
PLAT-004 promise.

The envelope is not an Evidence Receipt or a verification verdict. Its `evidence`
field contains only bounded references to the existing evidence subsystem; it
never embeds a receipt or creates a second evidence format.

The root option is spelled `--agent-output` and must precede the subcommand.
Combining it with an explicitly supplied `--format` or command-local
`--for-agent` is rejected instead of applying an implicit precedence rule;
command defaults do not conflict. The initial end-to-end integration is
`capabilities check`, whose offline success and unmet-requirements paths cover
both result classes without adding a database fixture.

An opted-in finite invocation writes exactly one complete JSON document to
stdout. NDJSON and streaming event protocols are separate future contracts.
Operation-envelope versions are independent positive integers, beginning at
`schemaVersion: 1`; the v1 parser accepts only that literal version. Changing a
field, its requiredness, an enum, or the established meaning of a value requires
a new envelope schema version.

This decision supersedes the preliminary nine-field PLAT-004 list and sample
`status: "success"` shape in issue #154 and the Agent Integration Contract v1
follow-up table. The accepted v1 contract has ten always-present keys, including
the safe `error` carrier, a dotted operation id, and the transport statuses
`succeeded | failed`.

Using `--agent-output` with an unsupported interactive, streaming, lifecycle, or
meta invocation fails closed before that invocation runs. It returns one bounded,
machine-readable error and a non-zero exit code; it never ignores the option or
falls back to human-oriented output.

`operation` is a bounded dotted identifier such as `capabilities.check`, matching
`^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$`, never raw argv, SQL, or a path. The
envelope transport status is the closed pair
`succeeded | failed`, with the invariant
`ok === (status === "succeeded")`. Domain statuses such as capability
availability, mutation cancellation, dry-run, and verification outcomes stay in
`data`.

Every envelope has an `error` field. It is either `null` or a strict, bounded
`{ code, message }` object; raw `Error.message` values and arbitrary detail maps
are not part of the contract. For `capabilities.check`, `context` is either
`null` or the existing safe projection of `engine`, `permission`, bounded
`connectionName`, and `agentMode`. The operation-specific `data` schema contains
only `required` and `results`; values already represented by envelope fields are
not nested again. `data` is strictly validated for its operation rather than
accepted as arbitrary JSON.

Warnings are strict `{ code, message }` records. Evidence entries are strict
`{ kind, id, digest? }` references for receipts, audits, or verification
artifacts; paths and embedded evidence bodies are forbidden. `recovery` is
either `null` or the existing strict `RecoveryEnvelope`, reusing its classifier,
parser, and step limits instead of creating a second recovery contract.

The complete serialized envelope is limited to 64 KiB and free-form text to
2,000 characters. Collections have field-specific limits. A value that cannot
fit the contract fails closed; it is never truncated into an apparently
successful result.

Agent output preserves existing process semantics: success exits `0`, an unmet
capability requirement or unexpected internal failure exits `1`, and invalid
input or an unsupported operation exits `2`. Once the exact `--agent-output`
token is present anywhere in argv, the entrypoint owns failure presentation:
stdout contains exactly one envelope and stderr remains empty. A token placed
after the subcommand is still recognized for this purpose but is rejected as an
invalid option rather than accepted or allowed to fall through to Commander
prose.

Successful envelopes have `error: null`. Every failed envelope has a non-null
error. A completed negative domain result, such as unmet capability
requirements, retains its safe `data`; failures before execution and unexpected
internal failures use `data: null`. Error and warning codes are stable, bounded,
uppercase snake-case identifiers matching
`^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$`. They are extensible operation vocabulary,
not a closed envelope enum, so adding a code does not itself change the envelope
schema.

The PLAT-004 capabilities and activation paths emit
`INVALID_AGENT_OUTPUT_OPTIONS`, `UNSUPPORTED_AGENT_OUTPUT_OPERATION`,
`INVALID_CAPABILITY_REQUIREMENTS`, `CAPABILITY_REQUIREMENTS_UNMET`,
`AGENT_OUTPUT_LIMIT_EXCEEDED`, and `AGENT_OUTPUT_INTERNAL_ERROR`. These are not
the parser's exhaustive allowed set: when recovery is non-null, the top-level
error may use the matching existing Recovery Envelope code. PLAT-004's warning
codes are
`DUPLICATE_CAPABILITY_REQUIREMENT`,
`CAPABILITY_CONTEXT_UNAVAILABLE`, `CAPABILITY_CONTEXT_UNRESOLVABLE`, and
`AGENT_MODE_RESTRICTION_ACTIVE`.

Serialization is compact JSON followed by one newline. The serializer emits a
stable field order for reproducible fixtures, but consumers must use keys rather
than order. Operation, code, and id strings are at most 160 characters; evidence
ids reuse `^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$` and digests use
`^sha256:[a-f0-9]{64}$`. Messages are at most 2,000; `required`, `results`, and
`warnings` are each capped at 128; `evidence` is capped at 16; and the final
UTF-8 document, including its newline, is capped at 65,536 bytes. An otherwise
valid result that exceeds the final limit becomes a small failed envelope with
`AGENT_OUTPUT_LIMIT_EXCEEDED` and exit `1`. When recovery is present, its error
`code` and `message` exactly equal the top-level error or strict parsing fails.

PLAT-004 adds no timestamp, correlation id, or working directory. Correlation is
owned by PLAT-006 and durable provenance by Evidence Receipts. Regression tests
compare unchanged `--format json` success and requirements-unmet output against
checked-in byte fixtures captured from baseline commit `4aa8c183` before product
source changes. Repeated post-change runs additionally prove determinism; they
are not used as evidence of backward compatibility.

Known Commander input failures remain input failures: a missing or malformed
`--require` maps to `INVALID_CAPABILITY_REQUIREMENTS` and other option conflicts
or unknown options map to `INVALID_AGENT_OUTPUT_OPTIONS`, all with exit `2`.
Only command-tree loading and unexpected action failures map to
`AGENT_OUTPUT_INTERNAL_ERROR` and exit `1`. Root help intentionally gains the
visible `--agent-output` option; absent opt-in, all other help content and legacy
command output remain unchanged.
