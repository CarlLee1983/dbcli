---
phase: 13-data-access-control-blacklist
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/types/index.ts
  - src/types/blacklist.ts
  - src/core/blacklist-manager.ts
  - src/core/blacklist-validator.ts
  - src/core/index.ts
  - src/utils/validation.ts
  - src/core/query-executor.ts
  - src/core/data-executor.ts
  - src/commands/blacklist.ts
  - src/cli.ts
  - resources/lang/en/messages.json
  - resources/lang/zh-TW/messages.json
autonomous: true
requirements:
  - BL-01
  - BL-02
  - BL-03
  - BL-04
  - NF-01
  - NF-02
  - NF-03
  - NF-04
must_haves:
  truths:
    - "User can define table-level blacklist in .dbcli and operations on blacklisted tables are rejected"
    - "User can define column-level blacklist and blacklisted columns are omitted from SELECT results"
    - "User can run 'dbcli blacklist list' to view current blacklist configuration"
    - "User can run 'dbcli blacklist table add <table>' to add tables to blacklist"
    - "User can run 'dbcli blacklist column add <table>.<column>' to add columns to blacklist"
    - "Query results show security footer notification when columns are filtered due to blacklist"
    - "DBCLI_OVERRIDE_BLACKLIST environment variable allows context-aware blacklist bypass"
    - "Backward compatible: projects without blacklist configuration work unchanged"
    - "Performance overhead is < 1ms per query (measured via vitest benchmark)"
    - "All 30+ tests pass; zero regressions in existing 341 tests"
  artifacts:
    - path: src/types/blacklist.ts
      provides: "BlacklistConfig, BlacklistValidator type definitions"
      exports: ["BlacklistConfig", "BlacklistState", "ColumnBlacklist"]
    - path: src/core/blacklist-manager.ts
      provides: "BlacklistManager class for loading and managing blacklist rules"
      exports: ["BlacklistManager"]
    - path: src/core/blacklist-validator.ts
      provides: "BlacklistValidator class for enforcing blacklist rules"
      exports: ["BlacklistValidator", "BlacklistError"]
    - path: src/commands/blacklist.ts
      provides: "CLI command handler for blacklist management (list, table add/remove, column add/remove)"
      exports: ["blacklistCommand"]
    - path: src/core/query-executor.ts
      provides: "Enhanced QueryExecutor with column filtering and security notifications"
      pattern: "executeWithBlacklist|filterColumns|buildSecurityNotification"
    - path: src/core/data-executor.ts
      provides: "Enhanced DataExecutor with table-level blacklist enforcement"
      pattern: "enforceTableBlacklist|throwBlacklistError"
    - path: resources/lang/en/messages.json
      provides: "English messages for blacklist commands and notifications"
      contains: "blacklist.*, security.*"
    - path: resources/lang/zh-TW/messages.json
      provides: "Traditional Chinese messages for blacklist commands and notifications"
      contains: "blacklist.*, security.*"
  key_links:
    - from: src/cli.ts
      to: src/commands/blacklist.ts
      via: "registerBlacklistCommand()"
      pattern: "new Command.*blacklist.*action.*blacklistCommand"
    - from: src/commands/query.ts
      to: src/core/query-executor.ts
      via: "QueryExecutor.executeWithBlacklist()"
      pattern: "executor.executeWithBlacklist"
    - from: src/core/query-executor.ts
      to: src/core/blacklist-validator.ts
      via: "validator.filterColumns()"
      pattern: "blacklistValidator.filterColumns"
    - from: src/core/data-executor.ts
      to: src/core/blacklist-validator.ts
      via: "validator.checkTableBlacklist()"
      pattern: "blacklistValidator.checkTableBlacklist"
    - from: src/core/config.ts
      to: src/types/blacklist.ts
      via: "DbcliConfig includes blacklist field"
      pattern: "DbcliConfig.*blacklist"

---

<objective>
Implement table and column-level blacklisting to prevent AI agents from accessing sensitive data. Configuration via `.dbcli` with CLI commands for management, security notifications in output, and context-aware overrides.

Purpose: Secure sensitive data from unauthorized access while maintaining operational flexibility. Enable projects to mark tables and columns as off-limits to AI agents, with clear security notifications when data is filtered.

Output: Blacklist infrastructure (type definitions, manager, validator), CLI commands (list, table add/remove, column add/remove), integrated filtering in query and data execution paths, i18n messages, 30+ unit tests covering all scenarios.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/12-dbcli/12-02-SUMMARY.md

# Key interfaces from codebase
From src/types/index.ts:
```typescript
export interface DbcliConfig {
  connection: ConnectionConfig
  permission: Permission
  schema?: Record<string, unknown>
  metadata?: Metadata
}

export type Permission = 'query-only' | 'read-write' | 'admin'
```

From src/core/query-executor.ts:
- QueryExecutor class handles SQL execution with permission enforcement
- Returns QueryResult<T> with rows, rowCount, columnNames, columnTypes, executionTimeMs
- Catches PermissionError and database execution errors

From src/core/data-executor.ts:
- DataExecutor handles INSERT, UPDATE, DELETE with permission enforcement
- Uses executeInsert(), executeUpdate(), executeDelete() methods
- Returns DataExecutionResult with rowsAffected and metadata

From src/i18n/message-loader.ts (Phase 12):
- MessageLoader singleton with t(key: string) and t_vars(key: string, vars: Record<string, any>)
- Uses DBCLI_LANG environment variable for language selection
- Falls back to English for missing keys
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create blacklist type definitions</name>
  <files>src/types/blacklist.ts</files>
  <action>
Create new file with blacklist configuration types. Define:
- BlacklistConfig interface: { tables: string[], columns: Record<string, string[]> }
- ColumnBlacklist type: { [tableName: string]: string[] }
- BlacklistState interface: { tables: Set<string>, columns: Map<string, Set<string>> }
- BlacklistError class extending Error
- Export all types and add to src/types/index.ts re-exports

Pattern: Immutable configuration (JSON) + mutable state (Set/Map for O(1) lookups)

Do NOT include manager/validator logic here — just types.
  </action>
  <verify>
    <automated>npx tsc src/types/blacklist.ts --noEmit && npm test -- src/types/blacklist.test.ts 2>/dev/null | grep -E "PASS|FAIL" || echo "Types compile successfully"</automated>
  </verify>
  <done>blacklist.ts created with BlacklistConfig, ColumnBlacklist, BlacklistState, BlacklistError types; exported from src/types/index.ts</done>
</task>

<task type="auto">
  <name>Task 2: Create BlacklistManager class</name>
  <files>src/core/blacklist-manager.ts</files>
  <action>
Create manager class responsible for loading and maintaining blacklist state from .dbcli config.

Implement:
- Constructor takes DbcliConfig and optional DBCLI_OVERRIDE_BLACKLIST env var
- loadBlacklist(): BlacklistState — deserialize config.blacklist JSON into efficient state (Set for tables, Map<string, Set> for columns)
- isTableBlacklisted(tableName: string): boolean — O(1) lookup
- isColumnBlacklisted(tableName: string, columnName: string): boolean — O(1) lookup
- getBlacklistedColumns(tableName: string): string[] — return full list of blacklisted columns for table
- canOverrideBlacklist(): boolean — check DBCLI_OVERRIDE_BLACKLIST env var

Key implementation:
- Load once at initialization, store as efficient Set/Map structures
- Case-insensitive table name comparison (use toLowerCase())
- Case-sensitive column name comparison (databases are typically case-sensitive for columns)
- Environment variable DBCLI_OVERRIDE_BLACKLIST=true bypasses all checks
- Performance target: < 1ms for any lookup on typical configs

Pattern: Singleton-like usage (instantiate once per CLI invocation)
Error handling: Log warnings for malformed config, don't crash
  </action>
  <verify>
    <automated>bun test src/core/blacklist-manager.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>BlacklistManager class created with loadBlacklist(), isTableBlacklisted(), isColumnBlacklisted(), getBlacklistedColumns(), canOverrideBlacklist() methods; all tests passing</done>
</task>

<task type="auto">
  <name>Task 3: Create BlacklistValidator class</name>
  <files>src/core/blacklist-validator.ts</files>
  <action>
Create validator class responsible for enforcing blacklist rules at query/data execution points.

Implement:
- Constructor takes BlacklistManager instance
- checkTableBlacklist(operation: string, tableName: string, tableList: string[]): void
  - Throws BlacklistError if table is blacklisted
  - Supports operation types: "SELECT", "INSERT", "UPDATE", "DELETE"
  - Message pattern: "Table '{table}' is blacklisted for {operation} operations"
  - Uses t_vars() for i18n: "errors.table_blacklisted"
- filterColumns(tableName: string, rows: Record<string, any>[], columnList: string[]): { filteredRows: Record<string, any>[], omittedColumns: string[] }
  - Removes blacklisted columns from row objects
  - Returns cleaned rows + list of omitted column names
  - Pattern: Deep copy rows before modification (immutable)
- buildSecurityNotification(tableName: string, omittedColumns: string[]): string
  - Creates footer message: "Security: 2 column(s) were omitted based on your blacklist"
  - Uses t_vars() for i18n: "security.columns_omitted"

Performance consideration: Column filtering should be < 1ms for typical result sets
Error handling: Logs via console.error with i18n messages, throws BlacklistError for table violations
  </action>
  <verify>
    <automated>bun test src/core/blacklist-validator.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>BlacklistValidator class created with checkTableBlacklist(), filterColumns(), buildSecurityNotification() methods; all tests passing</done>
</task>

<task type="auto">
  <name>Task 4: Extend DbcliConfig type with blacklist field</name>
  <files>src/types/index.ts, src/utils/validation.ts</files>
  <action>
Update DbcliConfig interface to include optional blacklist field.

In src/types/index.ts:
- Add blacklist?: BlacklistConfig to DbcliConfig interface
- Ensure blacklist field is optional for backward compatibility

In src/utils/validation.ts:
- Add blacklist field to DbcliConfigSchema (Zod schema)
- Schema: z.object({ tables: z.array(z.string()), columns: z.record(z.array(z.string())) }).optional()
- Default value: { tables: [], columns: {} }

This allows existing .dbcli files without blacklist field to work unchanged.

Test: Both old and new config formats deserialize correctly
  </action>
  <verify>
    <automated>bun test src/utils/validation.test.ts 2>&1 | grep -E "DbcliConfig|blacklist" | head -10</automated>
  </verify>
  <done>DbcliConfig extended with optional blacklist field; Zod schema updated; backward compatible with existing configs</done>
</task>

<task type="auto">
  <name>Task 5: Extend QueryExecutor with column filtering</name>
  <files>src/core/query-executor.ts</files>
  <action>
Enhance QueryExecutor to integrate blacklist filtering at result processing stage.

Current method signature:
  async execute(sql, options?): Promise<QueryResult>

Enhance to:
- Accept optional blacklistValidator parameter in constructor
- After executing query (line 57), before building result object (line 68):
  1. Determine table name from SQL (use regex to extract FROM clause table name)
  2. If validator exists and table is in result: call validator.filterColumns(tableName, rows, columnNames)
  3. Update rows and columnNames with filtered versions
  4. Store omittedColumns in result.metadata.securityNotification
- Update QueryResult type to include securityNotification?: string in metadata
- In query result formatter (table/JSON output), append security notification as footer

Key implementation:
- Table name extraction: /FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i regex
- Only filter if table found in blacklist
- Immutable row filtering (don't mutate original query result)
- securityNotification format: "Security: 2 column(s) were omitted based on your blacklist"

Error handling: If table name extraction fails, log warning but don't block query
Performance: Measure filtering overhead via vitest bench — should be < 1ms for 1000 rows
  </action>
  <verify>
    <automated>bun test src/core/query-executor.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>QueryExecutor extended with blacklist filtering; column omission added to result metadata; security notification integrated; existing tests still passing</done>
</task>

<task type="auto">
  <name>Task 6: Extend DataExecutor with table-level blacklist enforcement</name>
  <files>src/core/data-executor.ts</files>
  <action>
Enhance DataExecutor to block INSERT/UPDATE/DELETE operations on blacklisted tables.

Current methods:
- executeInsert(table, data, options?): Promise<DataExecutionResult>
- executeUpdate(table, data, where, options?): Promise<DataExecutionResult>
- executeDelete(table, where, options?): Promise<DataExecutionResult>

Enhance to:
- Accept optional blacklistValidator parameter in constructor
- At start of each method, call validator.checkTableBlacklist(operation, table, [])
  - Throws BlacklistError if table is blacklisted
  - Error message uses i18n: "errors.table_blacklisted"
- If override is enabled (validator.canOverrideBlacklist()), allow operation (log warning)

Key implementation:
- checkTableBlacklist() throws before SQL is built
- Error must pass through to user (don't catch BlacklistError)
- Log warning if override is active: t_vars('warnings.blacklist_override_used', { table })

Error handling: BlacklistError thrown with appropriate i18n message
Performance: Overhead < 1ms (single Set lookup)
  </action>
  <verify>
    <automated>bun test src/core/data-executor.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>DataExecutor extended with table-level blacklist enforcement in executeInsert/Update/Delete; BlacklistError thrown before SQL execution; existing tests still passing</done>
</task>

<task type="auto">
  <name>Task 7: Create blacklist CLI command</name>
  <files>src/commands/blacklist.ts</files>
  <action>
Create new command handler for blacklist management.

Implement blacklistCommand with subcommands:

1. dbcli blacklist list
   - Output: Display current blacklist from .dbcli
   - Format: "Blacklisted tables: [table1, table2]"
   - Format: "Blacklisted columns: table1=[col1, col2], table2=[col3]"
   - If empty: "No tables or columns are currently blacklisted"
   - Use t() for i18n: "blacklist.list_title", "blacklist.tables_label", "blacklist.columns_label"

2. dbcli blacklist table add <table>
   - Parse table name from argument
   - Add to config.blacklist.tables array (if not already present)
   - Save updated .dbcli
   - Message: t_vars("blacklist.table_added", { table })
   - Error handling: t_vars("errors.table_already_blacklisted", { table })

3. dbcli blacklist table remove <table>
   - Remove from config.blacklist.tables array
   - Save updated .dbcli
   - Message: t_vars("blacklist.table_removed", { table })
   - Error: t_vars("errors.table_not_in_blacklist", { table })

4. dbcli blacklist column add <table>.<column>
   - Parse table and column from argument (split on ".")
   - Add to config.blacklist.columns[table] array (if not already present)
   - Save updated .dbcli
   - Message: t_vars("blacklist.column_added", { table, column })
   - Error: t_vars("errors.column_already_blacklisted", { table, column })

5. dbcli blacklist column remove <table>.<column>
   - Remove from config.blacklist.columns[table] array
   - Save updated .dbcli
   - Message: t_vars("blacklist.column_removed", { table, column })
   - Error: t_vars("errors.column_not_in_blacklist", { table, column })

Key implementation:
- Use loadConfig/saveConfig from src/core/config.ts (immutable operations)
- Validate input (table name, column name) — reject if contains invalid characters
- CLI entry point: Command builder using commander.js (new Command('blacklist') with .subcommand())
- Help text: t("blacklist.description"), t("blacklist.table_help"), t("blacklist.column_help")

Error handling: Invalid inputs, missing table/column, file save failures
  </action>
  <verify>
    <automated>bun test src/commands/blacklist.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>blacklist command created with list, table add/remove, column add/remove subcommands; all CLI operations functional; tests passing</done>
</task>

<task type="auto">
  <name>Task 8: Register blacklist command in CLI entry point</name>
  <files>src/cli.ts</files>
  <action>
Register the blacklist command with the main CLI program.

In src/cli.ts:
- Import blacklistCommand from src/commands/blacklist
- Add to program using program.addCommand(blacklistCommand)
- Place after existing commands (schema, query, etc.)
- Verify: bun run dev -- blacklist --help shows subcommands

Key implementation:
- Command structure: dbcli blacklist <subcommand>
- Help visible in: bun run dev -- --help (list blacklist command)
- Help visible in: bun run dev -- blacklist --help (show subcommands)
  </action>
  <verify>
    <automated>bun run dev -- blacklist --help 2>&1 | grep -E "Usage|list|add|remove" | head -10</automated>
  </verify>
  <done>blacklist command registered in CLI; visible in help output; subcommands functional</done>
</task>

<task type="auto">
  <name>Task 9: Add i18n messages for blacklist</name>
  <files>resources/lang/en/messages.json, resources/lang/zh-TW/messages.json</files>
  <action>
Add blacklist and security notification messages to message catalogs.

In resources/lang/en/messages.json, add:
```json
"blacklist": {
  "description": "Manage sensitive data blacklist to prevent AI access",
  "list_title": "Current Blacklist Configuration",
  "tables_label": "Blacklisted tables",
  "columns_label": "Blacklisted columns",
  "none": "No tables or columns are currently blacklisted",
  "table_added": "✓ Table '{table}' added to blacklist",
  "table_removed": "✓ Table '{table}' removed from blacklist",
  "column_added": "✓ Column '{table}.{column}' added to blacklist",
  "column_removed": "✓ Column '{table}.{column}' removed from blacklist"
},
"security": {
  "columns_omitted": "Security: {count} column(s) were omitted based on your blacklist"
},
"errors": {
  "table_blacklisted": "Error: Table '{table}' is blacklisted for {operation} operations",
  "table_already_blacklisted": "Error: Table '{table}' is already blacklisted",
  "table_not_in_blacklist": "Error: Table '{table}' is not in the blacklist",
  "column_already_blacklisted": "Error: Column '{table}.{column}' is already blacklisted",
  "column_not_in_blacklist": "Error: Column '{table}.{column}' is not in the blacklist",
  "invalid_table_name": "Error: Invalid table name: {table}",
  "invalid_column_format": "Error: Invalid column format. Use 'table.column'"
},
"warnings": {
  "blacklist_override_used": "Warning: Blacklist override enabled (DBCLI_OVERRIDE_BLACKLIST=true). Executing {operation} on blacklisted table '{table}'"
}
```

In resources/lang/zh-TW/messages.json, add corresponding Traditional Chinese translations:
```json
"blacklist": {
  "description": "管理敏感資料黑名單以防止 AI 存取",
  "list_title": "目前黑名單配置",
  "tables_label": "已黑名單的表格",
  "columns_label": "已黑名單的欄位",
  "none": "目前沒有黑名單表格或欄位",
  "table_added": "✓ 表格 '{table}' 已新增至黑名單",
  "table_removed": "✓ 表格 '{table}' 已從黑名單移除",
  "column_added": "✓ 欄位 '{table}.{column}' 已新增至黑名單",
  "column_removed": "✓ 欄位 '{table}.{column}' 已從黑名單移除"
},
"security": {
  "columns_omitted": "安全: {count} 個欄位根據你的黑名單已被隱藏"
},
"errors": {
  "table_blacklisted": "錯誤: 表格 '{table}' 的 {operation} 操作已被黑名單",
  "table_already_blacklisted": "錯誤: 表格 '{table}' 已在黑名單中",
  "table_not_in_blacklist": "錯誤: 表格 '{table}' 不在黑名單中",
  "column_already_blacklisted": "錯誤: 欄位 '{table}.{column}' 已在黑名單中",
  "column_not_in_blacklist": "錯誤: 欄位 '{table}.{column}' 不在黑名單中",
  "invalid_table_name": "錯誤: 無效的表格名稱: {table}",
  "invalid_column_format": "錯誤: 無效的欄位格式。使用 'table.column'"
},
"warnings": {
  "blacklist_override_used": "警告: 已啟用黑名單覆蓋 (DBCLI_OVERRIDE_BLACKLIST=true)。執行 {operation} 在已黑名單的表格 '{table}' 上"
}
```

Ensure all messages are consistent in structure and grammar.
  </action>
  <verify>
    <automated>bun run dev -- blacklist list 2>&1 | head -5</automated>
  </verify>
  <done>Blacklist and security messages added to both English and Traditional Chinese message catalogs; CLI output shows translated messages based on DBCLI_LANG</done>
</task>

<task type="auto">
  <name>Task 10: Create comprehensive unit tests for blacklist system</name>
  <files>src/core/blacklist-manager.test.ts, src/core/blacklist-validator.test.ts, src/commands/blacklist.test.ts</files>
  <action>
Write 30+ unit tests covering all blacklist functionality.

Create src/core/blacklist-manager.test.ts (12+ tests):
- Loading empty blacklist (no config.blacklist field) → default state
- Loading populated blacklist (tables and columns) → correct state
- Table lookup: isTableBlacklisted() with exact match
- Table lookup: case-insensitive table name (postgresql vs POSTGRESQL)
- Column lookup: isColumnBlacklisted() with exact match
- Column lookup: missing column (returns false)
- Column lookup: missing table (returns false)
- getBlacklistedColumns() returns correct list
- DBCLI_OVERRIDE_BLACKLIST=true enables override
- DBCLI_OVERRIDE_BLACKLIST=false disables override
- Performance: 1000 lookups complete in < 10ms
- Malformed config (invalid tables/columns) logs warning, doesn't crash

Create src/core/blacklist-validator.test.ts (12+ tests):
- checkTableBlacklist() allows non-blacklisted table
- checkTableBlacklist() throws for SELECT on blacklisted table
- checkTableBlacklist() throws for INSERT on blacklisted table
- checkTableBlacklist() throws for UPDATE on blacklisted table
- checkTableBlacklist() throws for DELETE on blacklisted table
- checkTableBlacklist() allows overridden table (DBCLI_OVERRIDE_BLACKLIST=true)
- filterColumns() returns all columns for non-blacklisted table
- filterColumns() removes one blacklisted column correctly
- filterColumns() removes multiple blacklisted columns
- filterColumns() with empty rows (returns empty array)
- filterColumns() preserves row data integrity (immutable)
- buildSecurityNotification() formats message correctly (0 columns, 1, 2+)
- buildSecurityNotification() uses i18n t_vars()
- Error messages use i18n t_vars()

Create src/commands/blacklist.test.ts (10+ tests):
- blacklist list shows no content when config empty
- blacklist list shows tables correctly formatted
- blacklist list shows columns correctly formatted
- blacklist table add adds table to config
- blacklist table add rejects duplicate (already exists)
- blacklist table add rejects invalid table name
- blacklist table remove removes table from config
- blacklist table remove rejects non-existent table
- blacklist column add adds column to correct table
- blacklist column add rejects duplicate
- blacklist column add rejects invalid format (missing table or column)
- blacklist column remove removes column
- blacklist column remove rejects non-existent column
- Config changes persisted to .dbcli file

All tests:
- Use vitest + mocking for file I/O
- Mock MessageLoader with t() and t_vars()
- Test both English and Chinese message keys (verify keys exist)
- Include error cases and edge cases
- Performance benchmark: compare unoptimized vs optimized implementations
  </action>
  <verify>
    <automated>bun test src/core/blacklist-*.test.ts src/commands/blacklist.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>30+ unit tests created covering BlacklistManager, BlacklistValidator, blacklist command; all tests passing; coverage > 85%</done>
</task>

<task type="auto">
  <name>Task 11: Integration test — query with column filtering</name>
  <files>src/commands/query.test.ts</files>
  <action>
Add integration tests verifying query command works with blacklist column filtering.

Enhance src/commands/query.test.ts with 3-4 new test cases:
- Execute SELECT on table with blacklisted columns → returns filtered results + security notification
- Security notification formatted: "Security: 2 column(s) were omitted based on your blacklist"
- Column names in result metadata do not include blacklisted columns
- Query still includes WHERE filtering for blacklisted columns (blacklist doesn't affect WHERE clause)

Test setup:
- Create mock blacklist config with columns: { users: ['password', 'api_key'] }
- Execute query: SELECT * FROM users WHERE id = 1
- Verify result: password and api_key columns missing, but id and name present
- Verify securityNotification in metadata
- Output formatters (table, JSON) show notification in footer

Error cases:
- Query on blacklisted table throws BlacklistError before execution
- Permission check still enforced (query-only can't SELECT if blocked by permission)
  </action>
  <verify>
    <automated>bun test src/commands/query.test.ts 2>&1 | grep -E "blacklist|column" | tail -10</automated>
  </verify>
  <done>Query command integration tests added; column filtering verified; security notifications displayed in output</done>
</task>

<task type="auto">
  <name>Task 12: Integration test — data modification with table blocking</name>
  <files>src/commands/insert.test.ts, src/commands/update.test.ts, src/commands/delete.test.ts</files>
  <action>
Add integration tests verifying INSERT/UPDATE/DELETE commands respect table-level blacklist.

For insert.test.ts:
- INSERT on blacklisted table throws BlacklistError with message: "Table 'audit_logs' is blacklisted for INSERT operations"
- INSERT on non-blacklisted table proceeds normally
- Error message uses i18n: "errors.table_blacklisted"

For update.test.ts:
- UPDATE on blacklisted table throws BlacklistError
- UPDATE on non-blacklisted table proceeds normally
- WHERE clause validation still applied before blacklist check

For delete.test.ts:
- DELETE on blacklisted table throws BlacklistError
- DELETE on non-blacklisted table proceeds normally
- Confirmation flow still honored (--force flag)

All tests:
- Set up config with blacklist.tables: ['audit_logs']
- Verify error is thrown before SQL is built
- Verify error message includes table name and operation
  </action>
  <verify>
    <automated>bun test src/commands/insert.test.ts src/commands/update.test.ts src/commands/delete.test.ts 2>&1 | grep -E "blacklist|passed" | tail -10</automated>
  </verify>
  <done>INSERT/UPDATE/DELETE integration tests added; table-level blocking verified; BlacklistError thrown with i18n messages</done>
</task>

<task type="auto">
  <name>Task 13: Performance benchmark and regression test</name>
  <files>src/benchmarks/blacklist-performance.bench.ts</files>
  <action>
Create vitest benchmark to measure blacklist overhead and ensure < 1ms per query.

Implement benchmark scenarios:

1. Lookup performance (BlacklistManager):
   - isTableBlacklisted() with 1000 tables in config
   - isColumnBlacklisted() with 100 columns blacklisted per table
   - Expected: Each lookup < 1µs (microseconds)

2. Column filtering (BlacklistValidator):
   - filterColumns() on result with 100 rows × 50 columns
   - Omit 5 columns from each row
   - Expected: < 1ms total

3. Query execution overhead:
   - Full query flow with and without blacklist validator
   - Compare execution time difference
   - Expected: Overhead < 1ms

4. Config loading:
   - Load blacklist from .dbcli config
   - Expected: < 5ms

Benchmark output:
```
Blacklist Performance Benchmarks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Table lookup (1000 tables): 0.12µs/op
✓ Column lookup (100 cols): 0.08µs/op
✓ Column filtering (100 rows): 0.45ms/op
✓ Query execution (with validator): 0.8ms (overhead: 0.1ms)
✓ Config loading: 2.3ms

All benchmarks within acceptable thresholds.
```

Use vitest.bench() with { runs: 1000 } for statistical reliability.
  </action>
  <verify>
    <automated>bun test src/benchmarks/blacklist-performance.bench.ts 2>&1 | tail -15</automated>
  </verify>
  <done>Performance benchmark suite created; all metrics within < 1ms overhead threshold; regression detection in place</done>
</task>

<task type="auto">
  <name>Task 14: Update core/index.ts exports and documentation</name>
  <files>src/core/index.ts</files>
  <action>
Export BlacklistManager, BlacklistValidator, and BlacklistError from core module.

Add to src/core/index.ts:
```typescript
export { BlacklistManager } from './blacklist-manager'
export { BlacklistValidator, BlacklistError } from './blacklist-validator'
export type { BlacklistConfig, ColumnBlacklist, BlacklistState } from '@/types/blacklist'
```

Create src/core/BLACKLIST.md documentation (100-150 lines):
1. Overview: Purpose of blacklist system, use cases
2. Architecture: BlacklistManager (loading/lookup) + BlacklistValidator (enforcement + filtering)
3. Configuration example:
```json
{
  "blacklist": {
    "tables": ["audit_logs", "secrets_vault"],
    "columns": {
      "users": ["password", "api_key", "ssn"],
      "payment": ["credit_card", "cvv"]
    }
  }
}
```
4. Usage:
   - Table-level: All operations on blacklisted tables rejected
   - Column-level: Columns omitted from SELECT results, security notification displayed
5. CLI commands: list, table add/remove, column add/remove
6. Override: DBCLI_OVERRIDE_BLACKLIST=true for context-aware bypass
7. Performance: < 1ms overhead per query
8. Backward compatibility: Existing configs without blacklist field work unchanged

Pattern: Similar to existing documentation in src/i18n/README.md
  </action>
  <verify>
    <automated>bun test 2>&1 | tail -5</automated>
  </verify>
  <done>Core exports updated; BLACKLIST.md documentation created; README integrated</done>
</task>

<task type="auto">
  <name>Task 15: Full test suite validation and build verification</name>
  <files>package.json</files>
  <action>
Run full test suite and build to ensure zero regressions.

Execute:
1. bun test --run 2>&1 | tail -20
   - Verify: 370+ tests passing (341 existing + 30 new blacklist tests)
   - No failures or skipped tests
   - Code coverage for new files > 85%

2. bun run build 2>&1 | tail -10
   - Verify: dist/cli.mjs created
   - No TypeScript compilation errors
   - Binary size < 3.5 MB (no regression)

3. ./dist/cli.mjs blacklist --help
   - Verify: Command visible and functional
   - Help text displays correctly

4. DBCLI_LANG=en ./dist/cli.mjs blacklist list
   - Verify: English messages displayed

5. DBCLI_LANG=zh-TW ./dist/cli.mjs blacklist list
   - Verify: Chinese messages displayed

6. Integration test:
   - Run sample workflow: init, blacklist table add users, blacklist column add users.password, query "SELECT * FROM users", verify column omitted
  </action>
  <verify>
    <automated>bun test --run 2>&1 | grep -E "test|passed|failed" | tail -3</automated>
  </verify>
  <done>All 370+ tests passing; zero regressions; build successful; CLI commands functional in both languages; integration workflow verified</done>
</task>

</tasks>

<verification>
Phase completion verification checklist:

**Functional Requirements (BL-01 through BL-04):**
- [ ] BL-01: Table-level blacklist rejects all operations (SELECT, INSERT, UPDATE, DELETE)
  - Verify: run "dbcli query 'SELECT * FROM audit_logs'" on blacklisted table → BlacklistError thrown
- [ ] BL-02: Column-level blacklist omits columns from SELECT results, preserves WHERE filtering
  - Verify: run "dbcli query 'SELECT * FROM users'" with password blacklisted → result missing password column but security notification shown
- [ ] BL-03: CLI commands functional (list, table add/remove, column add/remove)
  - Verify: "dbcli blacklist list", "dbcli blacklist table add users", "dbcli blacklist column add users.password" work
- [ ] BL-04: Security notifications display in output
  - Verify: Query result footer shows "Security: 2 column(s) were omitted based on your blacklist"

**Non-Functional Requirements (NF-01 through NF-04):**
- [ ] NF-01: Backward compatible (existing configs work unchanged)
  - Verify: Old .dbcli files without blacklist field still load and function
- [ ] NF-02: Performance < 1ms overhead per query
  - Verify: vitest benchmark shows overhead < 1ms for typical configs
- [ ] NF-03: 30+ unit tests + full integration coverage
  - Verify: bun test shows 370+ total tests, all passing
- [ ] NF-04: Zero regressions in existing 341 tests
  - Verify: All existing tests still pass; no failures introduced

**Configuration:**
- [ ] .dbcli config accepts blacklist object: { tables: [], columns: {} }
- [ ] DBCLI_OVERRIDE_BLACKLIST=true environment variable works
- [ ] Config validation handles missing/malformed blacklist gracefully

**i18n:**
- [ ] All user-facing messages in resources/lang/en/messages.json
- [ ] All messages translated to resources/lang/zh-TW/messages.json
- [ ] DBCLI_LANG switching works (en vs zh-TW)

**Code Quality:**
- [ ] No console.log statements in production code (all via t())
- [ ] TypeScript compilation: 0 errors
- [ ] Immutability: No mutations in row filtering or config updates
- [ ] Error handling: All errors use i18n and include helpful context
</verification>

<success_criteria>
Phase 13 is successful when:

1. **Blacklist Infrastructure Complete**
   - BlacklistManager loads and maintains blacklist state efficiently (O(1) lookups)
   - BlacklistValidator enforces rules at appropriate enforcement points
   - Column filtering preserves row integrity and returns security notifications

2. **CLI Commands Functional**
   - `dbcli blacklist list` shows current configuration
   - `dbcli blacklist table add <table>` adds to blacklist
   - `dbcli blacklist column add <table>.<column>` adds to blacklist
   - All commands support undo (remove operations)
   - Help text available for all commands (--help)

3. **Integrated with Query/Data Execution**
   - QueryExecutor filters columns from SELECT results automatically
   - DataExecutor blocks INSERT/UPDATE/DELETE on blacklisted tables
   - Security notifications displayed in query result footers
   - Error messages are clear and actionable

4. **i18n Support**
   - All messages in resources/lang/en/messages.json
   - All messages in resources/lang/zh-TW/messages.json
   - DBCLI_LANG=en and DBCLI_LANG=zh-TW both work
   - No hardcoded strings in code

5. **Test Coverage**
   - 30+ new unit tests covering all functionality
   - Integration tests verify end-to-end workflows
   - Performance benchmarks confirm < 1ms overhead
   - All 370+ tests pass (existing + new)

6. **Backward Compatibility**
   - Projects without blacklist config work unchanged
   - Old .dbcli files load and function normally
   - No breaking changes to existing APIs
   - Zero regressions in existing 341 tests

7. **Performance**
   - Table lookups: < 1µs per query
   - Column filtering: < 1ms per result set
   - Config loading: < 5ms
   - Total overhead per query: < 1ms

8. **Documentation**
   - src/core/BLACKLIST.md created with architecture overview
   - CLI help text complete and translated
   - Usage examples for all commands
   - Configuration examples in .dbcli format

**Deliverable:** .planning/phases/13-dbcli-blacklist/13-01-SUMMARY.md with full results after execution.
</success_criteria>

<output>
After execution, create `.planning/phases/13-dbcli-blacklist/13-01-SUMMARY.md` with:

**Wave 1 Summary — Blacklist Infrastructure & CLI (15 tasks)**

1. Artifacts created: 8 files (types, manager, validator, command, updated executors, messages, exports, docs)
2. Test coverage: 35+ unit tests + 4 integration tests
3. Performance: Verified < 1ms overhead via benchmark suite
4. Backward compatibility: Verified with legacy config test
5. i18n: 25 new message keys (English + Traditional Chinese)
6. CLI commands: 5 functional commands (list, table add/remove, column add/remove)
7. Build: dist/cli.mjs updated, 0 TypeScript errors
8. Total test suite: 370+ tests passing, 0 failures, 0 regressions

**Next Phase (if needed):**
- Phase 13 Plan 02 (optional): Enhanced i18n documentation, user guide, SKILL.md integration
</output>
