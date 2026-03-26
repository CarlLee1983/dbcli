# Phase 7: Data Modification - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `dbcli insert` and `dbcli update` commands with comprehensive safety safeguards. Both commands enforce permission-based access control, pre-execution confirmation, and SQL injection prevention via parameterized queries. Restore/delete operations are separate phases.

</domain>

<decisions>
## Implementation Decisions

### 📥 Data Input Method

- **D-01:** INSERT data input method: **JSON stdin primary** (`dbcli insert users < data.json`)
  - Enables piping, automation, and programmatic use
  - Alternative: `--data` flag for simple single-row cases (e.g., `--data '{"name":"Alice"}'`)

### 🔍 UPDATE Specification

- **D-02:** UPDATE command structure: **`--set` (data) + `--where` (condition)** as separate flags
  - Example: `dbcli update users --where "id=1" --set '{"name":"Bob"}'`
  - WHERE clause is **mandatory** (enforced at CLI level, not just in SQL)
  - Both flags accept JSON strings

### ✅ Pre-Execution Confirmation

- **D-03a:** Confirmation flow: **Automatic display of generated SQL + interactive y/n prompt**
  - Always show the SQL that will execute
  - Require explicit user confirmation (y/n) before execution
  - This is the default, non-skippable behavior

- **D-03b:** Support `--force` flag to **skip confirmation** (for automation/scripts)
  - `dbcli insert users --force < data.json` — execute without prompt
  - Suitable for CI/CD pipelines and background scripts
  - SQL still shown in output before execution

- **D-03c:** Support `--dry-run` mode to **show SQL without executing**
  - `dbcli update users --where "id=1" --set '{"name":"Bob"}' --dry-run`
  - No database changes occur
  - Useful for testing and verifying command behavior

### 📊 Output Format

- **D-04a:** Output content: **Simple, concise summary** showing only affected row count
  - Success: `{"status":"success","rows_affected":1,"operation":"insert"}`
  - Clear, minimal information for verification

- **D-04b:** Output format: **JSON consistently** (same format as `dbcli query --format json`)
  - Aligns with existing dbcli output conventions
  - Enables programmatic parsing and automation
  - Default output includes operation type, row count, and timestamp

### ⚠️ Error Handling & Permissions

- **D-05a:** Error messages: **Show generated SQL for transparency**
  - Helps users understand what went wrong and debug issues
  - Example error: `Error: SQL execution failed. Generated SQL: INSERT INTO... Cause: ...`
  - Enables users to verify command correctness

- **D-05b:** Permission rejection (Query-only mode): **Clear message with upgrade suggestion**
  - Message format: `"Permission denied: Query-only mode allows SELECT only. Use Read-Write or Admin mode for INSERT/UPDATE."`
  - Tells user both the restriction AND the solution
  - Read-Write mode rejects DELETE/DROP, Admin allows all operations

### the agent's Discretion

- Error message phrasing and exact format details
- JSON output field names and structure (beyond row count)
- Exact confirmation prompt wording (must include SQL display)
- Command-line argument parsing implementation details
- Connection/auth error messages

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Requirements
- `.planning/REQUIREMENTS.md` § DATA-01, DATA-02 — Data modification acceptance criteria and constraints
- `.planning/ROADMAP.md` § Phase 7 — Phase boundary, dependencies on Phases 3, 4, 6

### Existing Code Patterns
- `src/commands/query.ts` — Command structure, error handling, output formatting patterns
- `src/commands/init.ts` — Option handling, interactive prompts, CLI flag conventions
- `src/core/query-executor.ts` — Permission checking, SQL execution patterns
- `src/adapters/` — Database-specific SQL generation patterns

### Permission & Safety
- `src/core/permission-guard.ts` — Permission level enforcement (Query-only, Read-Write, Admin)
- `src/core/sql-classifier.ts` — SQL operation type detection (SELECT vs INSERT vs UPDATE vs DELETE)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **QueryResultFormatter** (src/formatters/): Formats output in table/json/csv — reuse for INSERT/UPDATE output
- **QueryExecutor** (src/core/): Permission checking and SQL validation — adapt for INSERT/UPDATE
- **Prompts module** (src/utils/prompts.ts): Interactive confirmation prompts — reuse for y/n confirmation

### Established Patterns
- All commands use Commander.js with `.option()` and `.action()` structure
- Configuration via `.dbcli` JSON file, loaded by `configModule`
- Permission checking via `PermissionError` exception pattern
- Database adapters handle DB-specific SQL (PostgreSQL, MySQL, MariaDB)

### Integration Points
- CLI entry point: `src/cli.ts` registers all commands (will register insert/update)
- Database connection: All commands use `AdapterFactory.createAdapter()`
- Output formatting: Existing JSON/table/csv formatters apply to data operations

</code_context>

<specifics>
## Specific Ideas

- INSERT and UPDATE commands should work with the existing permission model from Phase 4 (Query-only rejects writes, Read-Write allows them, Admin allows all)
- Parameterized queries must prevent SQL injection — use adapter-specific parameter binding (e.g., `?` for MySQL, `$1` for PostgreSQL)
- Commands should match the command-line style already established by `dbcli query` and `dbcli schema`

</specifics>

<deferred>
## Deferred Ideas

- Bulk operations (importing CSV, batch updates) — separate phase
- Transaction support / rollback on multi-row failure — Phase 8+
- Audit logging (who changed what when) — Phase 9+
- DELETE operation — separate phase (risky, belongs with advanced data ops)
- Interactive field-by-field prompts for INSERT (too verbose vs stdin) — if needed post-V1

</deferred>

---

*Phase: 07-data-modification*
*Context gathered: 2026-03-25*
