# Story: DBCLI-PLAT-001 Capability Contract, Discovery and Requirement Check

## Goal

An external Skill — a CRUD Skill, a CQRS Skill, a DBA Operator Skill — can ask
dbcli what it is able to do, and whether those abilities are available in this
project, before it starts working, and can parse the answer.

## Context

dbcli provides atomic database abilities. It does not carry job knowledge. The
layering is `Story + Project AGENTS.md + Role Skill + Method Skill + Tool Skill
+ dbcli`: dbcli answers "what can be done", the dbcli Skill answers "how to
operate dbcli safely", and Role/Method Skills answer "how this job works".

Today the only machine-readable description of dbcli's abilities is `--help`,
which is prose. `src/adapters/capabilities.ts` already holds a per-engine ×
per-command support matrix, but nothing exposes it to a caller and nothing
gives an ability a stable name.

The trap this Story exists to avoid is writing a *second* table of what each
command supports per engine. Two tables disagree the first time an engine gains
support for something, silently.

## Classification

* Security sensitive: no
* Baseline conformance: no

## Scope

### In Scope

* A versioned capability contract in `src/core/capabilities/`, deriving every
  engine and risk claim from `ENGINE_CAPABILITIES`.
* `dbcli capabilities` with `text`, `json` and `markdown` output.
* `dbcli capabilities check --require <ids>` with `text` and `json` output.
* Agent-facing export of the pure types and functions through
  `@carllee1983/dbcli/core`.
* Unit, contract and integration tests, and an ADR.
* User documentation in both languages and both formats, plus Skill mirrors.

### Out of Scope

* Changing any existing command's `--format json` output.
* An Operation Envelope, correlation id, or evidence expansion.
* Executing Task Packs, or validating `safety.requires` against capability ids.
* Extending `ENGINE_CAPABILITIES` to the commands it does not yet cover.
* CRUD, CQRS or DBA behaviour inside dbcli core.

## Inputs

* `--require <ids>`: a comma-separated, non-empty list of capability ids.
* `--format <type>`.
* The local dbcli configuration, read for engine and permission only.
* The global `--use` / `--config` / `--global` connection selectors.

## Outputs

* A capability catalog: `schemaVersion` plus capabilities sorted by id.
* A check report: `schemaVersion`, `ok`, `required`, `context`, `results`,
  `warnings`.
* Exit codes `0` (all available), `1` (any unavailable or unknown), `2`
  (invalid input).

## Rules

* R1: Every `engines` and `risk` value is derived from `ENGINE_CAPABILITIES`;
  none is written literally in the capability registry.
* R2: Neither command opens a database connection or mutates the filesystem.
* R3: An unknown capability id is `unknown`, never `available`, and is never
  resolved to a similar-looking id.
* R4: With no readable local config the context is `null` and every known
  capability is `unavailable` with reason `context-unavailable`. The default
  config is never reported as if it were configured.
* R5: Output is deterministic: sorted by id, byte-identical across runs of the
  same build, and independent of `--require` argument order.
* R6: No credential, host, port, connection string or data row appears in any
  output.
* R7: The engine vocabulary is `DatabaseSystem` (`postgresql`). No third
  spelling is introduced.
* R8: `CAPABILITY_CONTRACT_SCHEMA_VERSION` is independent of the npm version.

## Expected Errors

* Empty `--require`, or an empty element within it: exit `2`.
* An unsupported `--format` value: exit `2`.
* A duplicate id in `--require`: de-duplicated in first-seen order, reported in
  `warnings`, exit unaffected.

## Dependencies

* `src/adapters/capabilities.ts` — the engine support matrix.
* `src/core/permission/rank.ts` — the permission ladder.
* `src/core/config.ts` — the single config reader.

## Constraints

* The contract may not live under `src/agent-core/`: the purity gate forbids
  the word `postgresql` there.
* No second database execution path, and no weakening of permission,
  blacklist, write gate, audit, redaction or deny-by-default behaviour.
