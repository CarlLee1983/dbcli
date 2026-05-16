---
phase: 25
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/audit/integration-helper.ts
  - tests/unit/core/audit/integration-helper.test.ts
autonomous: true
requirements: [INTEGRATE-02]
must_haves:
  truths:
    - "writeAuditEntry returns the entry UUID on a successful write"
    - "writeAuditEntry returns null when audit is disabled (CONFIG-02)"
    - "writeAuditEntry returns null when the underlying logger.write reports a skip (lock-budget-exhausted / write-failed)"
    - "AuditOutcome accepts an optional recovery_ref string and forwards it onto the persisted entry"
    - "Existing callers that ignore the return value continue to work (backward compatible at the type level)"
  artifacts:
    - path: "src/core/audit/integration-helper.ts"
      provides: "writeAuditEntry returning Promise<string | null> and AuditOutcome with recovery_ref?: string"
      contains: "recovery_ref"
    - path: "tests/unit/core/audit/integration-helper.test.ts"
      provides: "Unit coverage for the new return type and the recovery_ref pass-through"
      contains: "writeAuditEntry"
  key_links:
    - from: "src/core/audit/integration-helper.ts"
      to: "src/core/audit/logger.ts"
      via: "'success' in result discriminator (L5) propagating result.id from AuditWriteResult"
      pattern: "'success' in result"
---

<objective>
Upgrade `writeAuditEntry` in `src/core/audit/integration-helper.ts` so it (a) accepts an optional `recovery_ref` on the `AuditOutcome` and writes it onto the audit entry, and (b) returns the entry UUID on success or `null` on disabled / failed paths. This is the message channel through which catch blocks (Plan 05) will pass the pre-generated envelope id to the audit writer and capture the audit entry id back to attach to the envelope.

Purpose: Required by Phase 25 D-J / D-K / K1. Wave 1 type-plumbing that unblocks Plan 05 (catch-block wiring in `query.ts` / `inspect.ts`).

Output: writeAuditEntry signature upgraded; AuditOutcome extended; unit tests demonstrate the new return values and the recovery_ref pass-through.
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
@src/core/audit/integration-helper.ts
@src/core/audit/logger.ts
@src/core/audit/types.ts

<interfaces>
Current writeAuditEntry (src/core/audit/integration-helper.ts:65-109):
```ts
export interface AuditOutcome {
  success: boolean
  error?: any
  metadata?: Record<string, unknown>
  sql?: string
  target?: string
}

export async function writeAuditEntry(
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
): Promise<void> {
  try {
    const logger = await getAuditLogger(config, options.config || '.dbcli')
    // ... build entry ...
    await logger.write(entry)
  } catch {
    // D6: Never throw from audit integration.
  }
}
```

AuditLogger.write return shape (src/core/audit/logger.ts:42-47):
```ts
export type AuditWriteResult =
  | { skipped: 'disabled' }
  | { skipped: 'lock-budget-exhausted' }
  | { skipped: 'write-failed'; error: string }
  | { success: true; rotated: boolean; id: string }
```

AuditEntry already has `recovery_ref?: string` on the persisted shape (src/core/audit/types.ts:24, Phase 22 D-17).

Existing callers (must remain compatible - TS allows dropping a return):
- src/core/query-executor.ts:128, 142
- src/commands/report.ts:87, 97
- src/commands/inspect.ts:63, 70
- src/commands/doctor.ts:733
- src/commands/query.ts:167, 277, 341, 419
- src/commands/guide.ts:87, 94
- src/commands/plan.ts:51, 68
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend AuditOutcome with recovery_ref and write it onto the entry</name>
  <read_first>
    - src/core/audit/integration-helper.ts (lines 53-109, AuditOutcome + writeAuditEntry)
    - src/core/audit/types.ts (line 24, recovery_ref already exists on AuditEntry)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 5, exact target shape)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (D-J)
  </read_first>
  <files>src/core/audit/integration-helper.ts</files>
  <behavior>
    - `AuditOutcome.recovery_ref` is optional. When present, the persisted entry MUST have a `recovery_ref` field with the same string value.
    - When `outcome.recovery_ref` is absent, the persisted entry MUST NOT include a `recovery_ref` field at all (consistent with the existing `redacted_sql` / `error` conditional spreads in the same function).
    - The redaction surface for `recovery_ref` is intentionally NONE - the value is an opaque UUID v4 produced by `crypto.randomUUID()` (RESEARCH section 8). Do NOT run `redactSensitive` on it.
  </behavior>
  <action>
Open `src/core/audit/integration-helper.ts`. Modify the `AuditOutcome` interface at lines 53-59:

```ts
export interface AuditOutcome {
  success: boolean
  error?: any
  metadata?: Record<string, unknown>
  sql?: string
  target?: string
  /** Phase 25 D-J: envelope id from the catch block, propagated onto the persisted audit entry as `recovery_ref`. */
  recovery_ref?: string
}
```

In the entry-building block at lines 92-102, add a conditional spread for `recovery_ref` directly before the `metadata` field, matching the existing `redacted_sql` and `error` spread style:

```ts
const entry: Omit<AuditEntry, 'id' | 'ts' | 'session_id'> = {
  engine,
  command: commandName,
  side_effect_tier: tier,
  target,
  success: outcome.success,
  redacted_query: redactArgv(process.argv),
  ...(outcome.sql && { redacted_sql: redactSql(outcome.sql) }),
  ...(errorMessage && { error: errorMessage }),
  ...(outcome.recovery_ref && { recovery_ref: outcome.recovery_ref }),
  metadata: outcome.metadata,
}
```

Do NOT redact `outcome.recovery_ref` - it is an opaque UUID, not user-supplied text.
Do NOT touch the existing redaction calls.
Do NOT change the function signature in this task (return type is changed in Task 2).
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | tee /tmp/typecheck-25-02-t1.log; grep -E "(error TS|Found 0 errors)" /tmp/typecheck-25-02-t1.log | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "recovery_ref\\?: string" src/core/audit/integration-helper.ts` returns a line inside the `AuditOutcome` interface.
    - `grep -nE "outcome\\.recovery_ref" src/core/audit/integration-helper.ts` returns at least one line inside the entry construction.
    - `grep -cE "\\.\\.\\.\\(outcome\\.recovery_ref" src/core/audit/integration-helper.ts` >= 1 (the conditional spread is present).
    - `grep -nE "redactSensitive\\(outcome\\.recovery_ref" src/core/audit/integration-helper.ts` returns NOTHING (recovery_ref is NOT redacted - it is an opaque UUID per RESEARCH section 8).
    - `bun run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    AuditOutcome carries an optional `recovery_ref` field; when present, the persisted entry includes it; when absent, the persisted entry omits the field entirely. Existing redaction calls are untouched.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Change writeAuditEntry return type to Promise<string | null> and propagate logger.write result.id</name>
  <read_first>
    - src/core/audit/integration-helper.ts (full file after Task 1)
    - src/core/audit/logger.ts (lines 42-47, AuditWriteResult discriminated union; lines 130-185, write() returning { success: true, rotated, id })
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 5, AuditWriteResult discriminator L5)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md (L5, use 'success' in result, NOT result.success)
    - All existing callers listed in <interfaces> above (verify they ignore the return)
  </read_first>
  <files>
    src/core/audit/integration-helper.ts,
    tests/unit/core/audit/integration-helper.test.ts
  </files>
  <behavior>
    Test cases (RED first - write tests that fail against the current `Promise<void>` signature):
    - Success path: `writeAuditEntry(config_with_audit_enabled, 'query', {}, { success: true, target: 't' })` resolves to a non-empty string matching the UUID pattern `/^[0-9a-f-]{36}$/`.
    - Disabled path: when `config.audit.enabled === false`, the call resolves to `null`.
    - Caller can ignore the return: `await writeAuditEntry(...)` (no destructure) still typechecks and runs without error - this is the backward-compat assertion for the 17 existing call sites.
    - Optional but recommended: lock-budget-exhausted path (mock logger.write to return `{ skipped: 'lock-budget-exhausted' }`) resolves to `null`.
  </behavior>
  <action>
**Step A - modify `writeAuditEntry` in `src/core/audit/integration-helper.ts`:**

Change the return type and capture `logger.write`'s result. Replace the function body's tail (the `await logger.write(entry)` line and the surrounding try/catch) with the discriminator-based variant from PATTERNS.md section 5 / RESEARCH L5:

```ts
export async function writeAuditEntry(
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
): Promise<string | null> {
  try {
    const logger = await getAuditLogger(config, options.config || '.dbcli')
    const engine = (config.connection?.system as DatabaseSystem) || 'postgresql'

    // 1. Resolve Target
    const target = outcome.target || getOperationTarget(engine, commandName, options, outcome.sql)

    // 2. Resolve Side Effect Tier
    let tier = getEngineCapability(engine, commandName as any).tier
    if (options.dryRun || options.plan) {
      tier = 'dry-run'
    }

    // 3. Redact Error (if any)
    let errorMessage: string | undefined
    if (outcome.error) {
      errorMessage = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
      errorMessage = redactSensitive(errorMessage)
    }

    // 4. Build Entry
    const entry: Omit<AuditEntry, 'id' | 'ts' | 'session_id'> = {
      engine,
      command: commandName,
      side_effect_tier: tier,
      target,
      success: outcome.success,
      redacted_query: redactArgv(process.argv),
      ...(outcome.sql && { redacted_sql: redactSql(outcome.sql) }),
      ...(errorMessage && { error: errorMessage }),
      ...(outcome.recovery_ref && { recovery_ref: outcome.recovery_ref }),
      metadata: outcome.metadata,
    }

    const result = await logger.write(entry)
    // Phase 25 D-K / L5: 'success' in result discriminator - only the success
    // variant of AuditWriteResult exposes the entry id.
    return 'success' in result ? result.id : null
  } catch {
    // D6: Never throw from audit integration. Logger already prints to stderr once on write failure.
    return null
  }
}
```

Key implementation details:
- Use `'success' in result` (NOT `result.success`) per RESEARCH L5 - the skipped variants do not have a `.success` field; using `result.success` is a type error at strict mode.
- The catch block returns `null` (was: implicit `void`).
- All callers that did `await writeAuditEntry(...)` and dropped the return continue to work because TypeScript permits dropping the result of a `Promise<T>`.

**Step B - create or extend `tests/unit/core/audit/integration-helper.test.ts`:**

This file does NOT exist yet (`ls tests/unit/core/audit/` shows lock/logger/reader/rotation/session-id only). Create the file. Use Bun's `bun:test` framework and isolated tmpdir fixtures, matching the pattern in `tests/unit/core/audit/logger.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { DbcliConfig } from '@/utils/validation'

function makeConfig(enabled: boolean): DbcliConfig {
  return {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'u',
      password: 'p',
      database: 'd',
    },
    permission: 'query-only',
    metadata: { createdAt: '2026-05-15T00:00:00.000Z', version: '1.0' },
    audit: { enabled, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
  } as DbcliConfig
}

describe('writeAuditEntry return value (Phase 25 D-K)', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-02-'))
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('returns a UUID string on success when audit is enabled', async () => {
    const config = makeConfig(true)
    const id = await writeAuditEntry(
      config,
      'query',
      { config: join(workDir, '.dbcli') },
      { success: true, target: 'users' }
    )
    expect(id).not.toBeNull()
    expect(typeof id).toBe('string')
    expect(id!).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('returns null when audit is disabled (CONFIG-02)', async () => {
    const config = makeConfig(false)
    const id = await writeAuditEntry(
      config,
      'query',
      { config: join(workDir, '.dbcli') },
      { success: true, target: 'users' }
    )
    expect(id).toBeNull()
  })

  test('persists recovery_ref onto the audit entry when provided (D-J)', async () => {
    const config = makeConfig(true)
    const ref = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    const id = await writeAuditEntry(
      config,
      'query',
      { config: join(workDir, '.dbcli') },
      { success: false, target: 'users', error: new Error('boom'), recovery_ref: ref }
    )
    expect(id).not.toBeNull()
    // Read the JSONL file back and confirm recovery_ref made it onto disk.
    const file = join(workDir, '.dbcli', 'audit', 'default.jsonl')
    const raw = await Bun.file(file).text()
    const last = JSON.parse(raw.trim().split('\n').pop()!) as { recovery_ref?: string }
    expect(last.recovery_ref).toBe(ref)
  })

  test('omits recovery_ref on disk when not supplied', async () => {
    const config = makeConfig(true)
    const id = await writeAuditEntry(
      config,
      'query',
      { config: join(workDir, '.dbcli') },
      { success: true, target: 'users' }
    )
    expect(id).not.toBeNull()
    const file = join(workDir, '.dbcli', 'audit', 'default.jsonl')
    const raw = await Bun.file(file).text()
    const last = JSON.parse(raw.trim().split('\n').pop()!)
    expect('recovery_ref' in last).toBe(false)
  })

  test('return-ignoring callers continue to work (backward compat for 17 existing call sites)', async () => {
    const config = makeConfig(true)
    // No `const id = await ...` - drop the result, matching the pattern at
    // src/commands/inspect.ts:63 and other 16 sites that pre-date Phase 25.
    await writeAuditEntry(
      config,
      'query',
      { config: join(workDir, '.dbcli') },
      { success: true, target: 'users' }
    )
    // If this test reaches its end without throwing, the API is backward compatible.
    expect(true).toBe(true)
  })
})
```

Notes for the executor:
- If `tests/unit/core/audit/logger.test.ts` exposes a helper for building a `DbcliConfig`, prefer importing/reusing it rather than re-defining `makeConfig`.
- `Bun.file().text()` is the project-standard way to read files (AGENTS.md "Prefer Bun.file over node:fs's readFile").
- The logger writes to `.dbcli/audit/<connectionName>.jsonl`; when no V2 named connection is present, `connectionName` defaults to `'default'` per `src/core/audit/integration-helper.ts:28-29`, hence the file path `.dbcli/audit/default.jsonl`.

Run `bun test tests/unit/core/audit/integration-helper.test.ts` and confirm all five new cases pass.
  </action>
  <verify>
    <automated>bun test tests/unit/core/audit/integration-helper.test.ts 2>&1 | tee /tmp/test-25-02-t2.log; grep -E "(pass|fail|error)" /tmp/test-25-02-t2.log | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "Promise<string \\| null>" src/core/audit/integration-helper.ts` returns the `writeAuditEntry` declaration line.
    - `grep -nE "'success' in result" src/core/audit/integration-helper.ts` returns a line inside `writeAuditEntry` (L5 discriminator).
    - `grep -cE "return null" src/core/audit/integration-helper.ts` >= 2 (one in the discriminator branch, one in the catch).
    - `tests/unit/core/audit/integration-helper.test.ts` exists.
    - `bun test tests/unit/core/audit/integration-helper.test.ts` exits 0 with at least 5 passing tests.
    - `bun run typecheck` exits 0 (i.e., the 17 existing call sites still compile despite the return type change).
    - `bun test` (full suite, optional but recommended) does not regress.
  </acceptance_criteria>
  <done>
    writeAuditEntry returns Promise<string | null>. Success returns the entry UUID. Disabled / lock-budget-exhausted / write-failed / thrown-internal all return null. The `recovery_ref` from `AuditOutcome` is persisted onto disk when provided and omitted when not. All five new unit tests pass; no existing callers regress.
  </done>
</task>

</tasks>

<verification>
1. `bun run typecheck` exits 0 (no regression from the return-type change).
2. `bun test tests/unit/core/audit/integration-helper.test.ts` exits 0 with 5 new tests green.
3. `bun test tests/unit/core/audit/logger.test.ts` exits 0 (the logger.write contract is unchanged).
4. `grep -rc "await writeAuditEntry" src/ | grep -v ':0$'` lists the same 17 callers as before this plan (no accidental deletions).
</verification>

<success_criteria>
- AuditOutcome carries `recovery_ref?: string`.
- writeAuditEntry returns Promise<string | null>.
- The 'success' in result discriminator is used (not result.success).
- 5 new unit tests in tests/unit/core/audit/integration-helper.test.ts pass.
- All 17 existing callers continue to compile and run without modification.
- Plan 05 can now do `const auditId = await writeAuditEntry(...)` and pass `auditId` into `emitRecoveryEnvelope(..., { auditRef: auditId ?? undefined })`.
</success_criteria>

<output>
After completion, create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-02-SUMMARY.md` documenting:
- The new return type and how the 'success' in result discriminator selects the id (L5)
- How the recovery_ref pass-through chains onto the on-disk entry
- Confirmation that the 17 existing call sites still compile unchanged
- Forward pointer: Plan 05 catch blocks will now do `const auditId = await writeAuditEntry(...)` and feed auditId into emitRecoveryEnvelope
</output>
