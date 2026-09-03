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
10. `requiresConnection: true` is not independently proven; only the `false` direction is checked, since a false offline claim is the one that misleads — unverified: no test asserts that a connection-requiring command actually opens one

## Two things this slice got wrong first, and what caught them

Recorded because both were the *contract lying*, which is the failure mode this
work exists to prevent, and in both cases a test found it rather than a reader.

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
