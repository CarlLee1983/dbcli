# Read-only Task Packs plan in agent mode

## Goal

An agent running under `DBCLI_AGENT_MODE=1` can produce a plan from every
built-in Task Pack. Today `skill tasks plan` checks the pack's required
capabilities before planning (`src/commands/skill-tasks.ts:216-224`), agent
mode refuses every capability marked `mutatesConfiguration`
(`src/core/capabilities/check.ts:110-112`), and `blacklist.manage` carries that
mark (`src/core/capabilities/registry.ts:244-252`). On `main` at `54c13360`,
fourteen built-in packs require `blacklist.manage`; thirteen of them only run
`blacklist list`, and `connection-health` runs no blacklist command at all. No
built-in pack runs a `blacklist table|column add|remove` subcommand. So every
one of those packs is refused under agent mode although none mutates
configuration.

This Story implements ADR-0029
(`docs/adr/ADR-0029-reading-the-blacklist-is-its-own-capability.md`):

- A new capability `blacklist.read`, command path `blacklist list`, with its
  own engine-matrix key `blacklistRead` marked `readonly` and
  `mutatesConfiguration: false`. Every per-engine override that the
  `blacklist` key has (`src/adapters/capabilities.ts:491`, `:535`, `:575`) gets
  a matching `blacklistRead` override, so an engine without blacklist support
  reports `blacklist.read` unavailable too.
- `blacklist.manage` is unchanged and stays a configuration-mutating
  capability.
- The thirteen packs that run `blacklist list` require `blacklist.read`
  instead of `blacklist.manage`; `connection-health` drops the requirement.
- The legacy requirement name `blacklist-list`, which the parser rejects with
  its replacement (`src/core/agent-tasks/parser.ts:192-195`,
  `assets/tasks/README.md:35-36`), names `blacklist.read` as the replacement.
- ADR-0029 and the `CONTEXT.md` Capability entry, already written in the
  working tree, land with this Story.

Tests that pin `blacklist.manage` as a pack requirement change with the packs;
this is the requirement changing, not a test being weakened.

## Out of Scope

- Agent mode, `mutatesConfiguration` semantics, the permission ladder, the
  blacklist itself, the write gate, or any other safety boundary.
- Splitting `blacklist.manage` into finer mutating capabilities, or changing
  its matrix key.
- `CAPABILITY_CONTRACT_SCHEMA_VERSION` (the catalog's shape does not change).
- The `connection.*` capabilities.
- Changes to pack steps or Agent Notes other than their `requires` lists.
- Releasing: version numbers, tags, `CHANGELOG.md`, push, merge.

## Acceptance Criteria

1. A new test registers `skill tasks plan` on a Commander root, uses an
   agent-mode config fixture that passes config integrity verification, sets
   `DBCLI_AGENT_MODE=1`, and plans every built-in pack with the parameters it
   requires. On `main` at `54c13360` it fails with `agent-mode` refusals; after
   the change every pack produces a plan.
2. Under the same mode, `checkCapabilities` reports `blacklist.manage`,
   `connection.init`, `connection.select`, and `connection.rotate-credential`
   as `unavailable` with reason `agent-mode`.
3. The capability catalog lists `blacklist.read` with side effect `readonly`,
   command path `blacklist list`, and `mutatesConfiguration: false`; the
   existing registry, capability contract, and capability catalog tests pass.
4. No file under `assets/tasks/` requires `blacklist.manage`, and
   `connection-health` requires no blacklist capability.
5. A pack declaring `blacklist-list` is rejected with a message naming
   `blacklist.read`.
6. Missing／invalid config, unknown capability, unsupported engine, and
   insufficient permission still fail closed (existing tests pass).
7. `make verify` passes.
