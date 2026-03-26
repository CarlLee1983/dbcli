# Phase 5: Schema Discovery - Research

**Researched:** 2026-03-25
**Domain:** Database schema introspection, CLI output formatting, metadata storage, offline reference generation
**Confidence:** HIGH

## Summary

Phase 5 implements two public CLI commands (`dbcli list` and `dbcli schema [table]`) and populates the `.dbcli` config with persistent schema metadata that AI agents can reference offline. This phase builds directly on Phase 3-4 infrastructure (adapters, permissions, config storage).

The core challenge is extracting schema information from three database systems (PostgreSQL, MySQL, MariaDB) using their respective `information_schema` queries, then formatting output for two audiences: human operators (CLI tables) and AI agents (JSON + offline storage).

**Key findings:**

1. **Schema Introspection Method:** Bun.sql has no built-in schema API; we query each database's native metadata views directly:
   - PostgreSQL: `information_schema.columns`, `information_schema.table_constraints`
   - MySQL/MariaDB: `information_schema.COLUMNS`, `SHOW CREATE TABLE`, `INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS`
   - All three support `information_schema` standard, but syntax details differ (e.g., PostgreSQL uses `array_agg`, MySQL uses `GROUP_CONCAT`)

2. **Output Formatting:** For human consumption, table-format output is standard. For AI parsing, JSON with full metadata (types, nullability, constraints, row counts) enables accurate SQL generation. Standard CLI tools use `cli-table3` or equivalent for ASCII tables.

3. **Metadata Storage:** The `.dbcli` config already has a `schema` field (Record<string, unknown>). Phase 5 should populate this with a structured map of table names to full schemas (columns, types, constraints, row counts). This becomes the "offline reference" that AI can read without querying the database again.

4. **Permission Integration:** `dbcli list` and `dbcli schema` are read-only operations safe for all permission levels (query-only, read-write, admin). No permission guard needed.

5. **Adapter Methods Already Defined:** Phase 3 adapters already define `listTables()` and `getTableSchema(tableName)` methods, but implementations are partial (missing foreign key details in some cases). Phase 5 must complete these implementations.

**Primary recommendations:**

1. Complete `getTableSchema()` implementations in PostgreSQL and MySQL adapters to extract foreign key references
2. Create output formatter modules: `TableFormatter` (ASCII table) and `JSONFormatter` for results
3. Implement `dbcli list` command showing: table name, column count, row count (with `--format json` support)
4. Implement `dbcli schema [table]` command showing full structure (columns, types, constraints, FKs) with `--format json` support
5. Implement `dbcli schema` (no args) to scan all tables and populate `.dbcli` schema block with full metadata
6. Add `--force` flag to `dbcli schema` to skip confirmation when overwriting existing schema data
7. For output formatting, use Bun's built-in console features or lightweight table formatting (avoid adding dependencies if possible; Node built-in or simple manual ASCII generation is acceptable)
8. Store schema metadata in `.dbcli` as: `{ [tableName]: { columns: ColumnSchema[], rowCount, engine } }`

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCHEMA-01 | `dbcli schema [table]` command to retrieve single table structure | Per-adapter `getTableSchema(tableName)` with complete column details, types, constraints; `--format json` support |
| SCHEMA-02 | `dbcli list` command to show all tables with metadata | Adapter `listTables()` returning table names, row counts; `--format json` support |
| SCHEMA-03 | Auto-generate `.dbcli` with table structures and relationships | Full database schema scan, populate `.dbcli` schema field; store foreign keys in relationship metadata |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Commander.js | 13.0.0+ | CLI command definition | Already established in Phase 1; consistent with `init` command |
| Bun.sql | Built-in (1.3+) | Database schema queries | Native support for PostgreSQL, MySQL, MariaDB; zero dependencies |
| TypeScript | 5.3+ | Type-safe schema interfaces | Enforce schema structure; enable AI/IDE code generation later |
| Zod | 3.22+ | Schema validation and transformation | Already used in Phase 2-4; validate schema metadata before storage |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cli-table3 | 0.6+ | ASCII table formatting for terminal output | `dbcli list` human-readable table display |
| Bun console | Built-in | Console output | JSON, error, and summary output (built-in formatting) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| cli-table3 | Manual ASCII table building | Saves one dependency; manual table layout is fragile and hard to maintain |
| cli-table3 | Node built-in console.table() | console.table() output is not customizable; loses column ordering and styling |
| Storing schema in .dbcli | Separate .dbcli-schema.json | Single .dbcli file is simpler; schema is configuration, not separate artifact |
| Bun.sql queries | ORM (Drizzle, Prisma) | Adds heavy dependencies; for simple introspection queries, Bun.sql is sufficient |

**Dependency decision:** `cli-table3` is the minimal, standard choice for CLI table formatting. It's lightweight (50KB) and widely used. If avoiding extra dependencies is critical, Bun's built-in console features can format JSON and simple ASCII tables without a library.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── adapters/
│   ├── postgresql-adapter.ts    # (Enhanced) getTableSchema with FK details
│   ├── mysql-adapter.ts         # (Enhanced) getTableSchema with FK details
│   └── types.ts                 # (Updated) extend TableSchema, ColumnSchema with FK info
├── commands/
│   ├── init.ts                  # (Existing)
│   ├── list.ts                  # NEW: dbcli list command
│   └── schema.ts                # NEW: dbcli schema [table] command
├── formatters/                  # NEW
│   ├── index.ts
│   ├── table-formatter.ts       # Format schema as ASCII table
│   └── json-formatter.ts        # Format schema as JSON
└── core/
    ├── config.ts                # (Existing)
    └── [other]
```

### Pattern 1: TableSchema with Foreign Keys

**What:** Extend schema interfaces to capture foreign key relationships and full constraint metadata.

**When to use:** All database schema introspection code; enables AI agents to understand table relationships.

**Example:**

```typescript
// Source: src/adapters/types.ts (extended)
export interface ColumnSchema {
  name: string
  type: string
  nullable: boolean
  default?: string
  primaryKey?: boolean
  foreignKey?: {
    table: string
    column: string
  }
}

export interface TableSchema {
  name: string
  columns: ColumnSchema[]
  rowCount?: number
  engine?: string
  primaryKey?: string[]        // Array of PK column names
  foreignKeys?: Array<{        // Foreign key constraints
    name: string
    columns: string[]
    refTable: string
    refColumns: string[]
  }>
}
```

### Pattern 2: Output Formatter Interface

**What:** Separate concern of "retrieving schema" from "formatting output" to support multiple formats (table, JSON, CSV in future).

**When to use:** All commands that return structured data (`list`, `schema`, later `query`, `export`).

**Example:**

```typescript
// Source: src/formatters/index.ts
export interface OutputFormatter<T> {
  format(data: T, options?: { compact?: boolean }): string
}

// Source: src/formatters/table-formatter.ts
import Table from 'cli-table3'

export class TableFormatter implements OutputFormatter<ColumnSchema[]> {
  format(columns: ColumnSchema[]): string {
    const table = new Table({
      head: ['Name', 'Type', 'Nullable', 'Default', 'Primary Key'],
      style: { compact: false }
    })

    columns.forEach(col => {
      table.push([
        col.name,
        col.type,
        col.nullable ? 'YES' : 'NO',
        col.default || '—',
        col.primaryKey ? '✓' : ''
      ])
    })

    return table.toString()
  }
}

// Source: src/formatters/json-formatter.ts
export class JSONFormatter implements OutputFormatter<ColumnSchema[]> {
  format(columns: ColumnSchema[]): string {
    return JSON.stringify(columns, null, 2)
  }
}
```

### Pattern 3: Schema Caching in .dbcli

**What:** Populate `.dbcli` config's `schema` field with full database metadata for offline AI reference.

**When to use:** After `dbcli schema` (no-args) command completes; optionally after every `dbcli schema [table]` for incremental updates.

**Example:**

```typescript
// Source: src/commands/schema.ts (pseudocode)
interface DbcliSchemaBlock {
  [tableName: string]: {
    name: string
    columns: ColumnSchema[]
    rowCount: number
    engine: string
    primaryKey?: string[]
    foreignKeys?: Array<{ name; columns; refTable; refColumns }>
  }
}

// After introspection, update .dbcli config:
const config = await configModule.read('.dbcli')
const updatedConfig = {
  ...config,
  schema: {
    ...config.schema,
    ...schemaData  // Merge or replace
  }
}
await configModule.write('.dbcli', updatedConfig)

console.log(`✓ Updated .dbcli with schema for ${Object.keys(schemaData).length} tables`)
```

### Anti-Patterns to Avoid

- **Querying every time instead of caching:** `.dbcli` schema block allows AI agents to work offline; update it at least once per session with `dbcli schema` without args
- **Losing column order:** Always preserve column ordinal position from database (`ORDER BY ordinal_position` for PostgreSQL, `ORDINAL_POSITION` for MySQL)
- **Mixing human and machine output:** Provide `--format json` for programmatic parsing; default human-readable table is fine but don't mix in table output
- **Incomplete FK metadata:** Foreign keys are critical for proper SQL generation; must capture: constraint name, column names, referenced table, referenced columns
- **Assuming schema doesn't change:** Support `--refresh` flag to force re-query (don't rely on cache) or `dbcli schema --refresh [table]` for specific table

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ASCII table formatting | Manually concatenate strings with borders | `cli-table3` or similar | Table alignment, multi-line cell wrapping, unicode borders are error-prone |
| Information_schema queries | Custom query builders | Native SQL (information_schema + SHOW commands) | SQL is standardized; each DB has dialect variations; native is maintainable |
| JSON schema validation | Manual typeof checks | Zod schemas | Zod handles edge cases, provides clear error messages, enables TS inference |
| Output formatting dispatch | if-else on format option | Strategy pattern (formatter interface) | Enables adding CSV, YAML, etc. later without modifying command code |
| Permission checks for list/schema | Custom boolean logic | Rely on adapter being connected | `list` and `schema` are read-only safe; no explicit check needed (permissions checked at adapter connection time) |

**Key insight:** Information_schema queries vary per database (PostgreSQL vs MySQL column names, `array_agg` vs `GROUP_CONCAT`, etc.). Don't try to abstract into a single query; keep database-specific queries in each adapter's `getTableSchema()` method.

## Runtime State Inventory

**SKIPPED** — Phase 5 is greenfield schema discovery implementation, not a rename/refactor/migration phase. No runtime state audit needed.

## Common Pitfalls

### Pitfall 1: Missing Foreign Key References
**What goes wrong:** `getTableSchema()` returns columns but omits foreign key constraints, so AI agents can't understand relationships between tables.

**Why it happens:** information_schema foreign key queries are complex; each database uses different approaches (`information_schema.REFERENTIAL_CONSTRAINTS` for MySQL, `pg_constraint` for PostgreSQL).

**How to avoid:**
- Test `getTableSchema()` with a table that has FK constraints
- Verify foreign keys appear in returned ColumnSchema.foreignKey field
- Add test fixtures with FK relationships (orders→customers, products→categories)

**Warning signs:**
- `dbcli schema orders` shows no relationship between order.customer_id and customers.id
- AI agent generates orphaned IDs in SELECT queries (e.g., `SELECT * FROM orders WHERE customer_id = 5` without `JOIN customers`)

### Pitfall 2: Row Count Performance on Large Tables
**What goes wrong:** `COUNT(*)` on billion-row table times out or hangs the CLI.

**Why it happens:** Exact row count requires full table scan. PostgreSQL and MySQL provide estimates (pg_stat_user_tables.n_live_tup, information_schema.TABLES.TABLE_ROWS) but these are sampling-based.

**How to avoid:**
- Use row count estimates, not exact counts (already done in Phase 3 adapters)
- For `dbcli list`, use estimates only (fast, acceptable for schema discovery)
- For `dbcli schema [large-table]`, add `--no-count` flag to skip row count if desired
- Document in help: "Row counts are estimates; use `SELECT COUNT(*) FROM table` for exact count"

**Warning signs:**
- `dbcli list` hangs on databases with 1GB+ tables
- User reports timeout errors

### Pitfall 3: Character Encoding and Unicode in Column Names/Types
**What goes wrong:** Column names or data types with non-ASCII characters (é, ü, 中文) are corrupted or cause JSON encoding errors.

**Why it happens:** Information_schema results may include multi-byte UTF-8 characters; CLI output and JSON serialization must preserve encoding.

**How to avoid:**
- Use Bun.file for config writing (handles UTF-8 natively)
- JSON.stringify() handles Unicode correctly (escapes as \uXXXX)
- Test with databases containing non-ASCII identifiers
- Verify cli-table3 or console output doesn't truncate multi-byte chars

**Warning signs:**
- `dbcli schema` output shows ?? or replacement characters
- JSON output has malformed escapes

### Pitfall 4: Incomplete Schema After Partial Scan
**What goes wrong:** Running `dbcli schema` on a 1000-table database takes 5 minutes; on interruption (Ctrl+C), `.dbcli` ends up with 300 tables, leading to incomplete metadata.

**Why it happens:** Scanning all tables serially; no atomic write of full schema until complete.

**How to avoid:**
- Collect all schema data in memory first, write once at the end
- Provide progress indicator: "Scanning tables... 150/1000"
- Allow `--concurrency N` flag for parallel scanning (5-10 tables at once)
- Document: "Interrupting dbcli schema will not update .dbcli; re-run to continue"

**Warning signs:**
- User interrupts during schema scan; `.dbcli` partially updated
- AI agent sees only subset of tables

### Pitfall 5: Schema Drift Detection Not Implemented
**What goes wrong:** Database schema changes (new table, new column, dropped FK), but `.dbcli` is stale. AI agent tries to SELECT from dropped table.

**Why it happens:** Phase 5 doesn't implement incremental refresh (SCHEMA-04). `dbcli schema` overwrites without detecting changes.

**How to avoid:**
- Implement `--refresh` flag (SCHEMA-04 deferred, but OK to add now)
- On refresh, compare old schema vs new, report: "Added table X, removed column Y from table Z"
- Store timestamp in `.dbcli` metadata (already there: metadata.createdAt) — include lastUpdated
- Document: "Run `dbcli schema --refresh` after database migrations"

**Warning signs:**
- AI agent queries a table that no longer exists
- Development databases change frequently; schema cache becomes stale

## Code Examples

Verified patterns from Phase 3-4 codebase:

### PostgreSQL Foreign Key Query
```typescript
// Source: Phase 3 research + PostgreSQL information_schema standard
const fkQuery = `
  SELECT
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.table_name = kcu.table_name AND tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
  WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'
`
```

### MySQL Foreign Key Query
```typescript
// Source: MySQL information_schema standard
const fkQuery = `
  SELECT
    rc.CONSTRAINT_NAME,
    kcu.COLUMN_NAME,
    rc.REFERENCED_TABLE_NAME,
    kcu.REFERENCED_COLUMN_NAME
  FROM information_schema.REFERENTIAL_CONSTRAINTS rc
  JOIN information_schema.KEY_COLUMN_USAGE kcu
    ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.TABLE_NAME = kcu.TABLE_NAME
  WHERE kcu.TABLE_NAME = ? AND rc.CONSTRAINT_SCHEMA = DATABASE()
`
```

### cli-table3 Integration
```typescript
// Source: cli-table3 documentation + Phase 5 pattern
import Table from 'cli-table3'

const table = new Table({
  head: ['Column', 'Type', 'Nullable', 'Default', 'Key'],
  colWidths: [20, 20, 10, 20, 15],
  style: { compact: false, 'padding-left': 1, 'padding-right': 1 }
})

schema.columns.forEach(col => {
  const keyType = col.primaryKey ? 'PK' : (col.foreignKey ? 'FK' : '')
  table.push([
    col.name,
    col.type,
    col.nullable ? 'YES' : 'NO',
    col.default || 'NULL',
    keyType
  ])
})

console.log(table.toString())
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded schema in comments | Query information_schema dynamically | SQL standard adoption (~2000s) | Schema stays in sync with actual database; enables tools like dbcli |
| Per-database custom CLI tools | Unified CLI with adapter pattern | 2010s (ORMs like SQLAlchemy) | Single tool works across PostgreSQL, MySQL, MariaDB |
| Schema loaded in memory per query | Cache schema in config for offline use | 2020s (AI agent era) | AI agents can work offline; humans don't re-query unnecessarily |
| Console.log() for output | Table formatting libraries + structured output | 2010s (Node.js maturity) | Humans read tables easily; machines parse JSON |

**Deprecated/outdated:**
- `SHOW TABLES; DESCRIBE table_name;` manual workflow — replaced by CLI tools like dbcli
- In-band schema discovery (hidden in query comments) — replaced by config files + metadata storage
- Exact row count queries on huge tables — replaced by estimates from statistics (pg_stat_user_tables, information_schema sampling)

## Open Questions

1. **Concurrency for `dbcli schema` (no args):**
   - Should Phase 5 scan tables in parallel (5-10 at once) for speed, or serially (safer)?
   - **Recommendation:** Serial for Phase 5 (simpler, no concurrency bugs). Add `--concurrency` flag in Phase 8 if performance becomes issue.

2. **Exact row count vs. estimate:**
   - PostgreSQL: pg_stat_user_tables is estimate only; exact COUNT(*) on 1M+ rows is slow
   - MySQL: information_schema.TABLES.TABLE_ROWS is estimate only; exact COUNT(*) is slow
   - **Recommendation:** Use estimates in Phase 5. Add `--exact-counts` flag in Phase 8 if users request it.

3. **Schema for multiple schemas/databases:**
   - v1 supports single database only; what if a PostgreSQL connection has multiple schemas (public, private, app)?
   - **Recommendation:** Phase 5 scans public schema only (PostgreSQL) or no schema filtering (MySQL). Phase 8+ can support --schema flag.

4. **Relationship representation in AI metadata:**
   - Should Phase 5 generate a "relationships" section in .dbcli for AI agents, or just inline FKs in columns?
   - **Recommendation:** Inline FKs in columns (simpler). If AI agents request separate relationships map, add in Phase 9.

## Environment Availability

**Step 2.6: SKIPPED** — Phase 5 has no external dependencies beyond Bun runtime and existing project packages. All required tools (information_schema queries, CLI output) are built-in to Bun and npm packages already declared in package.json.

## Validation Architecture

| Requirement ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHEMA-01 | `dbcli schema users` returns columns, types, nullability, default values, primary/foreign keys | unit + integration | `bun test -- --grep "schema.*single table"` | ❌ Wave 0 |
| SCHEMA-02 | `dbcli list` shows all tables with row count estimate, supports `--format json` | unit + integration | `bun test -- --grep "list.*tables"` | ❌ Wave 0 |
| SCHEMA-03 | `dbcli schema` (no args) scans full database, populates .dbcli schema field, re-running updates in-place | integration | `bun test -- --grep "schema.*full-database"` | ❌ Wave 0 |

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 1.2.0 (established in Phase 1) |
| Config file | vitest.config.ts (existing) |
| Quick run command | `bun test -- --grep "schema\|list"` |
| Full suite command | `bun test --run` |

### Wave 0 Gaps
- [ ] `tests/unit/commands/list.test.ts` — verify command registration, output formatting (table + JSON)
- [ ] `tests/unit/commands/schema.test.ts` — verify single-table schema retrieval, FK extraction
- [ ] `tests/integration/commands/schema-discovery.test.ts` — end-to-end `dbcli list` and `dbcli schema` with real adapters (mocked DB or test container)
- [ ] `tests/unit/formatters/table-formatter.test.ts` — cli-table3 integration
- [ ] `tests/unit/formatters/json-formatter.test.ts` — JSON output structure
- [ ] Framework install: `bun install cli-table3` — if not already in package.json
- [ ] PostgreSQL FK query validation — test with test DB containing FK constraints
- [ ] MySQL FK query validation — test with test DB containing FK constraints

*(If no gaps: "None — existing test infrastructure covers all phase requirements")*

**Note:** Existing Phase 3 integration tests for adapters provide foundation. Phase 5 tests should focus on CLI command behavior and output formatting, not re-testing adapter methods.

## Sources

### Primary (HIGH confidence)
- Bun documentation ([https://bun.com/docs/runtime/sql](https://bun.com/docs/runtime/sql)) — SQL API reference, confirms no built-in schema introspection, requires information_schema queries
- PostgreSQL information_schema documentation ([https://www.postgresql.org/docs/current/information-schema.html](https://www.postgresql.org/docs/current/information-schema.html)) — schema for pg_tables, information_schema.columns, table_constraints
- cli-table3 npm package ([https://www.npmjs.com/package/cli-table3](https://www.npmjs.com/package/cli-table3)) — ASCII table formatting library, standard for CLI tools
- Commander.js 13.0+ documentation — already established in Phase 1, command patterns proven

### Secondary (MEDIUM confidence)
- Azure CLI output format patterns ([https://learn.microsoft.com/en-us/cli/azure/format-output-azure-cli?view=azure-cli-latest](https://learn.microsoft.com/en-us/cli/azure/format-output-azure-cli?view=azure-cli-latest)) — demonstrates --format json as standard pattern
- SchemaCrawler documentation ([https://www.schemacrawler.com/output.html](https://www.schemacrawler.com/output.html)) — shows multiple output format support (table, JSON, HTML)

### Tertiary (LOW confidence, marked for validation)
- Chalk terminal styling library ([https://www.npmjs.com/package/chalk](https://www.npmjs.com/package/chalk)) — optional for colored output; not required for Phase 5

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Bun.sql, Commander, TypeScript, Zod all proven in earlier phases
- Architecture: HIGH — Adapter methods defined in Phase 3; output formatter pattern is standard
- Pitfalls: MEDIUM — Schema introspection pitfalls (large tables, FK queries, encoding) based on common CLI tool issues; not Bun-specific

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (30 days; stable domain, no major library changes expected)

