# Reading the blacklist is its own capability

* Status: accepted
* Date: 2026-10-17

## Context

Agent mode refuses every capability marked `mutatesConfiguration`, and
`blacklist.manage` carries that mark because the `blacklist table|column add|remove`
subcommands rewrite the config. Fourteen built-in Task Packs declare
`blacklist.manage`, yet none of them mutates the blacklist: thirteen only run
`blacklist list`, and `connection-health` runs no blacklist command at all.
Under `DBCLI_AGENT_MODE=1`, `skill tasks plan` therefore refuses every
read-only pack before producing a plan (issue #222, A1).

The capability side effect is read from the engine matrix by key, and no two
capabilities share a key. A read capability that reused the `blacklist` key
would publish `sideEffect: local-write`.

## Decision

Add `blacklist.read`: command path `blacklist list`, its own engine-matrix key
`blacklistRead` marked `readonly`, `mutatesConfiguration: false`, with the same
per-engine overrides the `blacklist` key has. `blacklist.manage` keeps its key
and stays a configuration-mutating capability. Read-only packs require
`blacklist.read`; `connection-health` drops the requirement; the legacy alias
`blacklist-list` maps to `blacklist.read`.

Capabilities split by their effect on configuration, not by command. The two
blacklist keys are deliberate and must not be merged back into one.

Rejected alternative: read-only packs declare no blacklist capability at all,
as the integration-kit pack already does. That is simpler, but blacklist
support differs per engine, so the pack would fail at the step instead of being
refused by `checkCapabilities` before a plan exists.

## Consequences

The capability catalog gains one id; its shape is unchanged, so
`CAPABILITY_CONTRACT_SCHEMA_VERSION` does not move. Tests that pin
`blacklist.manage` as a pack requirement change with the packs.

**Falsified if:** `blacklist.read` in `src/core/capabilities/registry.ts`
shares its matrix key with `blacklist.manage`, or is marked
`mutatesConfiguration`; or `blacklistRead` in `src/adapters/capabilities.ts`
is not `readonly` for an engine whose `blacklist` key is supported; or a
built-in pack under `assets/tasks/` that never runs a `blacklist table|column add|remove`
subcommand requires `blacklist.manage`.
