---
phase: 04
plan: 01
subsystem: Permission Model - SQL Classifier & Enforcement
tags: [permissions, sql-classification, permission-guard, coarse-grained-access, statement-classification]
dependency_graph:
  requires: [Phase 2 init (permission type in config), Phase 3 adapters (connection infrastructure)]
  provides: [PermissionGuard module with SQL classification and enforcement]
  affects: [Phase 5 schema discovery, Phase 6 query operations, Phase 7 data modification]
tech_stack:
  patterns: [SQL keyword detection, character state machine for comment/string stripping, permission capability matrix, outer keyword detection for CTEs]
  added: [PermissionGuard module, SQL statement classifier, permission enforcement engine]
key_files:
  created:
    - src/core/permission-guard.ts (451 lines)
    - tests/unit/core/permission-guard.test.ts (82 test cases)
decisions:
  - Lightweight regex + keyword detection instead of full SQL parser (reduces bundle size, improves startup)
  - Character state machine for comment/string handling (more reliable than regex for escapes)
  - Outer keyword determines classification for CTE/subquery/UNION (security principle)
  - Default-deny approach when confidence is LOW (safe for permission checking)
  - Three permission levels: query-only (SELECT/SHOW/DESCRIBE/EXPLAIN), read-write (+INSERT/UPDATE), admin (all operations)
metrics:
  duration: "~25 minutes"
  tasks_completed: 4
  test_count: "82 unit tests (all passing), +145 total unit tests"
  build_status: "✓ Success (no TypeScript errors)"
  line_count: "451 lines in permission-guard.ts (exceeds 350 requirement)"
---

# Phase 4 Plan 1: Permission Model - SQL Classifier & Enforcement

## Implementation Summary

Successfully implemented a complete permission guard module for dbcli with SQL statement classification and permission enforcement. The system uses a lightweight, efficient approach based on keyword detection and a character state machine for handling comments and string literals.

### Core Components

**1. SQL Classifier Module** (`src/core/permission-guard.ts`)
- `normalizeSQL()`: Removes comments and compresses whitespace using regex
- `stripCommentsAndStrings()`: Character-by-character state machine handles line comments (--), block comments (/* */), and string literals ('...', "...") with escape sequence support
- `detectCompositePatterns()`: Identifies CTE (WITH), subqueries, and UNION patterns
- `extractFirstKeyword()`: Extracts first SQL keyword, with special handling for CTE outer operations
- `mapKeywordToType()`: Maps keywords to StatementType enum
- `isDestructiveOperation()`: Identifies DELETE, DROP, ALTER, TRUNCATE, CREATE operations
- `extractAllKeywords()`: Returns all keywords found (deduplicated, sorted)
- `determineConfidence()`: Assigns confidence levels (HIGH/MEDIUM/LOW) based on operation type

**2. Permission Enforcement Engine**
- `classifyStatement()`: Main classification function combining all helper functions
- `checkPermission()`: Validates statement against permission level, returns structured result
- `enforcePermission()`: Throws PermissionError when operation denied
- `PermissionError` class: Extends Error with classification and required permission details

**3. Permission Capability Matrix**
```
Query-only:   SELECT, SHOW, DESCRIBE, EXPLAIN
Read-Write:   +INSERT, +UPDATE
Admin:        All operations (no restrictions)
```

### Test Coverage

**82 unit tests** covering:
- Basic statement classification (15 tests)
  - SELECT, INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, SHOW, DESCRIBE, EXPLAIN
  - Case-insensitivity, empty strings, whitespace-only inputs

- Comment and string handling (10 tests)
  - Line comments (--), block comments (/* */), escaped quotes (\'), mixed cases
  - Keywords hidden in comments or strings are correctly ignored

- Composite patterns (8 tests)
  - CTE (WITH ... SELECT/DELETE), subqueries, UNION statements
  - Confirms outer keyword determines operation type (not inner patterns)

- Parameterized queries (5 tests)
  - PostgreSQL style ($1, $2), MySQL style (?)
  - Placeholders correctly stripped before classification

- Permission enforcement (26 tests)
  - Query-only: 8 tests (4 allowed, 4 blocked)
  - Read-Write: 11 tests (6 allowed, 5 blocked)
  - Admin: 8 tests (all operations allowed)

- Error handling and edge cases (18 tests)
  - PermissionError properties, message clarity
  - Very long statements, Unicode characters
  - Integration scenarios with mixed features

### Security Features

1. **Comment Stripping**: Comments are removed before keyword extraction, preventing:
   - `-- DELETE FROM users\nSELECT ...` (classified as SELECT)
   - `/* DELETE FROM users */ INSERT ...` (classified as INSERT)

2. **String Literal Handling**: String contents are stripped, preventing:
   - `INSERT VALUES ('DELETE FROM users')` (classified as INSERT, not DELETE)
   - `'It\'s a test'` (escaped quotes handled correctly)

3. **CTE Detection**: Outer operation determines safety:
   - `WITH cte AS (...) DELETE ...` (classified as DELETE, dangerous)
   - `WITH cte AS (...) SELECT ...` (classified as SELECT, safe)

4. **Parameterized Query Support**: Works with both database driver conventions:
   - PostgreSQL: `WHERE id = $1` → stripped before analysis
   - MySQL: `WHERE id = ?` → stripped before analysis

### Code Quality

- **451 lines** of well-documented TypeScript (exceeds 350 minimum)
- **Immutability**: All functions return new objects, never mutate input
- **Error handling**: Proper prototype chain for instanceof checks
- **Type safety**: Full TypeScript with exported interfaces and types
- **No dependencies**: Uses only built-in JavaScript functionality

### Integration Points

The module is ready for use in:
- **Phase 5** (Schema Discovery): No direct dependency
- **Phase 6** (Query Operations): `enforcePermission()` in query command handler
- **Phase 7** (Data Modification): `enforcePermission()` in insert/update/delete handlers

### Test Results

```
Unit Tests:  145 pass, 0 fail
  - permission-guard: 82 pass
  - config: 19 pass
  - adapters: 23 pass
  - error-mapper: 18 pass
  - env-parser: 3 pass

Build: ✓ Success
  - No TypeScript errors
  - dist/cli.mjs generated successfully (1.00 MB)
  - All imports resolved correctly
```

### Known Limitations

1. **SQL Dialect Variations**: Implementation assumes standard SQL syntax. Vendor-specific keywords (PostgreSQL VACUUM, MySQL OPTIMIZE) are classified as UNKNOWN with LOW confidence.

2. **Confidence Levels**: Unknown operation types default to deny in restricted modes. Users can upgrade to admin mode if needed.

3. **Not a Full Parser**: Deliberately lightweight for CLI use. Complex nested SQL structures are handled by outer keyword rule, not deep parsing.

## Compliance with Requirements

**INIT-05** (Coarse-grained permission model):
- ✅ Query-only mode: Only SELECT, SHOW, DESCRIBE, EXPLAIN allowed
- ✅ Read-Write mode: +INSERT, +UPDATE allowed
- ✅ Admin mode: All operations allowed
- ✅ Clear error messages when operations blocked
- ✅ Works with CTE, subqueries, and edge cases

## Files Modified

| File | Type | Change |
|------|------|--------|
| `src/core/permission-guard.ts` | Created | 451 lines - complete permission guard module |
| `tests/unit/core/permission-guard.test.ts` | Created | 82 test cases covering all scenarios |
| `dist/cli.mjs` | Modified | Rebuilt with new module (1.00 MB, no size increase from permission guard) |

## Commits

1. `6042d76` - SQL classifier implementation (normalizeSQL, stripCommentsAndStrings, keyword extraction)
2. `87d6cca` - Permission enforcement + 82 unit tests + integration fixes

---

## Next Steps

**Phase 5** will integrate this module into schema discovery commands to prepare database metadata for safe access. No code changes needed in permission-guard module - it's ready for downstream usage.
