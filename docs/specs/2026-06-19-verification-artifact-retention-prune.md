# Verification Artifact Retention and Prune Design Specification

**Date:** 2026-06-19
**Status:** Implemented — retained as a design record
**Baseline:** dbcli v1.34.0 plus local verification artifact reader/summary

## 1. Purpose

Define a safe lifecycle surface for local verification artifacts.

dbcli can now write and read schema-version-1 `VerificationArtifact` files under
`<cwd>/.dbcli/verification/`. That completes the evidence write/read loop, but
artifact directories can grow without an operator-visible retention policy.

This spec defines the next narrow development step: add a conservative,
dry-run-first prune surface under the existing `dbcli verification` namespace.
The command removes only local verification artifact files selected by explicit
retention criteria. It does not execute verification, alter artifact contents,
or introduce a generic `dbcli verify` scenario runner.

## 2. Current Evidence

- Artifact schema v1 is defined in `src/core/verification/types.ts`.
- Artifacts are written atomically under `.dbcli/verification/` by
  `writeVerificationArtifact`.
- `recover --apply --write-verification-artifact` and
  `assert --write-verification-artifact` can produce result evidence.
- `dbcli verification list|show|summary` provides read-only local inspection.
- The reader spec explicitly deferred retention and cleanup until requirements
  were clear.

## 3. Problem Statement

Verification artifacts are durable handoff evidence, but there is no bounded
local lifecycle operation.

That creates four practical issues:

1. Long-running projects can accumulate stale local evidence indefinitely.
2. Agents and developers have no dbcli-native way to preview cleanup candidates.
3. Manual deletion risks removing the wrong files or breaking handoff context.
4. Future artifact storage work would need to invent retention semantics from
   scratch.

## 4. Goals

1. Add a safe, explicit cleanup command for local verification artifacts.
2. Make dry-run preview the default behavior.
3. Require deliberate confirmation before any file is deleted.
4. Reuse the existing verification reader and status/subject filters.
5. Keep deletion scoped to `<cwd>/.dbcli/verification/verification-*.json`.
6. Produce machine-readable JSON results for agent handoff.
7. Preserve recent evidence by default with a keep-latest guard.

## 5. Non-Goals

- Do not add `dbcli verify`.
- Do not run assertions, snapshots, recovery, task packs, or database commands.
- Do not mutate artifact JSON contents.
- Do not migrate artifact schemas.
- Do not compact multiple artifacts into a new artifact.
- Do not delete audit logs, recovery envelopes, snapshots, or schema cache files.
- Do not recurse outside `.dbcli/verification/`.
- Do not make pruning automatic during write, list, show, summary, or upgrade.
- Do not upload, archive, encrypt, or sync artifacts.

## 6. Selected Approach

Add one subcommand:

```bash
dbcli verification prune --older-than 30d --format json
```

The command is dry-run by default. It only deletes when both confirmation flags
are present:

```bash
dbcli verification prune --older-than 30d --execute --force
```

The double flag mirrors existing dbcli destructive-command posture: `--execute`
means "perform the planned local action" and `--force` acknowledges deletion.

## 7. CLI Contract

### 7.1 Command

```bash
dbcli verification prune [options]
```

Purpose: preview or delete local verification artifact files matching explicit
retention criteria.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--format <format>` | `json` | `json` or `table`. |
| `--older-than <duration>` | required | Minimum artifact age. MVP accepts whole days only, e.g. `7d`, `30d`, `365d`. |
| `--keep-latest <n>` | `20` | Always protect the latest N valid artifacts before selecting candidates. |
| `--status <status>` | none | Filter valid artifacts by one status. |
| `--subject <kind:name>` | none | Filter valid artifacts by subject kind and optional name. |
| `--include-invalid` | `false` | Allow malformed `verification-*.json` files to be selected using file mtime. |
| `--execute` | `false` | Delete selected candidates instead of previewing them. |
| `--force` | `false` | Required together with `--execute`; prevents accidental deletes. |

`--older-than` is required in the first implementation. This prevents broad
"delete everything not protected by keep-latest" behavior.

`--status` and `--subject` apply only to valid artifacts. Invalid artifacts do
not have trusted status or subject fields and can only be selected when
`--include-invalid` is present.

### 7.2 Duration Parsing

MVP duration grammar:

```text
<positive-integer>d
```

Examples:

- `1d`
- `7d`
- `30d`

Rejected examples:

- `0d`
- `1h`
- `1.5d`
- `30`
- `forever`

The cutoff is computed as:

```text
Date.now() - days * 24 * 60 * 60 * 1000
```

Valid artifacts use `artifact.createdAt` for age comparison. Invalid artifacts,
when included, use filesystem `mtime`.

### 7.3 Candidate Selection

Selection order:

1. Read artifacts using the existing reader.
2. Sort valid artifacts in latest-first order using the reader's existing sort.
3. Mark the first `--keep-latest` valid artifacts as protected.
4. From remaining valid artifacts, select records matching all filters:
   - `createdAt` older than cutoff;
   - status matches `--status` when provided;
   - subject matches `--subject` when provided.
5. If `--include-invalid` is present, select invalid records whose file `mtime`
   is older than cutoff.
6. Before deletion, re-resolve every selected path and ensure it is still inside
   `<cwd>/.dbcli/verification/`.
7. Delete only regular files named `verification-*.json`.

Invalid records are never protected by `--keep-latest` because their `createdAt`
cannot be trusted. They are also never selected unless `--include-invalid` is
explicitly present.

### 7.4 JSON Output

Dry-run output:

```json
{
  "storageDir": "/repo/.dbcli/verification",
  "dryRun": true,
  "cutoff": "2026-05-20T00:00:00.000Z",
  "criteria": {
    "olderThanDays": 30,
    "keepLatest": 20,
    "status": "verified",
    "subject": { "kind": "backfill", "name": "safe-backfill-verify" },
    "includeInvalid": false
  },
  "protected": [
    {
      "path": "/repo/.dbcli/verification/verification-20260619-010203-new.json",
      "filename": "verification-20260619-010203-new.json",
      "id": "ver_new",
      "reason": "keep-latest"
    }
  ],
  "candidates": [
    {
      "path": "/repo/.dbcli/verification/verification-20260501-010203-old.json",
      "filename": "verification-20260501-010203-old.json",
      "id": "ver_old",
      "createdAt": "2026-05-01T01:02:03.000Z",
      "status": "verified",
      "subject": { "kind": "backfill", "name": "safe-backfill-verify" }
    }
  ],
  "deleted": [],
  "skipped": []
}
```

Execute output:

```json
{
  "storageDir": "/repo/.dbcli/verification",
  "dryRun": false,
  "cutoff": "2026-05-20T00:00:00.000Z",
  "criteria": {
    "olderThanDays": 30,
    "keepLatest": 20,
    "includeInvalid": false
  },
  "protected": [],
  "candidates": [],
  "deleted": [
    {
      "path": "/repo/.dbcli/verification/verification-20260501-010203-old.json",
      "filename": "verification-20260501-010203-old.json",
      "id": "ver_old"
    }
  ],
  "skipped": []
}
```

The `candidates` array is populated in dry-run mode. In execute mode,
successfully deleted records move to `deleted`; files that could not be deleted
move to `skipped`.

### 7.5 Table Output

Dry-run table output:

```text
mode      cutoff                    candidates   protected   deleted   skipped
dry-run   2026-05-20T00:00:00.000Z  1            1           0         0

candidates
createdAt                  status     subject                         id        filename
------------------------   --------   -----------------------------   -------   ----------------------------------------
2026-05-01T01:02:03.000Z   verified   backfill:safe-backfill-verify   ver_old   verification-20260501-010203-old.json
```

Execute table output:

```text
mode      cutoff                    candidates   protected   deleted   skipped
execute   2026-05-20T00:00:00.000Z  0            1           1         0
```

Table output should stay compact and bounded. JSON is the authoritative machine
contract.

## 8. Safety and Privacy

The prune command is local-file destructive, so safety defaults are stricter
than the read-only `list|show|summary` commands.

Required safety rules:

- Dry-run is default.
- `--execute` without `--force` exits `1` and deletes nothing.
- `--force` without `--execute` still performs dry-run only.
- `--older-than` is required.
- `--older-than` must be a positive day duration.
- Paths are resolved immediately before deletion and must remain inside
  `<cwd>/.dbcli/verification/`.
- Deletion targets must have filenames matching `verification-*.json`.
- Deletion targets must be regular files. Directories, symlinks, sockets, and
  other file types are skipped with a reason.
- A deletion error for one file does not stop deletion of the remaining
  candidates; the error is reported in `skipped`.
- No database connections are opened.
- No audit entries are written in the MVP. Audit logs track database activity;
  this command reports local artifact lifecycle through its own JSON result.
- Output must not add host, port, credentials, raw rows, or raw stdout/stderr.

## 9. Error Handling

| Case | Behavior |
| --- | --- |
| Missing `.dbcli/verification/` | Empty result, exit `0`. |
| Missing `--older-than` | Exit `1`, delete nothing. |
| Invalid duration | Exit `1`, delete nothing. |
| Invalid `--format` | Existing `validateFormat` error, exit `1`. |
| Invalid `--status` | Existing verification status error, exit `1`. |
| Invalid `--subject` | Existing subject parser error, exit `1`. |
| `--execute` without `--force` | Exit `1`, delete nothing. |
| Candidate path escapes storage dir | Skip candidate and report `outside-storage-dir`. |
| Candidate filename does not match `verification-*.json` | Skip candidate and report `filename-mismatch`. |
| Candidate is not a regular file | Skip candidate and report `not-regular-file`. |
| File disappears before delete | Skip candidate and report `missing`. |
| Unlink fails | Skip candidate and report the bounded filesystem error. |

## 10. Impacted Files

Likely implementation files:

- `src/core/verification/retention.ts`
- `src/core/verification/index.ts`
- `src/commands/verification.ts`

Likely tests:

- `tests/unit/core/verification/retention.test.ts`
- `tests/integration/verification-command.test.ts`

Likely documentation:

- `docs/user/en/index.md`
- `docs/user/en/index.html`
- `docs/user/zh-TW/index.md`
- `docs/user/zh-TW/index.html`
- `assets/reference.md`
- Generated skill/reference copies for supported platforms, via existing sync
  scripts.

## 11. Acceptance Criteria

- `dbcli verification prune --older-than 30d --format json` exits `0`, deletes
  nothing, and reports candidates.
- `dbcli verification prune --older-than 30d --execute` exits `1`, deletes
  nothing, and reports that `--force` is required.
- `dbcli verification prune --older-than 30d --force` performs dry-run only.
- `dbcli verification prune --older-than 30d --execute --force` deletes only
  selected artifact files.
- Latest valid artifacts are protected by default via `--keep-latest 20`.
- `--keep-latest 0` is accepted and protects no valid artifacts.
- `--status verified` selects only valid artifacts with status `verified`.
- `--subject backfill:safe-backfill-verify` selects only matching subjects.
- Invalid files are ignored by default.
- Invalid files older than cutoff are selected only with `--include-invalid`.
- Missing artifact directory exits `0` with empty arrays.
- Symlinks and directories inside `.dbcli/verification/` are not deleted.
- Path traversal and time-of-check/time-of-use escapes are skipped, not deleted.
- JSON output includes `storageDir`, `dryRun`, `cutoff`, `criteria`,
  `protected`, `candidates`, `deleted`, and `skipped`.
- English and zh-TW user docs plus Markdown/HTML parity stay aligned.

## 12. Verification Steps

Minimum implementation validation:

```bash
bun test tests/unit/core/verification/retention.test.ts
bun test tests/integration/verification-command.test.ts
bun run typecheck
bun run lint
bun run docs:check
```

Before release:

```bash
bun run plugin:check
bun run platform:check
bun run build
bun test
```

## 13. ADR

Decision: add `dbcli verification prune` as a dry-run-first local artifact
lifecycle command.

Drivers:

- Verification artifacts are now durable evidence and need explicit lifecycle
  management.
- Cleanup must be safer than manual deletion because agents may run it.
- The existing `verification` namespace is evidence-oriented and already owns
  artifact inspection.

Alternatives considered:

- Add automatic pruning during artifact writes.
  Rejected because it would make evidence writes unexpectedly destructive and
  would complicate failure semantics for `assert` and `recover --apply`.

- Add `dbcli verification clear`.
  Rejected because all-or-nothing deletion is too broad for agent workflows.

- Add retention configuration in `.dbcli/config.json`.
  Rejected for the first pass because explicit CLI criteria are easier to
  reason about, test, and audit from command output.

- Add `dbcli verify` first.
  Rejected because running verification scenarios is broader than artifact
  lifecycle and does not solve stale local evidence.

Consequences:

- dbcli gains a complete local lifecycle loop for verification evidence:
  write, inspect, summarize, and prune.
- The command introduces local-file deletion under a double-confirmation guard.
- Future artifact storage work can reuse the retention selection model without
  changing the v1 artifact schema.

Follow-ups:

- Consider optional retention defaults in config after CLI behavior stabilizes.
- Consider `dbcli verification archive` only if users need long-term evidence
  preservation outside `.dbcli/verification/`.
- Re-evaluate `dbcli verify <scenario>` after at least two workflows need shared
  scenario execution semantics.

## Lifecycle closeout

### Current implementation

`src/core/verification/retention.ts` and `src/commands/verification.ts`
implement dry-run-first `verification prune`. Deletion requires explicit
`--execute --force`, preserves the global keep-latest guard, rejects path
escapes/non-regular files, and reports candidates, deletions, and skips in JSON
and table output.

### Completion evidence

- Implementation: `44827b5`, `d2f864b`, `cec9ed6`, `49b655a`, and `857b4db`.
- Verification: retention unit tests and verification command integration tests
  passed in the focused verification run (111 tests in the aggregate).
- Documentation and parity: docs, skill, and platform checks passed during this
  audit.

### Known deviations

Prune remains local-file lifecycle management; it does not archive evidence or
execute verification scenarios. Those are intentionally separate concerns.
