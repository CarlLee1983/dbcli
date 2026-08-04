# Verification Artifact Reader and Summary

**Date:** 2026-06-19
**Status:** Implemented — retained as a design record
**Baseline:** dbcli v1.34.0 plus local assert artifact bridge

## 1. Purpose

Close the handoff gap after verification artifacts are written.

dbcli can now persist schema-version-1 `VerificationArtifact` records from
`recover --apply --write-verification-artifact` and
`assert --write-verification-artifact`. Agents still need a stable read-only
surface to list those artifacts, inspect one record, and summarize the latest
verification state without manually finding files under `.dbcli/verification/`.

This milestone adds a read-only artifact reader and CLI summary surface. It does
not execute verification, mutate artifacts, or introduce `dbcli verify`.

## 2. Current Evidence

- `VerificationArtifact` v1 is defined in `src/core/verification/types.ts`.
- Artifact construction and write helpers exist in
  `src/core/verification/artifact.ts` and
  `src/core/verification/artifact-writer.ts`.
- Recovery can write artifacts through
  `recover --apply --write-verification-artifact`.
- Assert can write artifacts through
  `assert --write-verification-artifact --verification-subject <kind:name>`.
- `safe-backfill-verify` task plans deliberately emit planned evidence only;
  result evidence is produced by a final artifact-writing `assert`.
- User docs already distinguish planned evidence from result evidence.

## 3. Problem Statement

Artifact writing is now possible, but artifact consumption is still ad hoc.

That creates four practical issues:

1. Agents must infer the artifact directory and file naming convention.
2. Handoffs cannot ask dbcli for the latest verification state.
3. Malformed or partial artifact files have no bounded reporting surface.
4. Future workflow automation would need to reimplement artifact discovery.

## 4. Goals

1. Add a stable read-only command surface for verification artifacts.
2. Make the latest verification status easy for agents to retrieve as JSON.
3. Provide a reusable core reader for later workflow and UI surfaces.
4. Handle missing directories and malformed files predictably.
5. Keep artifact reading separate from audit logs and from future execution
   commands.

## 5. Non-Goals

- Do not add `dbcli verify`.
- Do not execute task-pack steps.
- Do not run assertions, snapshots, recovery, database reads, or database writes.
- Do not modify, delete, compact, or migrate artifact files.
- Do not add artifact retention policy or cleanup.
- Do not change the v1 `VerificationArtifact` schema.
- Do not merge audit log entries into artifacts or treat artifacts as audit log
  replacements.
- Do not recurse outside `<cwd>/.dbcli/verification/`.

## 6. Selected Approach

Add a top-level `dbcli verification` command group:

```bash
dbcli verification list --format json
dbcli verification show <id-or-path> --format json
dbcli verification summary --format json
```

The command group is intentionally named `verification`, not `verify`.
`verification` is the evidence-inspection surface. A future `verify` command can
remain reserved for running verification scenarios.

All subcommands are local filesystem reads only. They use the current working
directory as the artifact storage root, matching the existing writer contract:

```text
<cwd>/.dbcli/verification/verification-<YYYYMMDD-HHMMSS>-<short-id>.json
```

## 7. CLI Contract

### 7.1 `dbcli verification list`

Purpose: list known artifacts in latest-first order.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--format <format>` | `json` | `json` or `table`. |
| `--limit <n>` | `20` | Maximum valid artifacts to return. |
| `--status <status>` | none | Filter by `verified`, `not_verified`, `indeterminate`, or `blocked`. |
| `--subject <kind:name>` | none | Filter by subject kind and optional name. |
| `--include-invalid` | `false` | Include bounded invalid-file metadata in JSON output. |

Subject parsing should match the existing assert subject form:

```text
<kind>:<name>
```

For list filtering, `<kind>` alone is also allowed:

```text
backfill
```

JSON output:

```json
{
  "storageDir": "/repo/.dbcli/verification",
  "artifacts": [
    {
      "path": "/repo/.dbcli/verification/verification-20260619-010203-abcd.json",
      "filename": "verification-20260619-010203-abcd.json",
      "id": "ver_...",
      "createdAt": "2026-06-19T01:02:03.000Z",
      "status": "verified",
      "subject": { "kind": "backfill", "name": "safe-backfill-verify" },
      "summary": "Assertion verified the expected state.",
      "evidenceCount": 1
    }
  ],
  "invalid": []
}
```

Table output should be compact:

```text
createdAt                  status        subject                         id
------------------------   -----------   -----------------------------   --------
2026-06-19T01:02:03.000Z   verified      backfill:safe-backfill-verify   ver_...
```

When the directory is missing, return an empty artifact list and exit `0`.

### 7.2 `dbcli verification show <id-or-path>`

Purpose: print one complete artifact.

Lookup rules:

1. If `<id-or-path>` is an existing path, read that path only if it resolves
   inside `<cwd>/.dbcli/verification/`.
2. Otherwise match by exact artifact `id`.
3. Otherwise match by unique artifact id prefix.
4. Otherwise match by filename.
5. If no artifact matches, exit `1` with a concise message.
6. If multiple artifacts match a prefix, exit `1` and list bounded candidates.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--format <format>` | `json` | `json` or `table`. |

JSON output is the full artifact plus local metadata:

```json
{
  "path": "/repo/.dbcli/verification/verification-20260619-010203-abcd.json",
  "artifact": {
    "schemaVersion": 1,
    "id": "ver_...",
    "createdAt": "2026-06-19T01:02:03.000Z",
    "status": "verified",
    "subject": { "kind": "backfill", "name": "safe-backfill-verify" },
    "summary": "Assertion verified the expected state.",
    "evidence": [{ "kind": "assert", "exitCode": 0 }]
  }
}
```

Table output should show the artifact fields and evidence references without raw
row data or unbounded content.

### 7.3 `dbcli verification summary`

Purpose: return a handoff-ready summary of verification evidence.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--format <format>` | `json` | `json` or `table`. |
| `--subject <kind:name>` | none | Summarize only matching subject artifacts. |
| `--status <status>` | none | Summarize only matching status artifacts. |

JSON output:

```json
{
  "storageDir": "/repo/.dbcli/verification",
  "latest": {
    "path": "/repo/.dbcli/verification/verification-20260619-010203-abcd.json",
    "id": "ver_...",
    "createdAt": "2026-06-19T01:02:03.000Z",
    "status": "verified",
    "subject": { "kind": "backfill", "name": "safe-backfill-verify" },
    "summary": "Assertion verified the expected state."
  },
  "counts": {
    "total": 4,
    "verified": 2,
    "not_verified": 1,
    "indeterminate": 0,
    "blocked": 1,
    "invalid": 0
  },
  "subjects": [
    {
      "subject": { "kind": "backfill", "name": "safe-backfill-verify" },
      "total": 3,
      "latestStatus": "verified",
      "latestCreatedAt": "2026-06-19T01:02:03.000Z"
    }
  ]
}
```

If no valid artifacts match, `latest` is `null`, counts are zero, and the command
exits `0`.

## 8. Core Reader Design

Create `src/core/verification/reader.ts`.

Primary exported types:

```ts
export interface VerificationArtifactRecord {
  path: string
  filename: string
  artifact: VerificationArtifact
}

export interface InvalidVerificationArtifactRecord {
  path: string
  filename: string
  error: string
}

export interface ReadVerificationArtifactsResult {
  storageDir: string
  artifacts: VerificationArtifactRecord[]
  invalid: InvalidVerificationArtifactRecord[]
}
```

Primary exported functions:

```ts
export async function readVerificationArtifacts(
  storageRoot: string
): Promise<ReadVerificationArtifactsResult>

export function filterVerificationArtifacts(
  artifacts: VerificationArtifactRecord[],
  filters: VerificationArtifactFilters
): VerificationArtifactRecord[]

export function summarizeVerificationArtifacts(
  input: ReadVerificationArtifactsResult,
  filters?: VerificationArtifactFilters
): VerificationArtifactSummary

export function findVerificationArtifact(
  input: ReadVerificationArtifactsResult,
  selector: string
): VerificationArtifactRecord
```

Reader rules:

- Only read files matching `verification-*.json` under `.dbcli/verification/`.
- Sort valid artifacts by `artifact.createdAt` descending, then filename
  ascending for deterministic ties.
- Validate `schemaVersion === 1`.
- Validate status with `isVerificationStatus`.
- Validate `subject.kind` against `VerificationSubjectKind`.
- Validate `id`, `createdAt`, `summary`, and `evidence` are present and usable.
- Bound invalid-file error messages to one short line.
- Do not throw for a missing directory.
- Throw only for programmer errors or unsafe explicit path selection in `show`.

## 9. Safety and Privacy

The reader must not expand the privacy surface:

- Do not connect to a database.
- Do not read audit logs unless a future milestone explicitly adds a join.
- Do not print credentials, connection strings, host, port, raw rows, or raw
  stdout/stderr.
- Preserve artifact content as written, but table and summary renderers should
  keep output bounded.
- Reject explicit paths outside `<cwd>/.dbcli/verification/`.
- Do not follow directory recursion or glob outside the verification directory.

## 10. Error Handling

| Case | Behavior |
| --- | --- |
| Missing `.dbcli/verification/` | Empty result, exit `0`. |
| Invalid `--format` | Existing `validateFormat` error, exit `1`. |
| Invalid `--status` | Concise allowed-status error, exit `1`. |
| Invalid `--subject` | Concise allowed-subject error, exit `1`. |
| Malformed artifact during list/summary | Add invalid record, continue. |
| Malformed artifact selected by `show` | Exit `1` with bounded parse/validation error. |
| `show` selector not found | Exit `1`. |
| `show` selector ambiguous | Exit `1`, print bounded candidate ids/filenames. |
| Explicit path outside storage dir | Exit `1`. |

## 11. Impacted Files

Likely implementation files:

- Create `src/core/verification/reader.ts`.
- Extend `src/core/verification/index.ts`.
- Create `src/commands/verification.ts`.
- Modify `src/cli.ts` to register `verificationCommand`.

Likely tests:

- Create `tests/unit/core/verification/reader.test.ts`.
- Create `tests/commands/verification.test.ts` or
  `tests/integration/verification-command.test.ts`, following existing command
  test conventions.

Likely documentation:

- Update `docs/user/en/index.md`.
- Update `docs/user/en/index.html`.
- Update `docs/user/zh-TW/index.md`.
- Update `docs/user/zh-TW/index.html`.
- Update `assets/SKILL.md` and `assets/SKILL.zh-TW.md` with compact routing.
- Update `assets/reference.md`.
- Sync generated plugin and platform skill copies through existing scripts.

## 12. Acceptance Criteria

- `dbcli verification list --format json` returns valid artifacts latest-first.
- `dbcli verification list --status verified` filters by status.
- `dbcli verification list --subject backfill:safe-backfill-verify` filters by
  subject kind and name.
- `dbcli verification list` exits `0` with an empty list when the artifact
  directory does not exist.
- `dbcli verification show <id>` prints the full matching artifact.
- `dbcli verification show <short-prefix>` succeeds only when the prefix is
  unique.
- `dbcli verification show <path>` rejects paths outside
  `<cwd>/.dbcli/verification/`.
- `dbcli verification summary --format json` returns latest artifact metadata,
  status counts, invalid count, and subject breakdown.
- Malformed files do not break list or summary.
- Selected malformed files fail `show` with a bounded error.
- The command performs no database connection and writes no audit entries.
- English and zh-TW user docs plus Markdown/HTML parity stay aligned.

## 13. Verification Steps

Minimum implementation validation:

```bash
bun test tests/unit/core/verification/reader.test.ts
bun test tests/commands/verification.test.ts
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
```

## 14. ADR

Decision: add `dbcli verification list|show|summary` as a read-only artifact
inspection surface.

Drivers:

- Artifacts are now durable evidence, but they need a stable consumption path.
- Agents need JSON they can trust for handoff and completion claims.
- The feature should remain read-only and low-risk before any scenario runner is
  introduced.

Alternatives considered:

- Put the surface under `dbcli audit verification`.
  Rejected because artifacts are related to audit but are not audit entries.

- Add `dbcli verify safe-backfill` now.
  Rejected because execution semantics are broader than artifact consumption and
  should wait until the evidence reader is stable.

- Add only a core reader without CLI.
  Rejected because it would not solve the agent handoff problem.

Consequences:

- dbcli gains a complete write/read loop for verification artifacts.
- Future `dbcli verify` or task-pack runner work can depend on the same reader.
- `verification` becomes a product namespace, so future commands under it should
  remain evidence-oriented unless explicitly redesigned.

Follow-ups:

- After this lands, evaluate whether `dbcli verify safe-backfill` is warranted or
  whether artifact-producing `assert` plus artifact summaries are sufficient.
- Consider a later `dbcli verification prune` only after retention requirements
  are clear.
- Consider optional audit correlation in a separate milestone without changing
  the v1 artifact schema.

## Lifecycle closeout

### Current implementation

`src/core/verification/reader.ts` and `src/commands/verification.ts` implement
`verification list`, `show`, and `summary` with bounded validation, latest-first
ordering, filters, malformed-file accounting, and path-safe lookup. The surface
does not connect to a database or mutate artifacts.

### Completion evidence

- Implementation: `fc3fb48`, `015bb40`, `528b5bc`, and `4da55c8`.
- Verification: reader unit tests and verification command integration tests
  passed in the focused verification run (111 tests in the aggregate).
- Documentation: English and Traditional Chinese docs cover the read-only
  inspection surface and planned/result distinction.
- Repository gates: typecheck, lint, docs parity, skill parity, platform parity,
  and CLI contract checks passed during this audit.

### Known deviations

Retention and prune are now part of the same namespace, as described by the
separate retention spec. The reader commands themselves remain read-only.
