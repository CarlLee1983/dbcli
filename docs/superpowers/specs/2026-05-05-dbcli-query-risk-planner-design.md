# dbcli Query Risk Planner Design

Date: 2026-05-05
Status: Approved for implementation planning

## Goal

Add a `dbcli plan` command that analyzes a SQL statement before execution and returns a safety decision for AI agents and humans. The feature should help agents avoid unsafe database actions by checking permissions, blacklist rules, SQL risk patterns, and available schema cache metadata without connecting to the database.

## MVP Scope

The MVP exposes:

```bash
dbcli plan "SQL_STATEMENT" [--format text|json] [--use CONNECTION]
```

The implementation should also introduce a reusable query risk engine so future `insert`, `update`, and `delete` command preflight modes can call the same analyzer. The MVP does not need to expose `--plan` on DML commands yet.

## Non-goals

- No live database `EXPLAIN`, `COUNT`, or row-estimate queries in the MVP.
- No built-in LLM or natural-language-to-SQL generation.
- No automatic SQL rewriting or execution.
- No full SQL parser dependency unless existing project patterns already provide one.
- No DDL execution support through `plan`; destructive DDL should be detected and blocked or warned as unsupported.

## User Experience

### Text output

Default output is human-readable text:

```text
Decision: BLOCK
Operation: UPDATE
Target tables: users

Risk factors:
- UPDATE statement has no WHERE clause.
- Target table users is medium size.

Recommendations:
- Add a WHERE clause.
- Run a SELECT count(*) with the same condition before executing.
- Use --dry-run on the actual write command.
```

Text output should stay concise and should not include copy-paste command blocks by default.

### JSON output

`--format json` returns a stable machine-readable result for agents:

```json
{
  "decision": "BLOCK",
  "operation": "UPDATE",
  "targetTables": ["users"],
  "riskFactors": [
    {
      "code": "write_missing_where",
      "severity": "block",
      "message": "UPDATE statement has no WHERE clause."
    }
  ],
  "recommendations": [
    "Add a WHERE clause.",
    "Use --dry-run on the actual write command."
  ],
  "suggestedCommands": [
    "dbcli schema users --format json",
    "dbcli plan \"UPDATE users SET status='inactive' WHERE id = 123\" --format json"
  ]
}
```

`suggestedCommands` is JSON-only to keep human output clean while still giving agents structured next steps.

## Decision Model

Use a three-level decision:

- `ALLOW`: no obvious risk was detected.
- `WARN`: execution may be acceptable, but the user or agent should inspect warnings.
- `BLOCK`: execution is unsafe, unsupported, or violates configured safety constraints.

The final decision is the highest severity among detected risk factors.

## MVP Risk Rules

### BLOCK

- `UPDATE` without `WHERE`.
- `DELETE` without `WHERE`.
- Current permission does not allow the SQL operation.
- Target table is blacklisted.
- Statement appears to be destructive DDL such as `DROP`, `TRUNCATE`, or unsupported destructive `ALTER`.
- SQL type cannot be recognized and appears write-like or DDL-like.

### WARN

- `SELECT *`.
- Query targets a `large` or `huge` table and lacks an obvious `WHERE` or `LIMIT`.
- Target table is missing from schema cache.
- Query references a blacklisted column.
- Multi-table query has partial schema-cache coverage.
- SQL type cannot be recognized but appears read-like.

### ALLOW

- SQL operation is recognized.
- Current permission allows the operation.
- No blacklist rule is violated.
- Schema cache either confirms the target table or the query does not require table-level checks.
- No high-risk pattern is present.

## Schema Cache Integration

`dbcli plan` must not open a database connection in the MVP. It should read existing schema cache data for the selected connection.

The analyzer uses schema metadata to:

- confirm whether target tables are known;
- inspect known columns;
- check `estimatedRowCount` and `sizeCategory`;
- detect large or huge table access without filters;
- improve blacklist checks for columns.

If schema cache is absent or stale, the command should return `WARN` and recommend refreshing the schema, for example:

```bash
dbcli schema users --format json
```

For multi-connection projects, `--use CONNECTION` must select the corresponding schema cache and permission context, matching existing dbcli global flag behavior.

## Module Boundaries

Recommended new files:

```text
src/commands/plan.ts
src/core/query-risk-analyzer.ts
src/types/query-risk.ts
```

The command layer should handle CLI parsing, config loading, blacklist loading, schema cache lookup, and output formatting.

The core analyzer should stay pure and reusable:

```ts
analyzeQueryRisk(input: {
  sql: string;
  permission: PermissionLevel;
  blacklist: BlacklistConfig;
  schemaLookup: SchemaLookup;
}): QueryRiskResult;
```

Future DML commands can pass generated SQL to this same analyzer before execution.

## SQL Analysis Strategy

The MVP may use lightweight pattern analysis rather than a full SQL parser, provided tests cover expected safety behavior. The analyzer should normalize whitespace and comments enough to avoid obvious false negatives for core rules.

Minimum detection targets:

- operation: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, DDL/unknown;
- primary target tables for common single-table statements;
- simple multi-table references from `FROM` and `JOIN` clauses;
- presence of `WHERE`;
- presence of `LIMIT`;
- `SELECT *`;
- obvious destructive DDL keywords.

When uncertain, prefer `WARN` or `BLOCK` over silently returning `ALLOW`.

## Testing Strategy

Use `bun test` and existing project test patterns.

Required cases:

- `UPDATE` without `WHERE` returns `BLOCK`.
- `DELETE` without `WHERE` returns `BLOCK`.
- insufficient permission returns `BLOCK`.
- `SELECT *` returns `WARN`.
- large table without `WHERE` or `LIMIT` returns `WARN`.
- blacklisted table returns `BLOCK`.
- blacklisted column returns `WARN`.
- unknown table or missing schema cache returns `WARN`.
- safe `SELECT` with `WHERE` and `LIMIT` returns `ALLOW`.
- `--format json` emits stable fields including `suggestedCommands`.
- default text output omits `suggestedCommands`.

## Implementation Notes

- Preserve current dbcli behavior and command conventions.
- Prefer existing config, permission, blacklist, schema-cache, and formatter utilities before adding abstractions.
- Keep the analyzer deterministic and side-effect free.
- Do not introduce new dependencies unless an existing parser-free approach proves unreliable.
- Future `--live-estimate` or DML `--plan` support should build on the same result model.

## Open Follow-up Ideas

- Add `--live-estimate` for optional database-backed `EXPLAIN` or count estimates.
- Add `--plan` to `insert`, `update`, and `delete` commands.
- Add project policy rules such as forbidding `SELECT *` in production.
- Add audit logging for plan results and executed follow-up commands.
