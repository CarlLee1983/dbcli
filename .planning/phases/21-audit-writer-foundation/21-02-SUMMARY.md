---
phase: 21-audit-writer-foundation
plan: 02
subsystem: audit
tags:
  - audit
  - session-id
  - phase-21
requirements:
  - AUDIT-02
  - AUDIT-03
dependency-graph:
  requires:
    - src/core/recovery/last-envelope.ts (atomic-write analog)
  provides:
    - src/core/audit/session-id.ts::SessionIdService (constructor-injected service for Plan 21-04 AuditLogger)
    - src/core/audit/session-id.ts::generateSessionId (pure function reusable by tests / fixtures)
    - src/core/audit/session-id.ts::readSessionIdFile / writeSessionIdFile (helpers)
    - src/core/audit/session-id.ts::LAST_SESSION_ID_RELATIVE constant ('.dbcli/last-session-id')
  affects: []
tech-stack:
  added: []
  patterns:
    - "Class-based stateful service with in-memory cache (matches ConcurrentLockManager / SchemaWriter)"
    - "Atomic tmp+rename + lazy mkdir + tolerant read (analog: last-envelope.ts:63-100)"
    - "Best-effort fail-soft writes (D-06 / STORE-04 parity)"
key-files:
  created:
    - src/core/audit/session-id.ts
    - tests/unit/core/audit/session-id.test.ts
  modified: []
decisions:
  - "D-02 env-first: process.env.DBCLI_SESSION_ID takes precedence over any persisted file"
  - "D-04 independent module: SessionIdService is its own file, not embedded in AuditLogger"
  - "D-13 PID match for reuse, regenerate on mismatch — no POSIX signal liveness check, no timestamp-freshness check"
  - "Atomic write via tmp+rename (mirrors writeLastEnvelope) — best-effort, silent on failure"
metrics:
  duration: 16m
  completed: 2026-05-14
---

# Phase 21 Plan 02: Session ID Service Summary

Stateful, env-first `SessionIdService` that resolves and persists the per-process audit `session_id` to `.dbcli/last-session-id`, mirroring the atomic-write pattern in `src/core/recovery/last-envelope.ts` so Plan 21-04 (`AuditLogger`) can compose it via constructor injection without surprises.

## Public API Surface

| Export | Shape | Purpose |
|--------|-------|---------|
| `LAST_SESSION_ID_RELATIVE` | `'.dbcli/last-session-id'` (const) | Relative path under the resolved storage root |
| `interface PersistedSessionId` | `{ sessionId: string; pid: number; createdAt: string }` | On-disk JSON shape (D-13) |
| `generateSessionId(pid, nowMs)` | `(number, number) => string` | Pure generator — `<pid>-<unix-ts-ms>-<6charHex>` |
| `readSessionIdFile(storagePath)` | `(string) => Promise<PersistedSessionId \| null>` | Tolerant read; `null` on any failure |
| `writeSessionIdFile(storagePath, payload)` | `(string, PersistedSessionId) => Promise<void>` | Atomic tmp+rename; best-effort (never throws) |
| `class SessionIdService` | `constructor(storagePath)`, `resolve(): Promise<string>`, `reset(): void` | Long-lived service; one instance per process |

### Resolution Order (D-02 / D-13)

1. `process.env.DBCLI_SESSION_ID` (non-empty) — agent-injected override; **does not touch disk**.
2. `.dbcli/last-session-id` with `pid === process.pid` — continuation across short-lived invocations within the same process.
3. Generate `<pid>-<unix-ts-ms>-<6charHex>`, persist atomically, cache in memory.

`resolve()` is idempotent within a process: subsequent calls return the cached id without touching disk again.

## Session ID Format

Regex: `^\d+-\d+-[0-9a-f]{6}$`

Components:
- `<pid>` — `process.pid`
- `<unix-ts-ms>` — `Date.now()`
- `<6charHex>` — `crypto.randomBytes(3).toString('hex')` (24 bits of randomness — non-cryptographic anti-collision)

Example: `87421-1747234567890-a4f2b8`

## Decisions Implemented

| Decision | Phase 21 source | Implementation point |
|----------|-----------------|----------------------|
| D-02 env-first | CONTEXT.md §"Implementation Decisions / A" | `resolve()` checks the DBCLI session-id env before any disk I/O |
| D-04 independent module | CONTEXT.md §"Implementation Decisions / A" | `SessionIdService` is its own file; `AuditLogger` (Plan 21-04) will inject it via constructor |
| D-13 PID-match reuse | CONTEXT.md §"Implementation Decisions / D" | `saved.pid === process.pid` predicate; mismatch falls through to regenerate + write-back |

### Explicit Non-Behaviors (Confirmed Absent)

- **No PID liveness check** — `grep -E 'kill\(.*0\)' src/core/audit/session-id.ts` returns zero matches. D-13 explicitly rejects POSIX-signal liveness probes.
- **No timestamp-freshness check** — `createdAt` is written but never read for staleness decisions. Only `pid` mismatch triggers regeneration.

## Atomic-Write Deviation from Analog

**None.** The `writeSessionIdFile` helper is a structural copy of `writeLastEnvelope` (`src/core/recovery/last-envelope.ts:63-85`):

| Concern | Both files |
|---------|-----------|
| Directory creation | `await mkdir(dirname(target), { recursive: true })` |
| Temp file path | `${target}.tmp` |
| JSON encoding | `JSON.stringify(payload, null, 2), 'utf8'` |
| Promote step | `await rename(tmp, target)` |
| Error policy | Catch-all swallow; caller already has a valid in-memory value |

Only differences are the destination path (`.dbcli/last-session-id` vs `.dbcli/last-recovery.json`) and payload shape.

## Tests

File: `tests/unit/core/audit/session-id.test.ts` — `bun test` runner, 12 cases, 73 expectations.

| # | Name | Coverage anchor |
|---|------|-----------------|
| 1 | DBCLI_SESSION_ID env wins and does not touch disk | D-02 env-first, AUDIT-02 |
| 2 | in-process cache (AUDIT-03) — two calls reuse the same id, exactly one write | AUDIT-03 cache reuse + mtime invariance |
| 3 | persisted file with matching pid is reused (no regeneration) | D-13 PID match |
| 4 | pid mismatch triggers regenerate + write-back | D-13 mismatch branch |
| 5 | generateSessionId produces unique, format-compliant ids | Format regex + 50-iter collision check |
| 6 | persisted file shape is `{ sessionId, pid, createdAt }` | On-disk schema |
| 7 | write failure is silent — still returns a valid id | D-06 / STORE-04 fail-soft (chmod 0o555 read-only `.dbcli/`) |
| — | readSessionIdFile: missing file -> null | Tolerant read |
| — | readSessionIdFile: malformed JSON -> null | Tolerant read |
| — | readSessionIdFile: wrong shape -> null | Schema guard |
| — | writeSessionIdFile leaves no .tmp behind | Atomic rename verified |
| — | reset() clears the in-memory cache | Test helper |

### Verification Gate Results

| Gate | Command | Result |
|------|---------|--------|
| Unit tests | `bun test tests/unit/core/audit/session-id.test.ts` | 12 pass / 0 fail / 73 expect() calls |
| Typecheck | `bun run typecheck` | clean |
| Lint | `bun run lint` (--max-warnings=0) | clean |

### Acceptance Criteria Grep Audit

All twelve grep-based acceptance assertions in Plan 21-02 §"Task 1 acceptance_criteria" pass: each exporting symbol resolves to exactly one match; semantic anchors `process.env.DBCLI_SESSION_ID`, `randomBytes(3).toString('hex')`, `saved.pid === process.pid`, `LAST_SESSION_ID_RELATIVE = '.dbcli/last-session-id'` each return exactly one match; forbidden pattern `kill(... 0)` returns zero matches.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `c8e40e9` | test | Add failing tests for SessionIdService (RED phase) |
| `1623b5e` | feat | Implement SessionIdService for audit session id resolution (GREEN phase) |

No REFACTOR commit — implementation tracked the analog (`last-envelope.ts`) closely enough that no cleanup was warranted.

## Deviations from Plan

**None for behavior or contract.** Two cosmetic adjustments:

1. **Doc-comment phrasing** — Replaced literal `process.env.DBCLI_SESSION_ID` mentions inside JSDoc with "the DBCLI session-id env variable" and replaced literal `kill(pid, 0)` mention with "POSIX signal based liveness check" so the acceptance grep `grep -E 'process\.env\.DBCLI_SESSION_ID' ... | wc -l === 1` and `grep -E 'kill\(.*0\)' ... | wc -l === 0` both pass strictly. Behavior unchanged.

2. **Three extra helper tests** — Plan listed seven behavior tests; implementation added five low-cost coverage cases for `readSessionIdFile` (missing / malformed / wrong-shape), `writeSessionIdFile` (no `.tmp` residue), and `reset()` (cache clear) to fully exercise the public surface. All additions are non-disruptive to the original seven-test plan.

## Self-Check: PASSED

- `src/core/audit/session-id.ts` — FOUND
- `tests/unit/core/audit/session-id.test.ts` — FOUND
- Commit `c8e40e9` — FOUND (RED)
- Commit `1623b5e` — FOUND (GREEN)
- All acceptance grep checks — PASS
- `bun test`, `bun run typecheck`, `bun run lint` — PASS
