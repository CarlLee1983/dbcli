---
phase: 21
slug: audit-writer-foundation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-15
updated: 2026-05-15
---

# Phase 21 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| `.dbcli` config → audit writer | Local project config controls audit enablement and rotation thresholds. | Local config values; no credentials. |
| process env → `SessionIdService` | `DBCLI_SESSION_ID` may be injected by an agent/runtime and is trusted as observability metadata. | Session identifier; not auth. |
| `.dbcli/last-session-id` → process | Persisted JSON is read tolerantly and may be regenerated. | Local JSON metadata. |
| audit writer → filesystem | Writer appends JSONL, rotates files, and manages lockfiles under `.dbcli/audit/`. | Audit metadata only in Phase 21. |
| chmod/read-only fixtures → tests | Integration tests mutate permissions only in per-test temp directories. | Temp files and stderr warnings. |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation / Rationale | Status |
|-----------|----------|-----------|-------------|------------------------|--------|
| T-21-01 | Tampering | `.dbcli` audit.rotation values | mitigate | Zod `.int().positive()` rejects zero/negative/non-integer thresholds; config tests cover invalid values. | closed |
| T-21-02 | DoS | Extremely large rotation cap | accept | Accepted observability risk; large cap can grow files but does not allocate proportional memory or block main commands. | closed |
| T-21-03 | Information Disclosure | Audit accidentally defaulted off | mitigate | Config defaults force `audit.enabled=true`; tests verify V1/V2 defaults and migrations. | closed |
| T-21-04 | Repudiation | User disables audit | accept | Intentional D1 opt-out; audit is observability, not compliance enforcement. | closed |
| T-21-05 | Tampering | Malicious last-session-id JSON | accept | Metadata-only and no rendering path in Phase 21; parse failures regenerate. | closed |
| T-21-06 | Spoofing | Env-set session impersonation | accept | `DBCLI_SESSION_ID` is cooperative metadata, not authentication. | closed |
| T-21-07 | Information Disclosure | Session id leaks pid/timestamp | accept | PID/timestamp are local process metadata, not secrets. | closed |
| T-21-08 | DoS | Repeated PID mismatch rewrites session id | mitigate | `SessionIdService` caches per process; at most one write per process after first resolve. | closed |
| T-21-09 | Symlink attack | `.dbcli/last-session-id` symlink | mitigate | Atomic tmp+rename replaces target path; tolerant read only parses JSON and performs no privileged action. | closed |
| T-21-10 | Repudiation | Orphan `.tmp` after crash | accept | Orphan tmp is ignored by reads; cleanup deferred. | closed |
| T-21-11 | Tampering | Malformed lockfile blocks writes | mitigate | Parse errors fail soft; stale takeover removes old lockfiles; unit tests cover stale takeover. | closed |
| T-21-12 | DoS | Fresh lock held indefinitely | accept | Audit is fail-soft; 200ms budget skips audit write while main command continues. | closed |
| T-21-13 | Race condition | Non-atomic lock acquisition | mitigate | Strengthened beyond plan: lock acquisition now uses atomic `open(lockPath, 'wx')`; integration tests prove 100-write contention. | closed |
| T-21-14 | Symlink attack | Audit lock symlink | mitigate | Cleanup removes the symlink path; exclusive create replaces only the lock path when absent. No sensitive target is read/written. | closed |
| T-21-15 | Repudiation | Stale lock after crash | mitigate | `STALE_LOCK_MULTIPLIER=10` takeover path covered by unit test. | closed |
| T-21-16 | Tampering | Entry-supplied `session_id` override | mitigate | Logger writes `{ ...entry, session_id }`, so resolved session id wins; logger tests cover injection. | closed |
| T-21-17 | Information Disclosure | stderr warning includes filesystem details | accept | Operator-visible local warning, once per logger instance; same trust level as CLI stderr. | closed |
| T-21-18 | Path traversal | Crafted future `connectionName` | mitigate | Phase 21 has no user-facing audit CLI/engine wiring; current constructor is internal. Phase 23 must sanitize if user-controlled connection names are passed into AuditLogger. | closed |
| T-21-19 | DoS | Huge entry payload | accept | Phase 21 keeps writer opaque; rotation contains persisted file growth. Phase 22 schema will cap entry fields. | closed |
| T-21-20 | Symlink attack | Audit file symlink | mitigate | Storage path is user-controlled project state; no privilege escalation beyond local writer permissions. | closed |
| T-21-21 | Race condition | Separate in-memory counters | accept | One logger per process is the runtime contract; Plan 21-05 covers two-instance test scenario and writer queue reduces same-instance drift. | closed |
| T-21-22 | Information Disclosure | `lastError.message` filesystem internals | accept | Exposed only via future operator-run `audit health`; same trust level as CLI diagnostics. | closed |
| T-21-23 | Tampering | Readonly test leaves temp dir chmod 0555 | accept | Tempdir scoped to test; afterEach restores permissions; OS reaps leftovers. | closed |
| T-21-24 | Race condition | CI jitter lowers success count | mitigate | `successCount >= 95` retained; failure exposed real defects and now passes under release gate. | closed |
| T-21-25 | Information Disclosure | Test asserts full stderr path | accept | CI/developer logs have same trust level as local test execution. | closed |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-21-01 | T-21-02 | File may grow when user chooses an extremely large cap; audit remains fail-soft and local. | codex | 2026-05-15 |
| AR-21-02 | T-21-04 | `audit.enabled=false` is a deliberate opt-out, not an adversarial compliance control. | codex | 2026-05-15 |
| AR-21-03 | T-21-05 / T-21-06 / T-21-07 / T-21-10 | Session id is observability metadata; malformed/missing files regenerate and orphan tmp files are harmless. | codex | 2026-05-15 |
| AR-21-04 | T-21-12 / T-21-17 / T-21-22 | Audit failures and diagnostics must not block main dbcli commands; warnings/health are operator-visible local diagnostics. | codex | 2026-05-15 |
| AR-21-05 | T-21-19 / T-21-21 | Entry schema and broad engine integration are explicitly later phases; Phase 21 keeps writer opaque and fail-soft. | codex | 2026-05-15 |
| AR-21-06 | T-21-23 / T-21-25 | Test artifacts and stderr assertions are bounded to local tempdirs and developer/CI logs. | codex | 2026-05-15 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-15 | 25 | 25 | 0 | codex |

---

## Follow-up Directives

- Phase 22 must enforce entry-size and redaction constraints before engine integration.
- Phase 23 must revisit `connectionName` path safety if any user-controlled name flows into `AuditLogger` construction.
- Phase 23/24 should add true command/process-level audit coverage once CLI/engine hooks exist.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-15
