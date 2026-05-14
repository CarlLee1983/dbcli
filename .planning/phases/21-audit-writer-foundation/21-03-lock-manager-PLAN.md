---
phase: 21-audit-writer-foundation
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/audit/lock.ts
  - tests/unit/core/audit/lock.test.ts
autonomous: true
requirements:
  - STORE-03
tags:
  - audit
  - file-lock
  - phase-21
must_haves:
  truths:
    - "AuditLockManager.acquireLock returns true on first try when no lock file exists, and the lockfile contains pid + timestamp + hostname JSON"
    - "AuditLockManager.releaseLock removes the lockfile and is idempotent (calling release when not held returns false without throwing)"
    - "When the lock is contended and the budget (~200ms) is exhausted, acquireLock RETURNS false (does NOT throw) so callers can fail-soft per D-07"
    - "Stale lockfile (timestamp older than stale threshold) is taken over: new acquireLock succeeds and overwrites the file"
    - "Each AuditLogger instance gets its own lockfile path (`<storagePath>/.dbcli/audit/<connection>.jsonl.lock`) so different connections never contend (D-06)"
    - "withLock wrapper releases lock in a finally block so an exception inside the operation does not leak the lock"
  artifacts:
    - path: "src/core/audit/lock.ts"
      provides: "AuditLockManager class with acquireLock(), releaseLock(), withLock(), isLockHeld(); exported constants LOCK_RETRY_BUDGET_MS = 200, LOCK_BACKOFF_START_MS = 5, LOCK_BACKOFF_MAX_MS = 50, STALE_LOCK_MULTIPLIER = 10"
      contains: "export class AuditLockManager"
      min_lines: 80
    - path: "tests/unit/core/audit/lock.test.ts"
      provides: "Unit tests for acquire/release roundtrip, contention -> fail-soft after budget, stale-lock takeover, withLock release on exception, per-connection lockfile isolation"
      contains: "AuditLockManager"
  key_links:
    - from: "src/core/audit/lock.ts (AuditLockManager.acquireLock)"
      to: "lockfile path <auditFilePath>.lock"
      via: "exp backoff loop with 200ms total budget; returns false (does not throw) on exhaustion"
      pattern: "LOCK_RETRY_BUDGET_MS"
    - from: "src/core/audit/lock.ts (AuditLockManager.tryAcquireLock)"
      to: "lockfile JSON { pid, operation, timestamp, hostname }"
      via: "atomic tmp + mv lockfile write (analog: concurrent-lock.ts:119-134)"
      pattern: "Bun\\.spawn\\(\\['mv'"
---

<objective>
Build `AuditLockManager` (`src/core/audit/lock.ts`) — a per-audit-file lock primitive tuned for the high-frequency audit write profile (short retry budget, fail-soft on exhaustion). The manager copies the mechanism of `ConcurrentLockManager` (lockfile + exp backoff + stale takeover) but explicitly diverges in three places per D-05/D-07: (1) total budget ~200ms not 30 s, (2) backoff 5ms->50ms not 10ms->500ms, (3) budget exhaustion RETURNS false (does NOT throw).

Purpose: Satisfy the lock-primitive half of STORE-03 (the concurrent multi-process correctness test lands in Plan 21-05). Provide a tested, drop-in dependency for Plan 21-04's `AuditLogger.write` so the logger can wrap its append + rotation logic in `withLock(...)` without re-implementing retry mechanics.

Output: One new source file at `src/core/audit/lock.ts`; one new test file at `tests/unit/core/audit/lock.test.ts`; no changes to existing files.
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
@AGENTS.md

<interfaces>
<!-- Existing analog: src/core/concurrent-lock.ts (ConcurrentLockManager). -->
<!-- AuditLockManager copies mechanism + diverges on tunings per D-05/D-07. -->

From src/core/concurrent-lock.ts lines 37-61 (exp backoff acquire loop — adapt):
```typescript
async acquireLock(operationName: string = 'schema-update'): Promise<boolean> {
  const startTime = Date.now()
  let backoffMs = 10
  while (true) {
    const elapsed = Date.now() - startTime
    if (elapsed > this.lockTimeoutMs) {
      throw new Error(...)            // <-- AUDIT VARIANT MUST RETURN false (D-07)
    }
    if (await this.tryAcquireLock(operationName)) {
      this.lockAcquiredAt = Date.now()
      return true
    }
    const waitTime = Math.min(backoffMs, 500)
    await new Promise((resolve) => setTimeout(resolve, waitTime))
    backoffMs = Math.min(backoffMs * 1.5, 500)
  }
}
```

From src/core/concurrent-lock.ts lines 100-138 (tryAcquireLock internals — replicate verbatim, change constructor to take a full lockfile path not a dir+filename):
```typescript
private async tryAcquireLock(operationName: string): Promise<boolean> {
  try {
    const lockFile = Bun.file(this.lockPath)
    if (await lockFile.exists()) {
      const lockContent = await lockFile.json()
      const lockAge = Date.now() - lockContent.timestamp
      const staleLockThresholdMs = this.lockTimeoutMs * 3   // <-- AUDIT: use STALE_LOCK_MULTIPLIER
      if (lockAge > staleLockThresholdMs) {
        await Bun.spawn(['rm', '-f', this.lockPath]).exited
      } else {
        return false
      }
    }
    const lockData = {
      pid: process.pid,
      operation: operationName,
      timestamp: Date.now(),
      hostname: require('os').hostname(),
    }
    const tempPath = `${this.lockPath}.${Date.now()}.tmp`
    const tempFile = Bun.file(tempPath)
    await Bun.write(tempFile, JSON.stringify(lockData))
    const moveResult = await Bun.spawn(['mv', tempPath, this.lockPath]).exited
    return moveResult === 0
  } catch {
    return false
  }
}
```

Public contract this plan will export:
```typescript
export const LOCK_RETRY_BUDGET_MS = 200       // D-07
export const LOCK_BACKOFF_START_MS = 5        // CONTEXT planner discretion
export const LOCK_BACKOFF_MAX_MS = 50         // CONTEXT planner discretion
export const STALE_LOCK_MULTIPLIER = 10       // ~2 s threshold (200ms * 10)

export interface LockfileContent {
  pid: number
  operation: string
  timestamp: number   // unix ts ms, used for staleness
  hostname: string
}

export class AuditLockManager {
  // Constructor takes the AUDIT FILE PATH (e.g. `.dbcli/audit/default.jsonl`);
  // the lockfile is internally derived as `${auditFilePath}.lock`.
  constructor(auditFilePath: string)
  acquireLock(operationName?: string): Promise<boolean>    // returns false on budget exhaustion (D-07)
  releaseLock(): Promise<boolean>                          // fail-soft; never throws (audit context)
  isLockHeld(): boolean
  withLock<T>(operation: () => Promise<T>, operationName?: string): Promise<T | { skipped: 'lock-budget-exhausted' }>
  getLockfilePath(): string                                // for tests / introspection
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement AuditLockManager with 200ms budget, fail-soft on exhaustion, stale takeover</name>
  <files>src/core/audit/lock.ts, tests/unit/core/audit/lock.test.ts</files>
  <read_first>
    - src/core/concurrent-lock.ts (full file — copy mechanism, change tunings; the diff vs analog is mechanically small but semantically meaningful per D-05/D-07)
    - tests/unit/core/concurrent-lock.test.ts (read entire file — mirror style: tmpdir setup, acquire/release roundtrip, timeout case; use it as the test scaffold)
    - .planning/phases/21-audit-writer-foundation/21-PATTERNS.md section "NEW: src/core/audit/lock.ts — `AuditLockManager`" (analog excerpts + change list)
    - .planning/phases/21-audit-writer-foundation/21-CONTEXT.md decisions D-05, D-06, D-07
    - AGENTS.md (Bun.spawn for `mv`/`rm` matches analog; Bun.file for lockfile reads matches analog — do NOT switch to node:fs here)
  </read_first>
  <behavior>
    - Test 1 (acquire/release roundtrip): construct manager pointing at `<tmpdir>/.dbcli/audit/default.jsonl`; call `acquireLock('audit-write')` — assert returns true and lockfile exists at `<tmpdir>/.dbcli/audit/default.jsonl.lock`; assert lockfile JSON has `pid === process.pid`, `operation === 'audit-write'`, `typeof timestamp === 'number'`, `typeof hostname === 'string'`; call `releaseLock()` — assert returns true and lockfile no longer exists
    - Test 2 (release when not held is idempotent): call `releaseLock()` on a fresh manager without acquiring; assert returns false and does NOT throw
    - Test 3 (contention -> fail-soft after ~200ms budget, D-07): pre-create lockfile manually with fresh timestamp (`Date.now()`) and pid that is NOT the current process's pid. Call `acquireLock()` and measure elapsed time. Assert: returns `false` (not true, not throw), and elapsed time is ≥ 200ms but < 600ms (allow generous upper bound for CI jitter)
    - Test 4 (stale-lock takeover): pre-create lockfile manually with `timestamp = Date.now() - 5000` (5 s old — beyond `LOCK_RETRY_BUDGET_MS * STALE_LOCK_MULTIPLIER = 2000ms`) and an arbitrary pid. Call `acquireLock()`. Assert returns true, and the lockfile now contains `pid === process.pid`
    - Test 5 (withLock releases on operation throw): call `withLock(async () => { throw new Error('boom') }, 'audit-write')`. Assert it re-throws 'boom' AND the lockfile is removed (call `isLockHeld()` -> false; check lockfile path does not exist)
    - Test 6 (withLock returns skipped marker on budget exhaustion): pre-create lockfile fresh + different pid. Call `withLock(async () => 'should-not-run', 'audit-write')`. Assert result is `{ skipped: 'lock-budget-exhausted' }` and the operation function was NOT invoked (use a counter / spy)
    - Test 7 (per-connection lockfile isolation, D-06): construct two managers pointing at `<tmpdir>/.dbcli/audit/conn-a.jsonl` and `<tmpdir>/.dbcli/audit/conn-b.jsonl` respectively. Acquire both in parallel. Assert both succeed (different lockfile paths -> no contention)
    - Test 8 (release fail-soft): hold a lock; manually delete the lockfile externally; call `releaseLock()`. Assert returns true (or false — either is acceptable) but does NOT throw. Required because production analog throws on release failure, but audit must NEVER throw (D-06 / STORE-04).
  </behavior>
  <action>
    Create `src/core/audit/lock.ts` with the following exact structure:

    ```typescript
    /**
     * AuditLockManager — short-budget file lock for audit writes.
     *
     * Decisions:
     * - D-05: NOT a reuse of ConcurrentLockManager; tunings differ.
     * - D-06: one lock per audit file (`<auditFilePath>.lock`).
     * - D-07: total retry budget ~200ms; on exhaustion RETURN false (do NOT throw).
     *
     * Mechanism (lockfile + exp backoff + stale takeover) is copied from
     * src/core/concurrent-lock.ts; tunings come from this module's constants.
     */
    import { dirname } from 'node:path'
    import { hostname } from 'node:os'

    export const LOCK_RETRY_BUDGET_MS = 200
    export const LOCK_BACKOFF_START_MS = 5
    export const LOCK_BACKOFF_MAX_MS = 50
    export const STALE_LOCK_MULTIPLIER = 10   // 2000ms stale threshold (200ms * 10)

    export interface LockfileContent {
      pid: number
      operation: string
      timestamp: number
      hostname: string
    }

    export type WithLockResult<T> = T | { skipped: 'lock-budget-exhausted' }

    export class AuditLockManager {
      private readonly lockPath: string
      private lockAcquiredAt: number | null = null

      constructor(private readonly auditFilePath: string) {
        this.lockPath = `${auditFilePath}.lock`
      }

      getLockfilePath(): string {
        return this.lockPath
      }

      isLockHeld(): boolean {
        return this.lockAcquiredAt !== null
      }

      async acquireLock(operationName: string = 'audit-write'): Promise<boolean> {
        const startTime = Date.now()
        let backoffMs = LOCK_BACKOFF_START_MS

        while (true) {
          const elapsed = Date.now() - startTime
          if (elapsed > LOCK_RETRY_BUDGET_MS) {
            // D-07: fail-soft — do NOT throw.
            return false
          }
          if (await this.tryAcquireLock(operationName)) {
            this.lockAcquiredAt = Date.now()
            return true
          }
          const waitTime = Math.min(backoffMs, LOCK_BACKOFF_MAX_MS)
          await new Promise((resolve) => setTimeout(resolve, waitTime))
          backoffMs = Math.min(backoffMs * 1.5, LOCK_BACKOFF_MAX_MS)
        }
      }

      async releaseLock(): Promise<boolean> {
        if (!this.lockAcquiredAt) return false
        try {
          const lockFile = Bun.file(this.lockPath)
          if (await lockFile.exists()) {
            await Bun.spawn(['rm', '-f', this.lockPath]).exited
          }
          this.lockAcquiredAt = null
          return true
        } catch {
          // Audit context: never throw on release. Clear internal state anyway.
          this.lockAcquiredAt = null
          return false
        }
      }

      async withLock<T>(
        operation: () => Promise<T>,
        operationName: string = 'audit-write'
      ): Promise<WithLockResult<T>> {
        const acquired = await this.acquireLock(operationName)
        if (!acquired) {
          return { skipped: 'lock-budget-exhausted' }
        }
        try {
          return await operation()
        } finally {
          await this.releaseLock()
        }
      }

      private async tryAcquireLock(operationName: string): Promise<boolean> {
        try {
          // Ensure parent dir exists (audit dir may not have been created yet).
          await Bun.spawn(['mkdir', '-p', dirname(this.lockPath)]).exited

          const lockFile = Bun.file(this.lockPath)
          if (await lockFile.exists()) {
            const lockContent = (await lockFile.json()) as LockfileContent
            const lockAge = Date.now() - lockContent.timestamp
            const staleLockThresholdMs = LOCK_RETRY_BUDGET_MS * STALE_LOCK_MULTIPLIER
            if (lockAge > staleLockThresholdMs) {
              await Bun.spawn(['rm', '-f', this.lockPath]).exited
            } else {
              return false
            }
          }

          const lockData: LockfileContent = {
            pid: process.pid,
            operation: operationName,
            timestamp: Date.now(),
            hostname: hostname(),
          }
          const tempPath = `${this.lockPath}.${process.pid}.${Date.now()}.tmp`
          await Bun.write(tempPath, JSON.stringify(lockData))
          const moveResult = await Bun.spawn(['mv', tempPath, this.lockPath]).exited
          return moveResult === 0
        } catch {
          return false
        }
      }
    }
    ```

    Create `tests/unit/core/audit/lock.test.ts` with eight test cases corresponding exactly to behavior Tests 1–8. Use:
    - `import { test, expect, beforeEach, afterEach, describe } from 'bun:test'`
    - `mkdtemp` + `tmpdir()` for per-test isolation
    - `node:fs/promises` (`writeFile`, `mkdir`, `unlink`, `stat`) for fixture setup / inspection
    - For Test 3 timing: use `performance.now()` for tighter measurement; allow window 180ms..600ms (CI jitter)
    - For Test 7 parallel: `await Promise.all([m1.acquireLock(), m2.acquireLock()])` followed by `await m1.releaseLock(); await m2.releaseLock()`

    Replace `require('os').hostname()` from the analog with the ESM-friendly `import { hostname } from 'node:os'` + `hostname()` call shown above (the analog file uses CommonJS-style require but new files should use ESM).
  </action>
  <verify>
    <automated>bun test tests/unit/core/audit/lock.test.ts 2>&1</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/core/audit/lock.ts` succeeds
    - `grep -E "^export class AuditLockManager" src/core/audit/lock.ts` returns exactly one match
    - `grep -E "^export const LOCK_RETRY_BUDGET_MS = 200" src/core/audit/lock.ts` returns exactly one match
    - `grep -E "^export const LOCK_BACKOFF_START_MS = 5" src/core/audit/lock.ts` returns exactly one match
    - `grep -E "^export const LOCK_BACKOFF_MAX_MS = 50" src/core/audit/lock.ts` returns exactly one match
    - `grep -E "^export const STALE_LOCK_MULTIPLIER = 10" src/core/audit/lock.ts` returns exactly one match
    - `grep -cE "^[^/]*return false" src/core/audit/lock.ts` returns at least 3 (acquire budget exhausted, tryAcquire when held, tryAcquire catch)
    - `grep -cE "throw new Error" src/core/audit/lock.ts` returns 0 (audit context never throws)
    - `grep -E "skipped:\s*['\"]lock-budget-exhausted['\"]" src/core/audit/lock.ts` returns exactly one match
    - `test -f tests/unit/core/audit/lock.test.ts` succeeds
    - `bun test tests/unit/core/audit/lock.test.ts` exits 0 with at least 8 passing tests
    - `bun run typecheck` exits 0
    - `grep -cE "^\s*require\\(" src/core/audit/lock.ts` returns 0 (ESM only)
  </acceptance_criteria>
  <done>
    AuditLockManager implemented per the exact code above with 200ms retry budget, fail-soft acquire, fail-soft release, withLock returns skipped marker on exhaustion; all eight test cases pass; typecheck clean; no `throw new Error` statements; ESM imports only.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Lockfile JSON on disk -> AuditLockManager.tryAcquireLock | Untrusted JSON (could be malformed, missing fields, oversized); parse-failure path returns false (acquire skips) |
| Lockfile path -> filesystem | Lock path is constructed from auditFilePath; auditFilePath is derived from resolvedStoragePath + connection name (Plan 21-04 supplies it). Plan 21-04 must enforce connection name validation; Plan 21-03 trusts its input. |
| `process.pid` -> lockfile content | Pid is informational only; no security decision is made on it (no `kill(pid, 0)` per D-13 pragmatic restraint) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-21-11 | Tampering | Attacker writes malformed lockfile to block writes indefinitely | mitigate | `lockFile.json()` failure falls into the outer catch -> returns false; the stale-lock takeover path (Test 4) handles lockfiles older than 2 s by removing them |
| T-21-12 | DoS | Attacker holds lock indefinitely with fresh timestamps | accept | Per D-07: audit is fail-soft. Holding the lock blocks the attacker's own audit writes too; main DB command is unaffected (D-06 / STORE-04). Stale threshold (2 s) bounds worst case. |
| T-21-13 | Race condition | Two processes both pass `lockFile.exists()` check then both write to `.tmp` then both `mv` | mitigate | Each .tmp path is suffixed with `${process.pid}.${Date.now()}` so the two .tmp files are distinct; the final `mv` to the same destination is atomic on POSIX (last `mv` wins). One acquireLock returns true (its lockfile is the surviving one); the loser's next iteration sees the lockfile and waits/backs off. STORE-03 multi-process integration test (Plan 21-05) is the integration-level proof. |
| T-21-14 | Symlink attack | Attacker pre-creates `<auditFile>.lock` as symlink to sensitive path | mitigate | `Bun.spawn(['rm', '-f', this.lockPath])` removes the symlink, not the target. `Bun.spawn(['mv', tmp, lockPath])` replaces the symlink with the regular file. No privileged path is read or written via the symlink. |
| T-21-15 | Repudiation | Crashed process leaves stale lockfile | mitigate | `STALE_LOCK_MULTIPLIER = 10` means lockfiles older than 2 s are taken over (Test 4) |
</threat_model>

<verification>
- `bun test tests/unit/core/audit/lock.test.ts` all green
- `bun run typecheck` clean
- `bun run lint` clean
- All acceptance-criteria greps match
</verification>

<success_criteria>
- STORE-03 satisfied at the primitive level: lockfile prevents two concurrent acquires of the same lockfile path (Plan 21-05 proves this at multi-instance integration level)
- D-05 satisfied: lock primitive is a separate class from ConcurrentLockManager
- D-06 satisfied: one lockfile per audit file (Test 7 verifies different connections don't contend)
- D-07 satisfied: 200ms budget enforced; exhaustion returns false (Test 3 + Test 6)
</success_criteria>

<output>
After completion, create `.planning/phases/21-audit-writer-foundation/21-03-SUMMARY.md` documenting:
- Public API surface (AuditLockManager + exported constants + WithLockResult type)
- Tunings actually used (vs ConcurrentLockManager analog values)
- Test case names + count
- Any deviations from the analog (expected: budget value, backoff values, fail-soft return on exhaust, fail-soft release, ESM import of hostname)
</output>
