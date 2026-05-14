---
phase: 21-audit-writer-foundation
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/audit/session-id.ts
  - tests/unit/core/audit/session-id.test.ts
autonomous: true
requirements:
  - AUDIT-02
  - AUDIT-03
tags:
  - audit
  - session-id
  - phase-21
must_haves:
  truths:
    - "First call without DBCLI_SESSION_ID env auto-generates an id matching /^\\d+-\\d+-[0-9a-f]{6}$/ and persists it to `.dbcli/last-session-id` (D-02 / success criterion 5)"
    - "Subsequent calls within the same process return the same cached id (AUDIT-03 / success criterion 5 second clause)"
    - "process.env.DBCLI_SESSION_ID takes precedence over any persisted file value (D-02)"
    - "When the persisted file's `pid` differs from `process.pid`, the service regenerates a new id and writes it back (D-13)"
    - "`.dbcli/last-session-id` is written atomically via tmp+rename so a crash mid-write cannot produce a half-file (analog: src/core/recovery/last-envelope.ts:78-85)"
    - "Write failures are silent (best-effort); the service still returns a valid id even if the file write fails (consistent with last-envelope pattern)"
  artifacts:
    - path: "src/core/audit/session-id.ts"
      provides: "SessionIdService class with `resolve(): Promise<string>`; module-level `readSessionIdFile` and `writeSessionIdFile` helpers; pure `generateSessionId` function"
      contains: "export class SessionIdService"
      min_lines: 60
    - path: "tests/unit/core/audit/session-id.test.ts"
      provides: "Unit tests for env precedence, in-process cache reuse, PID-mismatch regeneration, format regex, atomic write"
      contains: "SessionIdService"
  key_links:
    - from: "src/core/audit/session-id.ts (SessionIdService.resolve)"
      to: "process.env.DBCLI_SESSION_ID"
      via: "first-precedence env read"
      pattern: "process\\.env\\.DBCLI_SESSION_ID"
    - from: "src/core/audit/session-id.ts (SessionIdService.resolve)"
      to: ".dbcli/last-session-id"
      via: "atomic tmp+rename write of JSON { sessionId, pid, createdAt }"
      pattern: "last-session-id"
    - from: "src/core/audit/session-id.ts (generateSessionId)"
      to: "crypto.randomBytes"
      via: "6-char hex random suffix for collision resistance within same ms/pid"
      pattern: "randomBytes\\(3\\)"
---

<objective>
Build the `SessionIdService` module (`src/core/audit/session-id.ts`) — a stateful, class-based service that resolves the current `session_id` exactly once per process and persists it to `.dbcli/last-session-id` so future processes spawned by the same parent agent can pick up a continuation id when needed. The service is injected into `AuditLogger` (Plan 21-04) via constructor.

Purpose: Satisfy AUDIT-02 (env-first session id with `<pid>-<unix-ts>-<random>` fallback) and AUDIT-03 (in-process id reuse via the `.dbcli/last-session-id` file). Provide a tested, dependency-free building block that Wave-2 can compose without surprises.

Output: One new source file at `src/core/audit/session-id.ts`; one new test file at `tests/unit/core/audit/session-id.test.ts`; no changes to existing files.
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
<!-- Analog file: src/core/recovery/last-envelope.ts. The atomic write + tolerant read pattern is the same. -->

From src/core/recovery/last-envelope.ts (existing, lines 78-100 — atomic write + tolerant read):
```typescript
try {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tmp, target)
} catch {
  // Best-effort: writes are warnings, not errors.
}

// ...
try {
  await stat(target)
} catch {
  return null
}
try {
  const raw = await readFile(target, 'utf8')
  return JSON.parse(raw) as SavedRecoveryEnvelope
} catch {
  return null
}
```

Public contract this plan will export:
```typescript
// File path constant (relative to storage root)
export const LAST_SESSION_ID_RELATIVE = '.dbcli/last-session-id'

// Persisted JSON shape (D-13)
export interface PersistedSessionId {
  sessionId: string    // `${pid}-${unixTsMs}-${6charHex}`
  pid: number          // process.pid at write time
  createdAt: string    // ISO 8601 datetime
}

export class SessionIdService {
  constructor(storagePath: string)
  resolve(): Promise<string>     // env -> file (pid match) -> generate + persist
  reset(): void                  // test helper; clears in-memory cache
}

// Internal helpers (exported for unit test only)
export async function readSessionIdFile(storagePath: string): Promise<PersistedSessionId | null>
export async function writeSessionIdFile(storagePath: string, payload: PersistedSessionId): Promise<void>
export function generateSessionId(pid: number, nowMs: number): string  // pure function for testability
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement SessionIdService with env-first resolution, PID-stamped persistence, atomic write</name>
  <files>src/core/audit/session-id.ts, tests/unit/core/audit/session-id.test.ts</files>
  <read_first>
    - src/core/recovery/last-envelope.ts (full file — mirror the atomic write + tolerant read patterns at lines 63-100)
    - src/core/concurrent-lock.ts lines 16-25 (class constructor pattern with private fields + plain storagePath argument)
    - .planning/phases/21-audit-writer-foundation/21-PATTERNS.md section "NEW: src/core/audit/session-id.ts — `SessionIdService`" (the analog excerpts and class skeleton)
    - .planning/phases/21-audit-writer-foundation/21-CONTEXT.md decisions D-02, D-04, D-13, and the §specifics block on session-id format
    - AGENTS.md (Bun-first conventions: prefer node:fs/promises for file ops here since the analog uses it; do NOT switch to Bun.file for the atomic-write helper because the analog last-envelope.ts uses node:fs/promises)
  </read_first>
  <behavior>
    - Test 1 (env precedence): set `process.env.DBCLI_SESSION_ID = 'externally-injected-id-xyz'`; call `service.resolve()`; assert returned value === 'externally-injected-id-xyz' and `.dbcli/last-session-id` is NOT created (env path does not touch disk)
    - Test 2 (in-process cache, AUDIT-03): with env unset, call `service.resolve()` twice; assert both calls return the same string; assert exactly one write to `.dbcli/last-session-id` occurred (verify via file stat mtime or by spying / counting calls)
    - Test 3 (file reuse when pid matches): pre-write `.dbcli/last-session-id` with `{ sessionId: 'pid-match-id', pid: process.pid, createdAt: '2026-05-14T00:00:00.000Z' }`. Construct a fresh service, call `resolve()`. Assert returned id === 'pid-match-id' (no regeneration)
    - Test 4 (pid mismatch -> regenerate, D-13): pre-write `.dbcli/last-session-id` with `{ sessionId: 'old-id', pid: 999999, createdAt: '...' }` where 999999 ≠ process.pid. Construct fresh service, call `resolve()`. Assert returned id is NEW (≠ 'old-id') and matches the format regex; assert `.dbcli/last-session-id` is overwritten with new pid === process.pid
    - Test 5 (format regex): generate 50 ids via `generateSessionId(12345, 1747234567890)` style; assert each matches `/^\d+-\d+-[0-9a-f]{6}$/` AND each is unique (collision resistance check)
    - Test 6 (atomic write shape): trigger generation, then read raw `.dbcli/last-session-id`, parse as JSON, assert shape `{ sessionId: string, pid: number, createdAt: string-ISO }`
    - Test 7 (write failure is silent): point service at a read-only storage path (mkdir 0o555 in tmpdir), call resolve(); MUST still return a valid id (env fallback or generated) without throwing
  </behavior>
  <action>
    Create `src/core/audit/session-id.ts` with the following exact structure (use `node:fs/promises` for `mkdir`, `readFile`, `writeFile`, `rename`, `stat`; use `node:crypto` for `randomBytes`; use `node:path` for `join`, `dirname`):

    ```typescript
    /**
     * SessionIdService — resolves and persists the per-process audit session id.
     *
     * Decisions:
     * - D-02: DBCLI_SESSION_ID env wins; otherwise <pid>-<unix-ts-ms>-<6charHex>.
     * - D-04: independent module (not embedded in AuditLogger); constructor-injected.
     * - D-13: persisted JSON includes pid; mismatch -> regenerate.
     *
     * Storage path is the resolved storagePath (see src/core/config-binding.ts:64-67).
     * The persisted file lives at <storagePath>/.dbcli/last-session-id.
     * Atomic write follows src/core/recovery/last-envelope.ts:78-85.
     */
    import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
    import { randomBytes } from 'node:crypto'
    import { dirname, join } from 'node:path'

    export const LAST_SESSION_ID_RELATIVE = '.dbcli/last-session-id'

    export interface PersistedSessionId {
      sessionId: string
      pid: number
      createdAt: string
    }

    /** Pure generator — exported for testability (Test 5). */
    export function generateSessionId(pid: number, nowMs: number): string {
      const random = randomBytes(3).toString('hex')   // 6 hex chars, non-cryptographic
      return `${pid}-${nowMs}-${random}`
    }

    /** Tolerant read — returns null on any error (analog: last-envelope.readLastEnvelope). */
    export async function readSessionIdFile(
      storagePath: string
    ): Promise<PersistedSessionId | null> {
      const target = join(storagePath, LAST_SESSION_ID_RELATIVE)
      try {
        await stat(target)
      } catch {
        return null
      }
      try {
        const raw = await readFile(target, 'utf8')
        const parsed = JSON.parse(raw) as PersistedSessionId
        if (
          typeof parsed?.sessionId === 'string' &&
          typeof parsed?.pid === 'number' &&
          typeof parsed?.createdAt === 'string'
        ) {
          return parsed
        }
        return null
      } catch {
        return null
      }
    }

    /** Atomic write — best-effort (analog: last-envelope.writeLastEnvelope). */
    export async function writeSessionIdFile(
      storagePath: string,
      payload: PersistedSessionId
    ): Promise<void> {
      const target = join(storagePath, LAST_SESSION_ID_RELATIVE)
      const tmp = `${target}.tmp`
      try {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
        await rename(tmp, target)
      } catch {
        // Best-effort — caller still has a valid in-memory id.
      }
    }

    export class SessionIdService {
      private cached: string | null = null

      constructor(private readonly storagePath: string) {}

      async resolve(): Promise<string> {
        if (this.cached) return this.cached

        // 1. env wins (D-02)
        const fromEnv = process.env.DBCLI_SESSION_ID
        if (fromEnv && fromEnv.length > 0) {
          this.cached = fromEnv
          return fromEnv
        }

        // 2. persisted file with matching pid (D-13)
        const saved = await readSessionIdFile(this.storagePath)
        if (saved && saved.pid === process.pid) {
          this.cached = saved.sessionId
          return saved.sessionId
        }

        // 3. generate + persist
        const id = generateSessionId(process.pid, Date.now())
        await writeSessionIdFile(this.storagePath, {
          sessionId: id,
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })
        this.cached = id
        return id
      }

      /** Test helper — clears the in-memory cache so tests can simulate fresh processes. */
      reset(): void {
        this.cached = null
      }
    }
    ```

    Create `tests/unit/core/audit/session-id.test.ts` with seven test cases corresponding exactly to behavior Tests 1–7. Use:
    - `import { test, expect, beforeEach, afterEach } from 'bun:test'`
    - `mkdtemp` + `tmpdir()` for per-test isolated storage paths
    - Save and restore `process.env.DBCLI_SESSION_ID` around each test
    - For Test 7 (readonly), use `chmod(path, 0o555)` then restore with `chmod(path, 0o755)` in `afterEach` so cleanup works
    - Use a `mkdir` step to pre-create `.dbcli/` before pre-writing `last-session-id` in Test 3 / Test 4 fixtures

    Do NOT add any `kill(pid, 0)` liveness check (D-13 explicitly rejects it). Do NOT add any timestamp-freshness check.
  </action>
  <verify>
    <automated>bun test tests/unit/core/audit/session-id.test.ts 2>&1</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/core/audit/session-id.ts` succeeds
    - `grep -E "^export class SessionIdService" src/core/audit/session-id.ts` returns exactly one match
    - `grep -E "^export function generateSessionId" src/core/audit/session-id.ts` returns exactly one match
    - `grep -E "^export async function readSessionIdFile" src/core/audit/session-id.ts` returns exactly one match
    - `grep -E "^export async function writeSessionIdFile" src/core/audit/session-id.ts` returns exactly one match
    - `grep -E "process\\.env\\.DBCLI_SESSION_ID" src/core/audit/session-id.ts` returns exactly one match
    - `grep -E "randomBytes\\(3\\)\\.toString\\(['\"]hex['\"]\\)" src/core/audit/session-id.ts` returns exactly one match
    - `grep -E "saved\\.pid === process\\.pid" src/core/audit/session-id.ts` returns exactly one match
    - `grep -E "LAST_SESSION_ID_RELATIVE.*=.*\\.dbcli/last-session-id" src/core/audit/session-id.ts` returns exactly one match
    - `test -f tests/unit/core/audit/session-id.test.ts` succeeds
    - `bun test tests/unit/core/audit/session-id.test.ts` exits 0 with at least 7 passing tests
    - `bun run typecheck` exits 0
    - `grep -E "kill\\(.*0\\)" src/core/audit/session-id.ts` returns NO matches (D-13: no liveness check)
  </acceptance_criteria>
  <done>
    SessionIdService implemented per the exact code above; all seven test cases pass; typecheck clean; no liveness check present; atomic-write pattern mirrors last-envelope.ts.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `process.env.DBCLI_SESSION_ID` -> SessionIdService | Untrusted env value used as session id; no validation beyond non-empty check (audit ids are not security tokens) |
| `.dbcli/last-session-id` file -> SessionIdService.resolve | Untrusted JSON; tolerant parse (returns null on any failure, regenerates) |
| Filesystem -> writeSessionIdFile | Write may fail (readonly, full disk); must not throw |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-21-05 | Tampering | `.dbcli/last-session-id` malicious JSON (e.g. injected newlines, control chars) | accept | The id is metadata only; Phase 22+ entry schema will redact on read. Phase 21 stores it verbatim. Risk = low because Phase 21 has no rendering path. |
| T-21-06 | Spoofing | Attacker sets DBCLI_SESSION_ID to impersonate another agent's session | accept | session_id is observability metadata, not auth. D-02 explicitly trusts env. Documented as agent-cooperative, not adversarial. |
| T-21-07 | Information Disclosure | session id leaks pid + timestamp | accept | pid + ts are not secrets (visible in `ps`, file mtimes). Random 6-char hex is non-cryptographic anti-collision. |
| T-21-08 | DoS | Repeated process spawn with PID-mismatch regenerates file every time | mitigate | One write per process at most (cache after first resolve); regeneration happens once per new pid which is bounded by process spawn rate. |
| T-21-09 | Symlink attack | Attacker pre-creates `.dbcli/last-session-id` as a symlink to `/etc/passwd` | mitigate | Atomic tmp+rename writes to `<target>.tmp` first then rename; on POSIX rename replaces the symlink itself, not the target. Read path uses `readFile` which DOES follow symlinks — but we only JSON-parse and parse-fail returns null; no privileged action. |
| T-21-10 | Repudiation | Process crashes mid-write leaves `.dbcli/last-session-id.tmp` orphan | accept | Next resolve() ignores the .tmp file (only reads the target path); .tmp is harmless residue. Cleanup deferred to future tooling. |
</threat_model>

<verification>
- `bun test tests/unit/core/audit/session-id.test.ts` all green
- `bun run typecheck` clean
- `bun run lint` clean
- File-level grep checks listed in Task 1 acceptance criteria all match
</verification>

<success_criteria>
- AUDIT-02 satisfied: env-first resolution with `<pid>-<unix-ts-ms>-<6charHex>` fallback (Test 1 + Test 5)
- AUDIT-03 satisfied: in-process cache reuse + file persistence (Test 2 + Test 3)
- Roadmap success criterion 5 verified at module-level: first call without env auto-generates and persists; same-process subsequent calls reuse the cached id
- D-13 PID-mismatch regeneration verified (Test 4)
- Write-failure resilience (Test 7) prepares Plan 21-04 to inject this service without worrying about throws on resolve()
</success_criteria>

<output>
After completion, create `.planning/phases/21-audit-writer-foundation/21-02-SUMMARY.md` documenting:
- Public API surface (class + helpers + types)
- Format regex used for session ids
- Confirmation that no PID-liveness check (D-13) or timestamp-freshness check was added
- Test case names + count
- Atomic-write deviation from analog (expected: none — direct copy of last-envelope pattern)
</output>
