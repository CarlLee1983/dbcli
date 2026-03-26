# Phase 6: Query Operations - Research

**Researched:** 2026-03-25
**Domain:** SQL query execution, structured output formatting, error handling
**Confidence:** HIGH

## Summary

Phase 6 implements the `dbcli query` command—the core AI agent interaction point. This phase builds directly on Phases 3-5 (DB connection, permissions, schema discovery) and leverages existing infrastructure for permission enforcement and output formatting.

The domain is well-researched: Bun's SQL API is stable for query execution, CLI output formatting patterns are established from Phase 5, and permission guard implementation is complete. The primary work is integrating these components into a cohesive query command with three output formats (table, JSON, CSV) and intelligent error handling (missing table suggestions, syntax hints).

**Primary recommendation:** Implement `dbcli query` as a multi-part phase: (Wave 1) CSV formatter + result metadata module, (Wave 2) query command with permission checks and error handling, (Wave 3) comprehensive tests covering all output formats and error cases.

## User Constraints

No prior CONTEXT.md found. All research performed under standard discretion.

## Standard Stack

### Core Dependencies
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun.sql | native | SQL query execution (PostgreSQL, MySQL) | Zero-dependency, unified API across database systems; already verified in Phase 3 |
| cli-table3 | 0.6.5 | Table formatting for human-readable output | Proven table rendering; already used in Phase 5 table-formatter |
| zod | 3.22.4 | Output format validation | Type-safe result structure validation; aligns with project validation patterns |

### Output Formatting
| Format | Handler | Purpose | Best For |
|--------|---------|---------|----------|
| Table (ASCII) | cli-table3 (existing) | Human-readable results | Terminal operators, debugging |
| JSON | native JSON.stringify | Structured machine parsing | AI agents, tool composition |
| CSV | hand-rolled implementation (no external deps) | Data export, spreadsheet import | Excel/Sheets integration, data pipeline |

### No External Dependencies for CSV
CSV formatting is a simple hand-rolled implementation (quoted fields, escaped commas, header row). Do NOT add `csv-stringify` or `papaparse`:
- Phase 6 needs only basic CSV output (quote strings, escape commas/quotes)
- External dependency overhead exceeds complexity benefit
- Aligns with project philosophy: minimize dependencies, prioritize Bun native APIs
- CSV specification (RFC 4180) is straightforward to implement in 30-40 lines of TypeScript

**Installation:** No new dependencies required—build on existing stack.

## Architecture Patterns

### Query Execution Flow
```
1. Parse --format option (table|json|csv)
2. Load config from .dbcli
3. Create adapter
4. Connect to database
5. Classify SQL statement → Permission guard
6. Execute query with Bun.sql
7. Collect results into array
8. Format output (table|json|csv)
9. Print with metadata (row count, execution time)
10. Disconnect
```

### Result Metadata Structure
Query results require consistent metadata for AI parsing:

```typescript
interface QueryResult<T> {
  rows: T[]                    // Array of result rows
  rowCount: number             // Total rows returned
  columnNames: string[]        // Column names in order
  columnTypes?: string[]       // Column data types (for AI type hints)
  executionTimeMs?: number     // Query execution time
  metadata?: {
    statement: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' // Classified operation
    affectedRows?: number       // For INSERT/UPDATE/DELETE operations
  }
}
```

### Output Formatter Pattern (Established in Phase 5)
Extend existing formatter interface:

```typescript
// Existing pattern (re-use)
export interface OutputFormatter<T> {
  format(data: T, options?: { compact?: boolean }): string
}

// New: Query result formatter
export class QueryResultFormatter implements OutputFormatter<QueryResult<Record<string, any>>> {
  format(result: QueryResult, options?: FormatterOptions): string {
    // Table: cli-table3 with column names + types
    // JSON: metadata + rows
    // CSV: header row + quoted values
  }
}
```

### Error Handling for Query Operations

**Error Categories:**
1. **SQL Syntax Errors** → Parse error message, suggest common fixes
2. **Missing Table** → Extract table name, query schema, suggest similar names
3. **Missing Column** → Extract column name, suggest available columns
4. **Permission Denied** → Classify statement, recommend required permission level
5. **Connection Lost** → Already handled by adapter layer (Phase 3)

**Table Name Suggestion Algorithm:**
- Parse error message for quoted identifier (e.g., `'users'`)
- Query `adapter.listTables()` to get all table names
- Compute Levenshtein distance for similar names
- Suggest top 3 closest matches (threshold: distance < 3)

Example error:
```
❌ Error: relation "users" does not exist
   💡 Did you mean: 'user' (distance: 1) or 'users_old' (distance: 2)?
   💡 Available tables: user, users_old, user_roles, ...
```

### Query-Only Mode Safety: Auto-LIMIT

In `query-only` mode (read-only permission), auto-append `LIMIT 1000` for safety:
- Prevents accidental large data pulls
- Configurable via `--limit` flag (overrides auto-limit)
- Must not apply to queries already containing LIMIT clause
- Query inspection: use permission-guard's SQL parsing (already strips comments/strings)

**Example:**
```bash
dbcli query "SELECT * FROM huge_table"
# Becomes: SELECT * FROM huge_table LIMIT 1000
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Table rendering with borders/columns | Custom ASCII rendering | cli-table3 (already in use) | Handles alignment, borders, encoding; proven in Phase 5 |
| SQL result type conversion | Custom type mapping | Bun.sql + runtime type inference from first row | Bun handles type coercion; runtime inspection is safe |
| CSV escaping/quoting | Regex-based CSV parsing | Simple hand-rolled: quote strings, escape quotes, handle commas | RFC 4180 is trivial; no external dep overhead justified |
| Levenshtein distance | Implement from scratch | Pre-built pure-JS function (30 lines, inline) | Problem is trivial; one-off utility |

**Key insight:** The query phase should focus on *integration*, not new infrastructure. All heavy lifting (DB connection, permission checks, output formatting) is done. This phase assembles existing pieces into a cohesive command.

## Common Pitfalls

### Pitfall 1: Unbounded Result Sets
**What goes wrong:** `SELECT * FROM huge_table` returns 10M rows, CLI memory bloats, process crashes.
**Why it happens:** Query-only mode trusts user to write good queries; no automatic throttling.
**How to avoid:**
- Auto-append LIMIT in query-only mode (safety default)
- Show row count before output if > 10,000 rows (warning: "Large result set detected")
- In full output (JSON/CSV), stream results instead of buffering all rows
**Warning signs:** Memory usage spike, slow response, "JavaScript heap out of memory" errors.

### Pitfall 2: Missing Table Detection Failure
**What goes wrong:** User types `dbcli query "SELECT * FROM usrs"` (typo), error message doesn't suggest `users`.
**Why it happens:** Error messages from PostgreSQL/MySQL vary by version and dialect; parsing is fragile.
**How to avoid:**
- Don't rely on regex parsing of error messages (brittle)
- Instead: on SQL syntax error, proactively query `adapter.listTables()` and compute distances
- Present up to 3 closest matches with distance metrics
- Always show the raw error message first (for context), then suggestions
**Warning signs:** User confusion, no actionable next step in error message.

### Pitfall 3: CSV Output Doesn't Escape Special Characters
**What goes wrong:** Cell contains comma or quote: `Smith, Jr.` renders as two cells instead of one.
**Why it happens:** Hand-rolled CSV formatter omitted escaping logic.
**How to avoid:**
- For each cell: if contains comma/quote/newline, wrap in double quotes and escape internal quotes as ""
- Test with: comma, quote, newline, mixed special chars
- Validate output is parseable by standard CSV readers
**Warning signs:** Import failures in Excel/Sheets, data corruption warnings.

### Pitfall 4: Permission Check Bypass via Parameterized Queries
**What goes wrong:** User submits `DELETE FROM users` as parameterized query ($1, $2), permission guard doesn't catch it.
**Why it happens:** Permission guard's SQL classifier might strip params before analysis, missing keywords.
**How to avoid:**
- Verify permission-guard.ts `removeParameterMarkers()` is called AFTER keyword extraction
- Test with: `DELETE FROM ? WHERE id = $1`, `DELETE FROM users WHERE id IN (SELECT ...)`
- Permission check must happen BEFORE parameterized query construction
**Warning signs:** Unexpected deletes in read-only mode, security audit findings.

### Pitfall 5: Execution Time Measurement Includes Formatting
**What goes wrong:** Reported execution time includes JSON serialization (10s for large result), user thinks query is slow.
**Why it happens:** Single `performance.now()` call at start/end brackets entire operation.
**How to avoid:**
- Measure only database execution: `const start = performance.now(); const rows = adapter.execute(...); const executionTimeMs = performance.now() - start`
- Format *after* timing measurement
- Report both query time and total time if difference is >10%
**Warning signs:** Inflated execution times, user complaints about performance.

### Pitfall 6: Query Classification Confidence Level Ignored
**What goes wrong:** Uncertain statement (LOW confidence) is allowed in read-write mode, causes unintended write.
**Why it happens:** Permission guard returns classification but planner doesn't check `confidence` level.
**How to avoid:**
- If `classification.confidence === 'LOW'`, require `--force` flag to execute
- Log warning: "⚠️  Unable to confirm operation type with high confidence. Use --force to proceed."
- Never silently allow LOW confidence statements
**Warning signs:** Unintended write operations, security incidents.

## Code Examples

### Pattern 1: Execute Query and Collect Results
```typescript
// Source: Phase 3 DatabaseAdapter interface
// Bun.sql + execute method already handles parameterization

const sql = "SELECT * FROM users WHERE id = ?"
const params = [42]
const rows = await adapter.execute<User>(sql, params)

// Type-safe: rows are User objects with proper types
for (const row of rows) {
  console.log(row.id, row.name)
}
```

### Pattern 2: Format Query Results as Table
```typescript
// Source: Phase 5 TableFormatter pattern, re-used for query results
import { TableFormatter } from '@/formatters'

const rows = await adapter.execute('SELECT * FROM users')
const columns = Object.keys(rows[0] || {})

const table = new Table({
  head: columns,
  style: { compact: false, 'padding-left': 1, 'padding-right': 1 }
})

rows.forEach(row => {
  table.push(columns.map(col => row[col]))
})

console.log(table.toString())
```

### Pattern 3: Format Query Results as JSON with Metadata
```typescript
// Source: Phase 5 JSONFormatter pattern

interface QueryResult<T> {
  rows: T[]
  rowCount: number
  columnNames: string[]
  metadata?: {
    executionTimeMs: number
  }
}

const result: QueryResult<Record<string, any>> = {
  rows: rows,
  rowCount: rows.length,
  columnNames: Object.keys(rows[0] || {}),
  metadata: {
    executionTimeMs: performance.now() - startTime
  }
}

console.log(JSON.stringify(result, null, 2))
```

### Pattern 4: CSV Output with Proper Escaping
```typescript
// Source: Simple RFC 4180 implementation (no external library)

function escapeCSVField(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return ''
  const str = String(value)

  // If contains comma, quote, or newline, wrap and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"` // Escape quotes as ""
  }
  return str
}

function formatAsCSV(rows: Record<string, any>[]): string {
  if (rows.length === 0) return ''

  const columns = Object.keys(rows[0])
  const header = columns.map(escapeCSVField).join(',')

  const body = rows.map(row =>
    columns.map(col => escapeCSVField(row[col])).join(',')
  ).join('\n')

  return header + '\n' + body
}
```

### Pattern 5: Permission Guard Integration
```typescript
// Source: Phase 4 permission-guard module

import { enforcePermission } from '@/core/permission-guard'
import type { Permission } from '@/types'

const sql = "SELECT * FROM users"
const permission: Permission = config.permission

try {
  const classification = enforcePermission(sql, permission)
  // classification.type = 'SELECT', allowed
  const rows = await adapter.execute(sql)
} catch (error) {
  if (error instanceof PermissionError) {
    // Error has classification + required permission level
    console.error(`❌ ${error.message}`)
    console.error(`   Operation type: ${error.classification.type}`)
    console.error(`   Required permission: ${error.requiredPermission}`)
  }
}
```

### Pattern 6: Missing Table Suggestion via Levenshtein Distance
```typescript
// Source: Simple distance function + suggestion algorithm

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // Substitution
          matrix[i][j - 1] + 1,     // Insertion
          matrix[i - 1][j] + 1      // Deletion
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

async function suggestTableName(errorMessage: string, adapter: DatabaseAdapter): Promise<string[]> {
  // Extract table name from error (e.g., "relation 'users' does not exist")
  const match = errorMessage.match(/relation ['""`](\w+)['""`]/i)
  if (!match) return []

  const typo = match[1]
  const tables = await adapter.listTables()
  const distances = tables
    .map(t => ({ name: t.name, distance: levenshteinDistance(typo, t.name) }))
    .filter(t => t.distance < 3)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)

  return distances.map(d => d.name)
}
```

## State of the Art

| Aspect | Current Approach | Why This Works for Phase 6 |
|--------|------------------|---------------------------|
| Query execution | Bun.sql (native, zero-dependency) | Proven in Phase 3; unified API for PostgreSQL/MySQL |
| Permission checks | SQL classifier + whitelist enforcement | Proven in Phase 4; no execution before permission check |
| Result formatting | Separate formatters per output type | Proven in Phase 5; extensible pattern |
| Error handling | Adapter throws ConnectionError; command catches | Proven in Phase 3; consistent error hierarchy |

## Open Questions

1. **LIMIT Auto-Append in Query-Only Mode: Configurable?**
   - Current plan: Auto-append `LIMIT 1000` by default
   - Should this be configurable in `.dbcli` config? (e.g., `query: { autoLimit: 1000 }`)
   - **Recommendation:** Phase 6 ships with hard-coded 1000; Phase 8 (Schema Refresh) can expose as config option if user feedback demands it.

2. **Streaming Results for Large Datasets**
   - Current plan: Buffer entire result set in memory
   - Should Phase 6 implement streaming (write rows to stdout incrementally)?
   - **Recommendation:** No—Phase 6 buffers results; Phase 8 (Export) will implement streaming for large exports. Query command targets < 10K rows.

3. **Query Result Caching**
   - Should repeated queries cache results?
   - **Recommendation:** No—out of scope for Phase 6. Single-shot CLI tool; no persistent state. Caching deferred to V2.

4. **Column Type Inference for CSV/JSON**
   - Should metadata include inferred column types (INTEGER, VARCHAR, etc.)?
   - **Recommendation:** Yes for JSON metadata (helps AI understand types); no for CSV (only strings in CSV format anyway).

## Environment Availability

**No external tools required.** Phase 6 depends only on:
- Bun runtime (already present in Phase 1)
- PostgreSQL/MySQL databases (tested in Phase 3)
- .dbcli config file (created in Phase 2)

All dependencies are already verified as available in earlier phases.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (via Vitest, as established in Phase 1) |
| Config file | vitest.config.ts (already exists in project) |
| Quick run command | `bun test tests/unit/commands/query.test.ts` |
| Full suite command | `bun test --run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUERY-01 | `dbcli query "SELECT ..."` returns rows formatted as table | integration | `bun test tests/integration/commands/query.test.ts -t "SELECT.*table"` | ❌ Wave 0 |
| QUERY-02 | Permission-only mode rejects INSERT/DELETE with clear error | unit | `bun test tests/unit/commands/query.test.ts -t "permission"` | ❌ Wave 0 |
| QUERY-03 | Output formats (table, JSON, CSV) all produce valid output | unit | `bun test tests/unit/formatters/query-result-formatter.test.ts` | ❌ Wave 0 |
| QUERY-04 | Missing table error suggests similar table names | unit | `bun test tests/unit/commands/query.test.ts -t "suggestion"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test tests/unit/` (unit test suite < 5 sec)
- **Per wave merge:** `bun test --run` (full suite with integration tests)
- **Phase gate:** Full suite green + manual `dbcli query` test against real PostgreSQL/MySQL

### Wave 0 Gaps

- [ ] `tests/unit/formatters/query-result-formatter.test.ts` — test QueryResultFormatter for table/json/csv output with edge cases (nulls, special chars, empty results, large numbers)
- [ ] `tests/unit/commands/query.test.ts` — test query command logic (SQL classification, permission enforcement, error handling, suggestion generation)
- [ ] `tests/integration/commands/query.test.ts` — test full flow: real database connection, query execution, output formatting (requires test database)
- [ ] `src/formatters/query-result-formatter.ts` — implement QueryResultFormatter (3 formatters: table, JSON, CSV)
- [ ] `src/commands/query.ts` — implement query command with all options and error handling
- [ ] Framework setup: Ensure integration test database connection available (PostgreSQL/MySQL test instance)

## Sources

### Primary (HIGH confidence)
- **Bun.sql native API** — Verified in Phase 3 (DatabaseAdapter implementation)
- **Permission Guard (Phase 4)** — `src/core/permission-guard.ts` — classifyStatement, enforcePermission
- **Output Formatters (Phase 5)** — `src/formatters/` — TableFormatter, JSONFormatter patterns
- **Project CLAUDE.md constraints** — Bun-first, zero external dependencies for non-critical features
- **ROADMAP Phase 6** — `.planning/ROADMAP.md` lines 300-324 — clear requirements and success criteria

### Secondary (MEDIUM confidence)
- **RFC 4180 CSV Specification** — Standard format for comma-separated values with quoting/escaping rules
- **Levenshtein Distance Algorithm** — Standard string similarity metric, simple to implement
- **CLI-table3 documentation** — Used in Phase 5; extends to query result rows

### Implementation Reference (in-project)
- Phase 3 adapter pattern: `src/adapters/types.ts` (DatabaseAdapter interface)
- Phase 4 permission enforcement: `src/core/permission-guard.ts` (classifyStatement, enforcePermission)
- Phase 5 formatter pattern: `src/formatters/table-formatter.ts` and `json-formatter.ts`

## Metadata

**Confidence breakdown:**
- Query execution: HIGH — Bun.sql proven in Phase 3
- Permission enforcement: HIGH — PermissionGuard implemented in Phase 4
- Output formatting: HIGH — Formatters proven in Phase 5
- Error handling: MEDIUM — Patterns established, but specific error message parsing (missing table detection) requires careful implementation
- CSV formatting: HIGH — RFC 4180 is straightforward; no complex edge cases expected

**Research date:** 2026-03-25
**Valid until:** 2026-04-22 (30 days—Bun/database APIs stable, no breaking changes expected)

**Reasons for MEDIUM confidence in error handling:**
- Error messages vary by PostgreSQL/MySQL version and dialect
- Table suggestion via Levenshtein distance is heuristic, not guaranteed
- Some edge cases (column not found, constraint violation) require database-specific parsing
