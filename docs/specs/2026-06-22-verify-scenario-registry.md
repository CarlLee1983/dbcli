# Verify Scenario Registry Design Specification

**Date:** 2026-06-22  
**Status:** Implemented (2026-06-22) — retained as a design record  
**Baseline:** dbcli v1.36.0 verify scenario runner suite

> **Verification note (2026-06-22):** All goals and acceptance criteria below are
> implemented and merged (`refactor/verify-scenario-registry`, merge `129ee5b`;
> commits `4ecad3d` test-first invariants, `7458ba2` registry wiring, `a10cc83`
> help-surface regression). The registry types live in
> `src/core/verify/registry.ts` (re-exported from `src/core/verify/index.ts`).
> `src/commands/verify.ts` now defines each built-in scenario as a
> `VerifyScenarioDefinition` (`safeBackfillScenario`, `migrationScenario`),
> collects them in `BUILTIN_VERIFY_SCENARIOS`, and registers/executes them through
> a shared `registerScenario` + `executeScenario` lifecycle loop instead of
> hand-written parent-command blocks — satisfying §10 acceptance criteria.
> Covered by `tests/unit/core/verify/registry.test.ts` (invariants: exact built-in
> names, uniqueness, CLI-safe names, declared `subjectKind`, required lifecycle
> hooks), `tests/integration/verify-help.test.ts` (help surface), and the existing
> `tests/integration/verify-safe-backfill-command.test.ts` /
> `tests/integration/verify-migration-command.test.ts` integration suites.
>
> **Verified clean:** `bun run typecheck` ✓, `bun run lint` ✓ (0 warnings), and
> `bun test` across the registry + verify suites (39 pass / 0 fail). No CLI
> surface, output shape, artifact behavior, or exit-code semantics changed, per
> the Non-Goals. Deferred per §12: no third scenario added; no public
> scenario/plugin contract; `docs/user/` unchanged (no user-facing behavior
> change).

## 1. Purpose

Introduce a small internal registry for `dbcli verify` scenario commands now that the suite has two implemented runners: `verify safe-backfill` and `verify migration`.

The registry should reduce parent-command branching and copy-paste before the next scenario is added. This is a maintainability refactor only. It must preserve the existing CLI surface, output shapes, artifact behavior, safety checks, and exit-code semantics.

## 2. Current Evidence

- `docs/specs/2026-06-20-verification-workflow-suite-follow-up.md` already marks the workflow suite as implemented and names a scenario registry as the follow-up once two runners exist.
- `src/commands/verify.ts` currently owns both scenario registration blocks and their full action lifecycle.
- `verify safe-backfill` and `verify migration` share the same broad flow: normalize input, resolve config, require a SQL connection, build real runners, run preflight or after-write mode, render table or JSON, optionally persist artifacts, and map verification state to process exit code.
- `src/core/verify/scenario.ts` already contains shared guard/result primitives, so the remaining duplication is mostly command registration and lifecycle orchestration.

## 3. Problem Statement

Adding a third scenario currently requires another long command block in `src/commands/verify.ts`. That block would likely duplicate connection handling, input-error routing, runner setup, render dispatch, artifact write handling, and exit-code mapping.

The risk is not user-facing behavior today; the risk is drift. Scenario-specific differences can become mixed with shared lifecycle rules, making future safety changes harder to audit.

## 4. Goals

- Add an internal registry that defines all built-in verify scenarios in one place.
- Register `safe-backfill` and `migration` from scenario definitions instead of hand-written parent-command blocks.
- Keep scenario-specific logic close to each scenario: option normalization, runner construction, renderers, JSON result shapes, and readiness/verification rules.
- Centralize common command lifecycle behavior where it removes real duplication.
- Preserve current behavior exactly for:
  - command names and options
  - help output semantics
  - table and JSON output shapes
  - artifact write behavior
  - connection-error hints
  - `VerifyInputError` handling
  - exit-code rules
- Add tests that make registry invariants explicit.

## 5. Non-Goals

- Do not add a new scenario in this change.
- Do not introduce an external plugin system, user-loaded scenario files, or a public scenario DSL.
- Do not change artifact schema.
- Do not rename commands, flags, output keys, or user-facing modes.
- Do not change safety guards, database mutation rules, or recovery behavior.
- Do not update `docs/user/` unless implementation changes command behavior or help text.

## 6. Selected Approach

Create a small registry module, for example:

- `src/core/verify/registry.ts`

The registry exports a typed list of built-in scenario definitions. A definition should contain enough metadata and hooks for the command layer to register and execute the scenario without knowing scenario-specific internals.

Candidate shape:

```ts
export type VerifyScenarioSubjectKind = "table" | "migration";

export interface VerifyScenarioDefinition<Input, PreflightResult, AfterWriteResult> {
  name: string;
  description: string;
  subjectKind: VerifyScenarioSubjectKind;
  configure(command: Command): Command;
  normalize(options: Record<string, unknown>): Input;
  createRunners(context: RealRunnerContext, input: Input): ScenarioRunners<PreflightResult, AfterWriteResult>;
  renderPreflight(result: PreflightResult, format: OutputFormat): string;
  renderAfterWrite(result: AfterWriteResult, format: OutputFormat): string;
  isPreflightReady(result: PreflightResult): boolean;
  isAfterWriteVerified(result: AfterWriteResult, artifactError?: string): boolean;
}
```

The exact type names can change during implementation, but the boundary should remain:

- registry metadata is generic and auditable
- scenario modules own scenario-specific behavior
- the command layer owns CLI execution mechanics

## 7. Command Lifecycle Contract

Each registry-backed command must preserve this execution order:

1. Parse scenario options through Commander.
2. Normalize input before opening a database connection.
3. If normalization throws `VerifyInputError`, print the existing message shape and exit `1`.
4. Resolve configuration.
5. Require a SQL connection using the current SQL-system allowlist.
6. Connect the adapter once.
7. Build scenario runners from the real adapter context.
8. Run the selected mode:
   - `preflight`
   - `after-write`
9. Render table or JSON using the scenario renderer.
10. For after-write mode, attempt artifact persistence with current semantics.
11. Disconnect in `finally`.
12. Preserve current exit-code behavior:
   - preflight exits `0` only when ready
   - after-write exits `0` only when verified and artifact persistence did not fail
   - input/config/connection failures exit `1`

## 8. File Plan

Preferred low-churn implementation:

- Add `src/core/verify/registry.ts`.
- Export registry types from `src/core/verify/index.ts` if tests or command code need them.
- Keep scenario-specific definition objects close to existing scenario modules when practical.
- Replace manual parent registration in `src/commands/verify.ts` with a loop over built-in scenario definitions.
- Extract a command lifecycle helper only if it clearly reduces duplication after the registry is introduced.

Avoid a large file reshuffle in the first implementation. The goal is to create a stable internal seam for the third scenario, not to redesign the whole verification subsystem.

## 9. Test Requirements

Add focused registry tests:

- The registry includes exactly the expected built-in names: `safe-backfill` and `migration`.
- Scenario names are unique.
- Scenario names are CLI-safe, lowercase, and contain no spaces.
- Every scenario declares a supported `subjectKind`.
- Every scenario exposes required lifecycle hooks.

Preserve and extend command tests:

- Existing `verify safe-backfill` integration tests still pass.
- Existing `verify migration` integration tests still pass.
- `dbcli verify --help` still lists both scenarios.
- `dbcli verify safe-backfill --help` keeps the existing option surface.
- `dbcli verify migration --help` keeps the existing option surface.
- JSON output shape remains unchanged for both preflight and after-write modes.
- Artifact write failure semantics remain unchanged.
- Input validation errors happen before database connection attempts.

## 10. Acceptance Criteria

The implementation is accepted when:

- `src/commands/verify.ts` no longer manually defines separate long command action blocks for each built-in scenario.
- Adding a new built-in scenario requires adding one definition and scenario-specific tests, not editing parent lifecycle branching.
- Existing behavior is unchanged under integration tests.
- Registry invariant tests fail clearly on duplicate or malformed scenario definitions.
- `bun test` passes for affected unit and integration tests.
- `bun run typecheck` and `bun run lint` pass.

## 11. Risks And Mitigations

**Risk:** A generic lifecycle hides important scenario-specific safety behavior.  
**Mitigation:** Keep safety-sensitive runner logic inside scenario modules and only centralize mechanical command flow.

**Risk:** Type abstraction becomes heavier than the duplication it replaces.  
**Mitigation:** Start with the smallest definition shape required by the two existing scenarios. Do not model future scenarios until they exist.

**Risk:** Help text or output ordering changes accidentally.  
**Mitigation:** Add help-surface regression tests and keep existing integration tests unchanged.

**Risk:** Artifact handling changes because it moves into a helper.  
**Mitigation:** Preserve current after-write tests and add one explicit artifact-error regression if not already covered.

## 12. Deferred Follow-Ups

- Add a third scenario only after this registry proves stable.
- Reconsider a public scenario/plugin contract only after at least three built-in scenarios share the same stable lifecycle.
- Revisit `docs/user/` after implementation only if command behavior, help text, or user-facing examples change.

