---
phase: 21-audit-writer-foundation
plan: 03
subsystem: audit
tags: [audit, file-lock, phase-21, store-03]
requires: []
provides:
  - AuditLockManager (src/core/audit/lock.ts)
  - LOCK_RETRY_BUDGET_MS / LOCK_BACKOFF_START_MS / LOCK_BACKOFF_MAX_MS / STALE_LOCK_MULTIPLIER constants
  - LockfileContent interface
  - WithLockResult<T> type
affects:
  - Plan 21-04 AuditLogger.write (will wrap append+rotation in withLock)
tech_added: []
patterns_applied:
  - Lockfile + exp backoff + stale takeover (adapted from src/core/concurrent-lock.ts)
  - Atomic tmp + mv lockfile write (T-21-13 race mitigation via pid-suffixed tmp path)
  - ESM-only imports (no CommonJS require())
  - Fail-soft contract (acquire returns false; release never throws)
key_files_created:
  - src/core/audit/lock.ts
  - tests/unit/core/audit/lock.test.ts
key_files_modified: []
decisions:
  - D-05: AuditLockManager is a NEW class, not a reuse of ConcurrentLockManager.
  - D-06: One lockfile per audit file (`<auditFilePath>.lock`).
  - D-07: Retry budget = 200ms; exhaustion returns false (no throw).
requirements_satisfied:
  - STORE-03 (primitive level)
metrics:
  duration_minutes: 12
  completed: 2026-05-14
  tasks_completed: 1
  files_created: 2
  files_modified: 0
  test_count: 9
---

# Phase 21 Plan 03: Lock Manager Summary

`AuditLockManager` — short-budget (200ms) file lock with fail-soft acquire/release for audit writes; lockfile + exp backoff + stale takeover; per-audit-file lockfile (D-06); D-07 returns `false` instead of throwing on exhaustion so STORE-04 fail-soft holds end-to-end.

## Public API Surface

```ts
// src/core/audit/lock.ts
export const LOCK_RETRY_BUDGET_MS = 200
export const LOCK_BACKOFF_START_MS = 5
export const LOCK_BACKOFF_MAX_MS = 50
export const STALE_LOCK_MULTIPLIER = 10 // 2000ms stale threshold

export interface LockfileContent {
  pid: number
  operation: string
  timestamp: number  // Unix epoch ms; used for staleness check
  hostname: string
}

export type WithLockResult<T> = T | { skipped: 'lock-budget-exhausted' }

export class AuditLockManager {
  constructor(auditFilePath: string)
  acquireLock(operationName?: string): Promise<boolean>     // false on budget exhaust, never throws
  releaseLock(): Promise<boolean>                            // never throws; clears state regardless
  isLockHeld(): boolean
  withLock<T>(
    operation: () => Promise<T>,
    operationName?: string
  ): Promise<WithLockResult<T>>                              // { skipped: 'lock-budget-exhausted' } on acquire fail
  getLockfilePath(): string                                  // for tests / introspection
}
```

Construction: pass the AUDIT FILE PATH (e.g. `.dbcli/audit/default.jsonl`); the lockfile path is derived internally as `${auditFilePath}.lock`.

## Tunings vs Analog (ConcurrentLockManager)

| Tunable                          | ConcurrentLockManager (schema writes) | AuditLockManager (audit writes) | Rationale                                                            |
| -------------------------------- | ------------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| Total retry budget               | 30000 ms (30 s)                       | **200 ms**                      | Audit is high-frequency; long waits would stall main DB commands.    |
| Backoff start                    | 10 ms                                 | **5 ms**                        | Tighter cycle inside the short budget.                               |
| Backoff ceiling                  | 500 ms                                | **50 ms**                       | Fits within the 200 ms total budget.                                 |
| Budget exhaustion behavior       | `throw new Error('Lock acquisition timeout...')` | **`return false`**     | D-07 fail-soft: never block / break the main command.                |
| Stale-lock threshold multiplier  | 3x timeout                            | **10x budget** (=2000 ms)       | High-frequency writer + short budget => need wider stale window.     |
| Release-error behavior           | `throw new Error('Lock release failed...')` | **catch + return false; clear state** | Audit must never throw out of any operation.                  |
| Hostname import                  | CommonJS `require('os').hostname()`   | **ESM `import { hostname }`**   | New module follows ESM-only project convention.                      |
| Tmp file suffix                  | `${Date.now()}.tmp`                   | **`${pid}.${Date.now()}.tmp`**  | T-21-13 mitigation: concurrent writers in same ms use distinct tmps. |

Mechanism (lockfile creation, exp backoff loop, stale detection, atomic tmp+mv) is structurally identical to the analog; only the tunings, the throw-vs-return semantics, and the tmp suffix shape diverge.

## Test Coverage

`tests/unit/core/audit/lock.test.ts` — **9 tests, 44 expect() calls, all pass**:

| #   | Test name                                                       | Maps to behavior |
| --- | --------------------------------------------------------------- | ---------------- |
| 0   | exported constants match plan spec (200/5/50/10)                | constants gate   |
| 1   | acquire/release roundtrip with pid+op+ts+hostname JSON          | Test 1           |
| 2   | release idempotency on fresh manager                            | Test 2           |
| 3   | contention -> fail-soft after ~200ms budget                     | Test 3 (D-07)    |
| 4   | stale-lock takeover (>2s threshold)                             | Test 4           |
| 5   | withLock release on operation throw (finally)                   | Test 5           |
| 6   | withLock skipped marker on budget exhaustion (op NOT invoked)   | Test 6           |
| 7   | per-connection lockfile isolation (parallel acquire)            | Test 7 (D-06)    |
| 8   | release fail-soft after external lockfile deletion              | Test 8           |

Notes:
- Test 3 measures elapsed time with `performance.now()`; window `[180ms, 600ms)` to absorb CI jitter while still proving budget enforcement.
- Tests use per-test `mkdtemp(...)` isolation; `afterEach` removes the tmpdir.
- Test 7 verifies that two managers pointing at different audit files acquire in parallel — proves D-06 lockfile isolation across connections.

## Acceptance Criteria — All Passed

- `test -f src/core/audit/lock.ts` -> OK
- `grep -cE "^export class AuditLockManager"` -> 1
- `grep -cE "^export const LOCK_RETRY_BUDGET_MS = 200"` -> 1
- `grep -cE "^export const LOCK_BACKOFF_START_MS = 5"` -> 1
- `grep -cE "^export const LOCK_BACKOFF_MAX_MS = 50"` -> 1
- `grep -cE "^export const STALE_LOCK_MULTIPLIER = 10"` -> 1
- `grep -cE "^[^/]*return false"` -> 5 (>= 3 required)
- `grep -cE "throw new Error"` -> 0 (correct — audit context never throws)
- `grep -cE "skipped:\s*['\"]lock-budget-exhausted['\"]"` -> 4 (>= 1 required)
- `grep -cE "^\s*require\("` -> 0 (ESM-only)
- `bun test tests/unit/core/audit/lock.test.ts` -> 9 pass, 0 fail
- `bun run typecheck` -> exit 0, no errors
- `bun run lint` -> exit 0, no warnings

## Deviations from Plan

None — plan executed exactly as written.

The plan's reference snippet showed `interface LockfileContent` exported. The test imports the type via `import type { LockfileContent } from '@/core/audit/lock'` (not `import { ..., type LockfileContent }`) because `verbatimModuleSyntax: true` in `tsconfig.json` makes the dedicated `import type` form clearer; both forms are equivalent and the runtime contract is unchanged.

## Threat Surface Notes

All threats from the plan's `<threat_model>` are mitigated as planned:

- **T-21-11 (malformed lockfile)** — `lockFile.json()` failure falls into the outer `try/catch`, returns `false`; stale-takeover path also clears unparseable lockfiles older than 2 s.
- **T-21-12 (DoS holding lock)** — Accepted per D-07; budget exhaustion fails soft, never blocks main command.
- **T-21-13 (race between two writers)** — Mitigated: tmp path includes `${process.pid}` so two writers' tmp files never collide; final `mv` is atomic on POSIX (last writer wins). The loser's next iteration sees the surviving lockfile and waits/backs off. Integration-level proof deferred to Plan 21-05.
- **T-21-14 (symlink attack on lockfile path)** — `rm -f` removes the symlink, `mv` replaces it with a regular file; no privileged path is read or written through the symlink.
- **T-21-15 (crashed process leaves stale lockfile)** — `STALE_LOCK_MULTIPLIER = 10` means lockfiles older than 2 s are taken over (Test 4 verifies).

No new threat surface introduced beyond what the plan registered.

## Commits

| Hash    | Type | Message                                                                 |
| ------- | ---- | ----------------------------------------------------------------------- |
| f11bd60 | test | `[audit-lock] add failing unit tests for AuditLockManager` (RED gate)   |
| 577b77f | feat | `[audit-lock] implement AuditLockManager with 200ms budget and fail-soft` (GREEN gate) |

REFACTOR commit not needed — implementation is already minimal and clear.

## TDD Gate Compliance

- RED commit `f11bd60` (test added, failing) precedes GREEN.
- GREEN commit `577b77f` (implementation added, all 9 tests pass).
- REFACTOR optional gate skipped — no cleanup required.

## Self-Check: PASSED

- `src/core/audit/lock.ts` exists at the expected path
- `tests/unit/core/audit/lock.test.ts` exists at the expected path
- Commit `f11bd60` exists in git history (RED gate)
- Commit `577b77f` exists in git history (GREEN gate)
- `bun test tests/unit/core/audit/lock.test.ts` exits 0 (9 pass / 0 fail)
- `bun run typecheck` exits 0
- `bun run lint` exits 0
- No modifications to `STATE.md` or `ROADMAP.md` (parallel executor contract)
