---
phase: 25
plan: 03
status: complete
completed: 2026-05-16
requirements: [DOCS-02]
key-files:
  created:
    - src/core/audit/recent.ts
    - tests/unit/core/audit/recent.test.ts
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-03-SUMMARY.md
  modified:
    - src/core/audit/types.ts
---

# 25-03 SUMMARY — audit_recent helper

## What shipped

Three exports collected into the single source of truth that Plans 06 and 07 will lean on for DOCS-02:

### `AuditEntryBrief` (src/core/audit/types.ts) — D-59

```ts
export type AuditEntryBrief = Pick<
  AuditEntry,
  'id' | 'ts' | 'command' | 'target' | 'success'
>
```

Exactly 5 keys. Forbidden keys per D-59 (`redacted_query`, `redacted_sql`, `metadata`, `session_id`, `engine`, `side_effect_tier`) do not exist on the type and the runtime `briefifyForRecent` never copies them.

Phase 24's `BriefEntry` in `src/commands/audit.ts` is intentionally distinct (it lacks `id`). This plan does not touch Phase 24's brief.

### `shouldEmbedRecent` (src/core/audit/recent.ts) — D-57

```ts
export function shouldEmbedRecent(opts: { forAgent?: boolean; format: string }): boolean {
  return opts.forAgent === true || opts.format === 'json'
}
```

True only when the consumer is asking for agent-facing JSON output. Human markdown never gets `audit_recent` embedded.

### `loadRecentAudit` (src/core/audit/recent.ts) — D-58 / D-60 / H

- N defaults to **5** (constant `RECENT_AUDIT_DEFAULT_N = 5`, no `--audit-n` flag per D-58).
- Resolves the audit file via `getAuditLogger(...).getHealth().currentFile` — current connection only (D-58 / Phase 25 H).
- Reads with `include_rotated: true` so older entries in `.jsonl.1` are visible.
- `tailEntries` returns ascending time order (latest LAST), then maps each through `briefifyForRecent` to drop forbidden keys.
- Wrapped in `try { … } catch { return [] }` — D-60 fall-through covers disabled / ENOENT / corruption / any internal throw.

## Tests (D-57 / D-58 / D-59 / D-60 mapped)

`tests/unit/core/audit/recent.test.ts` — 12 cases / 3 describe blocks:

| Describe | Test | Decision |
|---|---|---|
| `shouldEmbedRecent` | forAgent=true,markdown → true | D-57 |
| `shouldEmbedRecent` | forAgent=false,json → true | D-57 |
| `shouldEmbedRecent` | forAgent=false,markdown → false | D-57 |
| `shouldEmbedRecent` | format=markdown only → false | D-57 |
| `RECENT_AUDIT_DEFAULT_N` | === 5 | D-58 |
| `loadRecentAudit` | enabled=false → [] | D-60 |
| `loadRecentAudit` | ENOENT → [] | D-60 |
| `loadRecentAudit` | 3 entries asc | D-58 |
| `loadRecentAudit` | 10 entries → 5 (latest LAST) | D-58 |
| `loadRecentAudit` | brief shape is exactly 5 keys; forbidden keys absent | D-59 |
| `loadRecentAudit` | rotated segment included | Phase 25 H + RESEARCH §7 |
| `loadRecentAudit` | corrupted file → [] | D-60 |

Final: `bun test tests/unit/core/audit/recent.test.ts` → 12 pass / 0 fail. `bun test tests/unit/core/audit/` → 75 pass / 0 fail across 7 files. `bun run typecheck` exits 0.

## Hand-off

- **Plan 06 (inspect + guide)**: import `{ shouldEmbedRecent, loadRecentAudit }`; gate the embed on `shouldEmbedRecent({ forAgent, format })`; assign the result to `audit_recent` on the JSON output object.
- **Plan 07 (recover + recover --apply)**: same import + gate pattern at the JSON print site.
- **Plan 08 (contract test)**: import `AuditEntryBrief` type to assert the 4-surface shape (inspect / guide / recover / recover --apply).

## Self-Check: PASSED

- [x] `AuditEntryBrief` exported with exactly 5 keys, distinct from Phase 24's `BriefEntry`.
- [x] `RECENT_AUDIT_DEFAULT_N`, `shouldEmbedRecent`, `loadRecentAudit` exported from `src/core/audit/recent.ts`.
- [x] `include_rotated: true` is passed; current connection only.
- [x] D-60 fall-through covers all error paths.
- [x] D-59 forbidden keys are absent at runtime (asserted by test).
- [x] 12 unit tests pass; no regression in the 63 prior audit unit tests.
- [x] `bun run typecheck` exits 0.
