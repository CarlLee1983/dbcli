# Acceptance Criteria

## Happy Path

* [x] `dbcli capabilities --format json` emits `schemaVersion: 1` and a non-empty
      capability array — `tests/integration/capabilities-command.test.ts`
* [x] `dbcli capabilities --format markdown` emits a table — same file
* [x] `dbcli capabilities` defaults to human-readable output — same file
* [x] `dbcli capabilities check --require schema.read,query.read` reports
      `available` and exits `0` on a supported engine with sufficient
      permission — same file
* [x] The agent-facing exports are reachable from `@carllee1983/dbcli/core` —
      `tests/unit/core-public.test.ts`

## Business Rules

* [x] Engine lists equal the `supported`/`limited` rows of
      `ENGINE_CAPABILITIES` — `tests/unit/core/capabilities/registry.test.ts`
* [x] `risk` is derived from the published side-effect tier — same file
* [x] Every `COMMAND_CAPABILITY_KEYS` entry is covered by a capability, and
      every capability names a real matrix key — same file
* [x] Ids are unique, sorted, and name abilities rather than jobs — same file
* [x] Identical input produces byte-identical output, and `required` and
      `results` hold the requested ids in first-seen input order while argument
      order changes neither any verdict nor `ok` — same file,
      `tests/unit/core/capabilities/check.test.ts` and
      `tests/docs/capability-ordering-parity.test.ts` (restated by
      DBCLI-PLAT-013; see its Superseded Behavior)
* [x] The strict schema rejects unknown fields and unknown schema versions —
      `tests/unit/core/capabilities/registry.test.ts`
* [x] Every catalogued command path exists in the live Commander tree —
      `tests/contract/capability-contract.test.ts`
* [x] `supportsJson` equals what the live tree offers, in both directions —
      same file
* [x] A capability claiming `requiresConnection: false` has a command whose
      import graph loads no adapter — same file

## Failure Cases

* [x] An unknown id is `unknown` with reason `unknown-capability`, exit `1` —
      `tests/unit/core/capabilities/check.test.ts`,
      `tests/integration/capabilities-command.test.ts`
* [x] An unsupported engine is `unavailable` with reason `engine`, exit `1` —
      same files
* [x] An insufficient permission is `unavailable` with reason `permission`,
      exit `1` — same files
* [x] A missing config yields `context: null` and reason
      `context-unavailable`, and never reports the default config's engine —
      same files
* [x] An empty `--require` exits `2` rather than reporting `ok` — same files
* [x] An unsupported `--format` exits `2` —
      `tests/integration/capabilities-command.test.ts`
* [x] A duplicate id is de-duplicated and warned about — same files

## Regression Requirements

* [x] Capability discovery loads no database adapter and creates no connection —
      `tests/contract/capability-contract.test.ts`
* [x] Neither command mutates the working directory —
      `tests/integration/capabilities-command.test.ts`
* [x] No credential, host or endpoint appears in either output — same file and
      `tests/unit/core/capabilities/registry.test.ts`
* [x] The engine vocabulary stays `postgresql` —
      `tests/unit/core/capabilities/registry.test.ts`
* [x] `agent-core` purity, core no-stdout, CLI contract, skill parity, platform
      parity and plugin sync gates all still pass — `make verify`

## Verification Notes

The full suite runs without external database services; the Elasticsearch,
live-DB and MySQL integration suites skip. Every assertion above holds without
them: no case in this Story needs a reachable database, which is the point.

## Addendum — code review follow-ups

* [x] Agent mode is part of the evaluated context, and configuration-changing
      capabilities are `unavailable` with reason `agent-mode` regardless of
      permission — `tests/unit/core/capabilities/check.test.ts`,
      `tests/integration/capabilities-command.test.ts`
* [x] `mutatesConfiguration` is never claimed by a capability whose command
      writes no configuration — `tests/contract/capability-contract.test.ts`
* [x] A present-but-unresolvable config reports `context-unresolvable`, never
      "no configuration was found", and leaks no filesystem path —
      `tests/integration/capabilities-command.test.ts`
* [x] `minimumPermission` derives from `minimumPermissionFor` rather than a
      transcribed ladder — `tests/unit/core/capabilities/registry.test.ts`
* [x] `limitedEngines` is the matrix `limited` subset, and is non-empty
      somewhere — same file
* [x] `DATABASE_SYSTEMS` matches the keys of `ENGINE_CAPABILITIES` —
      `tests/unit/adapters/database-systems-roster.test.ts`
* [x] "Mutates nothing on disk" is asserted recursively —
      `tests/integration/capabilities-command.test.ts`

### Known deviation — closed by DBCLI-PLAT-012

Recorded as accepted at delivery, and kept: it is what this Story shipped, and
deleting it would rewrite that. It no longer describes the product —
DBCLI-PLAT-012 moved the cache write to `src/core/schema-cache-persistence.ts`,
and `tests/integration/schema-cache-agent-mode.test.ts` asserts that
`capabilities check` and `dbcli schema` now agree under agent mode.

Under `DBCLI_AGENT_MODE=1`, `schema.read` / `schema.read-object` /
`schema.scan` report `available` although `dbcli schema` persists into
`config.json` and that write is refused. Marking them would make an agent
conclude schema cannot be read at all — a larger error in the opposite
direction. It deviates from R2's spirit rather than its letter (the capability
command does write config, incidentally). DBCLI-PLAT-012 moves cache
persistence out from behind the identity guard, which removes the cause.

## Addendum — connection attribution

* [x] A v2 default connection is named in `context.connectionName` even with no
      `--use` — `tests/integration/capabilities-command.test.ts`
* [x] A v1 single-connection config reports `connectionName: null` — same file
