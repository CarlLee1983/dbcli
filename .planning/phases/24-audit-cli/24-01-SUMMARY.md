---
phase: 24-audit-cli
plan: 01
status: complete
completed: 2026-05-15
---

# Plan 24-01 Summary — Audit Reader Module

## Objective

Build Phase 24's read-only foundation: a stateless, lockless, redaction-free
functional module that reads `.dbcli/audit/<conn>.jsonl` (and rotated `.jsonl.1`)
files into typed `AuditEntry[]` for Wave 2/3 commander handlers.

## What Was Built

`src/core/audit/reader.ts` (4 functional exports + 1 interface):

| Export | Signature | Behavior |
|---|---|---|
| `ReadOptions` | `{ include_rotated?: boolean }` | Toggle to prepend rotated `.1` entries |
| `readEntries` | `(file, opts?) → Promise<AuditEntry[]>` | Tolerant to truncated last line (D-08); hard-fails on middle-line corruption (T-24-04); ENOENT → `[]` |
| `discoverConnections` | `(auditDir) → Promise<{connection, files}[]>` | Scans audit dir; basename-derives connection name (D-44); excludes `.lock`; rotated-first file ordering; connection-name lex sort |
| `tailEntries` | `(entries, n) → AuditEntry[]` | Sort `ts.localeCompare` ascending then `slice(-n)`; `n<=0` → `[]` |
| `mergeByTimestamp` | `(Map<conn, entries>) → {connection, entry}[]` | Primary `ts` asc, secondary connection-name asc tie-break (D-42); envelope shape |

## Truncation vs Hard-Fail Behavior

| Condition | Behavior | Reason |
|---|---|---|
| Last line truncated (no closing `}`) | Skip + `process.stderr.write('[dbcli audit] skipping truncated last line in <path>\n')`; return parsed N-1 entries | D-08 cost: writer uses `appendFile` without fsync, so a process kill mid-write can leave a partial last line. Reader must not fail the whole tail for this. |
| Middle line not parseable | `throw new Error('[dbcli audit] corrupted line N in <path>. Run `dbcli audit clear` to reset.')` | T-24-04: middle corruption indicates external tampering or disk damage; silent skip would let cherry-picked deletions hide. Hint points user to the only safe recovery. |

## Discovery Rules

- Glob: `*.jsonl` and `*.jsonl.1` only — `.lock`, `.tmp`, anything else excluded
- Basename: strip `.jsonl` or `.jsonl.1` to derive connection name
- Files within a connection: sorted so `.jsonl.1` (rotated) appears before `.jsonl` (current)
- Top-level: connections sorted ascending by name (deterministic CLI output)

## Merge Tie-Break

`mergeByTimestamp` flattens `Map<conn, AuditEntry[]>` into `{connection, entry}[]`:
- Primary sort: `entry.ts.localeCompare(other.ts)` ascending (oldest first, latest last per D-5)
- Secondary tie-break (same `ts`): connection name lexicographic ascending — deterministic, agent-predictable (D-42)

## Hand-Off to Waves 2/3

Commander handlers (in 24-03 / 24-04) will call:

| Use Case | Call Sequence |
|---|---|
| Single-conn `tail` | `readEntries(file, { include_rotated: true })` → `tailEntries(entries, n)` |
| `tail --all` | `discoverConnections(dir)` → for each conn `readEntries(files[i], …)` → `mergeByTimestamp(byConn)` → `slice(-n)` |
| `show <id-or-prefix>` | `readEntries(file, { include_rotated: true })` → caller does prefix match |
| `show --all <id>` | `discoverConnections(dir)` → for each conn read → cross-file prefix match → return `{ connection, entry }` envelope |

## Constraints Held

- No `appendFile`, `AuditLockManager`, `SessionIdService`, `randomUUID`, `writeAuditEntry` (grep-asserted, T-24-02 mitigation: reader cannot accidentally open a write path)
- No `redactArgv`, `redactSql`, `redactSensitive` (entries are pre-redacted by Phase 22 D-22; reader must not duplicate the rule and create a second source of truth)
- No `'.dbcli'` literal — caller (commander handler) owns path resolution; reader only consumes the full file path

## Key Files

- **Created:** `src/core/audit/reader.ts` (120 lines, 5 exports)
- **Created:** `tests/unit/core/audit/reader.test.ts` (16 tests, 4 describe blocks)

## Verification

| Check | Result |
|---|---|
| `bun run typecheck` | PASS |
| `bun run lint --max-warnings=0` | PASS |
| `bun test tests/unit/core/audit/reader.test.ts` | 16 pass / 0 fail / 31 expect() |
| Acceptance grep: 4 named exports | 4 |
| Acceptance grep: no writer deps | 0 matches |
| Acceptance grep: no redaction | 0 matches |
| Acceptance grep: no `.dbcli` literal in reader | 0 matches |
| Acceptance grep: truncation warn text | found |
| Acceptance grep: hard-fail hint text | found |
| Acceptance grep: ≥12 tests | 16 |

## Self-Check: PASSED

All `must_haves.truths` (7) verified by unit tests; all acceptance criteria green; T-24-02 and T-24-04 mitigations grep-asserted at module boundary.

## Deviations

None. Implementation matches plan spec exactly.

## Commit

`690fc57 feat: [24-01] add audit reader functional module + unit tests`
