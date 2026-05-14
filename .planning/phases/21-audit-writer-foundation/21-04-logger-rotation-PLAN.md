---
phase: 21-audit-writer-foundation
plan: 04
type: execute
wave: 2
depends_on:
  - "21-01"
  - "21-02"
  - "21-03"
files_modified:
  - src/core/audit/logger.ts
  - src/core/audit/rotation.ts
  - tests/unit/core/audit/logger.test.ts
  - tests/unit/core/audit/rotation.test.ts
autonomous: true
requirements:
  - STORE-01
  - STORE-02
  - STORE-04
  - AUDIT-02
  - AUDIT-03
tags:
  - audit
  - jsonl-writer
  - rotation
  - getHealth
  - phase-21
must_haves:
  truths:
    - "When config.audit.enabled === false, AuditLogger.write returns `{ skipped: 'disabled' }` immediately, the audit directory is NOT created on disk, and no lockfile is touched (success criterion 1)"
    - "When enabled, the first call to write() lazily creates the audit directory via `mkdir(recursive: true)` (D-12); construction does NOT pre-create the directory"
    - "Each successful write appends one JSON line terminated by `\\n` to `<storagePath>/.dbcli/audit/<connectionName>.jsonl` using `appendFile` (O_APPEND under the hood, D-08); no fsync is called"
    - "When `currentSizeBytes + nextLine.length >= maxBytes` OR `currentEntryCount + 1 > maxEntries`, rotation triggers BEFORE the append: rename `<conn>.jsonl` -> `<conn>.jsonl.1` (D-09, overwriting any existing .1 per D-10); counters reset; then the new line is appended to a fresh `<conn>.jsonl`"
    - "When write fails (e.g. readonly dir, disk full, lock budget exhausted), the error is caught and stored in `lastError`; stderr receives ONE warning per process lifetime (D-16); subsequent failures silently update sticky lastError; the main command's promise resolves normally (STORE-04 / success criterion 4)"
    - "getHealth() returns the full AuditHealthReport shape regardless of enabled state — including enabled, writerInitialized, currentFile, currentSizeBytes, currentEntryCount, rotationUsage, lock {state}, lastWrite, lastError, sessionId, rotation"
    - "Each entry includes the session_id from the injected SessionIdService (AUDIT-02 wiring); the same id is reused for all writes within one process (AUDIT-03 wiring)"
    - "V1 / unnamed connections write to `default.jsonl` (D-14)"
  artifacts:
    - path: "src/core/audit/logger.ts"
      provides: "AuditLogger class with constructor(opts), write(entry), getHealth(); types AuditLoggerOptions, AuditWriteResult, AuditHealthReport"
      contains: "export class AuditLogger"
      min_lines: 150
    - path: "src/core/audit/rotation.ts"
      provides: "Pure `shouldRotate(stats, thresholds)` predicate + async `rotate(currentPath, previousPath)` function"
      contains: "export function shouldRotate"
      min_lines: 30
    - path: "tests/unit/core/audit/rotation.test.ts"
      provides: "Unit tests for shouldRotate predicate and rotate() rename behavior (overwrites existing .1)"
      contains: "shouldRotate"
    - path: "tests/unit/core/audit/logger.test.ts"
      provides: "Unit tests for disabled short-circuit, lazy mkdir, append O_APPEND, both rotation triggers, fail-soft on readonly dir, once-per-process warning, getHealth shape, sessionId reuse"
      contains: "AuditLogger"
  key_links:
    - from: "src/core/audit/logger.ts (AuditLogger.write)"
      to: "src/core/audit/session-id.ts (SessionIdService.resolve)"
      via: "constructor-injected sessionIdService; called inside write() before append"
      pattern: "sessionIdService\\.resolve"
    - from: "src/core/audit/logger.ts (AuditLogger.write)"
      to: "src/core/audit/lock.ts (AuditLockManager.withLock)"
      via: "wraps the rotation-check + append in a single locked critical section"
      pattern: "lockManager\\.withLock"
    - from: "src/core/audit/logger.ts (AuditLogger.write)"
      to: "src/core/audit/rotation.ts (shouldRotate + rotate)"
      via: "rotation triggered inside withLock before append"
      pattern: "shouldRotate"
    - from: "src/core/audit/logger.ts (AuditLogger.write)"
      to: "node:fs/promises appendFile"
      via: "O_APPEND single-line write (D-08)"
      pattern: "appendFile"
---

<objective>
Build the `AuditLogger` service (`src/core/audit/logger.ts`) and supporting `rotation.ts` module — the user-visible "writer" that ties Wave-1 building blocks (config schema, SessionIdService, AuditLockManager) into a complete fail-soft JSONL append-only writer with size-or-entry-based rotation, once-per-process error warning, and `getHealth()` introspection API. After Plan 21-04 lands, the audit subsystem is functionally complete from a Phase-21 standpoint — Phases 22-24 will wire it into the entry schema and engine adapters.

Purpose: Satisfy STORE-01 (JSONL append-only), STORE-02 (rotation on size OR entry caps), STORE-04 (fail-soft never throws to main command). Also covers AUDIT-02/AUDIT-03 wiring (the logger USES the SessionIdService and includes the resolved id in every entry). Expose the `getHealth()` API that Phase 24's `dbcli audit health` will surface (Cross-Phase Risk #5).

Output: Two new source files (`src/core/audit/logger.ts`, `src/core/audit/rotation.ts`); two new test files; no changes to existing files.
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
@.planning/phases/21-audit-writer-foundation/21-01-config-schema-PLAN.md
@.planning/phases/21-audit-writer-foundation/21-02-session-id-service-PLAN.md
@.planning/phases/21-audit-writer-foundation/21-03-lock-manager-PLAN.md
@AGENTS.md

<interfaces>
<!-- Wave-1 dependencies produced by sibling plans 21-01, 21-02, 21-03. -->

From Plan 21-01 — `src/utils/validation.ts` (post-Plan-01):
```typescript
export const AuditConfigSchema: ZodType<{
  enabled: boolean
  rotation: { max_bytes: number; max_entries: number }
}>
// Parsed result accessible as config.audit.{enabled, rotation.max_bytes, rotation.max_entries}
```

From Plan 21-02 — `src/core/audit/session-id.ts`:
```typescript
export class SessionIdService {
  constructor(storagePath: string)
  resolve(): Promise<string>
  reset(): void
}
```

From Plan 21-03 — `src/core/audit/lock.ts`:
```typescript
export class AuditLockManager {
  constructor(auditFilePath: string)
  acquireLock(operationName?: string): Promise<boolean>
  releaseLock(): Promise<boolean>
  isLockHeld(): boolean
  withLock<T>(
    operation: () => Promise<T>,
    operationName?: string
  ): Promise<T | { skipped: 'lock-budget-exhausted' }>
  getLockfilePath(): string
}
```

Public contract this plan will export:
```typescript
// src/core/audit/rotation.ts
export interface RotationStats {
  currentSizeBytes: number
  currentEntryCount: number
}
export interface RotationThresholds {
  maxBytes: number
  maxEntries: number
}
export function shouldRotate(
  stats: RotationStats,
  thresholds: RotationThresholds,
  nextLineByteLength: number
): boolean
export async function rotate(currentPath: string, previousPath: string): Promise<void>

// src/core/audit/logger.ts
export interface AuditLoggerOptions {
  storagePath: string                    // resolved storage root (NOT including .dbcli)
  connectionName: string                 // 'default' for V1 (D-14)
  enabled: boolean                       // from config.audit.enabled
  rotation: { maxBytes: number; maxEntries: number }
  sessionIdService: SessionIdService
  lockManager?: AuditLockManager         // test seam; defaults to new AuditLockManager(auditFilePath)
}

export type AuditWriteResult =
  | { skipped: 'disabled' }
  | { skipped: 'lock-budget-exhausted' }
  | { skipped: 'write-failed'; error: string }
  | { success: true; rotated: boolean }

export interface AuditHealthReport {
  enabled: boolean
  writerInitialized: boolean
  currentFile: string
  currentSizeBytes: number
  currentEntryCount: number
  rotationUsage: {
    bytes: { current: number; max: number; pct: number }
    entries: { current: number; max: number; pct: number }
  }
  lock: { state: 'held' | 'free'; heldByPid?: number }
  lastWrite: { ts: string; success: boolean; error?: string } | null
  lastError: { ts: string; message: string } | null
  sessionId: string | null
  rotation: { lastRotatedAt?: string; previousFile?: string }
}

export class AuditLogger {
  constructor(opts: AuditLoggerOptions)
  write(entry: Record<string, unknown>): Promise<AuditWriteResult>
  getHealth(): AuditHealthReport
}
```

Audit directory path resolution (D-15): `<opts.storagePath>/.dbcli/audit/`
Audit file path (D-14): `<opts.storagePath>/.dbcli/audit/<opts.connectionName>.jsonl`
Rotated segment path (D-09/D-10): `<auditFilePath>.1`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement rotation.ts (pure predicate + rename function)</name>
  <files>src/core/audit/rotation.ts, tests/unit/core/audit/rotation.test.ts</files>
  <read_first>
    - src/core/atomic-writer.ts lines 86-90 (the `mv` rename pattern)
    - .planning/phases/21-audit-writer-foundation/21-PATTERNS.md section "NEW: src/core/audit/rotation.ts" (the pseudo-shape)
    - .planning/phases/21-audit-writer-foundation/21-CONTEXT.md D-09 (single rolling), D-10 (one segment), D-11 (thresholds)
  </read_first>
  <behavior>
    - Test 1 (shouldRotate: below both caps): `shouldRotate({ currentSizeBytes: 100, currentEntryCount: 5 }, { maxBytes: 10000, maxEntries: 100 }, 50)` returns false
    - Test 2 (shouldRotate: byte cap met by next line): `shouldRotate({ currentSizeBytes: 9990, currentEntryCount: 5 }, { maxBytes: 10000, maxEntries: 100 }, 50)` returns true (9990 + 50 = 10040 >= 10000)
    - Test 3 (shouldRotate: byte cap exactly at boundary): `shouldRotate({ currentSizeBytes: 9990, currentEntryCount: 5 }, { maxBytes: 10000, maxEntries: 100 }, 10)` returns true (9990 + 10 = 10000 >= 10000)
    - Test 4 (shouldRotate: entry cap reached): `shouldRotate({ currentSizeBytes: 100, currentEntryCount: 100 }, { maxBytes: 10000, maxEntries: 100 }, 50)` returns true (currentEntryCount + 1 > maxEntries)
    - Test 5 (shouldRotate: OR semantics): given high byte cap but low entry cap (or vice versa), assert each cap triggers true independently
    - Test 6 (rotate: basic rename): seed `<tmp>/file.jsonl` with content `"line1\nline2\n"`; call `rotate(<tmp>/file.jsonl, <tmp>/file.jsonl.1)`. Assert: `file.jsonl` no longer exists, `file.jsonl.1` exists with content `"line1\nline2\n"`
    - Test 7 (rotate: overwrites existing .1, D-10): seed both `<tmp>/file.jsonl` ("new content") and `<tmp>/file.jsonl.1` ("OLD - should be overwritten"); call rotate(); assert `file.jsonl.1` content === "new content"
    - Test 8 (rotate: missing source file -> resolves without throwing): call rotate() against a non-existent path; assert it resolves (does not throw). Required because audit must never throw upstream.
  </behavior>
  <action>
    Create `src/core/audit/rotation.ts` with the exact structure below. Use `node:fs/promises` `rename` (atomic on POSIX). Wrap rename in try/catch so a missing source doesn't throw:

    ```typescript
    /**
     * Audit log rotation primitives.
     *
     * Decisions:
     * - D-08: Single OS-level rename; no fsync, no tmp+rename for the .jsonl itself.
     * - D-09: Rename current -> .1, overwriting any existing .1.
     * - D-10: Keep exactly one rolling segment.
     * - D-11: Thresholds passed in; defaults live in zod (Plan 21-01).
     */
    import { rename } from 'node:fs/promises'

    export interface RotationStats {
      currentSizeBytes: number
      currentEntryCount: number
    }

    export interface RotationThresholds {
      maxBytes: number
      maxEntries: number
    }

    /**
     * Pure predicate. Returns true if writing the next line would meet OR exceed either cap.
     * - Byte cap: (current + next line length) >= maxBytes
     * - Entry cap: (current + 1) > maxEntries
     * - OR relationship (D-11)
     */
    export function shouldRotate(
      stats: RotationStats,
      thresholds: RotationThresholds,
      nextLineByteLength: number
    ): boolean {
      const bytesAfter = stats.currentSizeBytes + nextLineByteLength
      const entriesAfter = stats.currentEntryCount + 1
      return bytesAfter >= thresholds.maxBytes || entriesAfter > thresholds.maxEntries
    }

    /**
     * Rename current segment to previous. Overwrites previous if it exists.
     * Best-effort: missing source file resolves without throwing (audit must never throw).
     */
    export async function rotate(currentPath: string, previousPath: string): Promise<void> {
      try {
        await rename(currentPath, previousPath)
      } catch {
        // If currentPath doesn't exist, there's nothing to rotate. Treat as no-op.
      }
    }
    ```

    Create `tests/unit/core/audit/rotation.test.ts` with eight cases corresponding to Tests 1-8 in behavior. Use:
    - `import { test, expect, beforeEach } from 'bun:test'`
    - `mkdtemp` + `tmpdir()` for filesystem fixtures
    - `node:fs/promises` writeFile / readFile / stat for setup and assertions
  </action>
  <verify>
    <automated>bun test tests/unit/core/audit/rotation.test.ts 2>&1</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/core/audit/rotation.ts` succeeds
    - `grep -E "^export function shouldRotate" src/core/audit/rotation.ts` returns exactly one match
    - `grep -E "^export async function rotate" src/core/audit/rotation.ts` returns exactly one match
    - `grep -E "^export interface RotationStats" src/core/audit/rotation.ts` returns exactly one match
    - `grep -E "^export interface RotationThresholds" src/core/audit/rotation.ts` returns exactly one match
    - `grep -cE "throw" src/core/audit/rotation.ts` returns 0
    - `bun test tests/unit/core/audit/rotation.test.ts` exits 0 with at least 8 passing tests
    - `bun run typecheck` exits 0
  </acceptance_criteria>
  <done>
    rotation.ts implemented per the exact code above; shouldRotate is a pure function with OR semantics; rotate is fail-soft on missing source; all eight tests pass; typecheck clean; no `throw` statements.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement AuditLogger class with lazy mkdir, withLock-wrapped rotation+append, once-per-process warning, getHealth()</name>
  <files>src/core/audit/logger.ts, tests/unit/core/audit/logger.test.ts</files>
  <read_first>
    - src/core/audit/session-id.ts (Plan 21-02 output — to verify import surface)
    - src/core/audit/lock.ts (Plan 21-03 output — to verify withLock return type union)
    - src/core/audit/rotation.ts (Task-1 output of this plan)
    - src/core/schema-writer.ts lines 1-100 (analog: stateful class with composed async file ops)
    - src/core/recovery/last-envelope.ts lines 60-100 (analog: best-effort filesystem ops with silent catch)
    - .planning/phases/21-audit-writer-foundation/21-PATTERNS.md section "NEW: src/core/audit/logger.ts — `AuditLogger`" and the data-flow diagram at the end
    - .planning/phases/21-audit-writer-foundation/21-CONTEXT.md decisions D-01..D-16 in full (the logger touches all of them)
    - AGENTS.md (use `node:fs/promises` appendFile / stat / mkdir per PATTERNS.md guidance — Bun.file is a replace-write API and would break D-08)
  </read_first>
  <behavior>
    - Test 1 (disabled short-circuit, success criterion 1 / CONFIG-02): construct logger with `enabled: false`. Call `write({ test: 1 })`. Assert: result is `{ skipped: 'disabled' }`; the audit directory `<storagePath>/.dbcli/audit/` does NOT exist after the call
    - Test 2 (lazy mkdir, D-12): construct logger with `enabled: true`. Assert: directory does NOT exist after construction. Call `write({ test: 1 })`. Assert: directory NOW exists AND the file `<storagePath>/.dbcli/audit/default.jsonl` exists with exactly one JSON line containing the entry plus a `session_id` field
    - Test 3 (append O_APPEND, STORE-01 / D-08): call write() three times with `{ i: 1 }`, `{ i: 2 }`, `{ i: 3 }`. Read the file; assert it contains exactly three `\n`-terminated JSON lines, each parsing to an object that includes the corresponding `i` value
    - Test 4 (rotation on max_bytes, STORE-02 / success criterion 2): construct logger with `rotation: { maxBytes: 200, maxEntries: 10000 }`. Write entries with payloads sized so the 4th write crosses the byte cap. Assert: after the triggering write, `<conn>.jsonl.1` exists with the pre-rotation content; `<conn>.jsonl` exists with just the new entry; `getHealth().currentEntryCount === 1` and `currentSizeBytes === lineLength`
    - Test 5 (rotation on max_entries, STORE-02 / success criterion 2): construct with `rotation: { maxBytes: 100_000_000, maxEntries: 3 }`. Write 4 entries. Assert: after the 4th write, `<conn>.jsonl.1` exists with the first 3 entries; `<conn>.jsonl` has only the 4th entry
    - Test 6 (rotation overwrites existing .1, D-10): pre-seed `<conn>.jsonl.1` with "OLD CONTENT\n"; construct logger with low maxEntries; trigger a rotation; assert `<conn>.jsonl.1` contains the NEW pre-rotation content, NOT "OLD CONTENT"
    - Test 7 (D6 fail-soft on readonly dir, STORE-04 / success criterion 4): create audit dir then `chmod 0o555` on `<storagePath>/.dbcli/audit/`; call write(). Assert: result is `{ skipped: 'write-failed', error: <string> }` (NOT a throw); `getHealth().lastError` is populated with `{ ts: ISO-string, message: string }`; capture `process.stderr` writes via a spy and assert exactly ONE warning line was emitted. Restore chmod 0o755 in afterEach.
    - Test 8 (D-16 once-per-process warning cadence): with same setup as Test 7, call write() THREE more times after the first failure. Assert: stderr received only ONE warning total; `lastError` is updated to the most recent failure's timestamp / message
    - Test 9 (getHealth shape when disabled): on a disabled logger, `getHealth()` returns an object with EXACTLY these top-level keys: `enabled, writerInitialized, currentFile, currentSizeBytes, currentEntryCount, rotationUsage, lock, lastWrite, lastError, sessionId, rotation`; assert `enabled === false`, `writerInitialized === false`, `sessionId === null`, `lastWrite === null`, `lastError === null`
    - Test 10 (getHealth shape after successful writes): enable logger; do two writes; call `getHealth()`. Assert: `enabled === true`, `writerInitialized === true`, `currentEntryCount === 2`, `currentSizeBytes > 0`, `rotationUsage.entries.current === 2`, `rotationUsage.entries.max === <configured maxEntries>`, `rotationUsage.entries.pct` is `(2 / max) * 100`, `lastWrite.success === true`, `sessionId` is a non-empty string
    - Test 11 (AUDIT-02/AUDIT-03 wiring): set `process.env.DBCLI_SESSION_ID = 'wired-id-abc'`; construct logger; write three entries; read file. Assert all three lines have `session_id === 'wired-id-abc'` (cache reuse from injected SessionIdService)
    - Test 12 (D-14 default.jsonl): construct logger with `connectionName: 'default'`. Trigger a write. Assert the file path created is exactly `<storagePath>/.dbcli/audit/default.jsonl`
    - Test 13 (lock-budget-exhausted fall-through): pass an `lockManager` option whose `withLock` always returns `{ skipped: 'lock-budget-exhausted' }` (use a small stub class implementing the same shape). Call write(). Assert result is `{ skipped: 'lock-budget-exhausted' }`; `lastError` is updated; exactly one stderr warning per process (same fail-soft path as Test 7 but a different skip reason)
  </behavior>
  <action>
    Create `src/core/audit/logger.ts` with this exact structure (use `node:fs/promises` for `appendFile`, `mkdir`, `stat`, `readFile`; do NOT use `Bun.file` for the .jsonl writes because Bun.file is replace-write semantics; D-08 mandates O_APPEND):

    ```typescript
    /**
     * AuditLogger — append-only JSONL writer with rotation + fail-soft semantics.
     *
     * Decisions implemented:
     * - D-01: lives under src/core/audit/
     * - D-02: class instance, one per process; stateful (counters, sticky lastError)
     * - D-03: async write(); awaited by callers (engines in Phase 23)
     * - D-04: SessionIdService injected via constructor
     * - D-05/06/07: AuditLockManager injected (or constructed) with per-file lockfile
     * - D-08: appendFile (O_APPEND); no fsync; one entry = one line + \n
     * - D-09/10/11: rotation = rename to .1, single segment, default 10MB / 1000
     * - D-12: lazy mkdir on first successful write
     * - D-13: wired indirectly through SessionIdService
     * - D-14: 'default' for unnamed/V1
     * - D-15: storagePath resolved by caller (config-binding.ts:64-67)
     * - D-16: once-per-process stderr warning; subsequent failures update sticky lastError silently
     */
    import { mkdir, stat, appendFile, readFile } from 'node:fs/promises'
    import { join } from 'node:path'
    import { AuditLockManager } from './lock'
    import type { SessionIdService } from './session-id'
    import { rotate, shouldRotate } from './rotation'

    export interface AuditLoggerOptions {
      storagePath: string
      connectionName: string
      enabled: boolean
      rotation: { maxBytes: number; maxEntries: number }
      sessionIdService: SessionIdService
      /** Test seam — defaults to a new AuditLockManager(auditFilePath). */
      lockManager?: AuditLockManager
    }

    export type AuditWriteResult =
      | { skipped: 'disabled' }
      | { skipped: 'lock-budget-exhausted' }
      | { skipped: 'write-failed'; error: string }
      | { success: true; rotated: boolean }

    export interface AuditHealthReport {
      enabled: boolean
      writerInitialized: boolean
      currentFile: string
      currentSizeBytes: number
      currentEntryCount: number
      rotationUsage: {
        bytes: { current: number; max: number; pct: number }
        entries: { current: number; max: number; pct: number }
      }
      lock: { state: 'held' | 'free'; heldByPid?: number }
      lastWrite: { ts: string; success: boolean; error?: string } | null
      lastError: { ts: string; message: string } | null
      sessionId: string | null
      rotation: { lastRotatedAt?: string; previousFile?: string }
    }

    const WARN_PREFIX = '[dbcli audit]'

    export class AuditLogger {
      private readonly auditDir: string
      private readonly auditFilePath: string
      private readonly previousFilePath: string
      private readonly enabled: boolean
      private readonly maxBytes: number
      private readonly maxEntries: number
      private readonly sessionIdService: SessionIdService
      private readonly lockManager: AuditLockManager

      private writerInitialized = false
      private currentSizeBytes = 0
      private currentEntryCount = 0
      private lastWrite: { ts: string; success: boolean; error?: string } | null = null
      private lastError: { ts: string; message: string } | null = null
      private warnedOnceThisProcess = false
      private cachedSessionId: string | null = null
      private lastRotatedAt: string | undefined
      private lastRotatedPrevious: string | undefined

      constructor(opts: AuditLoggerOptions) {
        this.enabled = opts.enabled
        this.maxBytes = opts.rotation.maxBytes
        this.maxEntries = opts.rotation.maxEntries
        this.auditDir = join(opts.storagePath, '.dbcli', 'audit')
        this.auditFilePath = join(this.auditDir, `${opts.connectionName}.jsonl`)
        this.previousFilePath = `${this.auditFilePath}.1`
        this.sessionIdService = opts.sessionIdService
        this.lockManager = opts.lockManager ?? new AuditLockManager(this.auditFilePath)
      }

      async write(entry: Record<string, unknown>): Promise<AuditWriteResult> {
        // D-01 / CONFIG-02 short-circuit; never touches disk.
        if (!this.enabled) {
          return { skipped: 'disabled' }
        }

        try {
          // D-04 / AUDIT-02 / AUDIT-03: resolve session id (cached after first call).
          const sessionId = await this.sessionIdService.resolve()
          this.cachedSessionId = sessionId

          // D-12: lazy mkdir on first successful path.
          await mkdir(this.auditDir, { recursive: true })

          // Re-sync counters from disk on first run (covers process restart with existing file).
          if (!this.writerInitialized) {
            await this.syncCountersFromDisk()
            this.writerInitialized = true
          }

          const enriched = { ...entry, session_id: sessionId }
          const line = JSON.stringify(enriched) + '\n'
          const lineBytes = Buffer.byteLength(line, 'utf8')

          // D-05/06/07: critical section — rotation check + append under lock.
          const lockResult = await this.lockManager.withLock(async (): Promise<{ rotated: boolean }> => {
            let rotated = false
            if (
              shouldRotate(
                { currentSizeBytes: this.currentSizeBytes, currentEntryCount: this.currentEntryCount },
                { maxBytes: this.maxBytes, maxEntries: this.maxEntries },
                lineBytes
              )
            ) {
              await rotate(this.auditFilePath, this.previousFilePath)
              this.lastRotatedAt = new Date().toISOString()
              this.lastRotatedPrevious = this.previousFilePath
              this.currentSizeBytes = 0
              this.currentEntryCount = 0
              rotated = true
            }
            // D-08: O_APPEND, no fsync, single line + \n.
            await appendFile(this.auditFilePath, line, { encoding: 'utf8' })
            this.currentSizeBytes += lineBytes
            this.currentEntryCount += 1
            return { rotated }
          }, 'audit-write')

          if ('skipped' in lockResult) {
            // Lock budget exhausted — D-07 fail-soft.
            this.handleFailure(`lock-budget-exhausted`)
            return { skipped: 'lock-budget-exhausted' }
          }

          const ts = new Date().toISOString()
          this.lastWrite = { ts, success: true }
          return { success: true, rotated: lockResult.rotated }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.handleFailure(message)
          return { skipped: 'write-failed', error: message }
        }
      }

      getHealth(): AuditHealthReport {
        return {
          enabled: this.enabled,
          writerInitialized: this.writerInitialized,
          currentFile: this.auditFilePath,
          currentSizeBytes: this.currentSizeBytes,
          currentEntryCount: this.currentEntryCount,
          rotationUsage: {
            bytes: {
              current: this.currentSizeBytes,
              max: this.maxBytes,
              pct: this.maxBytes > 0 ? (this.currentSizeBytes / this.maxBytes) * 100 : 0,
            },
            entries: {
              current: this.currentEntryCount,
              max: this.maxEntries,
              pct: this.maxEntries > 0 ? (this.currentEntryCount / this.maxEntries) * 100 : 0,
            },
          },
          lock: { state: this.lockManager.isLockHeld() ? 'held' : 'free' },
          lastWrite: this.lastWrite,
          lastError: this.lastError,
          sessionId: this.cachedSessionId,
          rotation: {
            lastRotatedAt: this.lastRotatedAt,
            previousFile: this.lastRotatedPrevious,
          },
        }
      }

      private async syncCountersFromDisk(): Promise<void> {
        try {
          const s = await stat(this.auditFilePath)
          this.currentSizeBytes = s.size
          const raw = await readFile(this.auditFilePath, 'utf8')
          this.currentEntryCount = raw.split('\n').filter(Boolean).length
        } catch {
          // File doesn't exist yet — counters stay at 0.
          this.currentSizeBytes = 0
          this.currentEntryCount = 0
        }
      }

      private handleFailure(message: string): void {
        const ts = new Date().toISOString()
        this.lastError = { ts, message }
        this.lastWrite = { ts, success: false, error: message }
        if (!this.warnedOnceThisProcess) {
          process.stderr.write(
            `${WARN_PREFIX} warning: audit write failed (${message}); subsequent failures suppressed this process.\n`
          )
          this.warnedOnceThisProcess = true
        }
      }
    }
    ```

    Create `tests/unit/core/audit/logger.test.ts` with thirteen test cases corresponding exactly to behavior Tests 1-13. Use:
    - `import { test, expect, beforeEach, afterEach, describe, spyOn } from 'bun:test'`
    - `mkdtemp` + `tmpdir()` for per-test isolation
    - Construct a real `SessionIdService` pointing at the same tmpdir
    - For Test 7 / 8 / 13: spy on `process.stderr.write` with `spyOn(process.stderr, 'write')`; restore after each test
    - For Test 7: pre-create the audit dir then `chmod(<auditDir>, 0o555)`; restore in afterEach with `chmod(<auditDir>, 0o755)` so cleanup works
    - For Test 13: pass a stub `lockManager` whose `withLock` returns `Promise.resolve({ skipped: 'lock-budget-exhausted' })` and whose `isLockHeld` returns false; the stub only needs to satisfy the small surface used by AuditLogger (`withLock`, `isLockHeld`); duck-typing through the `AuditLockManager` type is acceptable for the test
    - Restore env between tests: capture `process.env.DBCLI_SESSION_ID` before each, restore after

    Do NOT call fsync. Do NOT add a background queue. Do NOT add any code path that throws out of write().
  </action>
  <verify>
    <automated>bun test tests/unit/core/audit/logger.test.ts 2>&1</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/core/audit/logger.ts` succeeds
    - `grep -E "^export class AuditLogger" src/core/audit/logger.ts` returns exactly one match
    - `grep -E "^export interface AuditLoggerOptions" src/core/audit/logger.ts` returns exactly one match
    - `grep -E "^export interface AuditHealthReport" src/core/audit/logger.ts` returns exactly one match
    - `grep -E "^export type AuditWriteResult" src/core/audit/logger.ts` returns exactly one match
    - `grep -E "appendFile" src/core/audit/logger.ts` returns at least one match (D-08)
    - `grep -cE "fsync|fdatasync" src/core/audit/logger.ts` returns 0 (D-08)
    - `grep -E "lockManager\\.withLock" src/core/audit/logger.ts` returns exactly one match
    - `grep -E "sessionIdService\\.resolve" src/core/audit/logger.ts` returns exactly one match
    - `grep -E "shouldRotate" src/core/audit/logger.ts` returns exactly one match
    - `grep -E "skipped:\s*['\"]disabled['\"]" src/core/audit/logger.ts` returns exactly one match
    - `grep -cE "warnedOnceThisProcess" src/core/audit/logger.ts` is at least 3 (declaration + check + set)
    - `grep -cE "^\s*throw " src/core/audit/logger.ts` returns 0 (no `throw` statements in production paths)
    - `bun test tests/unit/core/audit/logger.test.ts` exits 0 with at least 13 passing tests
    - `bun run typecheck` exits 0
    - `bun run lint` exits 0 (no new warnings)
  </acceptance_criteria>
  <done>
    AuditLogger implemented per the exact code above; disabled short-circuits with no disk touch; lazy mkdir on first write; O_APPEND with no fsync; rotation triggers on either cap with overwrite of .1; fail-soft on readonly dir; one stderr warning per process with sticky lastError; getHealth() returns the full report; session_id wired into every entry; all 13 tests pass; typecheck + lint clean; no `throw` in production paths; no fsync calls.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Entry `Record<string, unknown>` parameter -> AuditLogger.write | Phase 21 treats entry as opaque; Phase 22 will lock schema + redaction. Phase 21 only adds `session_id` field; it does NOT inspect entry content. |
| Audit file on disk -> syncCountersFromDisk | Untrusted file (could be large, malformed, or contain embedded `\n` from prior corruption); readFile then split('\n') is bounded by maxBytes (10 MB default) but still loaded fully into memory in Phase 21 |
| connectionName -> auditFilePath | The connectionName is supplied by Plan 21-04 callers (Phase 23+); if a connection name contains `..` or path separators, the file path could escape the audit dir. Phase 21 trusts callers; Plan 21-01's config schema already constrains connection names to non-empty strings per V2 convention. |
| stderr writes -> terminal | Warning content includes `message` from caught error; plain string write, no shell interpretation. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-21-16 | Tampering | Entry contains a key `session_id` that overrides what the logger sets | mitigate | The line `{ ...entry, session_id: sessionId }` places `session_id` AFTER the spread, so a caller-supplied `session_id` is overwritten by the resolved id. Test 11 implicitly verifies this. |
| T-21-17 | Information Disclosure | stderr warning leaks filesystem paths or error details to a non-interactive parent process | accept | Warning is observability info; main DB command is unaffected. Once-per-process cadence (D-16) bounds noise. |
| T-21-18 | Path traversal | connectionName = "../../../etc/passwd" via crafted config | mitigate | Defense-in-depth: Plan 21-01's NamedConnectionSchema requires non-empty strings; connection names that survive zod parse are conventional identifiers per V2 config. Phase 21 documents this assumption — if Phase 23 later allows user-controlled connection names, add a path-traversal sanitizer there. |
| T-21-19 | DoS | Caller writes an entry with a gigantic payload (e.g. 100 MB stringified) | accept | Phase 21 has no entry size cap; rotation triggers as soon as the byte budget is exceeded, which contains the impact. Phase 22 entry schema will enforce per-field caps. |
| T-21-20 | Symlink attack | `<auditFile>` exists as a symlink to /etc/something | mitigate | `appendFile` writes to the symlink target; if attacker can create a symlink in `.dbcli/audit/`, they already have write access there — no privilege escalation. Defense-in-depth: storagePath is under user-controlled `.dbcli/audit/` per D-15. |
| T-21-21 | Race condition (TOCTOU on counters) | Two AuditLogger instances in the same process keep separate in-memory counters; counters drift | accept | D-02 stipulates ONE instance per process. Two-instance-same-process is a test scenario only (Plan 21-05). syncCountersFromDisk on first write per instance re-syncs from disk so the second instance starts from a correct base. Cross-process correctness comes from the lock (Plan 21-03 + Plan 21-05). |
| T-21-22 | Information Disclosure | `lastError.message` exposes filesystem internals | accept | `lastError` only flows out via `getHealth()` which is consumed by `dbcli audit health` (Phase 24); same trust level as the operator running the CLI. |
</threat_model>

<verification>
- `bun test tests/unit/core/audit/rotation.test.ts tests/unit/core/audit/logger.test.ts` all green
- `bun run typecheck` clean
- `bun run lint` clean
- Acceptance-criteria greps all match
- `grep -rE "fsync|fdatasync" src/core/audit/` returns 0 (D-08)
</verification>

<success_criteria>
- Roadmap success criterion 1 verified: `audit.enabled = false` -> no dir, no writes (Test 1)
- Roadmap success criterion 2 verified at unit level: rotation triggers on either cap with previous-segment retention (Tests 4, 5, 6)
- Roadmap success criterion 4 verified at unit level: readonly dir -> stderr warning + result has skip marker but no throw (Test 7) — full integration form lands in Plan 21-05
- Roadmap success criterion 5 wired: every entry has the session_id from the injected service (Test 11)
- STORE-01 satisfied: append-only JSONL via O_APPEND (Test 3)
- STORE-02 satisfied: rotation on size cap (Test 4) AND entry cap (Test 5) with .1 overwrite (Test 6)
- STORE-04 satisfied: write-failure does not throw upstream; sticky lastError; once-per-process warning (Tests 7, 8)
- AUDIT-02 / AUDIT-03 wiring verified: session_id present on every entry (Test 11)
- Cross-Phase Risk #5 mitigated: getHealth() exposes writer state for Phase 24 CLI to consume (Tests 9, 10)
</success_criteria>

<output>
After completion, create `.planning/phases/21-audit-writer-foundation/21-04-SUMMARY.md` documenting:
- Public API surface (AuditLogger + AuditLoggerOptions + AuditWriteResult + AuditHealthReport + rotation module)
- Confirmation of zero `throw` statements in production paths and zero fsync calls
- Test case names + counts (rotation: 8, logger: 13)
- Lock-manager test seam (constructor `lockManager?` option) — note this is for testability per D-02 (one instance per process at runtime)
- Any deviations from PATTERNS.md (expected: none; sync-from-disk on first write is an addition documented above for cross-process counter consistency)
</output>
