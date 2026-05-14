---
phase: 21-audit-writer-foundation
plan: 05
type: execute
wave: 3
depends_on:
  - "21-04"
files_modified:
  - tests/integration/core/audit-concurrent.test.ts
  - tests/integration/core/audit-readonly.test.ts
autonomous: true
requirements:
  - STORE-03
  - STORE-04
tags:
  - audit
  - integration-test
  - concurrent
  - readonly-dir
  - phase-21
must_haves:
  truths:
    - "When two AuditLogger instances write 100+ entries to the same `<conn>.jsonl` in parallel, EVERY line in the resulting file parses as valid JSON (success criterion 3 / STORE-03)"
    - "The total line count after the concurrent test equals the total number of write() calls that returned success (no entries are silently dropped beyond what skipped-marker results reported)"
    - "When the audit directory is chmod 0o555 (readonly), AuditLogger.write() returns a skip marker (skipped: 'write-failed' or 'lock-budget-exhausted') and emits exactly ONE stderr warning across many writes (success criterion 4 / D-16); no exception escapes write()"
    - "After the readonly fixture is restored to writable, a fresh AuditLogger can resume normal writes (no permanent corruption)"
  artifacts:
    - path: "tests/integration/core/audit-concurrent.test.ts"
      provides: "Two-instance concurrent write integration test proving lock serialization preserves JSONL parseability"
      contains: "AuditLogger"
    - path: "tests/integration/core/audit-readonly.test.ts"
      provides: "Readonly-dir integration test proving D6 fail-soft + once-per-process warning under realistic chmod constraints"
      contains: "chmod"
  key_links:
    - from: "tests/integration/core/audit-concurrent.test.ts"
      to: "src/core/audit/logger.ts (AuditLogger)"
      via: "construct two instances pointing at same auditFilePath; await Promise.all of writes from both"
      pattern: "new AuditLogger"
    - from: "tests/integration/core/audit-readonly.test.ts"
      to: "src/core/audit/logger.ts (AuditLogger)"
      via: "construct one instance; chmod parent dir to 0o555; loop write(); verify skip markers and stderr cadence"
      pattern: "chmod"
---

<objective>
Land the two phase-closing integration tests that prove the Phase-21 writer satisfies the two trickiest ROADMAP success criteria — criterion 3 (two processes writing same JSONL) and criterion 4 (readonly dir + main command unaffected). These tests are the integration-level counterparts of the unit tests in Plans 21-03 and 21-04: they verify that the lock + fail-soft + once-per-process-warning machinery actually composes correctly when exercised end-to-end through the public `AuditLogger.write` API.

Purpose: Close STORE-03 (concurrent serialization) and provide the integration-level evidence for STORE-04 / success criterion 4 (readonly dir). Per 21-PATTERNS.md "Recommendation for Phase 21 plan": "Ship Option 1 (in-process two-instance concurrent test) as the STORE-03 evidence. Option 2 (true multi-process) is more faithful to '兩個 dbcli 進程' wording but Phase 21 has no CLI surface to spawn — the natural moment is Phase 23/24". This plan ships Option 1.

Output: Two new test files under `tests/integration/core/`; no source code changes; no changes to existing tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/21-audit-writer-foundation/21-CONTEXT.md
@.planning/phases/21-audit-writer-foundation/21-PATTERNS.md
@.planning/phases/21-audit-writer-foundation/21-04-logger-rotation-PLAN.md
@AGENTS.md

<interfaces>
<!-- Plan 21-04 outputs that these tests consume. -->

From src/core/audit/logger.ts (post-Plan-21-04):
```typescript
export class AuditLogger {
  constructor(opts: AuditLoggerOptions)
  write(entry: Record<string, unknown>): Promise<AuditWriteResult>
  getHealth(): AuditHealthReport
}
// AuditWriteResult = { skipped: 'disabled' } | { skipped: 'lock-budget-exhausted' }
//                  | { skipped: 'write-failed', error: string } | { success: true, rotated: boolean }
```

From src/core/audit/session-id.ts (post-Plan-21-02):
```typescript
export class SessionIdService {
  constructor(storagePath: string)
  resolve(): Promise<string>
  reset(): void
}
```

Resulting on-disk shape (per-line) after a successful write:
```json
{"src":"a","i":7,"session_id":"87421-1747234567890-a4f2b8"}
```
Each line terminated by `\n`. Phase 21 entry shape is opaque (`Record<string, unknown>`) plus the `session_id` field that AuditLogger injects.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Concurrent two-instance integration test (STORE-03 / success criterion 3)</name>
  <files>tests/integration/core/audit-concurrent.test.ts</files>
  <read_first>
    - src/core/audit/logger.ts (verify post-Plan-21-04 import surface and AuditWriteResult union)
    - src/core/audit/session-id.ts (verify constructor signature)
    - src/core/audit/lock.ts (understand lock-budget-exhausted semantics — some writes under heavy contention may legitimately return that skip marker)
    - tests/integration/recovery.test.ts lines 30-58 (analog: subprocess spawn with sanitized env + mkdtemp fixture; we use the mkdtemp pattern only — Phase 21 has no CLI surface)
    - tests/integration/core/schema-system.integration.test.ts (analog: shape of an existing tests/integration/core/* file)
    - .planning/phases/21-audit-writer-foundation/21-PATTERNS.md section "Concurrent-test analog" (the composed Pattern A + B + C; ship Option 1 from that section)
    - .planning/phases/21-audit-writer-foundation/21-CONTEXT.md §"Phase 21 測試邊界"
  </read_first>
  <action>
    Create `tests/integration/core/audit-concurrent.test.ts` with the following structure. Use `bun:test` directly. Use TWO AuditLogger instances within the SAME process pointing at the same audit file path so they share the lockfile on disk. Each instance constructs its own `AuditLockManager` because Plan 21-04's default constructor path creates a fresh manager — the two managers correctly contend on the same lockfile.

    Required test cases:

    **Test 1 — "STORE-03: two AuditLogger instances writing 50 entries each in parallel produce only valid JSONL lines"**
    1. Create a tmpdir via `mkdtemp(join(tmpdir(), 'dbcli-audit-conc-'))`.
    2. Set `process.env.DBCLI_SESSION_ID = 'concurrent-test-session'` BEFORE constructing services (env path skips file persistence and keeps test deterministic).
    3. Construct one shared `SessionIdService(tmpdir)`.
    4. Construct two AuditLogger instances:
       - `loggerA = new AuditLogger({ storagePath: tmpdir, connectionName: 'default', enabled: true, rotation: { maxBytes: 10_000_000, maxEntries: 10_000 }, sessionIdService })`
       - `loggerB = new AuditLogger({ ...same opts... })`
       Rotation thresholds are intentionally well above 100 entries so rotation is NOT exercised — this test isolates concurrency from rotation.
    5. Generate 50 entries each: `const entriesA = Array.from({ length: 50 }, (_, i) => ({ src: 'a', i }))` and similarly `entriesB` with `src: 'b'`.
    6. Race them: `const results = await Promise.all([ ...entriesA.map(e => loggerA.write(e)), ...entriesB.map(e => loggerB.write(e)) ])`.
    7. Count successes: `const successCount = results.filter(r => 'success' in r && r.success === true).length`.
    8. Read the file: `const content = await readFile(join(tmpdir, '.dbcli', 'audit', 'default.jsonl'), 'utf8')`.
    9. Split and parse: `const lines = content.split('\n').filter(Boolean); const parsed = lines.map(l => JSON.parse(l))`.
    10. Assertions:
        - `expect(lines.length).toBe(successCount)` — exact match: every successful write produced exactly one line, and no line came from a non-success
        - `expect(parsed.length).toBe(successCount)` — JSON.parse on every line did not throw (this is the critical STORE-03 success-criterion-3 assertion)
        - For each line, `expect(typeof parsed[k].session_id).toBe('string')` and `expect(parsed[k].session_id).toBe('concurrent-test-session')`
        - For each line, `expect(parsed[k].src === 'a' || parsed[k].src === 'b').toBe(true)` (no corrupted records)
        - `expect(successCount).toBeGreaterThanOrEqual(95)` — under the 200ms lock budget with backoff (5ms..50ms), the vast majority of 100 contended writes should succeed in well under the budget; allow a small skip tolerance for CI jitter. If this assertion fails persistently in CI, the lock retry budget (Plan 21-03 `LOCK_RETRY_BUDGET_MS`) is too tight for the contention level and the failure is a legitimate Phase-21 signal.

    **Test 2 — "STORE-03: different connections do not contend (D-06)"**
    1. Same tmpdir setup.
    2. Construct `loggerA` with `connectionName: 'conn-a'` and `loggerB` with `connectionName: 'conn-b'`.
    3. Run 50 parallel writes from each.
    4. Read both files and assert each has 50 valid JSON lines, no cross-contamination (`src: 'a'` lines only in `conn-a.jsonl`, `src: 'b'` lines only in `conn-b.jsonl`).
    5. Assert ALL writes returned success (no skip markers) since separate lockfiles mean zero contention.

    Use:
    - `import { test, expect, beforeEach, afterEach, describe } from 'bun:test'`
    - `import { mkdtemp, readFile } from 'node:fs/promises'`
    - `import { tmpdir } from 'node:os'`
    - `import { join } from 'node:path'`
    - `import { AuditLogger } from '../../../src/core/audit/logger'`
    - `import { SessionIdService } from '../../../src/core/audit/session-id'`
    - Save and restore `process.env.DBCLI_SESSION_ID` in `beforeEach` / `afterEach`

    Do NOT spawn child processes — Option 1 from PATTERNS.md is the explicit choice for Phase 21 (no CLI surface yet).
  </action>
  <verify>
    <automated>bun test tests/integration/core/audit-concurrent.test.ts 2>&1</automated>
  </verify>
  <acceptance_criteria>
    - `test -f tests/integration/core/audit-concurrent.test.ts` succeeds
    - `grep -E "import \\{ AuditLogger \\}" tests/integration/core/audit-concurrent.test.ts` returns at least one match
    - `grep -E "Promise\\.all" tests/integration/core/audit-concurrent.test.ts` returns at least one match
    - `grep -E "JSON\\.parse" tests/integration/core/audit-concurrent.test.ts` returns at least one match
    - `grep -E "connectionName:\s*['\"]conn-a['\"]" tests/integration/core/audit-concurrent.test.ts` returns exactly one match (Test 2)
    - `grep -E "connectionName:\s*['\"]conn-b['\"]" tests/integration/core/audit-concurrent.test.ts` returns exactly one match (Test 2)
    - `bun test tests/integration/core/audit-concurrent.test.ts` exits 0 with at least 2 passing tests
    - `bun run typecheck` exits 0
  </acceptance_criteria>
  <done>
    audit-concurrent.test.ts proves: (a) two instances writing the same .jsonl produce only valid JSON lines (STORE-03 criterion 3), (b) two instances writing different .jsonl files don't contend (D-06). Both tests pass; typecheck clean.
  </done>
</task>

<task type="auto">
  <name>Task 2: Readonly-dir integration test (STORE-04 / success criterion 4 / D-16)</name>
  <files>tests/integration/core/audit-readonly.test.ts</files>
  <read_first>
    - src/core/audit/logger.ts (verify post-Plan-21-04 import surface; understand the once-per-process warning state)
    - tests/integration/recovery.test.ts lines 30-58 (analog: subprocess spawn pattern — referenced below)
    - .planning/phases/21-audit-writer-foundation/21-CONTEXT.md decisions D-16 (warn-once) and §"Phase 21 測試邊界" ("讀寫權限受限路徑（success criterion 4）建議用 fixture + `chmod` 在臨時目錄驗證；不要求所有引擎都跑")
  </read_first>
  <action>
    Create `tests/integration/core/audit-readonly.test.ts`. The challenge with D-16 (once-per-process warning) is that the `warnedOnceThisProcess` flag is per AuditLogger instance, NOT truly per process. To verify the integration-level guarantee that the main command's exit behavior is unaffected AND that warnings don't flood stderr, this test exercises a single `AuditLogger` instance against a readonly directory.

    Required test cases:

    **Test 1 — "STORE-04 / criterion 4: write() on readonly audit dir returns skip marker, does NOT throw, emits ONE stderr warning over many failures"**
    1. Create tmpdir via `mkdtemp`.
    2. Set `process.env.DBCLI_SESSION_ID = 'readonly-test-session'` to keep test deterministic and skip the session-id-file write path.
    3. Pre-create `<tmpdir>/.dbcli/audit/` via `mkdir(..., { recursive: true })`. Then `chmod(<tmpdir>/.dbcli/audit/, 0o555)`.
    4. Spy on `process.stderr.write` using `spyOn(process.stderr, 'write')` from `bun:test`.
    5. Construct ONE AuditLogger instance pointing at this tmpdir with `enabled: true`, `connectionName: 'default'`.
    6. Call `await logger.write({ i: 1 })` and assert: the returned value matches `expect.objectContaining({ skipped: expect.any(String) })` AND does NOT throw. The skip marker may be `'write-failed'` (likely on first call when the lockfile parent dir is readonly so the `mkdir -p` inside `AuditLockManager.tryAcquireLock` fails) or `'lock-budget-exhausted'` — both indicate fail-soft behavior. Document the expected marker in a comment.
    7. Call write() 5 more times in a loop (each with `{ i: n }`).
    8. After all 6 calls, inspect stderr spy: filter spy calls whose first arg is a string containing `'[dbcli audit]'`. Assert exactly ONE such call regardless of how many writes failed (D-16 once-per-process cadence)
    9. Inspect `logger.getHealth()`: assert `health.lastError !== null`, `typeof health.lastError.ts === 'string'`, `typeof health.lastError.message === 'string'`, `health.lastWrite.success === false`
    10. Restore stderr spy + chmod 0o755 in afterEach for cleanup.

    **Test 2 — "STORE-04 / criterion 4: write failure does not affect the awaiting caller's downstream code"**
    1. Same readonly fixture as Test 1.
    2. Construct AuditLogger.
    3. Define a simulated "main command" function:
       ```typescript
       async function simulatedMainCommand(logger: AuditLogger) {
         const result = { rows: 3, command: 'query' }
         // audit write happens here — must NOT throw or alter result
         await logger.write({ command: 'query', success: true, rowsAffected: 3 })
         return { result, exitCode: 0 }
       }
       ```
    4. Call `const out = await simulatedMainCommand(logger)`.
    5. Assert: `expect(out.result).toEqual({ rows: 3, command: 'query' })`, `expect(out.exitCode).toBe(0)`. This proves criterion 4: "stderr warning but main command returns its original result + exit code."

    **Test 3 — "after restoring writable permissions in a fresh logger, writes resume normally"**
    1. Set up readonly fixture; create logger1; do one failing write.
    2. `chmod(<tmpdir>/.dbcli/audit/, 0o755)`.
    3. Construct a NEW logger (logger2) with the same opts (separate `warnedOnceThisProcess` flag is acceptable — the test isolates "no permanent corruption" semantics).
    4. Call `await logger2.write({ recovered: true })`.
    5. Read the file `<tmpdir>/.dbcli/audit/default.jsonl`. Assert it exists and the single line parses to `{ recovered: true, session_id: 'readonly-test-session' }`.

    Use:
    - `import { test, expect, beforeEach, afterEach, describe, spyOn } from 'bun:test'`
    - `import { mkdtemp, mkdir, chmod, readFile } from 'node:fs/promises'`
    - `import { tmpdir } from 'node:os'`
    - `import { join } from 'node:path'`
    - `import { AuditLogger } from '../../../src/core/audit/logger'`
    - `import { SessionIdService } from '../../../src/core/audit/session-id'`

    Note on subprocess fidelity: ROADMAP success criterion 4 says "手動將 audit 目錄改為唯讀後執行 db command". Phase 21 has no engine wiring, so the test simulates the engine call with `simulatedMainCommand`. The real cross-process exit-code test belongs to Phase 23 (engine integration). 21-CONTEXT.md "Phase 21 測試邊界" explicitly endorses this: "讀寫權限受限路徑（success criterion 4）建議用 fixture + chmod 在臨時目錄驗證；不要求所有引擎都跑".
  </action>
  <verify>
    <automated>bun test tests/integration/core/audit-readonly.test.ts 2>&1</automated>
  </verify>
  <acceptance_criteria>
    - `test -f tests/integration/core/audit-readonly.test.ts` succeeds
    - `grep -E "import \\{ AuditLogger \\}" tests/integration/core/audit-readonly.test.ts` returns at least one match
    - `grep -cE "chmod" tests/integration/core/audit-readonly.test.ts` returns at least 2 (set readonly + restore)
    - `grep -E "0o555" tests/integration/core/audit-readonly.test.ts` returns at least one match
    - `grep -E "0o755" tests/integration/core/audit-readonly.test.ts` returns at least one match
    - `grep -E "spyOn\\(process\\.stderr" tests/integration/core/audit-readonly.test.ts` returns at least one match
    - `grep -E "\\[dbcli audit\\]" tests/integration/core/audit-readonly.test.ts` returns at least one match
    - `grep -E "simulatedMainCommand|exitCode" tests/integration/core/audit-readonly.test.ts` returns at least one match (Test 2)
    - `bun test tests/integration/core/audit-readonly.test.ts` exits 0 with at least 3 passing tests
    - `bun run typecheck` exits 0
  </acceptance_criteria>
  <done>
    audit-readonly.test.ts proves: (Test 1) readonly dir + 6 writes -> all return skip markers, no throw, exactly ONE stderr warning, lastError populated; (Test 2) simulated main command preserves its result + exit code despite audit failure; (Test 3) chmod-back-to-writable allows a fresh logger to write normally. All three tests pass; typecheck clean.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| tmpdir filesystem -> integration test fixtures | Fixtures own their tmpdir; chmod manipulations are bounded to the per-test tmpdir; no global filesystem state mutated |
| `process.stderr.write` spy -> bun:test internals | spyOn returns a restore function via `afterEach` cleanup; if a test crashes before restore, subsequent tests run with a still-mocked stderr (minor) |
| `process.env.DBCLI_SESSION_ID` -> test isolation | Tests set + restore env in beforeEach/afterEach to avoid leakage between tests |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-21-23 | Tampering | Test leaves audit dir at 0o555 if afterEach doesn't run (e.g. SIGKILL during test) | accept | tmpdir is unique per test; OS will eventually clean up via tmpfs reclaim. Bun test runner runs afterEach even on test failure. Worst case: leftover chmod 0o555 dir in /tmp gets reaped by OS. |
| T-21-24 | Race condition | Test 1 of concurrent test exercises real lockfile contention; CI jitter could push lock-budget skip rate above tolerance | mitigate | Tolerance set at `successCount >= 95` of 100 writes (5% skip allowance); rotation thresholds set high so rotation does not interact with the concurrency test; if CI persistently flakes, this is a legitimate Phase-21 signal that LOCK_RETRY_BUDGET_MS is too tight — surface to Phase 22+ rather than relax the test. |
| T-21-25 | Information Disclosure | Test asserts on full stderr content including filesystem paths | accept | Test output only goes to CI logs; same trust level as developers running the test locally. |
</threat_model>

<verification>
- `bun test tests/integration/core/audit-concurrent.test.ts tests/integration/core/audit-readonly.test.ts` all green
- `bun run typecheck` clean
- `bun run lint` clean
- All acceptance-criteria greps match
- Full phase verification: `bun test tests/unit/core/audit tests/integration/core/audit-concurrent.test.ts tests/integration/core/audit-readonly.test.ts tests/unit/core/config.test.ts tests/unit/core/config-v2.test.ts` all green
</verification>

<success_criteria>
- Roadmap success criterion 3 satisfied at integration level: two concurrent writers produce only valid JSONL lines (audit-concurrent.test.ts Test 1)
- Roadmap success criterion 4 satisfied at integration level: readonly dir -> skip marker + ONE stderr warning + main command unaffected (audit-readonly.test.ts Tests 1 + 2)
- D-06 satisfied at integration level: per-connection lockfile isolation (audit-concurrent.test.ts Test 2)
- D-16 satisfied at integration level: once-per-process warning cadence verified across multiple failures (audit-readonly.test.ts Test 1)
- STORE-03 closed
- STORE-04 closed at integration level (unit-level evidence already exists in Plan 21-04)
</success_criteria>

<output>
After completion, create `.planning/phases/21-audit-writer-foundation/21-05-SUMMARY.md` documenting:
- Test files added (paths + sizes + test case counts)
- Decision to ship Option 1 (in-process two-instance) instead of Option 2 (multi-process child spawn) per 21-PATTERNS.md recommendation
- Document the `successCount >= 95` tolerance and rationale (CI jitter; rotation isolation by setting thresholds high)
- Confirmation that no engine adapters, CLI commander tree, capability registry, or sensitive-output helper were touched (out of Phase 21 scope)
- Cross-reference to the Phase-23 follow-up: true multi-process spawn-based STORE-03 test gets re-evaluated once `dbcli audit` CLI lands
</output>
