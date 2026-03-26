# Blacklist System

Data access control for preventing AI agents from querying or modifying sensitive data.

## Overview

The blacklist system enables projects to define tables and columns that AI agents cannot access. This is essential for protecting sensitive data such as passwords, API keys, PII, and internal operational tables from being exposed through AI-assisted queries.

**Two levels of protection:**
- **Table-level**: All operations (SELECT, INSERT, UPDATE, DELETE) on blacklisted tables are rejected
- **Column-level**: Specific columns are omitted from SELECT results with a security notification

## Architecture

```
src/core/
  blacklist-manager.ts    # Config loading + O(1) lookup (Set/Map)
  blacklist-validator.ts  # Rule enforcement + column filtering
src/types/
  blacklist.ts            # BlacklistConfig, BlacklistState, BlacklistError
src/commands/
  blacklist.ts            # CLI: list, table add/remove, column add/remove
```

**BlacklistManager** — loads `.dbcli` config into efficient runtime structures:
- Table names stored as lowercase `Set<string>` for O(1) case-insensitive lookup
- Columns stored as `Map<tableName, Set<columnName>>` for O(1) per-column check
- Override support via `DBCLI_OVERRIDE_BLACKLIST=true` env var

**BlacklistValidator** — enforces rules at execution points:
- `checkTableBlacklist()` called by `QueryExecutor` and `DataExecutor`
- `filterColumns()` removes blacklisted columns from query results (immutable)
- `buildSecurityNotification()` creates footer messages for filtered queries

## Configuration

Add a `blacklist` object to your `.dbcli` file:

```json
{
  "connection": { ... },
  "permission": "query-only",
  "blacklist": {
    "tables": ["audit_logs", "secrets_vault"],
    "columns": {
      "users": ["password", "api_key", "ssn"],
      "payment": ["credit_card", "cvv"]
    }
  }
}
```

**Backward compatible**: Existing `.dbcli` files without a `blacklist` field work unchanged.

## CLI Commands

```bash
# View current blacklist
dbcli blacklist list

# Table-level blacklist
dbcli blacklist table add audit_logs
dbcli blacklist table remove audit_logs

# Column-level blacklist
dbcli blacklist column add users.password
dbcli blacklist column add users.api_key
dbcli blacklist column remove users.api_key
```

## Behavior

### Table-level blacklist

When a table is blacklisted, ALL operations are rejected before SQL is built:

```
$ dbcli query "SELECT * FROM audit_logs"
Error: Table 'audit_logs' is blacklisted for SELECT operations
```

### Column-level blacklist

When a table has blacklisted columns, SELECT results omit them with a notification:

```
$ dbcli query "SELECT * FROM users"
┌────┬──────────┬───────────────────┐
│ id │ name     │ email             │
├────┼──────────┼───────────────────┤
│  1 │ Alice    │ alice@example.com │
└────┴──────────┴───────────────────┘

Security: 2 column(s) were omitted based on your blacklist
```

**Note**: The WHERE clause is NOT affected by column blacklist — you can still filter by `password` in a WHERE clause, but `password` won't appear in results.

### Override

For authorized operations (e.g., data migration, admin tasks), bypass the blacklist:

```bash
DBCLI_OVERRIDE_BLACKLIST=true dbcli query "SELECT * FROM audit_logs"
```

A warning is logged when override is active. **Use with caution.**

## Performance

All lookups are O(1) using Set/Map data structures:

| Operation | Typical latency |
|-----------|----------------|
| Table lookup | < 0.01ms |
| Column lookup | < 0.01ms |
| Column filtering (1000 rows) | < 5ms |
| Config loading | < 5ms |
| Overall overhead per query | < 1ms |

## Integration Points

The blacklist is integrated at two execution points:

1. **QueryExecutor** (`src/core/query-executor.ts`):
   - Before execution: `checkTableBlacklist()` for all SQL operations
   - After execution: `filterColumns()` for SELECT results
   - `securityNotification` stored in `QueryResult.metadata`

2. **DataExecutor** (`src/core/data-executor.ts`):
   - Before SQL building: `checkTableBlacklist()` for INSERT/UPDATE/DELETE
   - `BlacklistError` is re-thrown (not swallowed)

## Error Messages

All messages are i18n-enabled. Override language with `DBCLI_LANG=zh-TW`.

| Key | Default message |
|-----|----------------|
| `errors.table_blacklisted` | "Error: Table '{table}' is blacklisted for {operation} operations" |
| `security.columns_omitted` | "Security: {count} column(s) were omitted based on your blacklist" |
| `warnings.blacklist_override_used` | "Warning: Blacklist override enabled..." |
