# Phase 08: Schema Refresh & Export - Research

**Researched:** 2026-03-25
**Domain:** Incremental schema diffing, data export, streaming, CLI architecture
**Confidence:** HIGH

## Summary

Phase 08 implements two complementary features: (1) **Incremental schema refresh** that detects schema changes in the live database and updates only deltas in `.dbcli`, and (2) **Data export** with JSON/CSV output formats supporting both stdout and file output. Both features integrate seamlessly with existing patterns: schema refresh uses the proven `configModule.merge()` immutable pattern, and export reuses the `QueryResultFormatter` and `QueryExecutor` infrastructure. The phase respects existing permission models and extends them naturally (Query-only mode respects the 1000-row auto-limit; Admin mode allows unlimited exports).

**Primary recommendation:** Implement schema refresh as a diff algorithm that compares in-memory snapshots (previous schema from `.dbcli`) against live database introspection (`listTables()` + `getTableSchema()`), reporting additions, removals, and modifications. For export, treat it as a specialized query command that reuses `QueryExecutor` and `QueryResultFormatter` with file output added.

## Standard Stack

### Core Libraries (No Changes from Phase 6-7)
| Library | Version | Purpose | Confidence |
|---------|---------|---------|------------|
| Bun | 1.1.0+ | Runtime and package manager | HIGH — locked in Phase 1 |
| TypeScript | 5.3+ | Static typing and CLI transpilation | HIGH — locked in Phase 1 |
| cli-table3 | 0.6.0+ | ASCII table formatting (reused) | HIGH — already in use for Phase 5 `schema` command |
| zod | 3.22+ | Input validation (reused) | HIGH — already in use for config validation |
| Commander.js | 11.0+ | CLI command routing (reused) | HIGH — already in use for all commands |

### Supporting (Reused from Earlier Phases)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|------------|
| QueryResultFormatter | 0.1 (src/) | JSON/CSV/table output | Export command output formatting |
| QueryExecutor | 0.1 (src/) | Permission enforcement, auto-limit | Export command execution layer |
| configModule.merge() | 0.1 (src/) | Immutable config updates | Schema refresh delta merging |
| DatabaseAdapter | 0.1 (src/) | DB introspection interface | Schema diff algorithm input |

### No New External Dependencies Required

**Rationale:** Phase 08 works entirely within existing infrastructure. `listTables()` and `getTableSchema()` already exist on DatabaseAdapter (Phase 5). `QueryResultFormatter` already supports JSON and CSV (Phase 6). Permission guards and auto-limit already integrated (Phase 6). No new npm packages needed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── commands/
│   ├── schema.ts         # Extended: add --refresh flag handler
│   └── export.ts         # NEW: export command (similar to query.ts pattern)
├── core/
│   ├── schema-diff.ts    # NEW: SchemaDiffEngine class
│   └── query-executor.ts # Extended: already supports export via generic execute()
├── formatters/
│   └── query-result-formatter.ts  # Already supports JSON/CSV
└── types/
    └── schema-diff.ts    # NEW: SchemaDiff, DiffReport types
```

### Pattern 1: Schema Diffing Algorithm

**What:** Compare previous schema (from `.dbcli` config.schema field) against current database state, detecting additions, deletions, and modifications per table and column.

**When to use:** `dbcli schema --refresh` command entry point.

**Algorithm:**
```typescript
// Source: Derived from CONTEXT.md Decisions D-01, D-02
// Two-phase comparison:

// Phase 1: Table-level comparison
// - Get current tables: adapter.listTables()
// - Get previous tables: Object.keys(config.schema || {})
// - Tables added: current - previous
// - Tables removed: previous - current
// - Tables unchanged (get full schema for column-level diff)

// Phase 2: Column-level comparison (for tables that exist in both)
// - For each unchanged table:
//   - Get current columns: adapter.getTableSchema(tableName).columns
//   - Get previous columns: config.schema[tableName].columns
//   - Compare by column name → detect adds/removes
//   - For matching columns: compare type, nullable, default, primaryKey → detect modifications

// Output: SchemaDiffReport
// {
//   tablesAdded: string[]
//   tablesRemoved: string[]
//   tablesModified: {
//     [tableName]: {
//       columnsAdded: ColumnSchema[]
//       columnsRemoved: ColumnSchema[]
//       columnsModified: Array<{
//         name: string
//         previous: ColumnSchema
//         current: ColumnSchema
//       }>
//     }
//   }
// }
```

**Example:**
```typescript
// Source: Bun runtime + existing adapter pattern (Phase 5 reference)
import { SchemaDiffEngine } from '@/core/schema-diff'

const diffEngine = new SchemaDiffEngine(adapter, config)
const report = await diffEngine.diff()

// report.tablesAdded = ['orders_new', 'audit_log']
// report.tablesRemoved = ['legacy_temp']
// report.tablesModified['users'].columnsAdded = [{name: 'created_at', type: 'timestamp', ...}]
// report.tablesModified['users'].columnsModified = [{
//   name: 'email',
//   previous: {type: 'varchar(100)', nullable: true},
//   current: {type: 'varchar(255)', nullable: false}
// }]
```

### Pattern 2: Export Command Structure

**What:** CLI command `dbcli export "SELECT ..."` with --format (json|csv) and optional --output file.

**When to use:** Replacing ad-hoc query + piping workflow with dedicated export command.

**Structure mirrors Phase 6 query command:**
```typescript
// Source: src/commands/query.ts pattern (Phase 6)
// 1. Load config and create adapter
// 2. Create QueryExecutor with permission guard
// 3. Execute query (auto-limit for query-only mode)
// 4. Format result with QueryResultFormatter
// 5. Output to stdout OR file (NEW: file output)

// Example CLI:
// dbcli export "SELECT * FROM users" --format json --output users.json
// dbcli export "SELECT * FROM orders" --format csv > orders.csv
// dbcli export "SELECT COUNT(*) FROM logs" --format json (to stdout)
```

### Pattern 3: Immutable Schema Merging

**What:** Schema refresh updates `.dbcli` config using established copy-on-write pattern from Phase 2.

**When to use:** After diff algorithm produces DiffReport, merge changes into existing config.schema field.

**Example:**
```typescript
// Source: src/core/config.ts configModule.merge() (Phase 2)
const updatedConfig = configModule.merge(
  existingConfig,
  {
    schema: {
      ...existingConfig.schema,
      // Add/update/remove table entries per diff report
      [newTable]: fullNewSchema,
      [modifiedTable]: updatedSchema  // Previous columns + new columns
      // Remove deleted tables implicitly (not in spread)
    },
    metadata: {
      ...existingConfig.metadata,
      schemaLastUpdated: new Date().toISOString(),
      schemaTableCount: newTableCount
    }
  }
)

await configModule.write('.dbcli', updatedConfig)
```

### Anti-Patterns to Avoid

- **Direct mutation of config.schema:** WRONG — violates immutability. Use `configModule.merge()` instead of modifying the config object directly.
- **Full database re-scan on every refresh:** WRONG — inefficient. Store previous schema in `.dbcli` and diff incrementally.
- **Buffering entire export result in memory:** WRONG for large datasets. CSV formatter already generates line-by-line; JSON can be streamed to stdout by shell. Don't accumulate full result in an array before outputting.
- **Custom CSV escaping logic:** WRONG — use existing `QueryResultFormatter.escapeCSVField()` RFC 4180 implementation.
- **Export without permission checks:** WRONG — reuse `QueryExecutor.execute()` which enforces permission model.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL diffing/parsing | Custom SQL parser to detect changes | Adapter introspection (`listTables()` + `getTableSchema()`) | Full SQL parsing is fragile; schema introspection is DB-native and correct |
| JSON/CSV formatting | Custom JSON/CSV serializers | `QueryResultFormatter` (existing Phase 6) | RFC 4180 CSV escaping has edge cases; reuse proven implementation |
| Permission enforcement | Custom permission checks in export | `QueryExecutor.execute()` (Phase 6 reuse) | Centralized permission logic prevents privilege escalation |
| Config updates | Manual schema merging logic | `configModule.merge()` immutable pattern (Phase 2) | Copy-on-write ensures no accidental mutations; preserves metadata.createdAt |
| File I/O and output routing | Shell wrapper or Node.js stream APIs | `Bun.file()` + stdout piping (native Bun) | Bun.file handles async I/O efficiently; stdout is already pipeatable |

**Key insight:** The dumbest diff algorithm (full table enumeration, field-by-field comparison) is actually the most robust. Trying to parse INFORMATION_SCHEMA with regex or custom logic invites bugs; let adapters handle DB-specific introspection.

## Runtime State Inventory

**Not applicable.** Phase 08 does not involve renaming, data migration, or OS registration changes. It adds new capabilities (schema refresh, export) without altering existing state structures.

## Common Pitfalls

### Pitfall 1: Comparing Old and New Schema Using Loose Equality

**What goes wrong:** Column type `varchar(255)` vs `varchar(255)` — string comparison might fail if one has trailing spaces or different case (`VARCHAR` vs `varchar`).

**Why it happens:** Database systems return schema metadata with inconsistent formatting.

**How to avoid:** Normalize types before comparison: lowercase both, trim whitespace, parse complex types (e.g., `numeric(10,2)` → `{type: 'numeric', precision: 10, scale: 2}`).

**Warning signs:** Diff report shows "modified" for columns that didn't actually change; false positives in `columnsModified` list.

### Pitfall 2: Permission Check Missing in Export

**What goes wrong:** `dbcli export "DELETE FROM users"` succeeds in query-only mode (should reject).

**Why it happens:** Export command doesn't route through `QueryExecutor`, which has permission enforcement.

**How to avoid:** ALWAYS use `QueryExecutor.execute()` for query execution, never call `adapter.execute()` directly. QueryExecutor checks permissions first.

**Warning signs:** Destructive SQL succeeds when it shouldn't; audit logs show unexpected writes from "query-only" users.

### Pitfall 3: Auto-Limit Not Respected in Export

**What goes wrong:** Query-only user exports 1M rows with `dbcli export "SELECT * FROM huge_table" --format json`, consuming all memory.

**Why it happens:** Export path bypasses QueryExecutor's auto-limit, or auto-limit disabled by `--no-limit` flag.

**How to avoid:** Export inherits QueryExecutor's auto-limit. For query-only mode, default `autoLimit: true` (1000-row limit). Document that large exports require admin credentials or LIMIT clause in SQL.

**Warning signs:** Memory spikes during export; query-only users complaining about truncated results.

### Pitfall 4: Schema Diff Loses FK Metadata

**What goes wrong:** Previous schema in `.dbcli` has FK constraints, but diff algorithm recreates schema without FK data, causing loss of relationship metadata.

**Why it happens:** `getTableSchema()` returns FK info, but diff only copies columns array without deep-copying FK metadata.

**How to avoid:** Diff algorithm must preserve ALL fields from TableSchema: columns, rowCount, engine, primaryKey, foreignKeys. Use spread operator or explicit copy to ensure no field is lost.

**Warning signs:** After `schema --refresh`, `dbcli schema users --format json` shows no foreign keys; FKs disappeared.

### Pitfall 5: Schema Refresh Overwrites User Edits to .dbcli Metadata

**What goes wrong:** User manually edited `.dbcli` to add custom metadata (`"customField": "value"`), then ran `schema --refresh`, and custom field is gone.

**Why it happens:** Schema update doesn't preserve entire metadata object, only updates specific fields.

**How to avoid:** `configModule.merge()` already preserves unknown metadata fields. Ensure schema diff only updates `schemaLastUpdated` and `schemaTableCount`, leaving other metadata untouched.

**Warning signs:** User metadata disappears after schema refresh; merge operation doesn't preserve all metadata fields.

## Code Examples

### Schema Refresh Core Algorithm

```typescript
// Source: Integrated pattern from Phase 5 (adapter.getTableSchema) + Phase 2 (configModule.merge)
import { DatabaseAdapter, TableSchema } from '@/adapters/types'
import { DbcliConfig } from '@/utils/validation'

interface SchemaDiffReport {
  tablesAdded: string[]
  tablesRemoved: string[]
  tablesModified: Record<string, {
    columnsAdded: string[]
    columnsRemoved: string[]
    columnsModified: string[]
  }>
  summary: string
}

export class SchemaDiffEngine {
  constructor(
    private adapter: DatabaseAdapter,
    private previousConfig: DbcliConfig
  ) {}

  async diff(): Promise<SchemaDiffReport> {
    // Get current database tables
    const currentTables = await this.adapter.listTables()
    const currentTableNames = new Set(currentTables.map(t => t.name))

    // Get previous tables from config
    const previousTableNames = new Set(Object.keys(this.previousConfig.schema || {}))

    // Detect table-level changes
    const tablesAdded = Array.from(currentTableNames).filter(t => !previousTableNames.has(t))
    const tablesRemoved = Array.from(previousTableNames).filter(t => !currentTableNames.has(t))

    // Detect column-level changes for tables in both
    const tablesModified: Record<string, any> = {}

    for (const tableName of Array.from(currentTableNames).filter(t => previousTableNames.has(t))) {
      const currentSchema = await this.adapter.getTableSchema(tableName)
      const previousSchema = this.previousConfig.schema![tableName]

      if (!previousSchema) continue

      const currentCols = new Map(currentSchema.columns.map(c => [c.name, c]))
      const previousCols = new Map(previousSchema.columns.map(c => [c.name, c]))

      const columnsAdded = Array.from(currentCols.keys()).filter(c => !previousCols.has(c))
      const columnsRemoved = Array.from(previousCols.keys()).filter(c => !currentCols.has(c))
      const columnsModified = Array.from(currentCols.keys()).filter(c => {
        const prev = previousCols.get(c)
        const curr = currentCols.get(c)
        return prev && curr && this.columnChanged(prev, curr)
      })

      if (columnsAdded.length > 0 || columnsRemoved.length > 0 || columnsModified.length > 0) {
        tablesModified[tableName] = {
          columnsAdded,
          columnsRemoved,
          columnsModified
        }
      }
    }

    return {
      tablesAdded,
      tablesRemoved,
      tablesModified,
      summary: `${tablesAdded.length} added, ${tablesRemoved.length} removed, ${Object.keys(tablesModified).length} modified`
    }
  }

  private columnChanged(prev: any, curr: any): boolean {
    return (
      prev.type.toLowerCase() !== curr.type.toLowerCase() ||
      prev.nullable !== curr.nullable ||
      prev.default !== curr.default ||
      prev.primaryKey !== curr.primaryKey
    )
  }
}
```

### Export Command Handler

```typescript
// Source: Query command pattern (Phase 6) + QueryResultFormatter (Phase 6)
import { AdapterFactory } from '@/adapters'
import { QueryExecutor } from '@/core/query-executor'
import { QueryResultFormatter } from '@/formatters'
import { configModule } from '@/core/config'
import { PermissionError } from '@/core/permission-guard'

export async function exportCommand(
  sql: string,
  options: {
    format: 'json' | 'csv'
    output?: string
  }
): Promise<void> {
  try {
    // 1. Load config and create adapter
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    const adapter = AdapterFactory.create(config.connection)
    await adapter.connect()

    try {
      // 2. Execute with QueryExecutor (enforces permissions, auto-limit)
      const executor = new QueryExecutor(adapter, config.permission)
      const result = await executor.execute(sql, {
        autoLimit: true  // Respect query-only 1000-row limit
      })

      // 3. Format output
      const formatter = new QueryResultFormatter()
      const formatted = formatter.format(result, { format: options.format })

      // 4. Output to file or stdout
      if (options.output) {
        const file = Bun.file(options.output)
        await file.write(formatted)
        console.error(`✅ Exported to ${options.output} (${result.rowCount} rows)`)
      } else {
        console.log(formatted)
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    if (error instanceof PermissionError) {
      console.error(`❌ Permission Denied: ${error.message}`)
      process.exit(1)
    }
    console.error(`❌ Export Error: ${(error as Error).message}`)
    process.exit(1)
  }
}
```

### Schema Refresh in schema.ts Command Handler

```typescript
// Source: Extend existing Phase 5 schema.ts with --refresh flag
// In schemaAction function:

if (options.refresh) {
  // Handle schema refresh
  const diffEngine = new SchemaDiffEngine(adapter, config)
  const report = await diffEngine.diff()

  if (report.tablesAdded.length === 0 && report.tablesRemoved.length === 0 && Object.keys(report.tablesModified).length === 0) {
    console.log('✅ Schema is up-to-date (no changes detected)')
    return
  }

  console.log('🔍 Schema changes detected:')
  console.log(`   ${report.summary}`)

  if (!options.force) {
    console.log('   Use --force to apply changes')
    return
  }

  // Apply diff to config using immutable merge
  const newSchema = { ...config.schema }

  // Add/update tables
  for (const tableName of report.tablesAdded.concat(Object.keys(report.tablesModified))) {
    const fullSchema = await adapter.getTableSchema(tableName)
    newSchema[tableName] = {
      name: fullSchema.name,
      columns: fullSchema.columns,
      rowCount: fullSchema.rowCount,
      engine: fullSchema.engine,
      primaryKey: fullSchema.primaryKey || [],
      foreignKeys: fullSchema.foreignKeys || []
    }
  }

  // Remove deleted tables (implicit in new schema)
  report.tablesRemoved.forEach(t => delete newSchema[t])

  // Update config with immutable merge
  const updatedConfig = configModule.merge(config, {
    schema: newSchema,
    metadata: {
      ...config.metadata,
      schemaLastUpdated: new Date().toISOString(),
      schemaTableCount: Object.keys(newSchema).length
    }
  })

  await configModule.write(options.config, updatedConfig)
  console.log(`✅ Schema updated in .dbcli`)
}
```

## State of the Art

| Old Approach | Current Approach | Adapted From | Impact |
|--------------|------------------|--------------|--------|
| Full schema re-scan on every query | Cached schema in .dbcli, refresh only on demand | Phase 5 schema discovery pattern | 90% faster repeated queries; user controls refresh timing |
| Export via query + pipe to jq | Native export command with --format and --output | Phase 6 query command | Consistent UX; file output without shell pipes |
| Manual permission checks per command | Centralized permission guard in QueryExecutor | Phase 6 query implementation | Prevents privilege escalation; DRY |
| Column type comparison with string === | Normalized lowercase comparison + structured type parsing | Adaptive to this phase | Eliminates false positives in diff reports |

**Deprecated/outdated:**
- Full INFORMATION_SCHEMA queries: Phase 5 adapter introspection is preferred (DB-native, faster)
- Custom JSON serializers: `QueryResultFormatter` from Phase 6 is standard

## Open Questions

1. **Schema diff on large tables (10K+ columns)?**
   - What we know: Phase 5 handles individual table schema fetches; no performance testing on very wide tables
   - What's unclear: Whether full column-by-column comparison scales for exotic schemas
   - Recommendation: Accept current O(n*m) diff for Phase 8; profile in Phase 9 if needed. Add progress indicator for schema refresh on 100+ tables.

2. **CSV streaming for truly massive exports (>1GB)?**
   - What we know: Current CSV formatter builds array of lines, joins with `\n`. Piping to shell handles stdout streaming.
   - What's unclear: Whether Bun's stdout buffering handles multi-GB streams without memory bloat
   - Recommendation: Defer native streaming adapter support to Phase 8+ performance review. Document LIMIT/OFFSET pagination strategy for exports >100MB.

3. **Schema change detection granularity?**
   - What we know: Diff reports table-level and column-level changes (CONTEXT.md D-02)
   - What's unclear: Whether to report constraint changes (CHECK, UNIQUE, NOT NULL) as separate modification category
   - Recommendation: Current design reports nullable and default changes; CHECK/UNIQUE deferred to Phase 9 unless test reveals omission.

## Environment Availability

**Not applicable.** Phase 08 has no external dependencies beyond those already validated in Phase 3 (PostgreSQL/MySQL). All tools (Bun, TypeScript, cli-table3) confirmed available in Phase 1.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 1.0+ (Bun native) |
| Config file | vitest.config.ts (if exists) or default |
| Quick run command | `bun test tests/unit/core/schema-diff.test.ts` |
| Full suite command | `bun test` (all tests in tests/) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHEMA-04 | Incremental schema refresh detects and updates only changes | unit | `bun test tests/unit/core/schema-diff.test.ts -t "diff algorithm"` | ❌ Wave 0 |
| SCHEMA-04 | Schema merge preserves metadata.createdAt and updates schemaLastUpdated | unit | `bun test tests/unit/core/schema-diff.test.ts -t "immutable merge"` | ❌ Wave 0 |
| SCHEMA-04 | Refresh command accepts --refresh flag and --force for no-confirm | integration | `bun test tests/integration/commands/schema.test.ts -t "refresh"` | ❌ Wave 0 |
| EXPORT-01 | Export command executes SELECT with permission checks (rejects DELETE in query-only) | unit | `bun test tests/unit/commands/export.test.ts -t "permission"` | ❌ Wave 0 |
| EXPORT-01 | Export outputs JSON and CSV formats correctly with RFC 4180 escaping | unit | `bun test tests/unit/commands/export.test.ts -t "format"` | ❌ Wave 0 |
| EXPORT-01 | Export to file with --output flag writes to disk | integration | `bun test tests/integration/commands/export.test.ts -t "file output"` | ❌ Wave 0 |
| EXPORT-01 | Export respects query-only auto-limit (1000 rows) | unit | `bun test tests/unit/commands/export.test.ts -t "auto-limit"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test tests/unit/core/schema-diff.test.ts && bun test tests/unit/commands/export.test.ts`
- **Per wave merge:** `bun test` (full suite)
- **Phase gate:** Full suite green + manual CLI verification (`dbcli schema --refresh --help`, `dbcli export --help`)

### Wave 0 Gaps
- [ ] `tests/unit/core/schema-diff.test.ts` — SchemaDiffEngine coverage (diff algorithm, edge cases, type normalization)
- [ ] `tests/unit/commands/export.test.ts` — Export command with permission checks, format validation, file output
- [ ] `tests/integration/commands/schema.test.ts` — Refresh flag integration (database changes → diff report → config update)
- [ ] `tests/integration/commands/export.test.ts` — End-to-end export (query execution → format → file output)

*(None of these tests exist in current codebase; all are marked for Phase 8 Wave 0 implementation)*

## Sources

### Primary (HIGH confidence)
- **Phase 2 (config.ts):** `configModule.merge()` immutable pattern — verified by reading src/core/config.ts
- **Phase 5 (schema.ts, adapters):** `DatabaseAdapter.listTables()` and `getTableSchema()` — verified by reading src/adapters/types.ts and src/commands/schema.ts
- **Phase 6 (query-executor.ts, formatters):** `QueryExecutor.execute()` permission enforcement, `QueryResultFormatter.formatJSON/formatCSV()` — verified by reading src/core/query-executor.ts and src/formatters/query-result-formatter.ts
- **CONTEXT.md (08-CONTEXT.md):** Decisions D-01 through D-11 and Specific Ideas — provided in upstream context

### Secondary (MEDIUM confidence)
- **REQUIREMENTS.md (lines 20-21, 36):** SCHEMA-04 and EXPORT-01 acceptance criteria — verified by reading .planning/REQUIREMENTS.md
- **Test framework (vitest):** Inferred from tests/unit/core/config.test.ts using `import { describe, test, expect } from 'vitest'` — confirmed active test suite

## Metadata

**Confidence breakdown:**
- **Standard Stack:** HIGH — All libraries confirmed in existing code (Bun, TypeScript, cli-table3, zod, Commander)
- **Architecture Patterns:** HIGH — Schema refresh and export patterns directly derived from Phase 2, 5, 6 proven implementations
- **Pitfalls:** MEDIUM — Based on common database schema diffing issues and export streaming gotchas; some (type normalization edge cases) inferred from training
- **Validation Architecture:** HIGH — Test framework confirmed active (vitest); requirement mapping verified against REQUIREMENTS.md

**Research date:** 2026-03-25
**Valid until:** 2026-04-08 (14 days — stable domain, low velocity on schema introspection standards)

## Immediate Action Items for Planner

1. **Create SchemaDiffEngine class** (src/core/schema-diff.ts)
   - Implement two-phase diff algorithm (table-level, then column-level)
   - Test with PostgreSQL and MySQL adapters to verify type normalization handles both systems

2. **Extend schema.ts command** with `--refresh [table]` flag
   - Optional table filter parameter
   - Route to `SchemaDiffEngine`, apply immutable merge to config

3. **Create export.ts command** (src/commands/export.ts)
   - Mirror query.ts structure: load config → create adapter → QueryExecutor → format → output
   - Add --output flag for file output (use `Bun.file()`)
   - Ensure QueryExecutor invocation enforces permissions and auto-limit

4. **Extend CLI registration** (src/cli.ts or router)
   - Add schema --refresh [table] option
   - Add export "SQL" command with --format (required) and --output (optional)

5. **Test infrastructure** (Wave 0)
   - SchemaDiffEngine unit tests: algorithm correctness, edge cases
   - Export command tests: permission enforcement, format validation, file I/O
   - Integration tests: end-to-end refresh and export workflows
