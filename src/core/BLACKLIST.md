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
- `checkTablesBlacklist(operation, tables)` blocks when *any* referenced table is
  blacklisted. `checkTableBlacklist()` is the single-table form and delegates to it.
- `filterColumnsForTables(tables, rows, columns)` removes the union of the column
  rules of every referenced table (immutable). `filterColumns()` is the
  single-table form. An **empty** table list means "the tables could not be
  identified", and applies *every* column rule rather than none.
- `buildSecurityNotification()` creates footer messages for filtered queries

**Which tables count** — `extractTableReferences()` (`src/utils/sql-tables.ts`)
enumerates them. It reports every positional table reference *and* every
identifier that is not a known SQL keyword, so a table reached through a JOIN,
a comma, a UNION branch, a subquery, or a grammar corner the positional walk
does not model is still reported. It over-reports by design: an extra name
blocks more, a missing name discloses data (issue #23).

**Consequence you will meet in practice:** a statement can be refused naming a
table you did not query. `SELECT t.token FROM api_keys t` is refused when a
table named `token` is blacklisted, because `token` appears as an identifier.
The error names the match, so the diagnosis is in the message. This is the price
of the guarantee, and it fails in the safe direction.

**Table entries are enforceable; column entries are a display filter.** Masking
matches the name a column arrives under, so `SELECT password_hash AS x FROM
users`, `substr(password_hash, 1, 10)`, `to_json(u)`, and MongoDB's
`$project: { stolen: '$sec.token' }` all return the value under a name no rule
covers. A column that genuinely must not be readable needs a database grant.
See `docs/security-threat-model.md`.

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

Not every command runs through `QueryExecutor`, so each path that reaches an
adapter directly carries its own enforcement. `tests/unit/core/execution-path-contract.test.ts`
registers them all.

1. **QueryExecutor** (`src/core/query-executor.ts`) — used by `query`, `export`
   (SQL), `snapshot`:
   - Before execution: `checkTablesBlacklist()` over every referenced table
   - After execution: `filterColumnsForTables()` for result rows
   - `securityNotification` stored in `QueryResult.metadata`

2. **DataExecutor** (`src/core/data-executor.ts`):
   - Before SQL building: `checkTableBlacklist()` for INSERT/UPDATE/DELETE
   - `BlacklistError` is re-thrown (not swallowed)

3. **Saved snippets** (`src/commands/q.ts`) — checks the snippet body, and for
   SQL also `verify.query`, then masks the result rows. Elasticsearch snippets
   are checked as index *expressions*; Redis is enforced inside its adapter.

4. **Interactive shell** (`src/core/repl/repl-engine.ts`) — talks to the adapter
   directly; blocks and masks with the same validator.

5. **Reports** (`src/core/report/run-diagnostic.ts`) — evidence rows are rendered
   into the report and snippets come from user-writable directories, so a
   blacklisted table skips the snippet and the rows are masked.

6. **Elasticsearch / MongoDB / Redis** — `export` and `query` check the index or
   collection and mask fields on each engine's own path. The Elasticsearch shell
   (`src/commands/es-shell.ts`, with the checks themselves in
   `src/commands/es-shell-guards.ts`) carries its own equivalent, since it calls
   `adapter.request` rather than `execute`; that call site is registered in the
   contract test like any other. Its object-scoped checks are skipped when
   neither `blacklist.tables` nor `blacklist.columns` is configured — the
   permission tier gate above them is not (ADR-0014 Decision 9).

   Redis and MongoDB carry their rules on the adapter, set by the factory from
   the configuration, so a command cannot reach either engine without them
   (ADR-0015 Decision 1). On Redis that covers `execute`'s parsed command and
   the `insert` / `update` / `delete` API, and `SCAN` / `KEYS` replies have
   protected key *names* removed (Decision 3). On MongoDB a request that names a
   protected field is refused rather than masked, because `$project`, `$set`,
   `$addFields` and `$group` all choose the key a value comes back under
   (Decision 2).

## Error Messages

All messages are i18n-enabled. Override language with `DBCLI_LANG=zh-TW`.

| Key | Default message |
|-----|----------------|
| `errors.table_blacklisted` | "Error: Table '{table}' is blacklisted for {operation} operations" |
| `security.columns_omitted` | "Security: {count} column(s) were omitted based on your blacklist" |
| `warnings.blacklist_override_used` | "Warning: Blacklist override enabled..." |
| `shell.es.blacklist_index` | "index '{index}' is blacklist-protected" |
| `shell.es.blacklist_unscoped` | "'{path}' names no index, so it cannot be checked against the blacklist..." |
| `shell.es.blacklist_field` | "field '{field}' is blacklist-protected and cannot be named in a request..." |
| `blacklist.refuse_wildcard` | "Refused: '{table}' contains wildcard characters, which are matched literally on {system}..." |

The three `shell.es.*` refusals are prefixed in code with the untranslated
`BlacklistRejection: ` token, which is what the recovery path matches on.
