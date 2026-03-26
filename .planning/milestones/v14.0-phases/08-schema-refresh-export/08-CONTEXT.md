# Phase 8: Schema Refresh & Export - Context

**Gathered:** 2026-03-25 (assumptions-based analysis)
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement incremental schema refresh (`dbcli schema --refresh`) to detect and update only schema changes in `.dbcli` config, plus `dbcli export "SQL"` command for querying data with multiple output formats (JSON, CSV) and optional file output. Streaming support addresses large result sets. Restore operations, data sync, and advanced export features deferred to later phases.

</domain>

<decisions>
## Implementation Decisions

### Schema Refresh Strategy
- **D-01:** Schema diffing will compare in-memory `.dbcli` schema snapshot (from previous `dbcli schema` scan) with live database schema via adapter introspection (`listTables()` + `getTableSchema()`)
- **D-02:** Diff reports will track: added tables, removed tables, added columns (per table), removed columns, modified columns (type/constraint changes)
- **D-03:** Schema update uses immutable `configModule.merge()` pattern (established in Phase 2) to overlay deltas into existing `.dbcli`, preserving metadata.createdAt and updating metadata.schemaLastUpdated (ISO timestamp)

### Export Implementation
- **D-04:** Export command uses buffered results from adapters (Bun.sql returns `Promise<T[]>`) — not streaming to adapter level, but stdout piping already provides CLI-level streaming
- **D-05:** Output formats: standard JSON (not newline-delimited) and RFC 4180 CSV (line-by-line generation)
- **D-06:** Large dataset handling respects existing permission model: Query-only enforces 1000-row auto-limit (from Phase 6); Read-Write/Admin allow unlimited exports (user responsible for memory/performance)
- **D-07:** CLI supports `--output file.json|file.csv` for file export; default to stdout (pipe-able with `jq`, `grep`, etc.)

### Streaming for Large Results
- **D-08:** "Streaming" is achieved via: (a) CSV formatter generates line-by-line without buffering entire result; (b) JSON formatter outputs single blob (piping to shell handles stdout streaming); (c) Query-only mode auto-limit prevents memory bloat for restricted users; (d) Admin users who export 100K+ rows use LIMIT/OFFSET pagination for batched exports
- **D-09:** No changes to adapter interface required — existing `Promise<T[]>` is sufficient for Phase 8 goals

### Command Interface
- **D-10:** `dbcli schema --refresh [table]` — Optional table filter; if omitted, refresh entire schema (same async pattern as Phase 5 `dbcli schema` without args)
- **D-11:** `dbcli export "SELECT * FROM users" --format json|csv [--output file]` — Format flag required, output optional (defaults to stdout)

### the agent's Discretion
- Exact diff algorithm (full table scan vs INFORMATION_SCHEMA optimization per DB system)
- CSV escaping implementation details (use existing RFC 4180 logic from Phase 6 or enhance)
- Progress indicator for large schema scans (`dbcli schema --refresh` on 1000+ tables)
- Error recovery for partial schema updates (roll back entire diff, or retry only failed tables)

</decisions>

<specifics>
## Specific Ideas

- Schema diff report should be human-readable and machine-parseable: "3 tables added, 2 removed, 5 columns modified" on success
- `--refresh` flag on `dbcli schema` should update `.dbcli` in-place without requiring separate confirmation (same confidence flow as Phase 5)
- Export result should include metadata (row count, execution time, format) similar to query command output

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Requirements
- `.planning/REQUIREMENTS.md` § SCHEMA-04, EXPORT-01 — Incremental refresh and export acceptance criteria
- `.planning/ROADMAP.md` § Phase 8 — Phase boundary, dependencies on Phases 3, 5, 6

### Existing Patterns & Code
- `src/core/config.ts` — Immutable configModule.merge() pattern for schema updates (established Phase 2)
- `src/core/query-executor.ts` — QueryExecutor.executeQuery() method, auto-limit pattern for Query-only mode (Phase 6)
- `src/adapters/types.ts` — DatabaseAdapter interface: `listTables()`, `getTableSchema()` methods
- `src/types/index.ts` — TableSchema, ColumnSchema interfaces with FK metadata (from Phase 5)
- `src/formatters/query-result-formatter.ts` — Output formatting pattern: JSON, CSV, table formats (Phase 6)
- `src/commands/schema.ts` — Existing `dbcli schema` command structure (Phase 5 baseline)
- `src/commands/query.ts` — Query command with --format flag and error handling (Phase 6 reference)

### Permission Model
- `src/core/permission-guard.ts` — Permission levels and enforcement (Phase 4)
- Phase 6 auto-limit: Query-only mode enforces 1000-row limit via QueryExecutor

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **configModule.merge()** (src/core/config.ts): Copy-on-write pattern for updating config while preserving metadata — directly applicable to schema delta merging
- **QueryResultFormatter** (src/formatters/query-result-formatter.ts): JSON/CSV/table format methods — adapt for export command output
- **QueryExecutor** (src/core/query-executor.ts): Permission enforcement, auto-limit logic for Query-only mode — reuse for export permission checks
- **DatabaseAdapter interface** (src/adapters/types.ts): `listTables()` and `getTableSchema()` already available in PostgreSQL/MySQL adapters
- **CSV formatting** (query-result-formatter.ts lines 138-149): RFC 4180-compliant line-by-line generation — reusable for export CSV output

### Established Patterns
- **Adapter pattern**: All DB-specific logic in adapters (PostgreSQL, MySQL adapters); CLI commands stay DB-agnostic
- **Permission checks at executor level** (not CLI level): enforcePermission() called at start of execute methods
- **Immutable config updates**: configModule uses copy-on-write; no mutations
- **Output formatting via dedicated formatters**: JSON/CSV/table handled in formatters/, not in command handlers
- **Async CLI actions**: Commands are async, error handling via try/catch + console.error

### Integration Points
- Schema refresh integrates with existing config module (update .dbcli config.schema field)
- Export command integrates with existing adapter execution (same adapter.execute() pattern as query)
- Export permissions integrate with existing permission model (Query-only vs Read-Write vs Admin)
- Export output uses existing formatter infrastructure

</code_context>

<deferred>
## Deferred Ideas

- **Scheduled/automated schema refreshes** — Separate phase (cron jobs, watch mode)
- **Schema change notifications** — Alert user when schema diffs detected (Phase 9+)
- **Streaming at adapter level** — Bun.sql supports Promise<T[]> in current phase; explore native streaming in Phase 8+ if performance testing reveals bottleneck
- **Data sync/replication** — Out of scope for V1
- **Selective column export** — `dbcli export ... --columns "col1,col2"` — future enhancement
- **Compress export output** — `dbcli export ... --gzip` — deferred to performance phase
- **Change data capture (CDC)** — Enterprise feature, deferred to V2

</deferred>

---

*Phase: 08-schema-refresh-export*
*Context gathered: 2026-03-25*
