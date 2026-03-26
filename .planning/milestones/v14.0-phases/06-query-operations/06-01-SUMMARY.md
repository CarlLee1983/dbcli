---
phase: 06-query-operations
plan: 01
subsystem: query-operations
tags: [query-result-types, formatters, utilities, levenshtein, error-handling]
dependency_graph:
  requires: [Phase 4: Permission Model, Phase 5: Schema Discovery]
  provides: [QueryResult type interface, QueryResultFormatter class, Levenshtein distance utility, Error suggestion utility]
  affects: [Phase 06 Plan 02: Query command implementation]
tech_stack:
  added: [cli-table3 (for query result tables)]
  patterns: [OutputFormatter interface, Generic type handling, Dynamic programming]
key_files:
  created:
    - src/types/query.ts
    - src/formatters/query-result-formatter.ts
    - src/utils/levenshtein-distance.ts
    - src/utils/error-suggester.ts
    - tests/unit/formatters/query-result-formatter.test.ts
    - tests/unit/utils/levenshtein-distance.test.ts
    - tests/unit/utils/error-suggester.test.ts
  modified:
    - src/formatters/index.ts
decisions: []
metrics:
  duration: "~25 minutes"
  completed_date: "2026-03-25"
  tasks: 9
  commits: 9
  files_created: 7
  tests_added: 63
  build_status: "✅ Success (1.1 MB)"
---

# Phase 6 Plan 01: Query Result Types & Formatters Summary

**Query result types and formatting infrastructure for Phase 6 query command implementation.**

This plan establishes the foundational types and utilities needed for the `dbcli query` command: type definitions for query results, formatters for three output types (ASCII table, JSON, CSV), and error handling utilities for intelligent missing-table suggestions.

## Executed Tasks

| # | Task | Type | Status | Commit |
|----|------|------|--------|--------|
| 1 | Create QueryResult type definitions | auto | ✅ Complete | e4b30cd |
| 2 | Implement QueryResultFormatter (table/json/csv) | auto | ✅ Complete | cf98638 |
| 3 | Update formatters index exports | auto | ✅ Complete | 7e574e6 |
| 4 | Implement Levenshtein distance utility | auto | ✅ Complete | 22d459d |
| 5 | Implement error suggester utility | auto | ✅ Complete | 6b72201 |
| 6 | Unit tests: QueryResultFormatter (27 tests) | auto | ✅ Complete | 1d3885c |
| 7 | Unit tests: Levenshtein distance (17 tests) | auto | ✅ Complete | 627b034 |
| 8 | Unit tests: Error suggester (19 tests) | auto | ✅ Complete | 462765a |
| 9 | Full test suite & build verification | auto | ✅ Complete | be51ae0 |

## Artifacts

### Type Definitions (src/types/query.ts)
- **QueryResult<T>** — Generic interface for query results with rows, metadata, and column information
- **QueryMetadata** — Interface for SQL statement type, affected rows, and execution time
- **SqlStatementType** — Union type for SQL operation classification (SELECT, INSERT, UPDATE, DELETE, UNKNOWN)

### Query Result Formatter (src/formatters/query-result-formatter.ts)
- **QueryResultFormatter** — Implements OutputFormatter for three formats:
  - **Table format** — ASCII table via cli-table3 with headers, row data, and metadata footer (row count, execution time)
  - **JSON format** — Structured output with full metadata for AI parsing (compact/non-compact modes)
  - **CSV format** — RFC 4180 compliant with proper escaping (commas, quotes, newlines)
- Methods:
  - `format(result, options)` — Main entry point dispatching to format-specific implementations
  - `formatTable()` — Creates ASCII table with metadata footer
  - `formatJSON()` — Serializes result to JSON with optional spacing
  - `formatCSV()` — RFC 4180 CSV with proper cell escaping

### Levenshtein Distance Utility (src/utils/levenshtein-distance.ts)
- **levenshteinDistance(a: string, b: string)** — Computes minimum edit distance
  - Used for intelligent error suggestions (table name typos)
  - Dynamic programming implementation O(n*m) time/space
  - Handles insertions, deletions, substitutions
  - Example: `levenshteinDistance('users', 'usrs')` returns 1

### Error Suggester Utility (src/utils/error-suggester.ts)
- **suggestTableName(errorMessage, adapter)** — Analyzes error and suggests similar table names
  - Extracts table name from PostgreSQL/MySQL error messages using regex
  - Queries database for available tables
  - Computes Levenshtein distances and filters by threshold (< 3)
  - Returns up to 3 suggestions sorted by distance
  - Gracefully handles adapter failures
- **ErrorSuggestion** — Interface with suggestions[] and tables[] arrays

### Index Updates (src/formatters/index.ts)
- Added export for QueryResultFormatter
- Maintains existing exports (TableFormatter, JSONFormatter, TableListFormatter)

## Test Coverage

### QueryResultFormatter Tests (27 tests)
- **Table format** — Headers, data rows, empty results, null handling, execution time footer
- **JSON format** — Valid JSON, compact mode, metadata preservation, null values
- **CSV format** — RFC 4180 escaping (commas, quotes, newlines), headers, empty results, numbers
- **Edge cases** — Unicode, large numbers, boolean values, JSON objects, many columns/rows

### Levenshtein Distance Tests (17 tests)
- **Basic** — Identical strings, empty strings, single operations (delete, substitute, insert)
- **Classic** — 'kitten' → 'sitting' = 3 edits
- **Properties** — Symmetry, case-sensitivity, multiple operations
- **Database scenarios** — Common table name typos (customers → customres, orders → order)

### Error Suggester Tests (19 tests)
- **Extraction** — PostgreSQL "relation" format, MySQL "table" format, various quote styles
- **Suggestions** — Single match, multiple matches, distance filtering, sorting by distance
- **Edge cases** — No matches found, empty tables, adapter failures, case-insensitive matching
- **Mock adapter** — Full DatabaseAdapter implementation for test isolation

## Test Results

```
Total tests: 221 (+ 63 new tests)
Pass rate: 100% (0 failures)
Test file breakdown:
  - QueryResultFormatter: 27 pass
  - Levenshtein distance: 17 pass
  - Error suggester: 19 pass
  - All other unit tests: 158 pass
```

## Build & Compilation

- **TypeScript check** — ✅ 0 errors (new code fully type-safe)
- **Build output** — ✅ dist/cli.mjs (1.1 MB, up from 978 KB in Phase 5)
- **Build time** — 34 ms
- **No regressions** — All Phase 5 tests still passing

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all implementations complete and tested.

## Integration Notes

These utilities are ready for Phase 6 Plan 02 (Query command implementation):
- QueryResult type is generic and extensible for any query data
- QueryResultFormatter supports three formats; command can expose via `--format` flag
- levenshteinDistance is pure and stateless; suitable for CLI error handling
- suggestTableName is async and handles adapter failures; fits CLI command pattern

No external dependencies added beyond existing cli-table3.

## Self-Check

- ✅ QueryResult interface exists in src/types/query.ts
- ✅ QueryResultFormatter class exists with table/json/csv methods
- ✅ levenshteinDistance function properly implemented
- ✅ suggestTableName function with error extraction and filtering
- ✅ All 63 new tests pass (27 formatter + 17 distance + 19 suggester)
- ✅ TypeScript compilation successful (0 errors in new code)
- ✅ Build completes successfully (dist/cli.mjs 1.1 MB)
- ✅ All 9 tasks committed atomically
