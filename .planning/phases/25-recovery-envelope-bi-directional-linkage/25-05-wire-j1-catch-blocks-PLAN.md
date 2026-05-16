---
phase: 25
plan: 05
type: execute
wave: 2
depends_on: [02, 04]
files_modified:
  - src/commands/inspect.ts
  - src/commands/query.ts
autonomous: true
requirements: [INTEGRATE-02, INTEGRATE-03]
must_haves:
  truths:
    - "When `dbcli query <bad-sql> --recovery` fails, the audit entry produced has a non-empty `recovery_ref` matching the envelope's `id`"
    - "When `dbcli inspect --recovery` fails (e.g. --require-schema-cache misfires), the audit entry produced has a non-empty `recovery_ref` matching the envelope's `id`"
    - "When the same failure produces an envelope, that envelope's `audit_ref` equals the audit entry's `id`"
    - "When `--recovery` flag is OMITTED on `dbcli inspect` failure, no envelope is emitted and no `recovery_ref` appears in the audit entry"
    - "When audit is disabled (`audit.enabled=false`) but `--recovery` is on, the envelope is still written with `id` but `audit_ref` is OMITTED (D-53)"
    - "Only `inspect.ts` and `query.ts` are modified in Plan 05; the 6 unwired commands (insert / update / delete / export / q / schema) are NOT touched (J1 scope)"
  artifacts:
    - path: "src/commands/inspect.ts"
      provides: "Catch block at lines 68-83 calls writeAuditEntry with recovery_ref then emitRecoveryEnvelope with envelopeId + auditRef"
      contains: "envelopeId"
    - path: "src/commands/query.ts"
      provides: "Catch block at lines 165-202 calls writeAuditEntry with recovery_ref then emitRecoveryEnvelope with envelopeId + auditRef (table-name context preserved)"
      contains: "envelopeId"
  key_links:
    - from: "src/commands/inspect.ts:68-83"
      to: "src/core/recovery/emit.ts emitRecoveryEnvelope({ envelopeId, auditRef })"
      via: "envelopeId pre-generated via crypto.randomUUID(); auditRef from awaited writeAuditEntry return value"
      pattern: "emitRecoveryEnvelope\\(.+envelopeId"
    - from: "src/commands/query.ts:165-202"
      to: "src/core/recovery/emit.ts emitRecoveryEnvelope({ envelopeId, auditRef })"
      via: "same template applied with operation: 'query', table from extractTableName"
      pattern: "emitRecoveryEnvelope\\(.+envelopeId"
---

<objective>
Wire the bi-directional ref into the two commands that already write both an audit entry AND emit a recovery envelope on failure (the J1 wired surface per the CONTEXT.md Scope Addendum). After this plan:
- A failing `query` or `inspect` invocation with `--recovery` produces an audit entry whose `recovery_ref` equals the envelope's `id`.
- The envelope's `audit_ref` equals the audit entry's `id`.
- The bi-directional UUIDs match, validating ROADMAP success criteria #1 + #2.

Purpose: D-50 / D-51 / D-J / K1 applied to the two wired surfaces. Out-of-scope commands (`insert / update / delete / export / q / schema`) are NOT modified - that asymmetry is the J1 lock and is guarded explicitly by Plan 08's contract test.

Output: Two catch-block patches (one per file) following the exact PATTERNS.md section J template. No new files.
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
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-02-write-audit-entry-id-return-PLAN.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-04-emit-envelope-id-PLAN.md
@src/commands/inspect.ts
@src/commands/query.ts
@src/core/audit/integration-helper.ts
@src/core/recovery/emit.ts

<interfaces>
After Plan 02 (writeAuditEntry signature):
```ts
export interface AuditOutcome {
  // ... existing fields ...
  recovery_ref?: string  // Phase 25 D-J
}
export async function writeAuditEntry(...): Promise<string | null>  // Phase 25 D-K
```

After Plan 04 (emit.ts EmitOptions):
```ts
export interface EmitOptions extends RecoveryRenderOptions {
  exitCode?: number
  argv?: string[]
  cwd?: string
  envelopeId?: string  // Phase 25 D-51
  auditRef?: string    // Phase 25 D-53
}
```

Current inspect.ts catch block (src/commands/inspect.ts:68-83):
```ts
} catch (err) {
  if (config) {
    await writeAuditEntry(config, 'inspect', options, {
      success: false,
      target: '*',
      error: err,
    })
  }

  if (options.recovery === true) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(err, { operation: 'inspect' })
  }
  console.error((err as Error).message)
  process.exit(1)
}
```

Current query.ts catch block (src/commands/query.ts:165-202):
```ts
} catch (error) {
  if (config) {
    await writeAuditEntry(config, 'query', options, {
      success: false,
      sql,
      error,
    })
  }

  if (options.recovery === true) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(error, {
      operation: 'query',
      table: (await import('@/utils/engine-hints')).extractTableName(sql) ?? undefined,
    })
  }

  if (error instanceof BlacklistError) { /* ... typed error rendering ... */ }
  if (error instanceof PermissionError) { /* ... */ }
  if (error instanceof ConnectionError) { /* ... */ }
  console.error(t_vars('errors.message', { message: (error as Error).message }))
  process.exit(1)
}
```

J1 scope reminder (CONTEXT.md Scope Addendum, line 304):
The 7 files in canonical_refs were listed as 雙向 ref 注入點 but post-research only `query.ts` is J1 from that group.
The 6 unwired commands (insert/update/delete/export/q/schema) MUST NOT be modified by Plan 05.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wire bi-directional ref into src/commands/inspect.ts catch block</name>
  <read_first>
    - src/commands/inspect.ts (full file, all 85 lines)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 8, exact target patch + section "Shared Patterns: D-J catch block template")
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (J specifics block in <specifics> section)
    - src/core/audit/integration-helper.ts (post Plan 02, confirm writeAuditEntry returns Promise<string | null>)
    - src/core/recovery/emit.ts (post Plan 04, confirm EmitOptions has envelopeId / auditRef)
  </read_first>
  <files>src/commands/inspect.ts</files>
  <behavior>
    - The catch block at lines 68-83 must produce, for any caught error:
      * If `options.recovery === true`: pre-generate `envelopeId = crypto.randomUUID()`; pass it to writeAuditEntry as `recovery_ref`; capture the returned `auditId`; pass `envelopeId` and `auditRef: auditId ?? undefined` to `emitRecoveryEnvelope`.
      * If `options.recovery !== true`: do NOT pre-generate envelopeId; do NOT pass `recovery_ref` to writeAuditEntry; do NOT call emitRecoveryEnvelope. The audit entry is still written (success: false), but without `recovery_ref`.
    - The trailing `console.error` + `process.exit(1)` is preserved verbatim (the existing fallback path for when --recovery is off).
    - Order of operations: pre-generate envelopeId FIRST, then writeAuditEntry SECOND (await its returned id), then emitRecoveryEnvelope LAST. This ordering matters: emit calls process.exit, so it must be last.
  </behavior>
  <action>
**Step A - add the `crypto` import at the top of the file:**

Find the import block at the top of `src/commands/inspect.ts` (lines 1-7). Add `import crypto from 'node:crypto'` immediately after the existing `node`-style imports. Place it before the project (`@/...`) imports to match the existing style:

```ts
import { Command } from 'commander'
import crypto from 'node:crypto'  // Phase 25 D-51
import { t } from '@/i18n/message-loader'
// ... rest unchanged ...
```

**Step B - replace the catch block at lines 68-83 with the patched version:**

Verbatim replacement (lines 68-83 of the current file):

```ts
} catch (err) {
  let auditId: string | null = null
  let envelopeId: string | undefined
  if (options.recovery === true) {
    envelopeId = crypto.randomUUID()  // Phase 25 D-51 / D-J
  }
  if (config) {
    auditId = await writeAuditEntry(config, 'inspect', options, {
      success: false,
      target: '*',
      error: err,
      ...(envelopeId && { recovery_ref: envelopeId }),  // Phase 25 D-J
    })
  }

  if (envelopeId !== undefined) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(err, { operation: 'inspect' }, {
      envelopeId,                            // Phase 25 D-51
      auditRef: auditId ?? undefined,        // Phase 25 K1
    })
  }
  console.error((err as Error).message)
  process.exit(1)
}
```

Notes:
- The `if (envelopeId !== undefined)` guard replaces the old `if (options.recovery === true)` guard. They are equivalent because `envelopeId` is set iff `options.recovery === true`.
- `auditId ?? undefined` converts `null` to `undefined`, matching the EmitOptions `auditRef?: string` type contract (Plan 04 omits the field when undefined).
- Do NOT add an `else` branch - if `--recovery` is off, the function still emits no envelope. That is unchanged behavior.

Run `bun run typecheck` to confirm the patched catch block satisfies the new function signatures.
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | tee /tmp/typecheck-25-05-t1.log; grep -E "(error TS|Found 0 errors)" /tmp/typecheck-25-05-t1.log | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "^import crypto from 'node:crypto'" src/commands/inspect.ts` returns one line.
    - `grep -nE "envelopeId = crypto\\.randomUUID\\(\\)" src/commands/inspect.ts` returns one line inside the catch block.
    - `grep -nE "let auditId: string \\| null = null" src/commands/inspect.ts` returns one line.
    - `grep -nE "recovery_ref: envelopeId" src/commands/inspect.ts` returns one line (the spread-on-truthy pattern).
    - `grep -nE "auditRef: auditId \\?\\? undefined" src/commands/inspect.ts` returns one line.
    - `grep -cE "emitRecoveryEnvelope\\(" src/commands/inspect.ts` is exactly 1 (only one emit call site, not duplicated).
    - `grep -nE "process\\.exit\\(1\\)" src/commands/inspect.ts` still present at the bottom of the catch.
    - `bun run typecheck` exits 0.
    - `bun test tests/integration/inspect.test.ts` exits 0 (existing inspect tests do not regress; they may not exercise the failure path but must still pass).
  </acceptance_criteria>
  <done>
    inspect.ts catch block follows the D-J template exactly: pre-gen envelopeId (only when --recovery), call writeAuditEntry with optional recovery_ref, then call emitRecoveryEnvelope with envelopeId + auditRef. All existing inspect tests pass; typecheck clean.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire bi-directional ref into src/commands/query.ts catch block (preserve typed-error rendering)</name>
  <read_first>
    - src/commands/query.ts (lines 1-30 for imports; lines 160-205 for the catch block)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 11, exact target patch)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md (section L3, outer catch in cli.ts - DO NOT modify cli.ts:154)
    - src/cli.ts (lines 149-160 to confirm the outer cli.ts catch is the unreachable fallback and is OUT OF SCOPE)
  </read_first>
  <files>src/commands/query.ts</files>
  <behavior>
    - The query.ts catch block (lines 165-202) keeps:
      * The typed-error rendering blocks (BlacklistError / PermissionError / ConnectionError) untouched
      * The `operation: 'query', table: extractTableName(sql)` context untouched
    - It gains the same D-J ordering as inspect.ts:
      * Pre-gen envelopeId when --recovery (else leave undefined)
      * await writeAuditEntry, capturing returned auditId
      * Call emitRecoveryEnvelope with envelopeId + auditRef when --recovery is on
    - The 3 OTHER call sites in query.ts that call writeAuditEntry (lines 277, 341, 419 success paths) do NOT change; they do not emit envelopes.
    - L3: do NOT modify the OUTER catch in `src/cli.ts:149-160` (that's the unreachable safety net; modifying it would double-emit).
  </behavior>
  <action>
**Step A - add the `crypto` import at the top of `src/commands/query.ts`:**

Find the top-of-file import block and add `import crypto from 'node:crypto'` near the other node imports (the existing imports use `@/`-style aliases extensively; add the node-builtin import at the top before the alias imports).

```ts
import crypto from 'node:crypto'  // Phase 25 D-51
// ... rest of imports unchanged ...
```

**Step B - replace the catch block at lines 165-202 with the patched version:**

Per PATTERNS.md section 11, the upgraded catch block is:

```ts
} catch (error) {
  let auditId: string | null = null
  let envelopeId: string | undefined
  if (options.recovery === true) {
    envelopeId = crypto.randomUUID()  // Phase 25 D-51 / D-J
  }
  if (config) {
    auditId = await writeAuditEntry(config, 'query', options, {
      success: false,
      sql,
      error,
      ...(envelopeId && { recovery_ref: envelopeId }),  // Phase 25 D-J
    })
  }

  if (envelopeId !== undefined) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(error, {
      operation: 'query',
      table: (await import('@/utils/engine-hints')).extractTableName(sql) ?? undefined,
    }, {
      envelopeId,                            // Phase 25 D-51
      auditRef: auditId ?? undefined,        // Phase 25 K1
    })
  }

  // Typed error rendering paths PRESERVED VERBATIM from the current file:
  if (error instanceof BlacklistError) {
    console.error(error.message)
    process.exit(1)
  }

  if (error instanceof PermissionError) {
    console.error(t_vars('errors.permission_denied', { required: error.requiredPermission }))
    console.error(`   Operation: ${error.classification.type}`)
    console.error(`   Message: ${error.message}`)
    process.exit(1)
  }

  if (error instanceof ConnectionError) {
    console.error(t_vars('errors.connection_failed', { message: error.message }))
    process.exit(1)
  }

  // Other errors (missing table, syntax, etc.)
  console.error(t_vars('errors.message', { message: (error as Error).message }))
  process.exit(1)
}
```

Critical: the typed error rendering remains AFTER the emit block. If `--recovery` is on, `emitRecoveryEnvelope` calls `process.exit()` and the typed-error rendering never runs. If `--recovery` is off, the typed-error rendering runs as before. This preserves the existing UX for the no-recovery path.

**Step C - do NOT modify the OUTER catch in `src/cli.ts:149-160`** (per RESEARCH section L3 and CONTEXT.md J1 scope). That outer catch is an unreachable safety net; modifying it would risk a double-emit.

Run typecheck and the integration query tests:
- `bun run typecheck`
- `bun test tests/integration/cli.test.ts` (if it includes query tests)
- `bun test tests/integration/recover-apply.test.ts` and `bun test tests/integration/recovery.test.ts` (the recovery integration tests may produce envelopes that flow through query catch blocks)
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | tee /tmp/typecheck-25-05-t2.log; grep -E "(error TS|Found 0 errors)" /tmp/typecheck-25-05-t2.log | tail -5; bun test tests/integration/recovery.test.ts 2>&1 | tee /tmp/test-25-05-t2-recovery.log; grep -E "(pass|fail|error)" /tmp/test-25-05-t2-recovery.log | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "^import crypto from 'node:crypto'" src/commands/query.ts` returns one line.
    - `grep -nE "envelopeId = crypto\\.randomUUID\\(\\)" src/commands/query.ts` returns one line inside the catch block.
    - `grep -cE "emitRecoveryEnvelope\\(" src/commands/query.ts` is exactly 1 (only one emit call site).
    - `grep -nE "envelopeId," src/commands/query.ts` returns at least one line (the third arg to emitRecoveryEnvelope).
    - `grep -nE "auditRef: auditId \\?\\? undefined" src/commands/query.ts` returns one line.
    - `grep -nE "extractTableName" src/commands/query.ts` is still present (table-name extraction context is preserved).
    - The 3 typed-error blocks are still present: `grep -cE "instanceof BlacklistError|instanceof PermissionError|instanceof ConnectionError" src/commands/query.ts` returns 3.
    - `grep -nE "process\\.exit\\(1\\)" src/commands/query.ts` returns at least 4 lines (one per typed-error branch + the default branch).
    - `grep -cE "await writeAuditEntry" src/commands/query.ts` returns >= 4 (the 4 existing call sites are preserved: catch + 3 success paths at 277, 341, 419).
    - `grep -cE "emitRecoveryEnvelope" src/cli.ts` is still 4 (the 4 outer catches in cli.ts are NOT modified; verifies L3).
    - `bun run typecheck` exits 0.
    - `bun test tests/integration/recovery.test.ts` exits 0.
    - The 6 unwired commands are NOT touched by this plan: `git diff --name-only` shows ONLY `src/commands/inspect.ts` and `src/commands/query.ts`.
  </acceptance_criteria>
  <done>
    query.ts catch block applies the D-J template: pre-gen envelopeId, capture auditId from writeAuditEntry, pass both to emitRecoveryEnvelope. The 3 typed-error branches are preserved verbatim and run when --recovery is off. The 6 unwired commands are unchanged. cli.ts outer catches are unchanged.
  </done>
</task>

</tasks>

<verification>
1. `bun run typecheck` exits 0.
2. `bun test tests/integration/inspect.test.ts` exits 0.
3. `bun test tests/integration/recovery.test.ts` exits 0 (envelopes still emit correctly).
4. `git diff --name-only HEAD` (after this plan's tasks) shows only `src/commands/inspect.ts` and `src/commands/query.ts` modified, NOT `cli.ts`, NOT `insert.ts`, NOT `update.ts`, NOT `delete.ts`, NOT `export.ts`, NOT `q.ts`, NOT `schema.ts`, NOT `guide.ts`.
5. `grep -cE "envelopeId" src/commands/inspect.ts src/commands/query.ts` returns at least 4 (the local variable + the option key in both files).
6. `grep -c "envelopeId\|auditRef" src/commands/insert.ts src/commands/update.ts src/commands/delete.ts src/commands/export.ts src/commands/q.ts src/commands/schema.ts 2>/dev/null` returns 0 (none of the 6 unwired commands gained these vars).
</verification>

<success_criteria>
- inspect.ts and query.ts catch blocks match PATTERNS.md sections 8 and 11 verbatim.
- ROADMAP success criteria #1 (audit entry's recovery_ref points to envelope) and #2 (envelope's audit_ref points to audit entry id) are now achievable by Plan 08's contract test for these two commands.
- J1 scope is observed: no other command files are modified.
- typed error rendering in query.ts (BlacklistError / PermissionError / ConnectionError) still runs when --recovery is off.
</success_criteria>

<output>
After completion, create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-05-SUMMARY.md` documenting:
- The two patched catch blocks (with diff-style before/after)
- Confirmation that cli.ts outer catches were NOT modified (L3 respected)
- Confirmation that the 6 unwired commands were NOT modified (J1 respected)
- Explicit note that Plan 08's J1 asymmetry guard test will assert this scope lock by failing if any of the 6 unwired commands' envelopes start carrying `audit_ref`
- Forward pointer: Plan 08 contract test will fail-stop on the J1 contract; Plan 06/07 are independent DOCS-02 work
</output>
