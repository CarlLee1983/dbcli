# Implementation plan — Agent Integration Contract v1

Design record: [`docs/specs/2026-09-04-agent-integration-contract-v1.md`](../specs/2026-09-04-agent-integration-contract-v1.md).
Decision: [ADR-0022](../adr/0022-the-capability-catalog-is-derived-from-the-engine-matrix.md).
Story: `specs/stories/DBCLI-PLAT-001-capability-contract/`.

This plan covers the first vertical slice only. Everything after it is backlog.

## Delivered in this slice

1. `DATABASE_SYSTEMS` roster in `src/adapters/types.ts`, with a compile-time
   exhaustiveness assertion so a new engine cannot be added to the union
   without appearing in the runtime list.
2. `src/core/permission/rank.ts` — the permission ladder extracted so the
   capability contract reuses one authority instead of copying it.
   `permission-guard.ts` re-exports it; no caller changes.
3. `src/core/capabilities/` — `types`, `registry`, `check`, `schema`, `index`.
4. `src/commands/capabilities.ts`, registered on both the eager and lazy paths.
5. Agent-facing export through `src/core/public.ts`.
6. Tests: unit, contract, integration, and public-surface.
7. Documentation: reference, both SKILL locales, all four `docs/user` files,
   ten generated platform mirrors, CONTEXT, CHANGELOG.

**Acceptance criteria:**

1. The catalog derives every engine and risk claim from `ENGINE_CAPABILITIES`, and every matrix key is covered — covered by: `tests/unit/core/capabilities/registry.test.ts`
2. Output is deterministic, uniquely keyed, and free of credentials, hosts and endpoints — covered by: `tests/unit/core/capabilities/registry.test.ts`
3. The strict schema rejects unknown fields and unknown schema versions — covered by: `tests/unit/core/capabilities/registry.test.ts`
4. Unknown ids, unsupported engines, insufficient permission and missing config all fail closed — covered by: `tests/unit/core/capabilities/check.test.ts`
5. Every catalogued command path exists in the live Commander tree, and `supportsJson` matches it in both directions — covered by: `tests/contract/capability-contract.test.ts`
6. Capability discovery loads no database adapter, and a capability claiming no connection has a command whose import graph loads none either — covered by: `tests/contract/capability-contract.test.ts`
7. `dbcli capabilities` emits text, JSON and markdown, deterministically, touching nothing on disk — covered by: `tests/integration/capabilities-command.test.ts`
8. `dbcli capabilities check` honours `--config` and the root `--use`, returns exit codes `0`/`1`/`2`, and echoes no credential or endpoint — covered by: `tests/integration/capabilities-command.test.ts`
9. The contract is reachable and round-trip validatable from `@carllee1983/dbcli/core` — covered by: `tests/unit/core-public.test.ts`
10. Agent mode makes configuration-changing capabilities unavailable, and leaves the rest alone — covered by: `tests/unit/core/capabilities/check.test.ts`, `tests/integration/capabilities-command.test.ts`
11. `mutatesConfiguration` is never claimed by a capability whose command writes no configuration — covered by: `tests/contract/capability-contract.test.ts`
12. A config that exists but will not resolve is reported as such, and leaks no filesystem path — covered by: `tests/integration/capabilities-command.test.ts`
13. `minimumPermission` comes from the runtime permission ladder rather than a transcription — covered by: `tests/unit/core/capabilities/registry.test.ts`
14. `DATABASE_SYSTEMS` matches the keys of `ENGINE_CAPABILITIES` — covered by: `tests/unit/adapters/database-systems-roster.test.ts`
15. `requiresConnection: true` is not independently proven; only the `false` direction is checked, since a false offline claim is the one that misleads — unverified: no test asserts that a connection-requiring command actually opens one
16. Under `DBCLI_AGENT_MODE=1`, `schema.read` reports `available` and `dbcli schema` succeeds there — covered by: `tests/integration/schema-cache-agent-mode.test.ts` (shipped as a known deviation and closed by DBCLI-PLAT-012, which moved the cache write out from behind the identity guard)

## Five things this slice got wrong first, and what caught them

Recorded because every one was the *contract lying*, which is the failure mode
this work exists to prevent, and not one was found by reading the code.

1. **`capabilities check` reported `engine: postgresql, permission: query-only`
   in a directory with no config at all.** `configModule.read` returns
   `DEFAULT_CONFIG` when none exists. Fixed by establishing config existence
   first; asserted by "a missing config reports context unavailable rather than
   assuming a default", which also asserts the string `postgresql` is absent
   from that output.
2. **`supportsJson` was hand-listed and wrong for four commands.** `queries`,
   `migrate` and `blacklist` were claimed to offer JSON when only their
   subcommands do; `use` was claimed not to when it does. The bidirectional
   parity test against the live Commander tree found all four.
3. **`connectionName` was `null` for a v2 default connection**, because it read
   `--use` rather than what the reader resolved. Found by probing an env-ref
   MongoDB config for credential leakage; nothing leaked, but the verdict was
   unattributable.
4. **`available` was reported under `DBCLI_AGENT_MODE=1` for capabilities that
   agent mode refuses outright** — `connection.select`, `connection.init`,
   `blacklist.manage`. Found in code review. This was the worst of the five: the
   contract's primary consumer is the agent the flag describes, and this was the
   one promise it would have acted on and found false. Agent mode is now a
   context field with its own reason, and a contract test derives the marked set
   from the command layer's real config-writing calls.
5. **A bare `catch` collapsed five situations into one false warning.** An
   unset `{"$env":...}` password, a v1 config given `--use`, a production
   connection needing an explicit selector, an agent-mode integrity failure and
   corrupt JSON all reported "no configuration was readable". Only the last is
   even close to true. Also found in review. `context-unresolvable` is now a
   separate reason, and a non-`ConfigError` is rethrown instead of swallowed.

## Not done, deliberately

* No existing `--format json` output was changed.
* No Operation Envelope, correlation id or evidence expansion.
* Task Packs remain `plan-only`; `safety.requires` is untouched.
* `ENGINE_CAPABILITIES` was not extended, so sixteen commands are absent from
  the catalog and return `unknown`. That is a known, documented boundary
  (DBCLI-PLAT-011), not an oversight.

## Rollback

Every commit carries a `Story: DBCLI-PLAT-001` trailer on a dedicated branch.
Reverting the branch removes the command, the core module and the docs; the
only edits to pre-existing behaviour are the `permission-guard.ts` re-export
and the `DATABASE_SYSTEMS` addition, both additive.
