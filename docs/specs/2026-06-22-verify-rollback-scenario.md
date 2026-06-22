# Verify Rollback Scenario Design Specification

**Date:** 2026-06-22  
**Status:** Implemented & Accepted (commit `3e30bb0`) — see §14  
**Baseline:** dbcli v1.36.0 verify scenario runner suite + scenario registry
(`docs/specs/2026-06-22-verify-scenario-registry.md`, Implemented)

## 1. Purpose

Add `dbcli verify rollback` as the **third** built-in verify scenario, registered
through the now-stable scenario registry (`BUILTIN_VERIFY_SCENARIOS`).

A rollback verification answers: *"after I reverted a change, is the database back
to the expected prior state?"* It runs the same two-phase flow as the existing
scenarios — **preflight** (analyze the proposed reverting statement, never execute)
and **after-write** (run a read-only read-back assertion and persist an artifact).

Like `safe-backfill` and `migration`, this scenario **never executes** the
write/DDL. It only analyzes the reverting statement and reads back the result the
agent reports after applying the rollback externally.

## 2. Scope Decision: Dual Kind

A rollback can revert either a schema change or a data change. Per design review,
this scenario supports **both** via a required `--kind <ddl|dml>` selector instead
of splitting into two commands:

- `--kind ddl` — revert a schema migration. The reverting statement is a single
  `ALTER TABLE` (e.g. dropping a column a forward migration added). Reuses the
  `migration` scenario's DDL contract.
- `--kind dml` — revert a data change. The reverting statement is a single
  `UPDATE` that restores prior values. Reuses the `safe-backfill` scenario's plan
  contract.

`--kind` is an **internal grammar selector**, not a new subject taxonomy. The
registry still treats `rollback` as one scenario with one registry-level
`subjectKind` (`'rollback'`); the *artifact* subject kind is mapped to the existing
closed enum (see §6) so the artifact schema is untouched.

## 3. Current Evidence

- `docs/specs/2026-06-22-verify-scenario-registry.md` §12 explicitly defers "Add a
  third scenario only after this registry proves stable." The registry is merged
  (`129ee5b`) and green, so this is the sanctioned next step.
- `src/commands/verify.ts` registers built-in scenarios from
  `BUILTIN_VERIFY_SCENARIOS` through a generic `registerScenario` /
  `executeScenario` lifecycle. Adding a scenario is now one definition object plus
  its scenario module — no parent-command branching.
- `src/core/verify/migration.ts` already exports a complete DDL contract:
  `classifyMigrationDdl`, `classifyMigrationTarget`, single-statement +
  `ALTER TABLE` gates, schema-aware target match.
- `src/core/verify/safe-backfill.ts` already exports a complete DML contract:
  `isUpdateOperation`, `extractUpdateTargetTable`, `updateTargetMatchesTable`,
  `isPlainSelectVerifyQuery`.
- `src/core/verify/scenario.ts` provides the shared primitives:
  `runGuardSequence`, `allGuardsPassed`, `mapAssertionToStatus`,
  `VerifyInputError`, `normalizeFormat`, `requireNonEmpty`, `shellQuote`,
  `renderAfterWriteCommand`, `redactSqlForEvidence`.

The rollback scenario is therefore mostly a **composition** of existing,
already-tested primitives keyed by `--kind`, not new safety logic.

## 4. CLI Surface

```
dbcli verify rollback \
  --kind <ddl|dml> \
  --table <table> \
  --statement <sql> \
  --verify-query <sql> \
  --expect <expr> \
  [--after-write] \
  [--format table|json] \
  [--subject-name <name>] \
  [--summary <text>]
```

Flag decisions:

- `--kind <ddl|dml>` — **required**. Selects which reverting-statement grammar is
  enforced. Invalid value fails closed as a `VerifyInputError` before any DB
  connection.
- `--statement <sql>` — **required**. The reverting statement (analyzed, never
  executed). A single unified flag is used instead of reusing `--ddl` / `--query`
  because Commander cannot cleanly express "exactly one of two flags, chosen by a
  third flag," and a single name keeps the dual-kind surface honest.
- `--verify-query`, `--expect`, `--after-write`, `--format`, `--subject-name`,
  `--summary` — identical semantics to the existing two scenarios.

The shared `--config` global option continues to flow through
`resolveConfigPath`, exactly as the other scenarios.

## 5. Guards (by kind)

Both kinds run a 4-guard sequence via `runGuardSequence`, stopping at the first
failure (identical to the existing scenarios). Guard names are stable and appear
in preflight output.

**`--kind ddl`** (reuses `migration` guards):

1. `blacklist` — target table not blacklisted (unless override allowed).
2. `schema` — target table resolves via `adapter.getTableSchema`.
3. `ddl` — `classifyMigrationDdl` (single statement, `ALTER TABLE` only) +
   analyzer confirms `operation === 'DDL'` + `classifyMigrationTarget` (target
   parses and matches `--table`, schema-aware).
4. `verify-query-readonly` — `isPlainSelectVerifyQuery` (plain SELECT, no
   write/DDL CTEs).

**`--kind dml`** (reuses `safe-backfill` guards):

1. `blacklist` — as above.
2. `schema` — as above.
3. `plan` — analyzer (read-write permission) classifies the statement as
   `UPDATE`, decision is not `BLOCK`, and `updateTargetMatchesTable` confirms the
   UPDATE target matches `--table`, schema-aware.
4. `verify-query-readonly` — as above.

MVP restrictions (documented as Non-Goals): DML rollback is **UPDATE only**
(INSERT/DELETE reverts deferred); DDL rollback is **single `ALTER TABLE` only**
(matching the migration MVP).

## 6. Artifact Mapping (schema untouched)

`VerificationSubjectKind` is a **closed union** and the registry spec set a
non-goal of "do not change artifact schema." Therefore the rollback artifact
reuses existing subject kinds rather than adding a new enum value:

| `--kind` | artifact `subject.kind` | `subject.command` |
|----------|-------------------------|-------------------|
| `ddl`    | `'migration'`           | `'verify rollback'` |
| `dml`    | `'backfill'`            | `'verify rollback'` |

Rollback provenance is carried by `subject.command = 'verify rollback'` and the
summary text, so no reader/retention/filter code changes. (Alternative considered:
add `'rollback'` to `VerificationSubjectKind`. Rejected for this change — it
ripples into the artifact schema surface the registry spec froze. Can be revisited
if subject-level rollback filtering is later required.)

The registry-level `VerifyScenarioSubjectKind` union **is** extended with
`'rollback'` (internal, command-layer metadata only; never serialized into an
artifact), keeping "one scenario → one registry subjectKind" intact.

## 7. Module Plan

- **`src/core/verify/rollback.ts`** (new) — owns rollback-specific behavior:
  - `RollbackKind = 'ddl' | 'dml'`
  - `RollbackInput` (`table`, `kind`, `statement`, `verifyQuery`, `expect`,
    `afterWrite`, `format`, `subjectName?`, `summary?`)
  - `normalizeRollbackInput` — validates `--kind` against the allowed set and
    branches statement validation; throws `VerifyInputError` on bad input.
  - `RollbackRunners` (guard + assertion runner interface)
  - `RollbackPreflightResult` / `RollbackAfterWriteResult` (`scenario: 'rollback'`,
    carry `kind` and `plannedStatement`)
  - `runRollbackPreflight`, `runRollbackAfterWrite`
  - `buildRollbackSubject` (maps kind → artifact subject kind per §6),
    `buildRollbackAfterWriteCommand`, default summaries.
  - Reuses `classifyMigrationDdl` / `classifyMigrationTarget` and
    `isUpdateOperation` / `updateTargetMatchesTable` / `isPlainSelectVerifyQuery`
    from the sibling modules — **no duplicated safety logic**.
- **`src/core/verify/registry.ts`** — extend `VerifyScenarioSubjectKind` with
  `'rollback'`.
- **`src/core/verify/index.ts`** — `export * from './rollback'`.
- **`src/commands/verify.ts`** — add `rollbackScenario` definition + a
  `buildRollbackRunners(ctx, input)` (branches guard wiring on `input.kind`,
  reusing the existing analyzer setup) + renderers; append to
  `BUILTIN_VERIFY_SCENARIOS` after `migrationScenario`.

The generic `executeScenario` lifecycle is **not modified** — rollback flows
through the exact same normalize → connect → runners → preflight/after-write →
artifact → exit-code path.

## 7a. User Documentation Plan (in scope)

`verify rollback` is new user-facing command behavior, so the user docs must be
updated in lockstep. `scripts/check-user-docs.ts` (`bun run docs:check`) enforces
that the `en` and `zh-TW` locales, in both `.md` and `.html`, carry the same
`doc-key` markers in the same order — so all **four** files must be edited
together:

- `docs/user/en/index.md`
- `docs/user/en/index.html`
- `docs/user/zh-TW/index.md`
- `docs/user/zh-TW/index.html`

Add a `#### verify rollback` subsection under the existing `command-reference`
doc-key, mirroring the structure of the current `#### verify safe-backfill` and
`#### verify migration` sections: the "never executes" ⚠️ warning, the
`--kind ddl|dml` + `--statement` usage, a preflight example and an `--after-write`
example for **both** kinds, and the exit-code note. Keep en and zh-TW content
equivalent. No new `doc-key` marker is introduced (the subsection lives under the
existing `command-reference` key), so the structural check stays green; the edit
is required for content parity and accuracy.

## 8. Command Lifecycle Contract

Unchanged from the registry contract. Rollback inherits, verbatim:

1. `--kind` and `--statement` validation happen in `normalize`, **before** any DB
   connection; a bad value exits `1` with the `VerifyInputError` message.
2. Resolve config → require SQL connection → connect once → build runners.
3. Preflight exits `0` only when all 4 guards pass (`status === 'ready'`).
4. After-write exits `0` only when `status === 'verified'` **and** artifact
   persistence did not fail.
5. Disconnect in `finally`; input/config/connection failures exit `1`.

## 9. Test Requirements

**Registry invariants** (`tests/unit/core/verify/registry.test.ts`, extend):

- `BUILTIN_VERIFY_SCENARIOS` now contains exactly `safe-backfill`, `migration`,
  `rollback`.
- `rollback` name is unique and CLI-safe; declares `subjectKind: 'rollback'`;
  exposes all required lifecycle hooks (covered by the existing generic checks).

**Rollback unit tests** (`tests/unit/core/verify/rollback.test.ts`, new):

- `normalizeRollbackInput` rejects missing/invalid `--kind` and empty
  `--statement` with `VerifyInputError`, before any runner.
- `--kind ddl`: blocks non-`ALTER TABLE`, multi-statement, and target-mismatch
  statements; passes a valid reverting `ALTER TABLE`.
- `--kind dml`: blocks non-`UPDATE` and target-mismatch statements; passes a valid
  reverting `UPDATE`.
- Preflight `ready` only when all 4 guards pass; `blocked` otherwise with a bounded
  reason.
- After-write maps assertion outcome → `verified` / `not_verified` /
  `indeterminate` and emits an artifact with the **correct mapped subject kind**
  (`migration` for ddl, `backfill` for dml) and `command: 'verify rollback'`.

**Command/help integration**:

- `tests/integration/verify-help.test.ts` — `verify --help` lists `rollback`;
  `verify rollback --help` shows `--kind`, `--statement`, `--verify-query`,
  `--expect`, `--after-write`, `--format`, `--subject-name`, `--summary`, and
  exits `0` with clean stderr (reuses the hardened `expectCleanHelp`).
- New `tests/integration/verify-rollback-command.test.ts` — preflight ready/blocked
  exit codes and JSON shape for both kinds; after-write artifact persistence and
  exit-code semantics; input validation (bad `--kind`) fails before DB connection.

**User docs**: `bun run docs:check` passes after the four `docs/user` files are
updated per §7a.

## 10. Acceptance Criteria

- `dbcli verify rollback --kind <ddl|dml> …` runs preflight and after-write with
  the lifecycle/exit-code rules in §8.
- No safety logic is duplicated: DDL/DML gates are reused from the sibling modules.
- The artifact schema (`VerificationSubjectKind` enum, schema version) is
  unchanged; rollback artifacts use mapped existing kinds.
- `BUILTIN_VERIFY_SCENARIOS` contains the three scenarios; registry invariant tests
  pass.
- Existing `safe-backfill` and `migration` behavior is unchanged.
- `docs/user/{en,zh-TW}/index.{md,html}` document `verify rollback` per §7a.
- `bun test` (unit + integration), `bun run typecheck`, `bun run lint`, and
  `bun run docs:check` pass.

## 11. Non-Goals

- No INSERT/DELETE rollback (DML rollback is UPDATE-only in this change).
- No multi-statement or non-`ALTER TABLE` DDL rollback.
- No new `VerificationSubjectKind` enum value; no artifact schema/version change.
- No transaction-level rollback, savepoints, or PITR/backup-restore verification.
- No execution of the reverting statement — analysis and read-back only.

> **Note:** `docs/user/` updates are **in scope** — see §7a. `verify rollback` is
> new user-facing command behavior, so the user documentation must be updated. It
> is excluded from Non-Goals deliberately.

## 12. Risks And Mitigations

**Risk:** `--kind` branching re-implements guard logic and drifts from the
originals.  
**Mitigation:** Import and call the existing `migration` / `safe-backfill`
classifiers directly; rollback adds orchestration only, no new gate logic. Cover
with unit tests asserting parity on representative blocked/allowed statements.

**Risk:** Reusing `migration` / `backfill` artifact subject kinds makes rollback
artifacts indistinguishable from forward operations.  
**Mitigation:** `subject.command = 'verify rollback'` and the summary record
provenance; document the trade-off. Revisit a dedicated enum value only if
subject-level filtering is needed.

**Risk:** A single `--statement` flag diverges from `--ddl` / `--query` used by the
other two scenarios.  
**Mitigation:** Documented deliberate choice for the dual-kind surface; help text
and tests pin the option set so it cannot drift silently.

## 13. Deferred Follow-Ups

- INSERT/DELETE DML rollback once the UPDATE path is proven.
- A dedicated `'rollback'` artifact subject kind if reporting needs to filter
  rollbacks distinctly (would be a separate artifact-schema change with its own
  spec and version bump).
- Revisit a public scenario contract only after the three built-ins share the
  stable lifecycle in production.

## 14. Verification Record

**Status:** Implemented & Accepted on 2026-06-22 (commit `3e30bb0` —
`feat: [verify] add rollback scenario (--kind ddl|dml)`).

### Delivered modules

- `src/core/verify/rollback.ts` — `RollbackKind`, `RollbackInput`,
  `normalizeRollbackKind` / `normalizeRollbackInput`, `RollbackRunners`,
  `RollbackPreflightResult` / `RollbackAfterWriteResult`, `runRollbackPreflight`,
  `runRollbackAfterWrite`, `buildRollbackSubject`,
  `buildRollbackAfterWriteCommand`, `statementGuardName`.
- `src/core/verify/registry.ts` — `VerifyScenarioSubjectKind` extended with
  `'rollback'`.
- `src/core/verify/index.ts` — `export * from './rollback'`.
- `src/commands/verify.ts` — `buildRollbackRunners(ctx, input)` (kind-branched
  statement guard), renderers, `rollbackScenario` appended to
  `BUILTIN_VERIFY_SCENARIOS` after `migrationScenario`. Generic
  `executeScenario` lifecycle unchanged.
- Tests: `tests/unit/core/verify/rollback.test.ts`, extended
  `registry.test.ts`, `tests/integration/verify-rollback-command.test.ts`,
  extended `verify-help.test.ts`.
- User docs: `verify rollback` subsection added to all four
  `docs/user/{en,zh-TW}/index.{md,html}` under the existing `command-reference`
  doc-key.

### §10 acceptance — full gate run 2026-06-22

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | preflight/after-write under §8 lifecycle + exit codes | ✅ | flows through unchanged `executeScenario` |
| 2 | no duplicated safety logic; gates reused from siblings | ✅ | `buildRollbackRunners` calls migration/safe-backfill predicates directly |
| 3 | artifact schema unchanged; mapped existing kinds | ✅ | `buildRollbackSubject`: `ddl→migration`, `dml→backfill`, `command:'verify rollback'` |
| 4 | three scenarios; registry invariant tests pass | ✅ | `BUILTIN_VERIFY_SCENARIOS = [safe-backfill, migration, rollback]` |
| 5 | safe-backfill / migration behavior unchanged | ✅ | full suite green |
| 6 | four `docs/user` files document `verify rollback` | ✅ | `docs:check` aligned |
| 7 | `bun test` + `typecheck` + `lint` + `docs:check` pass | ✅ | see gate results below |

**Gate results:** `bun test` → 3361 pass / 0 fail / 26 skip (DB-adapter
integration tests, no DB running). `bun run typecheck` (`tsc --noEmit`) → exit 0.
`bun run lint` (eslint `--max-warnings=0`) → exit 0. `bun run docs:check` → en
and zh-TW topics aligned.

All seven §10 criteria pass; implementation matches the §5–§8 contracts with no
gaps. Only the §13 deferred follow-ups (INSERT/DELETE DML rollback; a dedicated
`'rollback'` artifact subject kind) remain out of scope.
