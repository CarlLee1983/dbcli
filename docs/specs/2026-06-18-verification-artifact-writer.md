# Verification Artifact Writer Design Specification

**Date:** 2026-06-18
**Status:** Draft for implementation
**Baseline:** dbcli v1.33.0 plus verification contract milestone

## 1. Purpose

Add the first implementation layer for durable verification evidence.

The verification contract already defines the vocabulary and artifact shape.
This spec defines how dbcli should construct and, in the follow-up step, persist
bounded `VerificationArtifact` JSON objects so agents can hand off evidence
instead of only saying a verification step passed.

This is the next increment of the Agent Database Verification Workflow. It keeps
the workflow task-pack-first and does not introduce a new `dbcli verify` command.

## 2. Background

The current strategy is:

```text
inspect context
-> plan safe workflow
-> execute bounded command
-> recover if failed
-> verify outcome
-> keep audit trace
```

The first workflow selected for implementation is `safe-backfill-verify` because
it has a clear shape: scope count, dry-run, write, and read-back assertion.

Current shipped foundations:

- `docs/specs/2026-06-18-verification-contract.md` defines status vocabulary,
  artifact schema version `1`, future storage path, and relationship to
  `assert`, `snapshot`, `recover --apply`, task packs, and audit.
- `src/core/verification/types.ts` defines `VerificationArtifact`,
  `VerificationStatus`, evidence refs, and subject refs.
- `src/core/verification/status.ts` maps legacy recovery verification statuses
  to contract statuses.
- `assets/tasks/safe-backfill-verify.md` already plans a read-back `assert`
  command for backfill verification.
- `recover --apply` already exposes `verificationStatus` and
  `verificationBlockedReason` while preserving legacy `verifyStatus`.

## 3. Goals

1. Provide a pure builder that constructs valid schema-version-1
   `VerificationArtifact` objects.
2. Make artifact creation deterministic in tests through injectable clock and id
   generation.
3. Centralize evidence bounding so future writers and command surfaces do not
   duplicate truncation/redaction decisions.
4. Prepare safe filesystem persistence under `.dbcli/verification/` as the next
   implementation step.
5. Let task-pack planning expose planned verification metadata without implying
   the verification already ran.

## 4. Non-Goals

- Do not add `dbcli verify`.
- Do not execute task-pack steps automatically.
- Do not run database writes.
- Do not replace audit logs.
- Do not store full command stdout/stderr in artifacts.
- Do not alter existing recovery `verifyStatus` values.
- Do not change existing `assert`, `snapshot`, or task-pack command semantics.

## 5. Core Contract

Artifacts must continue to use the existing versioned shape:

```ts
export interface VerificationArtifact {
  schemaVersion: typeof VERIFICATION_ARTIFACT_SCHEMA_VERSION
  id: string
  createdAt: string
  status: VerificationStatus
  subject: VerificationSubject
  summary: string
  evidence: VerificationEvidenceRef[]
  blockedReason?: string
}
```

Allowed statuses remain:

- `verified`
- `not_verified`
- `indeterminate`
- `blocked`

The builder must reject any status outside this vocabulary.

## 6. Artifact Builder API

Add `src/core/verification/artifact.ts` and export it from
`src/core/verification/index.ts`.

Proposed API:

```ts
export interface BuildVerificationArtifactInput {
  status: VerificationStatus
  subject: VerificationSubject
  summary: string
  evidence: VerificationEvidenceRef[]
  blockedReason?: string
  now?: () => Date
  idFactory?: () => string
}

export function buildVerificationArtifact(
  input: BuildVerificationArtifactInput
): VerificationArtifact
```

Required behavior:

- Set `schemaVersion` to `VERIFICATION_ARTIFACT_SCHEMA_VERSION`.
- Set `createdAt` from `input.now?.()` or `new Date()`.
- Set `id` from `input.idFactory?.()` or an internal safe id generator.
- Validate `status` with `isVerificationStatus`.
- Trim and validate `summary`; empty summaries are invalid.
- Require at least one evidence item.
- Include `blockedReason` only when provided.
- If `status === 'blocked'`, allow `blockedReason` but do not require it because
  some callers may only know the blocked status at first.

## 7. Evidence Bounding

Artifacts are not audit logs. They should carry evidence references, not full
execution transcripts.

Rules:

- Commands may be stored, but must be bounded to a documented max length.
- `note` fields may be stored, but must be bounded to a documented max length.
- `stdout` and `stderr` should not be added to `VerificationEvidenceRef` in this
  milestone.
- Evidence refs may include `auditRef`, `recoveryRef`, `snapshotPath`,
  `taskName`, `step`, and `exitCode`.
- The builder should normalize overlong command/note strings by truncating with
  a clear suffix rather than throwing, so artifact creation remains reliable.

Suggested constants:

```ts
export const VERIFICATION_TEXT_FIELD_CAP = 2_000
export const VERIFICATION_EVIDENCE_CAP = 20
```

If evidence exceeds `VERIFICATION_EVIDENCE_CAP`, keep the first N refs and append
a final `manual` evidence ref whose note says the artifact was truncated. This
keeps artifacts bounded while making truncation visible.

## 8. Safe Backfill Planned Artifact Metadata

`safe-backfill-verify` remains `plan-only`. Its task plan may include a planned
verification metadata block derived from the resolved final `assert` step.

Proposed task-plan addition:

```ts
export interface AgentTaskPlanVerification {
  status: 'planned'
  subject: VerificationSubject
  evidence: VerificationEvidenceRef[]
  artifactSchemaVersion: typeof VERIFICATION_ARTIFACT_SCHEMA_VERSION
}
```

For `safe-backfill-verify`:

- `subject.kind = 'backfill'`
- `subject.name = 'safe-backfill-verify'`
- `evidence[0].kind = 'assert'`
- `evidence[0].command = <resolved assert command>`
- `evidence[0].taskName = 'safe-backfill-verify'`
- `evidence[0].step = <1-based assert step number>`

Important distinction:

- Task-plan metadata is planned evidence.
- A `VerificationArtifact` with `verified` / `not_verified` / `indeterminate` /
  `blocked` is result evidence.

Agents must not treat planned evidence as proof that verification ran.

## 9. Persistence Follow-Up

The writer should be implemented after the pure builder.

Storage path:

```text
.dbcli/verification/verification-<YYYYMMDD-HHMMSS>-<short-id>.json
```

Writer requirements:

- Create `.dbcli/verification/` if missing.
- Generate filenames internally.
- Reject or avoid caller-controlled path segments.
- Write atomically.
- Return the written path.
- Never overwrite an existing artifact silently.

This spec permits the writer to live in `src/core/verification/artifact-writer.ts`.

## 10. Recovery Bridge Follow-Up

`recover --apply` can later get an explicit opt-in flag such as:

```bash
dbcli recover --apply --write-verification-artifact
```

Behavior:

- Only write when the existing verify step ran.
- Preserve current output when the flag is absent.
- Keep legacy `verifyStatus`.
- Use contract `verificationStatus` for artifact status.
- Use evidence kind `recovery-verify`.
- Include `recoveryRef` when available.
- Include `auditRef` when available.
- Surface artifact-write failures clearly.

## 11. Security and Privacy

Artifacts must be safe to share inside a developer handoff:

- Do not include credentials.
- Do not include host/port unless already part of an existing non-secret public
  artifact contract.
- Do not include raw query result rows.
- Do not include unbounded stdout/stderr.
- Prefer audit and recovery refs over embedded transcripts.
- Keep blacklist behavior unchanged; artifact writing must not bypass blacklist
  or permission checks.

## 12. Testing Requirements

Builder tests:

- Constructs a valid `verified` backfill artifact with assert evidence.
- Constructs a `blocked` artifact with blocked reason.
- Rejects invalid status.
- Rejects empty summary.
- Rejects empty evidence.
- Uses injected `now` and `idFactory`.
- Truncates overlong command/note fields.
- Caps evidence count.

Task-plan tests:

- `safe-backfill-verify` plan includes planned verification metadata.
- Metadata references the resolved `assert` command.
- Metadata does not claim a terminal verification status.
- Other task packs without verification evidence remain unchanged.

Writer tests when implemented:

- Writes under `.dbcli/verification/`.
- Creates the directory if missing.
- Uses the expected filename pattern.
- Writes valid JSON matching the artifact.
- Does not allow path traversal.
- Does not silently overwrite existing artifacts.

Integration tests when a CLI flag is added:

- `recover --apply --write-verification-artifact` writes an artifact when
  verification runs.
- `recover --apply` without the flag keeps current output and writes nothing.
- Skipped/blocked verification writes `blocked` only when the flag is present.

## 13. Verification Commands

Minimum for the builder step:

```bash
bun test tests/unit/core/verification
bun run typecheck
```

Before merging the full milestone:

```bash
bun test tests/unit/core/verification
bun test tests/unit/agent-tasks/pack-safe-backfill-verify.test.ts
bun test tests/integration/recover-apply.test.ts
bun run typecheck
bun run build
bun run skill:check
bun run plugin:check
bun run platform:check
bun run docs:check
bun test
```

## 14. Open Decisions

1. Should planned task-pack verification metadata use status `planned`, or should
   it avoid a status field entirely to prevent confusion with result statuses?
2. Should artifact writing be opt-in only for the first release, or should
   future high-risk workflows write artifacts by default after verification?
3. Should `VerificationEvidenceRef` remain intentionally small, or should a v2
   schema add explicit bounded output fields?

Default recommendation:

- Use `status: 'planned'` only inside `AgentTaskPlanVerification`, not inside
  `VerificationArtifact`.
- Keep artifact writing opt-in until at least one workflow validates the UX.
- Keep v1 evidence refs small and pointer-oriented.
