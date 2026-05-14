# DML `--plan` SQL MVP Design

Date: 2026-05-14
Status: Approved for implementation planning

## Goal

Add SQL-only `--plan` preflight support to `dbcli insert`, `dbcli update`, and `dbcli delete` so agents can ask for the same `QueryRiskResult` safety decision used by `dbcli plan <sql>` before choosing whether to run `--dry-run` or a real write.

## MVP Scope

The MVP exposes:

```bash
dbcli insert <table> --data '{"name":"Alice"}' --plan [--format text|json]
dbcli update <table> --set '{"status":"inactive"}' --where "id=1" --plan [--format text|json]
dbcli delete <table> --where "id=1" --plan [--format text|json]
```

The feature is SQL-only for PostgreSQL, MySQL, and MariaDB connections. It is explicitly no-connect and schema-cache-only: it reads CLI arguments, config, selected SQL connection metadata, permission, blacklist, and cached schema, then returns a risk decision without creating an adapter or opening a database connection.

The JSON output contract must remain exactly the existing `QueryRiskResult` shape. The MVP does not add DML-specific top-level fields.

## Non-goals

- No MongoDB, Redis, or Elasticsearch DML planning in this MVP.
- No live database `EXPLAIN`, `COUNT`, row estimate, schema refresh, or `getTableSchema()` call.
- No write execution and no interactive confirmation path.
- No guarantee that planner-only SQL is byte-for-byte identical to `--dry-run` adapter SQL.
- No business-correctness validation such as foreign-key, unique constraint, trigger, or domain-rule checks.
- No new SQL parser dependency.
- No audit logging; audit trail remains a later feature.

## User Experience

### Text output

`--plan` defaults to text output, matching `dbcli plan`:

```text
Decision: ALLOW
Operation: UPDATE
Target tables: users

Recommendations:
- Use --dry-run on the actual write command.
```

Text output stays concise and does not include `suggestedCommands`, preserving existing `formatPlanResult()` behavior.

### JSON output

`--format json` returns the existing stable `QueryRiskResult` contract:

```json
{
  "decision": "ALLOW",
  "operation": "DELETE",
  "targetTables": ["users"],
  "riskFactors": [],
  "recommendations": ["Use --dry-run on the actual write command."],
  "suggestedCommands": []
}
```

When schema cache is missing or a target table is absent from cache, the existing analyzer may return `WARN` and include schema refresh suggestions such as:

```json
{
  "decision": "WARN",
  "operation": "UPDATE",
  "targetTables": ["users"],
  "riskFactors": [
    {
      "code": "schema_cache_missing",
      "severity": "warn",
      "message": "Schema cache is missing for the selected connection."
    }
  ],
  "recommendations": [
    "Refresh schema cache for the target table before executing.",
    "Use --dry-run on the actual write command."
  ],
  "suggestedCommands": ["dbcli schema users --format json"]
}
```

## CLI Rules

Add these flags to `insert`, `update`, and `delete`:

- `--plan` — analyze intended DML without connecting or executing.
- `--format <type>` — `text` or `json`, default `text`, used only for `--plan` output.

Rules:

- `--plan` and `--dry-run` are mutually exclusive. Supplying both fails with a non-zero exit.
- `--plan` does not require or consume `--force`.
- `--plan` still requires the command's normal required arguments:
  - `insert`: table plus `--data` or stdin JSON.
  - `update`: table plus `--set` JSON and `--where`.
  - `delete`: table plus `--where`.
- Successful analysis exits `0` even when `decision` is `BLOCK`.
- CLI usage errors, config errors, invalid JSON, invalid where syntax, unsupported engines, and invalid format values exit non-zero.
- `--format` values outside `text|json` fail for `--plan`.

## Architecture

DML `--plan` is a thin command-layer wrapper around the existing query risk planner. It should not create a second analyzer.

```text
insert/update/delete command
  └─ if --plan:
      1. validate command arguments
      2. reject --plan + --dry-run
      3. load config through existing config resolution
      4. reject non-SQL engines for the MVP
      5. build planner-only SQL from DML inputs
      6. call analyzeQueryRisk()
      7. print through existing formatPlanResult()
      8. return before adapter creation or DB connection
```

Recommended file boundaries:

```text
src/core/dml-plan-sql.ts      # pure helper: CLI DML input -> planner-only SQL
src/commands/plan.ts          # export/reuse formatPlanResult()
src/commands/insert.ts        # add --plan branch before adapter creation
src/commands/update.ts        # add --plan branch before adapter creation
src/commands/delete.ts        # add --plan branch before adapter creation
src/cli.ts                    # wire --plan and --format flags for DML commands
```

The helper is intentionally small and pure. It does not read config, schema, blacklist, or permissions. It only converts validated command input into SQL that `analyzeQueryRisk()` can understand.

## Planner-only SQL Construction

The planner SQL is an analysis artifact. It must preserve operation, target table, written column names, and `WHERE` presence/columns well enough for the existing analyzer to apply permission, blacklist, schema-cache, and DML risk rules.

Examples:

```ts
buildInsertPlanSql('users', { name: 'Alice', email: 'a@example.com' })
// INSERT INTO users (name, email) VALUES (?, ?)

buildUpdatePlanSql('users', { status: 'inactive' }, { id: 1 })
// UPDATE users SET status = ? WHERE id = ?

buildDeletePlanSql('users', { id: 1 })
// DELETE FROM users WHERE id = ?
```

Identifier handling:

- Accept the same simple identifier shape already supported by current DML parsers unless the implementation discovers a stricter existing utility.
- Reject empty table names and empty column names.
- Reject identifiers that cannot be safely represented in planner-only SQL without ambiguity.
- Do not include user values in the planner SQL; use placeholders to avoid leaking sensitive values and to keep analysis deterministic.

WHERE handling:

- `update` and `delete` should continue to require `--where`.
- The plan path should use the same simple `key=value` / `AND` parsing behavior accepted by the actual SQL command path, so `--plan` does not approve a where shape the real command would reject.
- The reconstructed `WHERE` may use placeholders and normalized `AND` joins.

## Safety Boundary

`--plan` may read:

- CLI arguments and stdin JSON for `insert`.
- Project config and selected connection metadata.
- Permission level.
- Blacklist rules.
- Cached schema for the selected connection.

`--plan` must not:

- Instantiate a database adapter.
- Connect to a database.
- Call `adapter.getTableSchema()`.
- Execute a write.
- Enter interactive confirmation.
- Require `--force`.
- Refresh schema automatically.

The result is an agent-safety preflight decision, not a runtime execution preview. Users should still use `--dry-run` to preview the actual SQL generation path before executing a write.

## Error Handling

### `--plan` with `--dry-run`

Fail with a clear message and non-zero exit:

```text
--plan cannot be used with --dry-run
```

### Unsupported engine

For MongoDB, Redis, and Elasticsearch connections, fail with a clear SQL-only MVP message and non-zero exit:

```text
--plan for insert/update/delete currently supports SQL connections only
```

This is not represented as a `QueryRiskResult`, because the SQL analyzer cannot make a meaningful SQL risk decision for those engine-specific DML paths.

### Missing config

Preserve existing command behavior:

```text
Run "dbcli init" to configure database connection
```

### Invalid arguments

Preserve existing validation behavior where possible:

- `insert` without JSON fails.
- `insert` with invalid JSON fails.
- `update` without `--set` or `--where` fails.
- `update` with invalid `--set` JSON fails.
- `delete` without `--where` fails.
- Unsupported where syntax fails.

### `BLOCK` decision

A `BLOCK` decision is successful analysis and exits `0`:

```json
{
  "decision": "BLOCK",
  "operation": "DELETE",
  "targetTables": ["users"],
  "riskFactors": [
    {
      "code": "table_blacklisted",
      "severity": "block",
      "message": "Target table users is blacklisted."
    }
  ],
  "recommendations": ["Review blacklist rules before accessing sensitive data."],
  "suggestedCommands": []
}
```

## Testing Strategy

Use `bun test` and follow the existing unit-test style.

### Helper tests

Create tests for the planner-only SQL helper:

- Insert JSON keys become an `INSERT INTO ... VALUES (?, ...)` planner SQL string.
- Update `--set` keys plus parsed `--where` become an `UPDATE ... SET ... WHERE ...` planner SQL string.
- Delete parsed `--where` becomes a `DELETE FROM ... WHERE ...` planner SQL string.
- Empty table, empty data, empty set, and invalid identifiers fail.
- Values are never embedded in the generated SQL.

### Command tests

Add command-level tests for each DML command:

- `insert --plan --format json` returns `QueryRiskResult` and does not create an adapter or connect.
- `update --plan --format json` returns `QueryRiskResult` and does not create an adapter or connect.
- `delete --plan --format json` returns `QueryRiskResult` and does not create an adapter or connect.
- `--plan --dry-run` fails.
- `--plan` under MongoDB, Redis, and Elasticsearch connections fails with the SQL-only MVP message.
- `BLOCK` decisions exit `0`.
- Text output omits `suggestedCommands`.
- JSON output includes the complete existing `QueryRiskResult` fields.

### Analyzer integration expectations

Do not duplicate the full `query-risk-analyzer` suite. Add focused integration expectations proving that DML plan passes the reconstructed SQL into the analyzer correctly:

- Blacklisted table returns `BLOCK`.
- Insufficient permission returns `BLOCK`.
- Missing schema cache returns `WARN`.
- Known-schema, sufficient-permission DML returns the analyzer's expected decision.

### Regression commands

At implementation completion, run at minimum:

```bash
bun test tests/unit/core/query-risk-analyzer.test.ts
bun test tests/unit/commands/plan.test.ts
bun test <new DML plan helper tests>
bun test <new DML plan command tests>
bun test
```

## Implementation Notes

- Keep `analyzeQueryRisk()` pure and reusable.
- Prefer exporting `formatPlanResult()` from `src/commands/plan.ts` over adding a duplicate formatter.
- Prefer a shared command helper only if it prevents obvious repetition without obscuring command-specific validation.
- Avoid touching runtime DML execution behavior except for early `--plan` branching.
- Preserve existing `--dry-run`, `--force`, recovery, and non-SQL engine behavior outside the `--plan` branch.
- The implementation plan should be TDD-first and keep commits small.
