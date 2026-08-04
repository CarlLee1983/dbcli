# Safe Backfill Verification Orchestration Design Specification

**Date:** 2026-06-18
**Status:** Implemented — retained as a design record
**Baseline:** dbcli v1.34.0

## 1. Purpose

Close the gap between planned verification evidence and actual result evidence
for the `safe-backfill-verify` workflow.

dbcli v1.34.0 can already:

- plan `safe-backfill-verify` with a `verification.status = "planned"` block;
- build bounded schema-version-1 `VerificationArtifact` objects;
- write artifacts atomically under `.dbcli/verification/`;
- write a recovery verification artifact from
  `recover --apply --write-verification-artifact`.

The remaining product gap is that the first high-risk workflow,
`safe-backfill-verify`, still depends on the agent manually re-running the final
`assert` command and then describing the result in prose. This spec defines the
next narrow step: make the final `assert` step able to produce a result
`VerificationArtifact` on demand.

## 2. Background

The verification strategy is:

```text
inspect context
-> plan safe workflow
-> execute bounded command
-> recover if failed
-> verify outcome
-> keep audit trace
```

`safe-backfill-verify` is the first target because it has a stable shape:

```text
blacklist list
-> schema <table>
-> plan "<UPDATE ...>"
-> assert "<read-back SELECT>" --expect "<condition>"
```

The task remains `plan-only`; dbcli does not execute the backfill write for the
agent. The missing piece is durable result evidence for the last read-back
assertion.

Relevant shipped surfaces:

- `assets/tasks/safe-backfill-verify.md` defines the plan-only workflow and the
  final read-back `assert`.
- `src/core/agent-tasks/planner.ts` derives planned verification metadata from
  the resolved final `assert` step.
- `src/commands/assert.ts` already executes SQL assertions, writes audit entries,
  and exits non-zero on failed assertions unless `--no-fail` is used.
- `src/core/verification/artifact.ts` and
  `src/core/verification/artifact-writer.ts` provide the artifact builder and
  safe writer.

## 3. Problem Statement

`safe-backfill-verify` can now say which assertion should prove the backfill
worked, but the CLI has no direct way to persist the actual assertion outcome as
verification evidence.

That creates three practical issues:

1. Agents can confuse planned evidence with executed evidence.
2. Handoffs lose the exact result status unless the agent copies output into a
   separate note.
3. The first workflow cannot be called end-to-end verifiable without relying on
   narrative claims.

## 4. Goals

1. Let the final `assert` command in `safe-backfill-verify` opt in to writing a
   result `VerificationArtifact`.
2. Keep task packs `plan-only`; do not add automatic write execution.
3. Preserve existing `assert` output and exit-code behavior when the new flag is
   absent.
4. Reuse the v1 verification artifact schema and writer from v1.34.0.
5. Include audit linkage when available, without making audit success required.
6. Make the feature testable with unit tests for pure mapping and CLI
   integration tests for artifact writing.

## 5. Non-Goals

- Do not add a generic task-pack runner.
- Do not add `dbcli verify` in this milestone.
- Do not execute `update`, raw write SQL, migrations, or any database write from
  a task-pack plan.
- Do not make verification artifact writing default for `assert`.
- Do not store raw result rows, unbounded stdout/stderr, credentials, host, port,
  or connection strings in artifacts.
- Do not change `safe-backfill-verify` from `plan-only`.
- Do not change the v1 `VerificationArtifact` schema.

## 6. Design Options

### Option A - Generic Task-Pack Runner

Add a runner that executes task-pack steps and writes artifacts after verification
steps.

Pros:

- Solves more than one workflow.
- Gives agents a single command for planned workflow execution.

Cons:

- Broadens side-effect risk because task packs can contain future write-like
  steps.
- Requires new risk gates, step cursors, resume semantics, and failure recovery.
- Too large for the next increment.

Decision: defer.

### Option B - `assert` Opt-In Artifact Bridge

Add a narrow opt-in flag to `dbcli assert` so a successful or failed read-back
assertion can write a `VerificationArtifact`.

Pros:

- Directly matches the final step of `safe-backfill-verify`.
- Reuses the existing assertion engine, audit integration, artifact builder, and
  artifact writer.
- Avoids automatic task-pack execution and database writes.
- Produces true result evidence rather than planned evidence.

Cons:

- Requires a few metadata flags so the artifact has the correct subject.
- Only covers workflows whose verification step is `assert`.

Decision: implement first.

### Option C - New `dbcli verify` Command

Add `dbcli verify safe-backfill ...` as a scenario-specific verifier.

Pros:

- Clean product vocabulary.
- Could later support multiple declared verification scenarios.

Cons:

- Premature until at least two workflows need shared runner semantics.
- Risks duplicating `assert` before artifact behavior is proven.

Decision: defer until multiple workflows need the same abstraction.

## 7. Selected Approach

Implement Option B: an `assert` artifact bridge.

The command remains an assertion command first. Artifact writing is an optional
side effect that runs after the assertion verdict is known.

Proposed CLI:

```bash
dbcli assert "<verify_query>" \
  --expect "<expect>" \
  --write-verification-artifact \
  --verification-subject backfill:safe-backfill-verify \
  --verification-summary "Backfill read-back assertion matched expected state."
```

The minimum required metadata is:

- `--write-verification-artifact`
- `--verification-subject <kind:name>`

`--verification-summary` is optional. If omitted, dbcli derives a bounded
summary from the verdict:

- pass: `Assertion verified the expected state.`
- fail: `Assertion did not verify the expected state.`

`--verification-subject` accepts:

```text
<kind>:<name>
```

For this milestone, allowed `kind` values are the existing
`VerificationSubjectKind` values. The implementation should reject unknown kinds
before running the query.

Examples:

```bash
dbcli assert "SELECT count(*) FROM orders WHERE status IS NULL" \
  --expect "value == 0" \
  --write-verification-artifact \
  --verification-subject backfill:safe-backfill-verify
```

```bash
dbcli assert "SELECT sum(amount) FROM ledger_a" \
  --vs "SELECT sum(amount) FROM ledger_b" \
  --compare value \
  --write-verification-artifact \
  --verification-subject assertion:ledger-reconciliation
```

Only the first example is required by this milestone. The second is acceptable
if it falls out naturally from the generic assertion mapping.

## 8. Artifact Mapping

When artifact writing is enabled, map the assertion verdict to
`VerificationArtifact` as follows:

| Artifact field | Source |
| --- | --- |
| `schemaVersion` | `VERIFICATION_ARTIFACT_SCHEMA_VERSION` |
| `status` | `verified` when all checks pass; `not_verified` when any check fails |
| `subject.kind` | parsed `--verification-subject` kind |
| `subject.name` | parsed `--verification-subject` name |
| `summary` | `--verification-summary` or derived default |
| `evidence[0].kind` | `assert` |
| `evidence[0].command` | redacted current `dbcli assert ...` command, bounded by the builder |
| `evidence[0].exitCode` | `0` for pass; `1` for fail before `--no-fail` adjustment |
| `evidence[0].auditRef` | audit entry id when `writeAuditEntry` returns one |

The artifact status must describe assertion truth, not process exit behavior.
If `--no-fail` is used and the assertion fails, the process exits `0` but the
artifact status is still `not_verified` and evidence `exitCode` is `1`.

If assertion execution reaches an exception before a verdict exists, no artifact
is written in this milestone. The command should keep existing error behavior.
The recovery workflow already handles failed command execution.

## 9. Command Output Contract

Default behavior is unchanged.

When `--write-verification-artifact` is present and writing succeeds:

- JSON output keeps the existing verdict fields and adds
  `verificationArtifactPath`.
- Table output prints a final line:

```text
Verification artifact: <path>
```

When artifact writing fails after a verdict exists:

- print `Failed to write verification artifact: <message>` to stderr;
- keep the assertion output unchanged;
- preserve the assertion exit-code behavior.

This mirrors `recover --apply --write-verification-artifact`: artifact writing is
important evidence, but a local filesystem write failure must not turn a failed
assertion into a passing one or hide the assertion verdict.

## 10. Safety and Privacy

Artifact writing must keep the v1 privacy model:

- no raw rows;
- no raw stdout/stderr transcripts;
- no credentials or connection strings;
- no host or port;
- no unbounded command text;
- no blacklist bypass.

The assertion query may appear in the command evidence because `assert` already
accepts query text as a command argument and audit redaction exists. The
implementation should use the existing redaction helpers for argv evidence.

Audit linkage is opportunistic. A missing audit id must not block artifact
writing because audit can be disabled or fail closed.

## 11. Impacted Files

Likely implementation files:

- `src/commands/assert.ts`
- `src/core/verification/assert-artifact.ts` or equivalent pure helper
- `src/core/verification/index.ts`
- `tests/unit/core/verification/assert-artifact.test.ts`
- `tests/integration/assert-verification-artifact.test.ts`
- `tests/unit/agent-tasks/pack-safe-backfill-verify.test.ts`

Likely documentation files:

- `docs/user/en/index.md`
- `docs/user/en/index.html`
- `docs/user/zh-TW/index.md`
- `docs/user/zh-TW/index.html`
- `assets/SKILL.md`
- `assets/SKILL.zh-TW.md`
- `assets/reference.md`

Only update user docs if the CLI flag is implemented. The spec itself does not
change user-facing behavior.

## 12. Test Requirements

Pure helper tests:

- parses `backfill:safe-backfill-verify` into subject kind/name;
- rejects unknown subject kinds;
- rejects malformed subject strings before query execution;
- maps passing verdict to `verified`;
- maps failing verdict to `not_verified`;
- uses assertion truth rather than `--no-fail` process behavior;
- includes `assert` evidence with command, audit ref when supplied, and exit
  code.

CLI integration tests:

- without the flag, `dbcli assert` output remains unchanged and writes no
  artifact;
- with the flag and a passing assertion, artifact is written under
  `.dbcli/verification/` and output includes `verificationArtifactPath`;
- with the flag and a failing assertion, artifact status is `not_verified` and
  command exits `1`;
- with `--no-fail` and a failing assertion, artifact status is `not_verified`
  and command exits `0`;
- malformed `--verification-subject` exits before connecting to the database;
- artifact write failure reports stderr without corrupting the verdict output.

Task-pack regression tests:

- `safe-backfill-verify` still emits planned metadata only;
- planned metadata remains `status: "planned"`;
- planned metadata must not include a result artifact path.

## 13. Documentation Requirements

Update docs after implementation:

1. Add an `assert --write-verification-artifact` subsection near data
   verification docs.
2. Clarify the planned/result distinction:
   - `skill tasks plan safe-backfill-verify` produces planned evidence.
   - the final `assert --write-verification-artifact` produces result evidence.
3. Add a concise safe-backfill example that shows:
   - plan the workflow;
   - dry-run the write manually;
   - execute the write under existing write permissions;
   - run the final assertion with artifact writing.
4. Sync English and zh-TW Markdown/HTML docs.
5. Update `assets/SKILL.md` and `assets/SKILL.zh-TW.md` only with compact routing
   guidance, not a long playbook.

## 14. Verification Commands

Minimum implementation validation:

```bash
bun test tests/unit/core/verification
bun test tests/integration/assert-verification-artifact.test.ts
bun test tests/unit/agent-tasks/pack-safe-backfill-verify.test.ts
bun run typecheck
bun run docs:check
bun run skill:check
```

Before release:

```bash
bun run plugin:check
bun run platform:check
bun run build
bun test
bun run release:check
```

## 15. Open Decisions Resolved By This Spec

1. Should `safe-backfill-verify` get automatic execution orchestration now?
   - No. Keep task packs `plan-only` and use `assert` artifact writing for the
     actual verification result.
2. Should this milestone add `dbcli verify`?
   - No. Add it only if multiple workflows need the same runner or scenario
     semantics.
3. Should artifact writing be default for `assert`?
   - No. Keep it opt-in to preserve output and filesystem side-effect
     expectations.
4. Should failed assertions write artifacts?
   - Yes, when the flag is present and a verdict exists. `not_verified` is useful
     evidence.

## 16. Follow-Ups

- After this bridge ships, test whether `migration-review` also wants
  artifact-producing assertion or snapshot evidence.
- If two or more workflows need multi-step result aggregation, design a generic
  verification run record before adding `dbcli verify`.
- If agents still confuse planned and result evidence, consider renaming the plan
  field from `verification` to `plannedVerification` in a future compatibility
  window.

## Lifecycle closeout

### Current implementation

The planned/result bridge is implemented by the artifact builder and writer,
`assert --write-verification-artifact`, the `safe-backfill-verify` task pack,
and the `verify safe-backfill` scenario. Planned task metadata remains
`status: "planned"`; result artifacts are explicit and bounded.

### Completion evidence

- Implementation: `a638131`, `4524d1a`, `53716a3`, `4485ecf`, `a71ea50`,
  `f32d896`, `d0a65cc`, `a3aeb80`, and `22d14ba`.
- Verification: the verification/core suite, recovery apply verification
  tests, and `safe-backfill-verify` pack regression passed during this audit;
  the relevant focused aggregate passed 111 tests.
- Documentation: English and Traditional Chinese docs explain planned versus
  result evidence and the no-write scenario contract.
- Repository gates: typecheck, lint, docs parity, skill parity, and platform
  parity passed during this audit.

### Known deviations

The original spec's task-pack-first path is now complemented by a narrow
scenario command because later evidence justified it. Neither the task pack nor
`verify safe-backfill` executes the supplied backfill write; after-write mode
only verifies and records the result.
