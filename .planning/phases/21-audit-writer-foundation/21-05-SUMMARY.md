---
phase: 21-audit-writer-foundation
plan: 05
subsystem: audit-testing
tags:
  - audit
  - integration-test
  - concurrent
  - readonly-dir
  - fail-soft
  - phase-21

# Dependency graph
requires:
  - phase: 21-03-lock-manager
    provides: AuditLockManager lockfile contract consumed by concurrent writer tests
  - phase: 21-04-logger-rotation
    provides: AuditLogger.write(), fail-soft result union, once-per-process warning cadence, and getHealth()
provides:
  - tests/integration/core/audit-concurrent.test.ts — two-instance STORE-03 JSONL parseability and per-connection isolation coverage
  - tests/integration/core/audit-readonly.test.ts — readonly-dir STORE-04 / D6 fail-soft coverage
  - src/core/audit/lock.ts atomic exclusive lock creation hardening discovered by integration coverage
  - src/core/audit/logger.ts per-instance write serialization hardening discovered by integration coverage
affects:
  - 22-entry-schema
  - 23-engine-integration
  - 24-cli-surface

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Audit integration fixtures use tmpdir + chmod bounded to per-test directories"
    - "Same-process two-instance concurrency is Phase 21 evidence; true CLI/process coverage remains Phase 23/24"
    - "AuditLogger serializes writes per instance before crossing the per-file lock boundary"
    - "AuditLockManager acquires lockfiles with atomic open(..., 'wx') instead of replace-style moves"

key-files:
  created:
    - tests/integration/core/audit-concurrent.test.ts
    - tests/integration/core/audit-readonly.test.ts
  modified:
    - src/core/audit/lock.ts
    - src/core/audit/logger.ts

key-decisions:
  - "Shipped Option 1 from 21-PATTERNS.md: two AuditLogger instances in one process, not child-process CLI spawning, because Phase 21 has no audit CLI surface."
  - "Kept the successCount >= 95 tolerance; initial failure at 8/100 was treated as a legitimate writer/lock defect, not test flake."
  - "Fixed lock acquisition with atomic exclusive creation and per-instance writer queue rather than loosening the retry budget."
  - "Readonly integration accepts either write-failed or lock-budget-exhausted skip markers because both prove D6 fail-soft behavior through AuditLogger.write()."

patterns-established:
  - "Integration tests may reveal Phase 21 source defects even when a plan expected test-only output; fix defects narrowly and document as deviations."
  - "Future true multi-process audit tests should reuse these assertions once dbcli audit / engine wiring exists."

requirements-completed:
  - STORE-03
  - STORE-04

# Metrics
duration: 45min
completed: 2026-05-15
---

# Phase 21 Plan 05: Integration Tests Summary

**Audit writer integration coverage now proves concurrent JSONL parseability, per-connection lock isolation, readonly-dir fail-soft behavior, warning suppression, and recovery after chmod restoration; the tests also closed two real writer/lock race defects.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-15T00:00:00+08:00
- **Completed:** 2026-05-15T00:45:00+08:00
- **Tasks:** 2 planned test tasks + 2 narrow source hardening fixes discovered by those tests
- **Files created:** 2
- **Files modified:** 2

## Accomplishments

- Added `tests/integration/core/audit-concurrent.test.ts` (2 tests):
  - Same-process, two-instance `AuditLogger` contention against one `default.jsonl` file.
  - Confirms every successful write produces exactly one valid JSONL line, all parsed rows keep `session_id: 'concurrent-test-session'`, and at least 95/100 writes succeed.
  - Confirms different connections (`conn-a`, `conn-b`) use isolated lockfiles and produce 50/50 valid rows with no cross-contamination.
- Added `tests/integration/core/audit-readonly.test.ts` (3 tests):
  - Readonly audit directory causes `write()` to return skip markers without throwing.
  - Six repeated failures emit exactly one `[dbcli audit]` stderr warning and populate `getHealth().lastError` / `lastWrite.success === false`.
  - A simulated main command preserves `{ rows: 3, command: 'query' }` and `exitCode: 0` even when audit write fails.
  - Restoring `0o755` and constructing a fresh logger resumes normal writes with parseable JSONL.
- Hardened `AuditLockManager`:
  - Replaced temp-file + `mv` acquisition with `open(lockPath, 'wx')` exclusive creation.
  - Replaced shell `rm` / `mkdir -p` calls with `node:fs/promises` `rm` and `mkdir`.
- Hardened `AuditLogger`:
  - Added a per-instance `writeChain` so concurrent calls on the same logger serialize before contending on the per-file lock.
  - Preserves the public `write(entry): Promise<AuditWriteResult>` contract.

## Task Commits

1. **Task 1 + Task 2: Phase 21-05 integration tests and race fixes** — `3a2834d` (test/fix)

## Files Created/Modified

### Created

- `tests/integration/core/audit-concurrent.test.ts` — 2 integration tests, ~120 lines, covers STORE-03 same-file contention and D-06 per-connection isolation.
- `tests/integration/core/audit-readonly.test.ts` — 3 integration tests, ~130 lines, covers STORE-04 / D6 readonly-dir fail-soft, warning cadence, downstream result preservation, and writable recovery.

### Modified

- `src/core/audit/lock.ts` — lock acquisition now uses atomic `open(..., 'wx')`; release and stale cleanup use `rm(..., { force: true })`.
- `src/core/audit/logger.ts` — `write()` now queues per instance and delegates to `writeInternal()` so same-instance bursts do not exhaust the lock budget against themselves.

## Decisions Made

- **Option 1 shipped, Option 2 deferred:** followed 21-PATTERNS.md and used two `AuditLogger` instances in one process for Phase 21. True multi-process spawn-based STORE-03 evidence should be re-evaluated once Phase 23/24 wire real command paths and `dbcli audit` CLI surfaces exist.
- **Kept `successCount >= 95`:** the first run produced only 8 successes, validating the plan's warning that persistent failures are a legitimate Phase-21 signal. The fix changed writer/lock behavior; it did not weaken the assertion.
- **Kept high rotation thresholds:** both integration tests set `maxBytes: 10_000_000` and `maxEntries: 10_000` to isolate concurrency and readonly behavior from rotation.
- **No engine / CLI / capability / redaction changes:** Phase 21 remains foundation-only. No adapters, commander tree, capability registry, or `tests/helpers/sensitive-output.ts` were touched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Lock acquisition was not atomic under burst contention**
- **Found during:** Task 1 concurrent integration test.
- **Issue:** The planned test produced only 8 successful writes out of 100. `AuditLockManager.tryAcquireLock()` used temp files suffixed with `Date.now()` and then shell `mv` to the lock path; same-process concurrent writes could collide on temp names and `mv` could overwrite an existing lock.
- **Fix:** Use `open(this.lockPath, 'wx')` to create the lockfile atomically and fail if it already exists. Use `mkdir`/`rm` from `node:fs/promises` for parent creation and cleanup.
- **Files modified:** `src/core/audit/lock.ts`
- **Verification:** `bun test tests/integration/core/audit-concurrent.test.ts` passes; full audit lock/logger/unit suite passes.
- **Committed in:** `3a2834d`

**2. [Rule 3 — Blocking] Same-instance parallel writes exhausted the lock budget against themselves**
- **Found during:** Task 1 concurrent integration test after lock acquisition hardening.
- **Issue:** The test intentionally calls `loggerA.write()` 50 times and `loggerB.write()` 50 times in a single `Promise.all`. Within each logger instance, all 50 calls started lock acquisition at once; most burned the 200ms budget before they could write.
- **Fix:** Add a private `writeChain` so each logger serializes its own writes while separate logger instances still contend through the shared per-file lock. This preserves public async semantics and narrows contention to the intended inter-instance boundary.
- **Files modified:** `src/core/audit/logger.ts`
- **Verification:** `bun test tests/integration/core/audit-concurrent.test.ts` passes with 2 tests and 208 expect calls.
- **Committed in:** `3a2834d`

---

**Total deviations:** 2 auto-fixed (1 lock atomicity bug, 1 writer burst-serialization bug).
**Impact on plan:** Narrow positive deviation. The plan expected test-only files, but the tests revealed real Phase 21 correctness defects. Fixes were constrained to audit writer internals and validated by existing unit coverage plus the new integration tests.

## Issues Encountered

- The readonly-dir tests are intentionally slower (~1.2s for the first case) because the failure path waits for the 200ms lock retry budget repeatedly. This is acceptable integration-test cost and directly exercises D6 fail-soft behavior.
- On readonly paths, either `{ skipped: 'write-failed' }` or `{ skipped: 'lock-budget-exhausted' }` is valid depending on whether the filesystem failure occurs during lazy mkdir, lock creation, or append. Tests assert the stable contract: skip marker, no throw, one warning, sticky health state, downstream command result unaffected.

## Verification

All required gates passed:

- `bun test tests/integration/core/audit-concurrent.test.ts` — 2 pass / 0 fail / 208 expect calls.
- `bun test tests/integration/core/audit-readonly.test.ts` — 3 pass / 0 fail / 17 expect calls.
- `bun run typecheck` — pass.
- `bun run lint` — pass with `--max-warnings=0`.
- Acceptance greps from the plan all passed for both new test files.
- Phase targeted regression suite passed: `bun test tests/unit/core/audit tests/integration/core/audit-concurrent.test.ts tests/integration/core/audit-readonly.test.ts tests/unit/core/config.test.ts tests/unit/core/config-v2.test.ts` — 89 pass / 0 fail / 510 expect calls.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 21 now has all 5 plans executed and summarized.
- STORE-03 and STORE-04 are closed at integration level.
- Phase 22 can lock the audit entry schema on top of a writer whose concurrency and fail-soft behavior are already integration-tested.
- Phase 23 should revisit true multi-process / CLI-level audit evidence once engine hooks exist.

---
*Phase: 21-audit-writer-foundation*
*Completed: 2026-05-15*
