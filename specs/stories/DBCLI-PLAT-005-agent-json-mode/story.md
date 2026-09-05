# Story: DBCLI-PLAT-005 Opt-in Agent JSON Mode

## Goal

An external Skill or agent can discover dbcli's complete static capability catalog
through the machine-readable Operation Envelope v1 via `capabilities.list` (invoked as
`dbcli --agent-output capabilities`), inspect per-subcommand JSON availability across
the catalog, and receive consistent, bounded, fail-closed JSON envelopes for catalog
discovery without prose scraping or schema drift.

## Context

DBCLI-PLAT-004 established the Operation Envelope v1 format (`schemaVersion: 1`, ten
fixed top-level keys, single-document stdout output) and activated it end-to-end for
`capabilities check` (`operation: "capabilities.check"`).

However, `capabilities` catalog enumeration was deliberately left out of PLAT-004
envelope support. Furthermore, while certain multi-level command families (e.g.
`blacklist`, `migrate`, `queries`, `audit`, `verification`, `proxy`) offer `--format json`
on specific subcommands, their root capability declarations previously exposed only a single
boolean `supportsJson` reflecting top-level options, or lacked per-subcommand JSON clarity.

DBCLI-PLAT-005 expands Operation Envelope v1 to support static catalog discovery
(`capabilities.list`) and clarifies per-subcommand JSON granularity within the
capability catalog while preserving backward compatibility with all existing human,
`--format json`, and `--for-agent` consumers.

## Classification

* Security sensitive: yes
* Baseline conformance: no

## Scope

### In Scope

* Expanding Operation Envelope v1 registered operations to include `capabilities.list`
  in addition to `capabilities.check`.
* Validating `data` in `capabilities.list` with the strict `CapabilityCatalogSchema`
  (containing `schemaVersion: 1` and `capabilities: Capability[]`).
* Wire root-level opt-in: `dbcli --agent-output capabilities` emits one compact
  Operation Envelope v1 on stdout with `operation: "capabilities.list"` and exit code `0`.
* Preflight support in `inspectAgentOutputInvocation` for both `capabilities check` and
  `capabilities` catalog enumeration.
* Exposing and verifying per-subcommand JSON granularity across capability discovery,
  ensuring external agents can discern which commands and subcommands support JSON.
* Pure contract export updates in `@carllee1983/dbcli/core` and type refinements.
* Unit, contract, integration, and security fixture verification.
* Updating root help messages, user documentation (English and Traditional Chinese,
  Markdown and HTML), assets (`assets/SKILL.md`, `assets/SKILL.zh-TW.md`, `assets/reference.md`),
  and skill mirrors.

### Out of Scope

* Modifying any existing non-agent output bytes: `--format json`, text, or markdown
  for `dbcli capabilities` remain 100% byte-identical when `--agent-output` is not passed.
* Adding speculative `--agent-output` support to commands beyond `capabilities` and
  `capabilities check`.
* Interactive, streaming, lifecycle, and meta commands (`shell`, `es-shell`, `proxy`,
  `--help`, `--version`).
* Introducing correlation IDs (reserved for DBCLI-PLAT-006) or evidence persistence
  (reserved for DBCLI-PLAT-007).
* Changing the schema version of Operation Envelope (remains `schemaVersion: 1`).

## Inputs

* The root option `--agent-output`, positioned before the subcommand.
* The subcommand `capabilities` (without arguments) or `capabilities check --require <ids>`.
* CLI options: `--format` or `--for-agent` when provided alongside `--agent-output`
  remain invalid and trigger structured option failure.

## Outputs

One compact UTF-8 JSON document followed by a single newline on stdout, with stderr empty:

```text
{
  schemaVersion: 1,
  ok: boolean,
  operation: "capabilities.check" | "capabilities.list",
  status: "succeeded" | "failed",
  context: { engine, permission, connectionName, agentMode } | null,
  data: CapabilityCatalog | OperationEnvelopeCapabilitiesCheckData | null,
  warnings: Array<{ code, message }>,
  evidence: Array<{ kind, id, digest? }>,
  recovery: RecoveryEnvelope | null,
  error: { code, message } | null
}
```

For `capabilities.list`:
* `operation`: `"capabilities.list"`
* `status`: `"succeeded"`
* `ok`: `true`
* `context`: `null` (the catalog is static and engine-independent)
* `data`: `{ schemaVersion: 1, capabilities: [...] }` strictly matching `CapabilityCatalogSchema`
* `warnings`: `[]`
* `evidence`: `[]`
* `recovery`: `null`
* `error`: `null`

## Rules

* R1: `OPERATION_ENVELOPE_SCHEMA_VERSION` remains integer `1`. Both `capabilities.check`
  and `capabilities.list` are registered v1 operations. The parser rejects unknown operations.
* R2: `data` is strictly validated according to the `operation` field:
  - When `operation === 'capabilities.check'`, `data` satisfies `capabilitiesCheckDataSchema`.
  - When `operation === 'capabilities.list'`, `data` satisfies `CapabilityCatalogSchema`.
* R3: Invariant `ok === (status === "succeeded")` holds universally. For `capabilities.list`,
  a successful emission always has `ok: true`, `status: "succeeded"`, `error: null`, and `data` non-null.
* R4: Operation ID grammar remains `^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$`.
* R5: For `capabilities.list`, the catalog is serialized within the envelope. The total size
  remains bounded under 65,536 UTF-8 bytes (actual serialized size is ~22.5 KiB). If an envelope
  exceeds 65,536 bytes, it fails closed with `AGENT_OUTPUT_LIMIT_EXCEEDED` and exit code `1`.
* R6: `--agent-output` with `capabilities` must precede the subcommand. If placed after
  `capabilities` or combined with `--format` or `--for-agent`, it fails closed with
  `INVALID_AGENT_OUTPUT_OPTIONS` and exit code `2`.
* R7: Unsupported operations or meta flags combined with `--agent-output` fail closed with
  `UNSUPPORTED_AGENT_OUTPUT_OPERATION` and exit code `2`.
* R8: Error and warning codes remain bounded uppercase snake-case identifiers.
* R9: Serialization is deterministic, compact JSON followed by a single newline.
* R10: The capability catalog in `data` accurately reflects subcommand JSON support, allowing
  external agents to inspect granular command surface capabilities without false negatives.

## Expected Errors

* `dbcli capabilities --agent-output`: failed envelope with `INVALID_AGENT_OUTPUT_OPTIONS`, exit `2`.
* `dbcli --agent-output capabilities --format json`: failed envelope with `INVALID_AGENT_OUTPUT_OPTIONS`, exit `2`.
* `dbcli --agent-output unsupported_cmd`: failed envelope with `UNSUPPORTED_AGENT_OUTPUT_OPERATION`, exit `2`.
* Command-tree load or unexpected runtime failure: failed envelope with `AGENT_OUTPUT_INTERNAL_ERROR`,
  curated safe message `"Agent output failed safely."`, exit `1`.
* Serialized envelope exceeding 64 KiB: `AGENT_OUTPUT_LIMIT_EXCEEDED`, exit `1`.

## Dependencies

* `src/core/capabilities/` — static capability catalog and schemas (`CapabilityCatalogSchema`).
* `src/core/operation-envelope.ts` — Operation Envelope v1 contract and parser.
* `src/utils/agent-output.ts` — preflight inspection and failure emitters.
* `src/commands/capabilities.ts` — `capabilities` and `capabilities check` actions.

## Constraints

* Strict zero-leakage: zero credentials, zero SQL, zero paths, zero unhandled exception traces.
* Core remains pure: no stdout/stderr writes in `src/core/`.
* No regression to existing output: `capabilities --format json`, `capabilities --format markdown`,
  and text output remain unchanged when `--agent-output` is absent.
* Full gate verification: `make verify` must pass with 100% success.

## Trust Boundary Fields

* `argv[]` — parsed during preflight to detect `--agent-output` and enforce placement rules.
* `data.capabilities` — static capability objects emitted in `capabilities.list`. Must contain
  no dynamic environment variables, paths, or database credentials.
* `error.code` and `error.message` — stable curated English strings.
* Serialized stdout bytes — must never exceed 65,536 UTF-8 bytes.

## Superseded Behavior

* `src/core/operation-envelope.ts`: previously constrained `operation` exclusively to `capabilities.check`.
  Now supports registered union of `capabilities.check` and `capabilities.list`.
* `src/utils/agent-output.ts`: previously rejected `dbcli --agent-output capabilities` as unsupported operation.
  Now accepts `capabilities` as a valid entry point.
