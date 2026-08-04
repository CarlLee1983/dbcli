# Verification Workflow Suite Follow-up

**Date:** 2026-06-20
**Status:** Implemented — retained as a design record
**Baseline:** dbcli v1.35.0 plus local `verify safe-backfill` hardening

## 1. Purpose

Plan the next development items after the first `dbcli verify safe-backfill`
scenario.

The verification layer now has three usable product surfaces:

- `dbcli verify safe-backfill` runs one scenario in preflight or after-write
  mode, and explicitly never executes the backfill write.
- `dbcli verification` reads, summarizes, shows, and prunes local result
  artifacts under `.dbcli/verification/`.
- task packs can describe planned verification workflows, while result evidence
  is stored as v1 `VerificationArtifact` JSON.

The next milestone should turn this from a single-scenario feature into a small,
coherent workflow suite for agents. The goal is not to add many commands. The
goal is to prove the scenario pattern on one additional high-value workflow,
reduce duplication before the second scenario lands, and tighten release gates
around the new verification contract.

## 2. Current Evidence

- `src/commands/verify.ts:230` defines the `verify` namespace as scenario
  execution, with `safe-backfill` as the only registered scenario.
- `src/commands/verify.ts:234` to `src/commands/verify.ts:247` wires the
  `safe-backfill` CLI contract and options.
- `src/core/verify/safe-backfill.ts:238` defines injectable runner boundaries
  for guards and assertions.
- `src/core/verify/safe-backfill.ts:262` to
  `src/core/verify/safe-backfill.ts:283` already models ordered guard execution
  with first-failure short-circuiting.
- `src/core/verify/safe-backfill.ts:335` to
  `src/core/verify/safe-backfill.ts:405` maps after-write outcomes to v1
  verification artifacts.
- `src/core/verification/types.ts:3` defines stable statuses:
  `verified`, `not_verified`, `indeterminate`, and `blocked`.
- `src/core/verification/types.ts:5` to `src/core/verification/types.ts:18`
  already includes evidence and subject kinds for `snapshot`, `migration`,
  `backfill`, and `task-pack-plan`.
- `src/commands/verification.ts:186` to `src/commands/verification.ts:367`
  provides the local artifact inspection and lifecycle command surface.
- `assets/tasks/migration-review.md:1` to `assets/tasks/migration-review.md:41`
  defines a plan-only migration review workflow but does not produce result
  evidence.
- `docs/feature-matrix.md` states that `migrate` is SQL-only and `verification`
  is local artifact inspection/lifecycle management.

## 3. Recommended Sequence

### P0 - Scenario Runner Refactor, No Behavior Change

Extract the common scenario execution primitives currently embedded around
`safe-backfill` into reusable core helpers before adding a second scenario.

Target outcome:

- preserve all current `verify safe-backfill` CLI behavior;
- reduce copy-paste risk for the next scenario;
- keep scenario-specific safety checks in scenario modules, not in the parent
  command file.

Suggested files:

- Add `src/core/verify/scenario.ts`.
- Keep `src/core/verify/safe-backfill.ts` as the scenario-specific module.
- Keep `src/commands/verify.ts` as thin CLI wiring.
- Add or update `src/core/verify/index.ts` exports.

Acceptance criteria:

- Existing safe-backfill unit and integration tests pass without snapshot or
  output-shape changes.
- `src/commands/verify.ts` owns command parsing/rendering only; scenario logic
  remains in `src/core/verify/*`.
- Shared helper types cover guard sequencing, all-guards-passed checks, bounded
  reasons, and artifact evidence labels.
- No new user-facing command or option is introduced in P0.

### P1 - Add `dbcli verify migration` MVP

Add the second scenario runner for schema migration verification. This is the
best follow-up because migration is already a v1 verification subject kind and
there is an existing `migration-review` plan-only task pack.

Selected MVP scope:

```bash
dbcli verify migration \
  --table <table> \
  --ddl "<ALTER TABLE ...>" \
  --verify-query "<SELECT assertion query>" \
  --expect "<assert expression>"
```

After the migration is applied externally:

```bash
dbcli verify migration ... --after-write
```

The command name uses `migration`, but it must follow the same product rule as
`safe-backfill`: it never executes DDL. It validates and records evidence around
an externally applied migration.

Supported options:

| Option | Required | Description |
| --- | --- | --- |
| `--table <table>` | yes | Table affected by the migration. |
| `--ddl <sql>` | yes | Proposed migration DDL, analyzed but never executed. MVP accepts `ALTER TABLE` only. |
| `--verify-query <sql>` | yes | Plain `SELECT` used for post-migration read-back verification. |
| `--expect <expr>` | yes | Assertion expression passed to the existing assert evaluator. |
| `--after-write` | no | Runs post-migration assertion and writes a v1 artifact. |
| `--format <table|json>` | no | Output format, default `table`. |
| `--subject-name <name>` | no | Artifact subject name. Default is the table name. |
| `--summary <text>` | no | Optional artifact summary override. |

MVP guard sequence:

1. Validate all options before opening a DB connection.
2. Confirm the connection is SQL-only: PostgreSQL, MySQL, or MariaDB.
3. Run blacklist guard on `--table`.
4. Run schema guard on `--table` before the migration.
5. Analyze `--ddl` with the existing risk analyzer in a non-executing mode.
6. Require `ALTER TABLE` in the MVP and require the DDL target to match
   `--table`, schema-aware when both sides include a schema.
7. Require `--verify-query` to be a plain `SELECT`, using the same fail-closed
   semantics as safe-backfill.

Preflight mode:

- returns `ready` or `blocked`;
- prints the planned DDL, but never executes it;
- prints the exact after-write command;
- writes no artifact.

After-write mode:

- reruns all guards;
- executes the read-back assertion;
- writes a v1 artifact with subject `migration:<subject-name>`;
- evidence includes `task-pack-plan` with `taskName: migration-review` and one
  redacted `assert` evidence entry;
- maps assertion pass/fail/error to `verified`, `not_verified`, or
  `indeterminate`; failed guards map to `blocked`.

Acceptance criteria:

- `dbcli verify migration --format json` preflight has stable keys:
  `scenario`, `mode`, `status`, `table`, `plannedDdl`, `guards`,
  `afterWriteCommand`.
- `dbcli verify migration ... --after-write --format json` returns `artifact.id`
  and `artifact.subject.kind === "migration"`.
- `ALTER TABLE public.users ...` does not pass when `--table audit.users`.
- `CREATE TABLE`, `DROP TABLE`, `CREATE INDEX`, and multi-statement DDL are
  blocked in the MVP with bounded reasons.
- `EXPLAIN`, `EXPLAIN ANALYZE`, `SHOW`, `DESCRIBE`, and data-modifying CTEs are
  rejected as `--verify-query`.
- Artifacts do not persist raw DDL literal values, raw verify-query literal
  values, raw `--expect`, credentials, host, port, rows, or connection strings.
- `verification list --subject migration:<name>` can find the artifact.

### P2 - Verification Handoff Summary Improvements

Improve the handoff path agents use after scenarios produce artifacts.

Current `verification summary` already gives counts and latest status, but agents
still have to decide manually whether the latest evidence is acceptable for a
specific delivery note. Add one bounded command option instead of a new command:

```bash
dbcli verification summary --subject <kind:name> --latest-only --format json
```

Contract:

- `--latest-only` returns the latest matching valid artifact plus status counts.
- Missing artifacts return exit `0` with `latest: null`, matching existing
  summary behavior.
- Invalid files remain outside the valid summary and are not promoted into
  `latest`.
- Table output prints one concise latest-artifact section and the existing counts
  section.

Acceptance criteria:

- Existing `verification summary` output is unchanged when `--latest-only` is
  absent.
- JSON shape is additive and documented.
- Unit tests cover no artifacts, one artifact, multiple subjects, status filter,
  and malformed files.

### P3 - Release Gate and Documentation Hardening

Make the verification workflow suite hard to regress before tagging the next
release.

Required updates:

- `docs/user/en/index.md`
- `docs/user/en/index.html`
- `docs/user/zh-TW/index.md`
- `docs/user/zh-TW/index.html`
- `assets/reference.md`
- `assets/SKILL.md`
- `assets/SKILL.zh-TW.md`
- platform/plugin mirrors if generated assets change
- `docs/feature-matrix.md` if command descriptions or support claims change

Acceptance criteria:

- User docs distinguish `verify` (scenario runner) from `verification`
  (artifact inspection/lifecycle).
- English and Traditional Chinese docs both include `verify migration`.
- Reference docs state that `verify migration` never executes DDL.
- Skill text routes migration work to `migration-review` for planning and
  `verify migration` for result evidence.
- `docs:check`, `skill:check`, `platform:check`, and `plugin:check` pass.

## 4. Non-Goals

- Do not execute DDL from `verify migration`.
- Do not support `CREATE TABLE`, `DROP TABLE`, `CREATE INDEX`, or arbitrary DDL
  in the migration MVP.
- Do not change the v1 `VerificationArtifact` schema.
- Do not add a generic YAML/JSON scenario runner yet.
- Do not make task packs executable by default.
- Do not add remote artifact storage.
- Do not merge `verify` and `verification`.
- Do not change `verify safe-backfill` public behavior while refactoring.
- Do not expand GUI, SDK, or sidecar scope in this milestone.

## 5. Design Options

### Option A - Add `verify migration` directly with duplicated code

Pros:

- Fastest path to a visible second scenario.

Cons:

- Duplicates guard sequencing and artifact mapping.
- Makes the third scenario more expensive.
- Increases chance of inconsistent redaction or status mapping.

Rejected for P1 unless P0 uncovers that a shared helper is not useful.

### Option B - Refactor scenario primitives first, then add migration

Pros:

- Keeps behavior stable before adding scope.
- Makes status mapping, guard sequencing, bounded reasons, and artifact evidence
  consistent across scenarios.
- Still small enough for one milestone.

Selected.

### Option C - Build a generic scenario registry now

Pros:

- Cleaner long-term architecture.

Cons:

- Premature with only one implemented scenario.
- Requires a broader external scenario contract before the product shape is
  proven.

Deferred until after at least two scenario runners exist.

## 6. Implementation Plan

1. Add regression tests around current safe-backfill behavior before refactoring:
   CLI help, preflight JSON, blocked guard order, after-write artifact shape,
   and evidence redaction.
2. Extract shared scenario helpers into `src/core/verify/scenario.ts`.
3. Update safe-backfill to consume the shared helpers without changing outputs.
4. Add migration core module, likely `src/core/verify/migration.ts`.
5. Add migration CLI wiring to `src/commands/verify.ts`.
6. Add DDL target extraction for MVP `ALTER TABLE` statements and test quoted and
   schema-qualified table names.
7. Reuse safe-backfill's plain-SELECT verifier guard and evidence redaction.
8. Add integration tests for `verify migration` preflight, after-write verified,
   after-write not_verified, blocked DDL, blocked table mismatch, and blocked
   unsafe verify-query.
9. Add `verification summary --latest-only` behind additive tests.
10. Update English and Traditional Chinese docs, HTML mirrors, reference, skill
    assets, and platform/plugin mirrors.

## 7. Test Plan

Targeted tests:

```bash
bun test tests/unit/core/verify/safe-backfill.test.ts
bun test tests/integration/verify-safe-backfill-command.test.ts
bun test tests/unit/core/verify/migration.test.ts
bun test tests/integration/verify-migration-command.test.ts
bun test tests/integration/verification-command.test.ts
```

Static and parity checks:

```bash
bun run typecheck
bun run lint
bun run docs:check
bun run skill:check
bun run platform:check
bun run plugin:check
```

Release-level checks before tagging:

```bash
bun test
bun run build
bun test tests/integration/dist-smoke.test.ts
bash scripts/release-check.sh
```

## 8. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| DDL parsing becomes too broad or incorrect. | MVP supports `ALTER TABLE` only and blocks all other DDL forms. |
| Refactor changes safe-backfill output. | Add safe-backfill output regression tests before extracting helpers. |
| Agents confuse preflight with result evidence again. | Keep preflight artifact-free; docs must explicitly say `ready` is not `verified`. |
| Migration verification stores sensitive SQL literals. | Reuse shared redaction for DDL labels, verify-query labels, and `--expect`. |
| `verification summary --latest-only` changes existing consumers. | Make it additive; existing summary output remains unchanged without the flag. |
| Docs drift across English, Traditional Chinese, HTML, skill, and platform mirrors. | Run all parity checks and update generated mirrors in the same change. |

## 9. Suggested Delivery Slices

### Slice 1 - Refactor Guard/Artifact Scenario Helpers

Scope:

- tests first for current safe-backfill behavior;
- helper extraction;
- no new public behavior.

Stop condition:

- targeted safe-backfill tests and full typecheck/lint pass.

### Slice 2 - `verify migration` MVP

Scope:

- migration core module;
- command wiring;
- unit and integration tests;
- no docs yet except developer spec updates if needed.

Stop condition:

- migration targeted tests pass and existing safe-backfill tests still pass.

### Slice 3 - Handoff Summary and Docs

Scope:

- `verification summary --latest-only`;
- user docs, reference, skill assets, mirrors;
- parity checks.

Stop condition:

- parity checks and relevant integration tests pass.

### Slice 4 - Release Candidate Validation

Scope:

- full test/build/release checks;
- changelog and feature matrix updates if versioning work starts.

Stop condition:

- `bun test`, `bun run build`, dist smoke, and release check pass with known
  external-service skips only.

## 10. Follow-up After This Milestone

After two scenario runners exist, reconsider a small scenario registry:

- `verify safe-backfill`
- `verify migration`
- later candidates: `verify rollback`, `verify export-redaction`,
  `verify performance-baseline`

The registry should be introduced only when it removes duplication from real
scenario modules. It should not become an external scenario DSL until the CLI
contracts are stable across at least three scenarios.

## Completion evidence

- **Implemented:** P0 scenario helper refactor, P1 `verify migration` MVP,
  P2 `summary --latest-only`, and P3 documentation/parity work.
- **Verification:** the verification scenario and workflow-pack suites were
  included in the full repository run (4,269 tests passed; 26 environment-gated
  tests skipped).
- **Known deviations:** the registry now includes rollback and constraint
  scenarios; the external scenario DSL remains deferred by the separate
  evaluation record.
