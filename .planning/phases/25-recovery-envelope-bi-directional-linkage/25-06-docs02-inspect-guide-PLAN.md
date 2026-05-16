---
phase: 25
plan: 06
type: execute
wave: 3
depends_on: [03, 05]
files_modified:
  - src/core/inspect/types.ts
  - src/core/guide/types.ts
  - src/commands/inspect.ts
  - src/commands/guide.ts
autonomous: true
requirements: [DOCS-02]
must_haves:
  truths:
    - "InspectSnapshot has audit_recent?: AuditEntryBrief[] declared as a trailing optional field"
    - "GuideSnapshot has audit_recent?: AuditEntryBrief[] at the top level (NOT inside context.InspectSnapshot)"
    - "INSPECT_SCHEMA_VERSION and GUIDE_SCHEMA_VERSION remain at 1 (additive optional field, no bump)"
    - "`dbcli inspect --for-agent` JSON output contains the audit_recent key (array, possibly empty)"
    - "`dbcli guide <goal> --for-agent` JSON output contains the audit_recent key at the top level"
    - "Human markdown output of `inspect` and `guide` (no --for-agent, no --format json) does NOT contain audit_recent (D-57)"
    - "When audit is disabled or missing, audit_recent is [] (not absent, not undefined-serialized) (D-60)"
  artifacts:
    - path: "src/core/inspect/types.ts"
      provides: "InspectSnapshot.audit_recent? optional field at end of interface"
      contains: "audit_recent"
    - path: "src/core/guide/types.ts"
      provides: "GuideSnapshot.audit_recent? optional field at top level (NOT inside context)"
      contains: "audit_recent"
    - path: "src/commands/inspect.ts"
      provides: "Injection between collectInspect() and renderJson(snap) when shouldEmbedRecent returns true"
      contains: "loadRecentAudit"
    - path: "src/commands/guide.ts"
      provides: "Same injection at the top-level GuideSnapshot (NOT inside snap.context)"
      contains: "loadRecentAudit"
  key_links:
    - from: "src/commands/inspect.ts"
      to: "src/core/audit/recent.ts (loadRecentAudit, shouldEmbedRecent)"
      via: "dynamic import after collectInspect; mutate snap.audit_recent before renderJson"
      pattern: "loadRecentAudit\\(config, configPath\\)"
    - from: "src/commands/guide.ts"
      to: "src/core/audit/recent.ts (loadRecentAudit, shouldEmbedRecent)"
      via: "same pattern but mutates the top-level GuideSnapshot, not context"
      pattern: "snap\\.audit_recent = await loadRecentAudit"
---

<objective>
Implement DOCS-02 audit_recent embedding for the two snapshot-based agent surfaces (`inspect` and `guide`):
1. Add `audit_recent?: AuditEntryBrief[]` to `InspectSnapshot` and `GuideSnapshot` (top level, not inside context).
2. In each command's happy-path, after the snapshot is collected and before it is rendered, call `loadRecentAudit` from Plan 03 when `shouldEmbedRecent({ forAgent, format })` returns true.
3. Verify integration: `dbcli inspect --for-agent` JSON has `audit_recent`; `dbcli guide health --for-agent` JSON has `audit_recent` at top level.

Purpose: D-56 / D-57 / D-58 / D-59 / D-60 applied to inspect + guide. Wave 3 injection that consumes Plan 03's helper. Plan 07 does the same for recover / recover --apply (different file shape - print-site wrap).

Output: Two type interfaces extended with one optional field each; two command handlers with a small injection block each.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-03-audit-recent-helper-PLAN.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-05-wire-j1-catch-blocks-PLAN.md
@src/core/inspect/types.ts
@src/core/guide/types.ts
@src/commands/inspect.ts
@src/commands/guide.ts
@src/core/audit/recent.ts

<interfaces>
Current `InspectSnapshot` (src/core/inspect/types.ts:64-75):
```ts
export interface InspectSnapshot {
  schemaVersion: typeof INSPECT_SCHEMA_VERSION
  system: SnapshotSystem | null
  connection: ConnectionSection
  permission: PermissionSection
  blacklist: BlacklistSection
  objects: ObjectsSection
  schemaCache: SchemaCacheSection
  snippets: SnippetsSection
  suggestedCommands: string[]
  warnings: string[]
}
```

Current `GuideSnapshot` (src/core/guide/types.ts:60-71):
```ts
export interface GuideSnapshot {
  schemaVersion: typeof GUIDE_SCHEMA_VERSION
  generatedAt: string
  goal: GuideGoalId
  context: InspectSnapshot  // already gets audit_recent via Task 1, but DOCS-02 puts it on the OUTER snapshot
  steps: GuideStep[]
  warnings: GuideWarning[]
}
```

`shouldEmbedRecent` + `loadRecentAudit` (from Plan 03 / `src/core/audit/recent.ts`):
```ts
export function shouldEmbedRecent(opts: { forAgent?: boolean; format: string }): boolean
export async function loadRecentAudit(config: DbcliConfig, configPath: string, n?: number): Promise<AuditEntryBrief[]>
```

Important from PATTERNS.md section 13 (GuideSnapshot note):
`context: InspectSnapshot` already has its own `audit_recent?` field after delta 12, but populating it in `collectGuide` is wasted work. Guide injects `audit_recent` at the top-level `GuideSnapshot`, not nested under `context`. Document this in the test (DOCS-02 contract: agent reads `top_level.audit_recent`, not `context.audit_recent`).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend InspectSnapshot + GuideSnapshot types with audit_recent</name>
  <read_first>
    - src/core/inspect/types.ts (full file, focus on lines 64-75 InspectSnapshot)
    - src/core/guide/types.ts (full file, focus on lines 60-71 GuideSnapshot)
    - src/core/audit/types.ts (post Plan 03, confirm AuditEntryBrief is exported)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (sections 12 + 13, exact target shapes)
  </read_first>
  <files>
    src/core/inspect/types.ts,
    src/core/guide/types.ts
  </files>
  <behavior>
    - Both interfaces gain a NEW optional trailing field: `audit_recent?: AuditEntryBrief[]`.
    - The field is positioned AFTER `warnings` in both interfaces (last field of the interface).
    - Neither schema version (`INSPECT_SCHEMA_VERSION` / `GUIDE_SCHEMA_VERSION`) is bumped - additive optional field is a non-breaking change for agent consumers.
    - The import `import type { AuditEntryBrief } from '@/core/audit/types'` is added at the top of each file.
  </behavior>
  <action>
**Step A - extend `src/core/inspect/types.ts`:**

Add import line near the top (if other type-only imports exist there, place it with them). Use whatever path style the surrounding imports use:

```ts
import type { AuditEntryBrief } from '@/core/audit/types'
```

Then modify the `InspectSnapshot` interface at lines 64-75 to append `audit_recent` as the final field:

```ts
export interface InspectSnapshot {
  schemaVersion: typeof INSPECT_SCHEMA_VERSION
  system: SnapshotSystem | null
  connection: ConnectionSection
  permission: PermissionSection
  blacklist: BlacklistSection
  objects: ObjectsSection
  schemaCache: SchemaCacheSection
  snippets: SnippetsSection
  suggestedCommands: string[]
  warnings: string[]
  /** Phase 25 DOCS-02: last N audit entries (brief shape). Only populated on agent JSON paths (D-57). [] when audit disabled / missing (D-60). */
  audit_recent?: AuditEntryBrief[]
}
```

Do NOT bump `INSPECT_SCHEMA_VERSION` (still `1`).

**Step B - extend `src/core/guide/types.ts`:**

Same pattern - add import then append the field on `GuideSnapshot`:

```ts
import type { AuditEntryBrief } from '@/core/audit/types'

// ... existing code ...

export interface GuideSnapshot {
  schemaVersion: typeof GUIDE_SCHEMA_VERSION
  generatedAt: string
  goal: GuideGoalId
  context: InspectSnapshot
  steps: GuideStep[]
  warnings: GuideWarning[]
  /** Phase 25 DOCS-02: last N audit entries (brief shape). Only populated on agent JSON paths (D-57). Top-level (NOT nested under context). */
  audit_recent?: AuditEntryBrief[]
}
```

Do NOT bump `GUIDE_SCHEMA_VERSION` (still `1`).

**Step C - run typecheck:**

`bun run typecheck` must exit 0. The `InspectSnapshot.audit_recent` field is also visible via `GuideSnapshot.context.audit_recent`, but that's not where Task 2 will populate it (the test in Plan 08 reads from `top_level.audit_recent`).
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | tee /tmp/typecheck-25-06-t1.log; grep -E "(error TS|Found 0 errors)" /tmp/typecheck-25-06-t1.log | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "audit_recent\\?: AuditEntryBrief\\[\\]" src/core/inspect/types.ts` returns one line.
    - `grep -nE "audit_recent\\?: AuditEntryBrief\\[\\]" src/core/guide/types.ts` returns one line.
    - `grep -cE "AuditEntryBrief" src/core/inspect/types.ts` returns 2 (import + field declaration).
    - `grep -cE "AuditEntryBrief" src/core/guide/types.ts` returns 2.
    - `grep -nE "INSPECT_SCHEMA_VERSION = 1" src/core/inspect/types.ts` returns one line (unchanged at 1).
    - `grep -nE "GUIDE_SCHEMA_VERSION = 1" src/core/guide/types.ts` returns one line (unchanged at 1).
    - `bun run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Both snapshot interfaces have an optional trailing `audit_recent` field of type `AuditEntryBrief[]`. Schema versions remain 1. typecheck clean.
  </done>
</task>

<task type="auto">
  <name>Task 2: Inject audit_recent in inspect.ts happy path</name>
  <read_first>
    - src/commands/inspect.ts (full file, after Plan 05 - lines 1-85)
    - src/core/audit/recent.ts (from Plan 03 - loadRecentAudit, shouldEmbedRecent)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 8 "Additional delta - DOCS-02 happy-path injection")
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (D-57, D-60)
  </read_first>
  <files>src/commands/inspect.ts</files>
  <behavior>
    Test cases (live integration, verifiable via spawning `dbcli inspect`):
    - `bun run src/cli.ts inspect --for-agent --config <empty-tmpdir>` JSON has `audit_recent: []` (D-60: no audit dir -> []).
    - With pre-seeded audit entries: same command's JSON has `audit_recent: [{ id, ts, command, target, success }, ...]` with up to 5 entries.
    - With `--format markdown` and no `--for-agent`: stdout is markdown; `audit_recent` MUST NOT appear (D-57).
    - With `--format json` (no `--for-agent`): `audit_recent` IS present (D-57: format === 'json' is sufficient).

    These end-to-end checks are exercised by Plan 08's contract test - this task just adds the source code that makes them pass.
  </behavior>
  <action>
Open `src/commands/inspect.ts`. The file currently has:
- Lines 1-8: imports
- Line 34: `.action(async (options, command) => {`
- Lines 36-43: `forAgent` / `format` / `brief` derivation + `configPath` + `config = await configModule.read(configPath)`
- Lines 45-51: `const snap = await collectInspect({ ... })`
- Lines 53-56: optional `requireSchemaCacheOrThrow`
- Line 58-60: `const out = format === 'markdown' ? renderMarkdown(snap, ...) : renderJson(snap, ...)`
- Lines 62-67: success-path `writeAuditEntry`
- Lines 68-83: catch block (already modified by Plan 05)

Add the DOCS-02 injection AFTER the `requireSchemaCacheOrThrow` block (line 56) and BEFORE the `const out = ...` line (line 58):

```ts
      if (options.requireSchemaCache === true) {
        const { requireSchemaCacheOrThrow } = await import('@/core/inspect')
        requireSchemaCacheOrThrow(snap.schemaCache, snap.system ?? null)
      }

      // Phase 25 DOCS-02: embed last N audit entries on agent JSON paths.
      if (config) {
        const { shouldEmbedRecent, loadRecentAudit } = await import('@/core/audit/recent')
        if (shouldEmbedRecent({ forAgent, format })) {
          snap.audit_recent = await loadRecentAudit(config, configPath)
        }
      }

      const out =
        format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
      console.log(out)
```

Notes:
- `config` is already in scope (set at line 43).
- `forAgent`, `format`, `configPath` are already in scope (derived at lines 37-42).
- Use dynamic import (`await import(...)`) to match the existing project style (the catch block uses `await import('@/core/recovery')`).
- `loadRecentAudit` already handles disabled / missing / corrupted internally and returns `[]` - no try/catch needed at the call site (D-60 is enforced inside the helper).
- Do NOT change `renderJson(snap, { brief })` - the snapshot type now has `audit_recent?` so JSON.stringify will include it iff set.

Run `bun run typecheck` to confirm.
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | tee /tmp/typecheck-25-06-t2.log; grep -E "(error TS|Found 0 errors)" /tmp/typecheck-25-06-t2.log | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "shouldEmbedRecent\\(\\{ forAgent, format \\}\\)" src/commands/inspect.ts` returns one line.
    - `grep -nE "snap\\.audit_recent = await loadRecentAudit\\(config, configPath\\)" src/commands/inspect.ts` returns one line.
    - The injection block is positioned BEFORE the `const out = ...` line: `grep -n "snap.audit_recent\\|const out" src/commands/inspect.ts` shows snap.audit_recent appearing on a LOWER line number than `const out = ...`.
    - `bun run typecheck` exits 0.
    - `bun test tests/integration/inspect.test.ts` exits 0 (existing tests do not regress).
  </acceptance_criteria>
  <done>
    inspect.ts injects audit_recent into the snapshot between the optional schema-cache check and the render call. Only triggers when shouldEmbedRecent returns true. Existing inspect tests still pass.
  </done>
</task>

<task type="auto">
  <name>Task 3: Inject audit_recent at top level of GuideSnapshot in guide.ts happy path</name>
  <read_first>
    - src/commands/guide.ts (full file, 104 lines)
    - src/core/audit/recent.ts
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 9, exact guide.ts injection)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (D-57)
  </read_first>
  <files>src/commands/guide.ts</files>
  <behavior>
    Test cases (verifiable in Plan 08):
    - `bun run src/cli.ts guide health --for-agent` JSON has `audit_recent` at the top level.
    - The same JSON also has `context.audit_recent` (because InspectSnapshot has the optional field after Task 1) BUT it is undefined / absent at the inner level because `collectGuide` does not populate it. Plan 08 reads only the TOP-level `audit_recent` and asserts agents must use that one.
    - guide's catch block (line 92-102) is NOT modified - guide does not emit envelopes per CONTEXT.md J1 / PATTERNS.md "NO emit envelope -> no D-J patch".
  </behavior>
  <action>
Open `src/commands/guide.ts`. The current structure (after the validated goal at line 68):

- Line 70-71: `const configPath = resolveConfigPath(command, options as { config?: string })` + `config = await configModule.read(configPath)`
- Lines 73-80: `const snap = await collectGuide({ ... })`
- Lines 82-84: `const out = format === 'markdown' ? renderMarkdown(snap, ...) : renderJson(snap, ...)` then `console.log(out)`
- Lines 86-91: success-path `writeAuditEntry`
- Lines 92-102: catch block (NOT modified)

Add the DOCS-02 injection BETWEEN the `collectGuide` call and the `renderJson(snap)` call:

```ts
      const snap = await collectGuide({
        workspace: process.cwd(),
        configPath,
        goal: validated,
        probe: options.probe === true,
        brief,
        probeTimeoutMs: options.probeTimeout as number,
      })

      // Phase 25 DOCS-02: embed last N audit entries on agent JSON paths.
      // Top-level placement (NOT inside snap.context) so agents read top_level.audit_recent.
      if (config) {
        const { shouldEmbedRecent, loadRecentAudit } = await import('@/core/audit/recent')
        if (shouldEmbedRecent({ forAgent, format })) {
          snap.audit_recent = await loadRecentAudit(config, configPath)
        }
      }

      const out =
        format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
      console.log(out)
```

Critical: `snap.audit_recent` here is the top-level `GuideSnapshot.audit_recent` field (added by Task 1). DO NOT write `snap.context.audit_recent = ...` - that would put the data on InspectSnapshot's slot, not on the agent-facing top level.

Do NOT modify the catch block at lines 92-102. Guide has no recovery envelope to wire (PATTERNS.md section 9 confirms).

Run `bun run typecheck` and the existing guide integration tests.
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | tee /tmp/typecheck-25-06-t3.log; grep -E "(error TS|Found 0 errors)" /tmp/typecheck-25-06-t3.log | tail -5; bun test tests/integration/guide.test.ts 2>&1 | tee /tmp/test-25-06-t3-guide.log; grep -E "(pass|fail|error)" /tmp/test-25-06-t3-guide.log | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "shouldEmbedRecent\\(\\{ forAgent, format \\}\\)" src/commands/guide.ts` returns one line.
    - `grep -nE "snap\\.audit_recent = await loadRecentAudit\\(config, configPath\\)" src/commands/guide.ts` returns one line.
    - `grep -nE "snap\\.context\\.audit_recent" src/commands/guide.ts` returns NOTHING (we are NOT populating the inner InspectSnapshot's slot - top-level placement only).
    - `grep -cE "emitRecoveryEnvelope" src/commands/guide.ts` is exactly 0 (guide does not emit envelopes - confirms no D-J patch was accidentally introduced).
    - `bun run typecheck` exits 0.
    - `bun test tests/integration/guide.test.ts` exits 0.
  </acceptance_criteria>
  <done>
    guide.ts injects audit_recent at top-level GuideSnapshot. Inner context.audit_recent remains undefined. Catch block is unchanged. Existing guide tests pass.
  </done>
</task>

</tasks>

<verification>
1. `bun run typecheck` exits 0.
2. `bun test tests/integration/inspect.test.ts` exits 0.
3. `bun test tests/integration/guide.test.ts` exits 0.
4. `git diff --name-only HEAD` after this plan shows: `src/core/inspect/types.ts`, `src/core/guide/types.ts`, `src/commands/inspect.ts`, `src/commands/guide.ts` (4 files, no more).
5. Manual smoke (optional): `bun run src/cli.ts inspect --for-agent --config /tmp/empty-dbcli` (where `/tmp/empty-dbcli` is an empty dir with just a valid `.dbcli` config) prints JSON with `"audit_recent": []` at the top level.
</verification>

<success_criteria>
- InspectSnapshot and GuideSnapshot each carry `audit_recent?: AuditEntryBrief[]` as a trailing optional field.
- inspect.ts and guide.ts each call `loadRecentAudit` only when `shouldEmbedRecent({ forAgent, format })` is true.
- guide.ts places `audit_recent` at the TOP level of GuideSnapshot, not inside `context`.
- INSPECT_SCHEMA_VERSION and GUIDE_SCHEMA_VERSION stay at 1.
- Schema versions match the rule "additive optional field is non-breaking" (RESEARCH section 12 G1).
</success_criteria>

<output>
After completion, create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-06-SUMMARY.md` documenting:
- The two type extensions and why the top-level placement matters for guide
- The injection sites in inspect.ts and guide.ts
- Confirmation that guide's catch block was NOT touched (J1 / PATTERNS.md section 9)
- Forward pointer: Plan 07 handles recover / recover --apply with a different shape (print-site wrap, not snapshot mutation)
</output>
