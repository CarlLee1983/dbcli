# Verification Artifact Contract Hardening

**Date:** 2026-06-19
**Status:** Implemented — retained as a design record
**Baseline:** dbcli v1.34.0 plus local verification artifact reader, summary, and prune

## 1. Purpose

Close the robustness and contract gaps found after implementing
`dbcli verification prune`.

The verification artifact workflow now has write, read, summary, and retention
surfaces. The next development item should not add another feature. It should
make the current surface harder to misuse and more honest about what it does:

- malformed local artifact JSON must never be accepted as valid and then crash a
  renderer;
- the `verification` namespace must no longer be described as globally
  read-only after gaining a destructive prune mode;
- retention semantics must clearly state whether `--keep-latest` is global or
  filter-scoped;
- human-readable prune output should preserve item-level accountability when
  deletion actually happens.

## 2. Current Evidence

- `VerificationArtifact` v1 is defined in `src/core/verification/types.ts`.
- `readVerificationArtifacts` validates a subset of the artifact shape in
  `src/core/verification/reader.ts`.
- `verification show --format table` dereferences evidence fields in
  `src/commands/verification.ts`.
- `verification prune` deletes only after `--execute --force`, and its core
  deletion path uses inside-directory, filename, `lstat`, and regular-file
  guards in `src/core/verification/retention.ts`.
- `selectPrunePlan` currently applies `--keep-latest` to the latest valid
  artifacts globally before applying status and subject filters.
- User docs and bundled skill summaries still describe the parent
  `verification` namespace as read-only, even though `prune --execute --force`
  can delete local artifact files.

## 3. Problem Statement

The verification artifact feature is functionally useful, but its current
contracts are too loose in four places.

1. Artifact validation treats `evidence` as valid when it is merely a non-empty
   array. A file with `evidence: [null]` can be listed as valid, then crash the
   table renderer during `verification show`.
2. The public command description and documentation mix old read-only language
   with a new lifecycle command that can delete files.
3. Prune behavior protects the newest valid artifacts globally, not within the
   filtered subset, but docs do not make this explicit.
4. Execute-mode table output summarizes deletion counts but does not list the
   deleted and skipped files, forcing humans to switch to JSON after a mutation
   to see exactly what happened.

These are not reasons to add new storage or verification concepts. They are
contract-hardening work for the existing surface.

## 4. Goals

1. Fully validate the v1 artifact shape that dbcli reads and renders.
2. Treat malformed evidence, malformed subject fields, and malformed optional
   fields as invalid-file records with bounded error messages.
3. Keep `verification list|show|summary` read-only and document them as such.
4. Describe the parent `verification` namespace as local artifact inspection and
   lifecycle management, not as globally read-only.
5. Preserve the existing global `--keep-latest` behavior, and document that it
   protects the newest N valid artifacts across all subjects and statuses before
   filters are applied.
6. Add execute-mode table detail for `prune` so deleted and skipped files are
   visible without requiring JSON.
7. Keep JSON output shapes backward-compatible except for malformed files moving
   from `artifacts` to `invalid`.
8. Keep docs, skill assets, and platform mirrors in sync.

## 5. Non-Goals

- Do not add `dbcli verify`.
- Do not change the v1 artifact schema.
- Do not introduce schema migration or artifact rewriting.
- Do not change the artifact writer filename format.
- Do not change prune deletion safety guards.
- Do not make pruning automatic.
- Do not change default `--keep-latest 20`.
- Do not make `--keep-latest` filter-scoped in this iteration.
- Do not add database access, audit writes, or remote storage to
  `verification`.

## 6. Selected Approach

Implement a hardening pass across reader validation, command wording, docs, and
table rendering.

The key product decision is to retain global `--keep-latest` semantics. Global
protection is more conservative for a destructive local cleanup command: the
newest valid evidence survives even when a user scopes deletion by status or
subject. This can under-delete during targeted cleanup, but it is safer than
accidentally deleting the most recent evidence for another subject.

The implementation must therefore clarify, not change, the selection order:

1. Read and sort valid artifacts latest-first.
2. Protect the first `--keep-latest` valid artifacts across the entire corpus.
3. Apply status and subject filters to the remaining valid artifacts.
4. Apply age selection.
5. Include invalid files by mtime only when `--include-invalid` is present.

## 7. Design Options Considered

### Option A: Documentation-only cleanup

Update the parent wording and docs, but leave artifact validation and table
output unchanged.

Rejected because it leaves a reproduced runtime crash in `verification show`.

### Option B: Contract hardening without behavior expansion

Tighten v1 validation, clarify namespace and retention docs, and improve
execute-mode table output while keeping JSON shape and prune safety semantics.

Selected because it addresses the review findings without expanding scope or
changing destructive selection behavior.

### Option C: Filter-scoped `--keep-latest`

Apply status and subject filters before protecting the latest N artifacts.

Rejected for this iteration because it weakens global safety and changes an
already implemented behavior. It can be reconsidered later as a new option, but
only with explicit UX and migration notes.

## 8. Runtime Validation Contract

`validateVerificationArtifact(value)` must reject malformed artifacts before
they enter `ReadVerificationArtifactsResult.artifacts`.

Required top-level fields:

| Field | Validation |
| --- | --- |
| `schemaVersion` | exactly `1` |
| `id` | non-empty string |
| `createdAt` | string parseable as a date |
| `status` | one of `verified`, `not_verified`, `indeterminate`, `blocked` |
| `subject` | object with valid `kind` |
| `summary` | non-empty string |
| `evidence` | non-empty array of valid evidence objects |

Optional top-level fields:

| Field | Validation |
| --- | --- |
| `blockedReason` | string when present |

Subject validation:

| Field | Validation |
| --- | --- |
| `kind` | one of `recovery`, `task-pack`, `assertion`, `migration`, `backfill`, `manual` |
| `name` | string when present |
| `command` | string when present |

Evidence validation:

| Field | Validation |
| --- | --- |
| `kind` | one of `assert`, `snapshot`, `recovery-verify`, `task-pack-plan`, `manual` |
| `command` | string when present |
| `exitCode` | number when present |
| `auditRef` | string when present |
| `recoveryRef` | string when present |
| `snapshotPath` | string when present |
| `taskName` | string when present |
| `step` | number when present |
| `note` | string when present |

Unknown extra fields may be preserved, but dbcli does not rely on them. Known
fields with wrong types must make the file invalid.

Invalid-file error messages remain bounded to one line and at most the existing
`INVALID_ERROR_MAX`.

## 9. CLI Contract Updates

### 9.1 Parent command wording

Change the parent command description from read-only inspection language to
mixed-mode local artifact wording, for example:

```text
Inspect and manage local verification artifacts under .dbcli/verification/
```

The help text and docs must explicitly separate the subcommands:

- `verification list`, `verification show`, and `verification summary` are
  read-only local filesystem inspection commands.
- `verification prune` is a local lifecycle command. It is dry-run by default
  and deletes only with `--execute --force`.

### 9.2 Prune keep-latest wording

Update option descriptions and docs to say:

```text
Always protect the latest N valid artifacts across all subjects/statuses before filters.
```

This wording must appear in:

- CLI option help for `--keep-latest`;
- `docs/user/en/index.md`;
- `docs/user/zh-TW/index.md`;
- generated `index.html` mirrors;
- `assets/reference.md`;
- bundled skill/reference mirrors for supported platforms.

### 9.3 Prune table output

Dry-run table output keeps the current summary plus candidate detail.

Execute-mode table output should include:

```text
mode      cutoff                    candidates   protected   deleted   skipped
-------   ------------------------  ----------   ---------   -------   -------
execute   2026-05-20T00:00:00.000Z  0            20          2         1

deleted
id        filename
-------   -----------------------------------------
ver_old   verification-20260501-010203-old.json

skipped
reason              id       filename
-----------------   ------   -----------------------------------------
not-regular-file    -        verification-link.json
```

The exact spacing may follow the existing `renderTable` helper. The required
content is section labels plus file-level deleted and skipped rows.

JSON output remains authoritative and keeps the existing keys:

- `storageDir`
- `dryRun`
- `cutoff`
- `criteria`
- `protected`
- `candidates`
- `deleted`
- `skipped`

## 10. Documentation and Asset Scope

Update all user-facing surfaces affected by command behavior:

- `src/commands/verification.ts`
- `docs/user/en/index.md`
- `docs/user/en/index.html`
- `docs/user/zh-TW/index.md`
- `docs/user/zh-TW/index.html`
- `assets/SKILL.md`
- `assets/SKILL.zh-TW.md`
- `assets/reference.md`
- generated skill/reference mirrors under `.cursor/`, `.github/`, `.windsurf/`,
  `plugins/`, and `skills/`

Use existing sync/check scripts where possible rather than hand-editing every
generated mirror independently.

## 11. Test Plan

### 11.1 Unit tests

Extend `tests/unit/core/verification/reader.test.ts`:

- `evidence: [null]` is rejected and appears in `invalid`.
- evidence with unknown `kind` is rejected.
- evidence optional fields with wrong types are rejected.
- `subject.name` with a non-string value is rejected.
- `subject.command` with a non-string value is rejected.
- `blockedReason` with a non-string value is rejected.
- a valid artifact with all known optional evidence fields still reads as valid.

Extend `tests/unit/core/verification/retention.test.ts`:

- document the global `keep-latest` behavior with a test where a status-scoped
  prune protects a newest artifact of a different status before selecting
  candidates.

### 11.2 Integration tests

Extend `tests/integration/verification-command.test.ts`:

- `verification list --format json --include-invalid` reports an artifact with
  `evidence: [null]` in `invalid`, not `artifacts`.
- `verification show <id> --format table` never crashes on malformed local JSON;
  the malformed file is reported through the invalid-file path.
- `verification prune --execute --force --format table` includes `deleted`
  section detail after deleting selected files.
- `verification prune --execute --force --format table` includes `skipped`
  section detail when a selected path is skipped by safety guards.
- `verification --help` no longer describes the parent namespace as read-only.

### 11.3 Documentation checks

Run existing docs and mirror checks:

```bash
bun run docs:check
bun run skill:check
bun run platform:check
```

## 12. Acceptance Criteria

- Malformed evidence entries are never returned in `artifacts`.
- `verification show --format table` does not crash on malformed local artifact
  JSON.
- Invalid malformed artifacts continue to produce bounded one-line error
  messages.
- Valid artifacts produced by existing writers still read successfully.
- CLI help and user docs describe `verification` as mixed inspection/lifecycle
  management, not globally read-only.
- Docs explicitly state that `list`, `show`, and `summary` are read-only.
- Docs explicitly state that `prune` is dry-run by default and deletes only with
  `--execute --force`.
- Docs explicitly state that `--keep-latest` is global across valid artifacts
  before filters are applied.
- Execute-mode table output lists deleted files and skipped files when present.
- JSON output remains backward-compatible for valid artifacts and prune results.
- English and zh-TW Markdown/HTML docs remain aligned.
- Skill and platform mirrors remain aligned.

## 13. Verification Steps

Minimum implementation validation:

```bash
bun test tests/unit/core/verification/reader.test.ts
bun test tests/unit/core/verification/retention.test.ts
bun test tests/integration/verification-command.test.ts
bun run typecheck
bun run lint
bun run docs:check
bun run skill:check
bun run platform:check
```

Before release:

```bash
bun run build
bun test
```

## 14. ADR

Decision: harden the existing verification artifact command contracts before
adding new verification features.

Drivers:

- Local artifact files can be malformed or manually edited.
- Artifact inspection must fail gracefully because agents rely on it for handoff.
- Destructive local cleanup must be described honestly in help and docs.
- Retention behavior must optimize for preserving recent evidence.

Alternatives considered:

- Documentation-only cleanup: rejected because it leaves a reproduced runtime
  crash.
- Filter-scoped keep-latest: rejected for this iteration because it changes the
  safer existing behavior and needs separate product discussion.
- Move prune out of `verification`: rejected because the namespace already owns
  local artifact lifecycle and the delete guard is narrow.

Consequences:

- Reader validation becomes stricter for malformed local files.
- Some files previously listed as valid will move to `invalid`.
- Human-facing docs become more accurate about destructive behavior.
- Targeted prune can still under-delete because global `keep-latest` remains
  conservative by design.

Follow-ups:

- Consider a future `--keep-latest-scope filtered|global` only if users need
  filter-scoped retention.
- Consider a JSON schema or zod validator if v1 grows beyond the current small
  artifact shape.

## Lifecycle closeout

### Current implementation

Reader validation, bounded malformed-file reporting, prune deletion guards,
global keep-latest semantics, and execute-mode deletion/skipped details are
implemented in `src/core/verification/reader.ts`, `retention.ts`, and
`src/commands/verification.ts`. User-facing wording distinguishes read-only
inspection from destructive prune.

### Completion evidence

- Implementation: `fc3fb48`, `cec9ed6`, `3ac63bc`, `49b655a`, `0b7ca7f`,
  `857b4db`, and `49b655a`.
- Verification: reader/retention unit tests and verification command
  integration tests passed in the focused verification run (111 tests in the
  aggregate).
- Documentation and parity: `bun run docs:check`, `bun run skill:check`, and
  `bun run platform:check` passed during this audit.

### Deferred decisions

`--keep-latest` remains global across valid artifacts. Reopen a filtered-scope
variant only if users present a concrete retention workflow that needs the
different safety trade-off.
