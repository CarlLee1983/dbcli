---
phase: 03
plan: 01
subsystem: Database Adapter Infrastructure
tags: [adapters, types, factory, error-handling, typescript]
dependency_graph:
  requires: [INIT-02 configuration system from Phase 2]
  provides: [DatabaseAdapter interface, AdapterFactory, error mapping]
  affects: [Phase 3 Plan 02 (adapter implementations), all query operations]
tech_stack:
  patterns: [Factory Pattern, Type-safe interfaces, Error categorization]
  added: [src/adapters/* module structure]
key_files:
  created:
    - src/adapters/types.ts (130 lines)
    - src/adapters/factory.ts (120 lines)
    - src/adapters/error-mapper.ts (102 lines)
    - src/adapters/index.ts (14 lines)
    - tests/unit/adapters/factory.test.ts (52 lines)
    - tests/unit/adapters/error-mapper.test.ts (86 lines)
decisions:
  - Used stub adapter implementations for Phase 3.01 to enable factory tests
  - Preserved ConnectionError class with instanceof support via prototype chain
  - All user-facing messages in Traditional Chinese (繁體中文)
metrics:
  duration: "~15 minutes"
  completed: "2026-03-25 07:55:30 UTC"
  tasks: "7/7 complete"
  test_count: "12 new (78 total suite, 0 fail)"
  build_status: "✓ Success"
---

# Phase 3 Plan 1: DB Connection - Adapter Infrastructure

Database adapter abstraction layer with type-safe interface, factory pattern, and comprehensive error mapping. This Wave 1 establishes the foundation for all Phase 3 subsequent tasks.

**One-liner:** Type-safe database adapter framework with system-aware instantiation, 5-category error mapping, and unit tests.

## Summary

Successfully created the complete database adapter infrastructure foundation:

- **DatabaseAdapter interface** with 6 core methods (connect, disconnect, execute, listTables, getTableSchema, testConnection)
- **AdapterFactory** implementing system-aware driver routing for PostgreSQL, MySQL, MariaDB
- **Error mapping system** categorizing 5 error types (ECONNREFUSED, ETIMEDOUT, AUTH_FAILED, ENOTFOUND, UNKNOWN) with Traditional Chinese user-friendly messages and actionable hints
- **Public API** (src/adapters/index.ts) providing clean single-source-of-truth exports
- **12 comprehensive unit tests** covering factory instantiation and error categorization

## Tasks Completed

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Define DatabaseAdapter interface and types | ✅ Complete | 458cdaf |
| 2 | Create AdapterFactory for system-aware instantiation | ✅ Complete | 93ae36e |
| 3 | Implement error-mapper with 5 error categories | ✅ Complete | b70763e |
| 4 | Create public exports in src/adapters/index.ts | ✅ Complete | e45c785 |
| 5 | Write unit tests for AdapterFactory | ✅ Complete | f1ec428 |
| 6 | Write unit tests for error-mapper | ✅ Complete | 792cab6 |
| 7 | Verify full test suite and types compile | ✅ Complete | (verified) |

## Verification Results

### TypeScript Compilation
```
✓ src/adapters/types.ts compiles successfully
✓ src/adapters/factory.ts compiles successfully
✓ src/adapters/error-mapper.ts compiles successfully
✓ src/adapters/index.ts compiles successfully
```

### Unit Tests
```
Adapter unit tests: 12 pass, 0 fail
- factory.test.ts: 5 tests pass
  ✓ createAdapter returns PostgreSQLAdapter for postgresql
  ✓ createAdapter returns MySQLAdapter for mysql
  ✓ createAdapter returns MySQLAdapter for mariadb
  ✓ createAdapter throws for unsupported system
  ✓ createAdapter preserves ConnectionOptions

- error-mapper.test.ts: 7 tests pass
  ✓ mapError categorizes ECONNREFUSED
  ✓ mapError categorizes ETIMEDOUT
  ✓ mapError categorizes AUTH_FAILED
  ✓ mapError categorizes ENOTFOUND
  ✓ mapError categorizes UNKNOWN
  ✓ ConnectionError has required properties
  ✓ mapError works for all database systems
```

### Full Test Suite
```
78 tests pass across 7 files
164 expect() calls executed
No regressions from Phase 2 tests
Execution time: 107ms
```

### Build Verification
```
✓ bun run build completes successfully
✓ dist/cli.mjs generated (0.99 MB)
✓ Shebang added and executable
✓ No build errors or warnings
```

## Error Categorization Matrix

All 5 error categories implemented with system-specific hints:

| Error Code | Trigger | Message | Hints | Example |
|------------|---------|---------|-------|---------|
| ECONNREFUSED | Connection refused | Server not running/port not listening | Service start, port verification, network reachability | `ping localhost` |
| ETIMEDOUT | Timeout exceeded | Firewall or network delay | Firewall rules, timeout config, network test | Increase `timeout` in .dbcli |
| AUTH_FAILED | Authentication failed | Invalid credentials | CLI verification, config files, re-run init | `psql -U user -h host` |
| ENOTFOUND | DNS resolution failed | Host not found | Check spelling, DNS resolution, IPv4/IPv6 | Try 127.0.0.1 instead of localhost |
| UNKNOWN | Any other error | Fallback message | Generic hints, server logs, direct driver test | Use `mysql` or `psql` CLI tools |

All messages and hints use Traditional Chinese (繁體中文) per CLAUDE.md requirement.

## Known Stubs

The following implementation stubs are intentional and will be completed in Phase 3 Plan 02:

### PostgreSQLAdapter (src/adapters/factory.ts, lines 13-41)
- Constructor accepts options but stores them for later use
- All methods (connect, disconnect, execute, listTables, getTableSchema, testConnection) have no-op implementations
- Stubs return empty arrays/true to allow unit tests to pass
- Will be replaced with Bun.sql implementation in Plan 02

### MySQLAdapter (src/adapters/factory.ts, lines 46-74)
- Similar stub structure to PostgreSQLAdapter
- Handles both MySQL and MariaDB systems (same driver)
- No-op implementations will be replaced with Bun.sql in Plan 02

**Reason for stubs:** Allows AdapterFactory unit tests to compile and verify routing logic without requiring full driver implementation. Factory tests confirm correct adapter instantiation before Plan 02 implements actual database connections.

## Implementation Notes

### Type Safety
- ConnectionError class properly extends Error with prototype chain for instanceof checks
- All adapter methods return Promise with correct generic types
- ConnectionOptions interface enforces system type literal union

### Error Mapping Strategy
- First match wins: errors checked in priority order (ECONNREFUSED → ETIMEDOUT → AUTH_FAILED → ENOTFOUND → UNKNOWN)
- Error code checked first (fast path), then message pattern matching (fallback)
- Hints include system-specific command examples with actual connection parameters
- Sensitive information (passwords) excluded from all messages

### Architecture Patterns
- **Factory Pattern:** AdapterFactory.createAdapter() centralizes adapter instantiation
- **Interface Segregation:** DatabaseAdapter defines minimal required interface
- **Error Object Pattern:** ConnectionError carries code, message, and hints for flexible error handling
- **Module Exports:** src/adapters/index.ts provides single source of truth for public API

## Next Phase Dependencies

Phase 3 Plan 02 will implement:
- PostgreSQLAdapter with Bun.sql driver integration
- MySQLAdapter with Bun.sql driver integration
- Integration tests with real/mock database connections
- Connection pooling strategy (if needed)
- Schema introspection queries (listTables, getTableSchema)

Current stub implementations allow Plan 02 to focus on actual driver integration without changing the adapter interface contract.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check Results

✅ All created files exist and are accessible
✅ All commits verified in git log
✅ TypeScript compilation successful for adapter files
✅ 12 unit tests all pass
✅ 78 total tests pass (no regressions)
✅ Build succeeds with dist/cli.mjs generated
