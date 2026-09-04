# Acceptance Criteria

## Happy Path

* [x] `dbcli capabilities --format json` describes every public top-level
      command, or the catalog's absence of one is deliberate and recorded —
      `tests/contract/capability-contract.test.ts`
* [x] `dbcli capabilities check --require query.explain` reports `available` on
      a PostgreSQL connection and `unavailable` with reason `engine` on Redis —
      `tests/unit/core/capabilities/check.test.ts`
* [x] The catalog is still byte-identical across runs and still sorted by id —
      `tests/unit/core/capabilities/registry.test.ts`

## Business Rules

* [x] Every new `supported` / `limited` claim is backed by a cited `file:line`
      or a named test, listed in this Story's evidence table —
      `specs/stories/DBCLI-PLAT-011-complete-capability-matrix/story.md`
* [x] Engines and risk stay derived from `ENGINE_CAPABILITIES`; no engine list
      is written literally in the registry —
      `tests/unit/core/capabilities/registry.test.ts`
* [x] Every `COMMAND_CAPABILITY_KEYS` entry is covered by a capability and every
      capability names a real matrix key — same file
* [x] Every catalogued command path exists in the live Commander tree, and the
      declared JSON surface equals what the tree offers, in both directions —
      `tests/contract/capability-contract.test.ts`
* [x] A capability claiming `requiresConnection: false` has a command whose
      import graph loads no adapter — same file
* [x] `mutatesConfiguration` is claimed only where the import graph reaches a
      configuration writer — same file
* [x] `supportsEvidence` is claimed exactly where the command writes a
      verification artifact or evidence pack — same file
* [x] No status outside the existing four appears in the matrix —
      `tests/unit/adapters/capabilities.test.ts`
* [x] `CAPABILITY_CONTRACT_SCHEMA_VERSION` is unchanged: entries were added, the
      shape was not — `tests/unit/core/capabilities/registry.test.ts`

## Failure Cases

* [x] A capability whose engine support the audit could not settle reports
      `unavailable` with reason `engine` rather than `available` —
      `tests/unit/core/capabilities/check.test.ts`
* [x] An unknown id still reports `unknown` with reason `unknown-capability` —
      same file
* [x] A SQL-only capability is `unavailable` with reason `engine` on mongodb,
      redis and elasticsearch — same file

## Regression Requirements

* [x] `capabilities` still opens no database connection and loads no adapter,
      with sixteen more commands described —
      `tests/contract/capability-contract.test.ts`
* [x] No credential, host, port or endpoint appears in the catalog —
      `tests/unit/core/capabilities/registry.test.ts`
* [x] The reference's "Scope of v1" paragraph and its five mirrors no longer
      list commands that are now catalogued —
      `tests/docs/capability-scope-parity.test.ts`
* [x] `make verify` passes in full

## Verification Notes

Nothing here needs a reachable database: the catalog is static and
`capabilities check` reads only the local configuration. `make verify` still
requires the `docker-compose.test.yml` services for the rest of the suite.

The evidence table in `story.md` is the audit record. A claim without a row
there is a claim nobody checked, which is the failure this Story exists to
avoid.
