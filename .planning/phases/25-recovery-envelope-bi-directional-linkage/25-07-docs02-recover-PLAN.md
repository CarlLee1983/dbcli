---
phase: 25
plan: 07
type: execute
wave: 3
depends_on: [03]
files_modified:
  - src/commands/recover.ts
autonomous: true
requirements: [DOCS-02]
must_haves:
  truths:
    - "`dbcli recover --format json` stdout JSON contains audit_recent at top level"
    - "`dbcli recover --apply` stdout JSON contains audit_recent at top level"
    - "`dbcli recover` (no flag, defaults to markdown) stdout does NOT contain audit_recent (D-57)"
    - "`dbcli recover --next` (out of DOCS-02 scope per L2) is NOT modified"
    - "When audit is disabled / missing, audit_recent is []"
    - "audit_recent is added at the print site via JSON.stringify({ ...envelope, audit_recent }) - the RecoveryEnvelope body type is NOT modified (D-52)"
    - "audit_recent is added at the apply print site via JSON.stringify({ ...result, audit_recent }) - the ApplyResult type is NOT modified"
    - "`recover --apply` does NOT call writeAuditEntry (F1) - recover itself does not write audit entries"
  artifacts:
    - path: "src/commands/recover.ts"
      provides: "Lazy config load + loadRecentAudit + two print-site JSON wraps (no-apply envelope path and --apply result path)"
      contains: "audit_recent"
  key_links:
    - from: "src/commands/recover.ts"
      to: "src/core/audit/recent.ts (loadRecentAudit)"
      via: "lazy import after resolveApplySource; load config from process.cwd() since recover has no resolveConfigPath today"
      pattern: "loadRecentAudit\\(config, configPath\\)"
    - from: "src/commands/recover.ts (no-apply branch)"
      to: "console.log(JSON.stringify({ ...envelope, audit_recent }, null, 2))"
      via: "D-52 wrapper-at-print-site (not via render-json.ts)"
      pattern: "JSON\\.stringify\\(\\{ \\.\\.\\.source\\.envelope, audit_recent"
---

<objective>
Implement DOCS-02 audit_recent embedding for the third and fourth agent surfaces (`recover` and `recover --apply`). Unlike `inspect` and `guide` (which mutate the snapshot type), `recover` must NOT touch the `RecoveryEnvelope` body (D-52). The injection therefore happens at the print site, wrapping the output JSON with `{ ...envelope, audit_recent }`.

Purpose: D-56 (4 agent surfaces) / D-57 (trigger on JSON format) / D-60 (always `[]` on errors). Wave 3 injection mirroring Plan 06 for the two recover-JSON paths.

Output: One file modified (`src/commands/recover.ts`). Two print sites wrapped. No new types, no new files. The `recover` command does NOT call `writeAuditEntry` (F1 deferred).
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
@src/commands/recover.ts
@src/core/audit/recent.ts
@src/core/recovery/render-json.ts
@src/core/recovery/apply-render-json.ts
@src/core/recovery/next-render-json.ts

<interfaces>
Current `recover.ts` action handler shape (verbatim from src/commands/recover.ts:223-292):
```ts
.action(async (options: Record<string, unknown>) => {
  try {
    // ... mutual-exclusion + format derivation + allowWrite parsing ...
    const source = await resolveApplySource({ from: options.from as string | undefined, cwd: process.cwd() })

    if (options.next === true) {
      const result = await runNext(options, source)
      const out = format === 'markdown' ? renderNextMarkdown(result) : renderNextJson(result)
      console.log(out)
      return
    }

    if (options.apply !== true) {
      const out = format === 'markdown' ? renderMarkdown(source.envelope) : renderJson(source.envelope)
      console.log(out)
      return
    }

    const noVerify = options.verify === false
    const result = await runApply({ envelope: source.envelope, cwd: source.cwd, source: { kind: source.kind, path: source.path } }, { allowWrite, noVerify })
    const out = format === 'markdown' ? renderApplyMarkdown(result) : renderApplyJson(result)
    console.log(out)
    process.exit(exitCodeFor(result.finalStatus))
  } catch (err) { /* ... */ }
})
```

Key observations:
- recover does NOT call `resolveConfigPath` or `configModule.read` today (per `grep` of recover.ts).
- `source.envelope` is `RecoveryEnvelope` body (D-52 forbids extending this type).
- `result` is `ApplyResult` (also kept clean per PATTERNS.md section 15 recommendation).
- `renderNextJson(result)` is OUT OF SCOPE (L2: `--next` is a 5th JSON path explicitly excluded).
- D-57 trigger: `format === 'json'` (recover has NO `--for-agent` flag per RESEARCH L6).

Available helper (from Plan 03):
```ts
import { loadRecentAudit } from '@/core/audit/recent'
// async (config, configPath, n?) -> AuditEntryBrief[]; never throws
```

Available config loader:
```ts
import { configModule } from '@/core/config'
// configModule.read(configPath: string) -> Promise<DbcliConfig | null>
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Lazy-load config + audit_recent once per recover invocation, then wrap both JSON print sites</name>
  <read_first>
    - src/commands/recover.ts (full file, focus on lines 223-292 action handler)
    - src/core/audit/recent.ts (Plan 03 output)
    - src/core/config (find configModule.read signature)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 10, the exact wrap pattern)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md (L6 recover has no --for-agent, L8 dual print sites, L9 --from external)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (D-56, D-57, F1)
  </read_first>
  <files>src/commands/recover.ts</files>
  <behavior>
    Test cases (verifiable in Plan 08):
    - Spawn `dbcli recover --format json --config <workDir>` after seeding `.dbcli/last-recovery.json`: stdout JSON parses and contains `audit_recent: []` (or populated if audit entries exist).
    - Spawn `dbcli recover --apply --config <workDir>`: stdout JSON has `audit_recent` AND the existing ApplyResult fields (`schemaVersion`, `startedAt`, etc.).
    - Spawn `dbcli recover` (defaults to markdown): stdout is markdown; the bytes `audit_recent` do NOT appear.
    - Spawn `dbcli recover --next ...`: stdout JSON does NOT contain `audit_recent` (out of scope per L2).
    - Spawn with `audit.enabled = false` in config: stdout `audit_recent` is `[]`.
    - Spawn with missing `.dbcli` config dir: the recover command may still output the envelope, but `audit_recent` is `[]` (D-60 fall-through). Recover MUST NOT crash.
  </behavior>
  <action>
**Step A - prepare a single shared audit_recent variable at the top of the action handler:**

After the `resolveApplySource(...)` call (line 252-255) and BEFORE the `if (options.next === true)` branch (line 257), insert a hoisted `audit_recent` load. Per PATTERNS.md section 10:

```ts
const source = await resolveApplySource({ from: options.from as string | undefined, cwd: process.cwd() })

// Phase 25 DOCS-02: load audit_recent ONCE for both no-apply + --apply branches.
// Only when output format is json (D-57; recover has no --for-agent flag per L6).
// --next branch is OUT OF SCOPE (L2) - do not inject there.
let audit_recent: import('@/core/audit/types').AuditEntryBrief[] = []
if (format === 'json' && options.next !== true) {
  try {
    const { configModule } = await import('@/core/config')
    // recover.ts does not currently take --config; use cwd + '.dbcli' as the conventional resolver.
    // This matches resolveApplySource (line 254 above) which also uses process.cwd().
    const configPath = `${process.cwd()}/.dbcli`
    const config = await configModule.read(configPath)
    if (config) {
      const { loadRecentAudit } = await import('@/core/audit/recent')
      audit_recent = await loadRecentAudit(config, configPath)
    }
  } catch {
    audit_recent = []  // D-60: never block recover on audit lookup failures
  }
}
```

Notes:
- The `import('@/core/audit/types').AuditEntryBrief[]` inline type avoids adding a static import to the top of the file. Alternative: add `import type { AuditEntryBrief } from '@/core/audit/types'` at the top of `recover.ts` and use `AuditEntryBrief[]` directly. Either is acceptable - pick what reads cleanest in the existing file.
- The try/catch at the call site is BELT-AND-SUSPENDERS: `loadRecentAudit` already swallows errors (Plan 03), but the `configModule.read` call may itself throw if the config dir is malformed - swallow that too.
- The `if (config)` guard handles `configModule.read` returning `null` (e.g., no `.dbcli` in cwd).

**Step B - wrap the no-apply JSON print site at line 264-268:**

Replace:

```ts
if (options.apply !== true) {
  const out =
    format === 'markdown' ? renderMarkdown(source.envelope) : renderJson(source.envelope)
  console.log(out)
  return
}
```

with:

```ts
if (options.apply !== true) {
  if (format === 'markdown') {
    console.log(renderMarkdown(source.envelope))
  } else {
    // Phase 25 DOCS-02: wrap envelope with audit_recent at the PRINT site.
    // D-52 forbids embedding audit_recent in RecoveryEnvelope body, so build the
    // composite object inline rather than passing it through renderJson.
    console.log(JSON.stringify({ ...source.envelope, audit_recent }, null, 2))
  }
  return
}
```

Why not modify `renderJson(env)`? Per D-52 and PATTERNS.md section 14: `renderJson` operates on the `RecoveryEnvelope` body type, which must NOT carry audit_recent (stdout shape stable for `emitRecoveryEnvelope` callers, etc.). The wrapping happens here, in the consumer that already knows it wants the agent-facing shape.

**Step C - wrap the --apply JSON print site at line 281-283:**

Replace:

```ts
const out = format === 'markdown' ? renderApplyMarkdown(result) : renderApplyJson(result)
console.log(out)
process.exit(exitCodeFor(result.finalStatus))
```

with:

```ts
if (format === 'markdown') {
  console.log(renderApplyMarkdown(result))
} else {
  // Phase 25 DOCS-02: same pattern as no-apply branch - wrap at print site
  // so ApplyResult type stays clean (mirrors D-52 separation for symmetry).
  console.log(JSON.stringify({ ...result, audit_recent }, null, 2))
}
process.exit(exitCodeFor(result.finalStatus))
```

**Step D - do NOT modify the --next branch:**

The block at line 257-262 stays exactly as-is:

```ts
if (options.next === true) {
  const result = await runNext(options, source)
  const out = format === 'markdown' ? renderNextMarkdown(result) : renderNextJson(result)
  console.log(out)
  return
}
```

This is OUT OF SCOPE per RESEARCH L2 / CONTEXT.md D-56 (D-56 lists 4 commands, --next is the 5th excluded path).

**Step E - confirm recover does NOT call writeAuditEntry:**

Per F1 (CONTEXT.md), `recover --apply` does not write its own audit entry. Verify by grepping the file post-edit: `grep -nE "writeAuditEntry" src/commands/recover.ts` must return NOTHING.

Run `bun run typecheck` and the existing recover integration tests.
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | tee /tmp/typecheck-25-07-t1.log; grep -E "(error TS|Found 0 errors)" /tmp/typecheck-25-07-t1.log | tail -5; bun test tests/integration/recovery.test.ts tests/integration/recover-apply.test.ts 2>&1 | tee /tmp/test-25-07-t1.log; grep -E "(pass|fail|error)" /tmp/test-25-07-t1.log | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "let audit_recent" src/commands/recover.ts` returns one line (the hoisted variable).
    - `grep -nE "loadRecentAudit\\(config, configPath\\)" src/commands/recover.ts` returns one line.
    - `grep -nE "configModule\\.read\\(configPath\\)" src/commands/recover.ts` returns one line (lazy config load).
    - `grep -nE "JSON\\.stringify\\(\\{ \\.\\.\\.source\\.envelope, audit_recent" src/commands/recover.ts` returns one line (no-apply wrap).
    - `grep -nE "JSON\\.stringify\\(\\{ \\.\\.\\.result, audit_recent" src/commands/recover.ts` returns one line (--apply wrap).
    - `grep -cE "renderNextJson" src/commands/recover.ts` returns 1 (--next render call is preserved, untouched).
    - `grep -nE "writeAuditEntry" src/commands/recover.ts` returns NOTHING (F1: recover does not self-audit).
    - `grep -nE "options\\.next === true" src/commands/recover.ts` returns one line (--next branch preserved verbatim).
    - The audit_recent injection happens BEFORE the `--next` branch (gate by `options.next !== true` in the load block).
    - `bun run typecheck` exits 0.
    - `bun test tests/integration/recovery.test.ts` exits 0.
    - `bun test tests/integration/recover-apply.test.ts` exits 0.
    - `bun test tests/integration/recover-next.test.ts` exits 0 (--next path is untouched and should not regress).
  </acceptance_criteria>
  <done>
    recover.ts has a single hoisted audit_recent load gated by `format === 'json' && options.next !== true`. Both the no-apply and --apply JSON print sites wrap `{ ...envelope, audit_recent }` and `{ ...result, audit_recent }` respectively. --next is untouched. recover does NOT call writeAuditEntry. All existing recover tests pass.
  </done>
</task>

</tasks>

<verification>
1. `bun run typecheck` exits 0.
2. `bun test tests/integration/recovery.test.ts` exits 0 (no regression to envelope read path).
3. `bun test tests/integration/recover-apply.test.ts` exits 0.
4. `bun test tests/integration/recover-next.test.ts` exits 0 (L2 boundary preserved).
5. `git diff --name-only HEAD` after this plan shows only `src/commands/recover.ts` modified.
6. Manual smoke (optional): from a workspace with a valid `.dbcli` and a pre-seeded `.dbcli/last-recovery.json`, `bun run src/cli.ts recover --format json` prints JSON with `"audit_recent": [` near the bottom of the document. The `.dbcli/last-recovery.json` file itself is unchanged (read-only operation).
</verification>

<success_criteria>
- audit_recent is injected on both `recover --format json` (no apply) and `recover --apply` stdout JSON paths.
- Trigger condition: `format === 'json'` (NOT `--for-agent`, recover doesn't have that flag, RESEARCH L6).
- --next JSON path is NOT modified (L2 boundary).
- D-52 preserved: neither `RecoveryEnvelope` body nor `ApplyResult` type is extended. Wrapping happens at the print site.
- F1 preserved: recover does not call writeAuditEntry.
- D-60 preserved: any internal failure (config missing, audit disabled, etc.) -> audit_recent is `[]`, recover output still works.
</success_criteria>

<output>
After completion, create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-07-SUMMARY.md` documenting:
- The hoisted audit_recent load and why it is gated by `format === 'json' && options.next !== true`
- The two print-site wraps and why D-52 forbids modifying the underlying render functions
- Confirmation that --next was NOT touched (L2)
- Confirmation that writeAuditEntry was NOT called from recover (F1)
- Forward pointer: Plan 08 contract test exercises all four JSON paths (inspect, guide, recover, recover --apply) end-to-end
</output>
