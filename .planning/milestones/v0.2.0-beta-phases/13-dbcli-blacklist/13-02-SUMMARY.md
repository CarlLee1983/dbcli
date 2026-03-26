---
phase: 13-dbcli-blacklist
plan: "02"
subsystem: cli-commands
tags: [blacklist, security, cli-wiring, tdd]
dependency_graph:
  requires:
    - "13-01: BlacklistManager, BlacklistValidator, QueryExecutor/DataExecutor integration"
  provides:
    - "CLI-level blacklist enforcement for query, insert, update, delete commands"
  affects:
    - "src/commands/query.ts"
    - "src/commands/insert.ts"
    - "src/commands/update.ts"
    - "src/commands/delete.ts"
tech_stack:
  added: []
  patterns:
    - "BlacklistManager + BlacklistValidator always constructed per invocation (manager handles undefined config gracefully)"
    - "BlacklistError caught before PermissionError in catch block — specific error handling"
    - "JSON error output for insert/update/delete BlacklistError; plain stderr for query BlacklistError"
key_files:
  created:
    - src/commands/query-blacklist-wiring.test.ts
    - src/commands/data-blacklist-wiring.test.ts
  modified:
    - src/commands/query.ts
    - src/commands/insert.ts
    - src/commands/update.ts
    - src/commands/delete.ts
decisions:
  - "Always construct BlacklistManager + BlacklistValidator even when config.blacklist is undefined (manager handles it gracefully, avoids conditional wiring logic)"
  - "BlacklistError handler placed BEFORE PermissionError handler for specificity"
  - "insert/update/delete use JSON error output format to match their normal output contract; query uses stderr (matches its error pattern)"
metrics:
  duration: "8 minutes"
  completed: "2026-03-26T08:17:00Z"
  tasks_completed: 2
  files_modified: 6
---

# Phase 13 Plan 02: CLI Blacklist Wiring Summary

**One-liner:** Wired BlacklistManager + BlacklistValidator into all four CLI execution commands (query, insert, update, delete) so blacklist configuration in .dbcli takes runtime effect.

## What Was Built

Plan 01 built the blacklist infrastructure (BlacklistManager, BlacklistValidator, QueryExecutor/DataExecutor integration) but none of the CLI command files constructed or passed the validator. This meant a blacklisted table was silently accessible from the command line.

Plan 02 closes this critical security gap with ~3 lines of change per file:
1. `src/commands/query.ts` — constructs BlacklistManager + BlacklistValidator, passes to QueryExecutor as 3rd arg, catches BlacklistError
2. `src/commands/insert.ts` — same pattern, passes to DataExecutor as 4th arg
3. `src/commands/update.ts` — same pattern
4. `src/commands/delete.ts` — same pattern (validator constructed after config load, before DataExecutor)

## Tasks Completed

### Task 1: Wire BlacklistValidator into queryCommand (TDD)

**Commit:** `931f995`

- Added imports: `BlacklistManager`, `BlacklistValidator`, `BlacklistError` to `query.ts`
- Added construction after adapter creation (step 3b)
- Changed `new QueryExecutor(adapter, config.permission)` to `new QueryExecutor(adapter, config.permission, blacklistValidator)`
- Added `BlacklistError` catch handler before `PermissionError` (prints `error.message` to stderr, exits 1)
- Test file: `src/commands/query-blacklist-wiring.test.ts` (4 tests)
  - Test 1: blacklisted table throws/exits with blacklist error message
  - Test 2: empty blacklist config allows operation
  - Test 3: undefined blacklist config does not throw
  - Test 4: validator is constructed and passed to QueryExecutor

### Task 2: Wire BlacklistValidator into insert, update, delete commands (TDD)

**Commit:** `7bff832`

- Added identical imports to `insert.ts`, `update.ts`, `delete.ts`
- Added construction before DataExecutor in each command
- Changed DataExecutor construction to include `blacklistValidator` as 4th arg
- Added `BlacklistError` catch handler before `PermissionError` in each command (JSON output + exit 1)
- Test file: `src/commands/data-blacklist-wiring.test.ts` (8 tests)
  - Tests 1-3: each command rejects blacklisted table with BlacklistError
  - Tests 1b/2b/3b: each command constructs and passes validator
  - Test 4: undefined blacklist config allows operations
  - Test 5: BlacklistError outputs JSON error object and exits 1

## Verification Results

```
# All blacklist wiring tests
12 pass, 0 fail (query-blacklist-wiring.test.ts + data-blacklist-wiring.test.ts)

# Full test suite
222 pass, 4 fail (4 failures are pre-existing: skill.test.ts x2, message-loader.test.ts x2)
```

All imports confirmed in all 4 command files.

All executor constructions confirmed to include validator as argument.

## Deviations from Plan

None - plan executed exactly as written.

The only notable decision: the plan specified "Important: The validator is ALWAYS constructed (even if blacklist config is empty/undefined)" and we followed that — no conditional `if (config.blacklist)` guards added.

## Known Stubs

None - all wiring is functional. BlacklistManager handles undefined `config.blacklist` internally, returning empty Set/Map state where all checks pass through.

## Self-Check: PASSED

Files created/modified:
- FOUND: src/commands/query-blacklist-wiring.test.ts
- FOUND: src/commands/data-blacklist-wiring.test.ts
- FOUND: src/commands/query.ts
- FOUND: src/commands/insert.ts
- FOUND: src/commands/update.ts
- FOUND: src/commands/delete.ts

Commits:
- FOUND: 931f995 (feat: wire BlacklistValidator into queryCommand)
- FOUND: 7bff832 (feat: wire BlacklistValidator into insert, update, delete commands)
