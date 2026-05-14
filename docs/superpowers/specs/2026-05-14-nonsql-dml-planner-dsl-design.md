# Non-SQL DML Planner-Only DSL Design

Date: 2026-05-14
Status: Approved for implementation planning

## Goal

Extend the current SQL-only DML `--plan` preflight into an engine-aware planner for MongoDB, Redis, and Elasticsearch while preserving the existing `QueryRiskResult` output contract. Non-SQL engines should no longer be rejected solely because they are not SQL connections. Instead, `insert`, `update`, and `delete` `--plan` paths should dispatch to engine-specific planner-only DSL analyzers that perform static safety checks without connecting to the database.

The feature is for agent-safety preflight. It lets agents ask whether an intended write is obviously unsafe before choosing whether to run `--dry-run` or a real write.

## MVP Scope

The MVP extends `dbcli insert/update/delete --plan` for configured MongoDB, Redis, and Elasticsearch connections.

Supported surfaces:

```bash
dbcli insert <target> --data '{...}' --plan [--format text|json]
dbcli update <target> --set '{...}' --where '<engine filter>' --plan [--format text|json]
dbcli delete <target> --where '<engine filter>' --plan [--format text|json]
```

Engine interpretation:

- SQL: existing planner-only SQL path remains intact.
- MongoDB: target is a collection; planner input includes insert document, update document, and filter object.
- Redis: target is a key or key-like namespace; planner input reflects the current command's key/hash/delete behavior.
- Elasticsearch: target is an index; planner input covers document-level index/update/delete intent, primarily by `_id`.

The JSON output shape remains exactly the existing `QueryRiskResult` shape:

```ts
interface QueryRiskResult {
  decision: 'ALLOW' | 'WARN' | 'BLOCK'
  operation: QueryRiskOperation
  targetTables: string[]
  riskFactors: QueryRiskFactor[]
  recommendations: string[]
  suggestedCommands: string[]
}
```

For MVP compatibility, non-SQL analyzers should keep `operation` mapped to the existing broad `INSERT`, `UPDATE`, and `DELETE` values rather than introducing engine-specific operation values. Engine-specific detail belongs in risk factor codes, messages, target names, and recommendations.

## Non-goals

- No live database `EXPLAIN`, count, scan, search, mapping refresh, or schema sampling.
- No adapter creation, database connection, or command execution.
- No LLM or natural-language-to-DSL generation.
- No complete parser for arbitrary MongoDB, Redis, or Elasticsearch query syntax.
- No change to real DML execution behavior outside the `--plan` branch.
- No raw `dbcli plan --engine <engine>` generic non-SQL command in this MVP.
- No Redis pipeline, Lua, or multi-command planning.
- No Elasticsearch bulk, `_update_by_query`, or `_delete_by_query` support beyond conservative blocking.

## Architecture

Use a shared command-layer dispatcher and pure engine-specific analyzers.

```text
insert/update/delete --plan
  └─ runDmlPlanAnalysis()
      ├─ SQL: build*PlanSql() → analyzeQueryRisk()
      ├─ MongoDB: buildMongoDmlPlan() → analyzeMongoDmlRisk()
      ├─ Redis: buildRedisDmlPlan() → analyzeRedisDmlRisk()
      └─ Elasticsearch: buildElasticsearchDmlPlan() → analyzeElasticsearchDmlRisk()
```

Recommended file boundaries:

```text
src/types/query-risk.ts
  # Preserve QueryRiskResult; extend risk factor codes as needed.

src/core/dml-plan.ts
  # Engine-neutral DML plan input types and dispatcher helpers.

src/core/mongo/dml-plan.ts
  # MongoDB planner-only DSL, field extraction, and risk analyzer.

src/core/redis/dml-plan.ts
  # Redis planner-only DSL, key-pattern checks, and risk analyzer.

src/core/elasticsearch/dml-plan.ts
  # Elasticsearch planner-only DSL, by-id checks, and risk analyzer.

src/commands/dml-plan.ts
  # Replace SQL-only wrapper with engine-aware wrapper.

src/commands/insert.ts
src/commands/update.ts
src/commands/delete.ts
  # Pass raw DML intent into runDmlPlanAnalysis() instead of building SQL before config dispatch.
```

A representative intent model:

```ts
type DmlPlanIntent =
  | {
      operation: 'insert' | 'update' | 'delete'
      target: string
      data?: Record<string, unknown>
      set?: Record<string, unknown>
      where?: Record<string, unknown>
      rawWhere?: string
    }
```

`runDmlPlanAnalysis()` should load config, inspect `config.connection.system`, convert the generic command intent into an engine-specific plan, run the analyzer, and print with `formatPlanResult(result, format)`.

The command wrapper remains responsible for:

1. Validating `--plan` and `--dry-run` mutual exclusion.
2. Validating `--format text|json`.
3. Loading config through existing config resolution.
4. Dispatching by selected connection system.
5. Returning normally for analyzer decisions, including `BLOCK`.
6. Exiting non-zero only for CLI/config/invalid DSL errors.

## Planner Safety Boundary

`--plan` may read:

- CLI arguments and stdin JSON.
- Project config and selected connection metadata.
- Permission level.
- Blacklist rules.
- Cached schema / collection / index metadata for the selected connection.

`--plan` must not:

- Instantiate any database adapter.
- Connect to a database.
- Call `getTableSchema()` or equivalent adapter metadata methods.
- Execute reads or writes.
- Enter interactive confirmation.
- Require `--force`.
- Refresh schema automatically.

## Engine Rules

### MongoDB

`targetTables` uses the collection name. Field checks should support top-level and dotted-path field names where existing blacklist/schema utilities can represent them.

#### BLOCK

- Permission does not allow the requested write operation.
- Collection is blacklisted.
- Insert or update writes a blacklisted field.
- Update or delete filter is empty (`{}`).
- Delete filter lacks `_id` or another clear equality condition.
- Update document contains unsupported or high-risk operators, including `$where`, pipeline update arrays, or operators outside the MVP allowlist.

#### WARN

- Collection is missing from schema cache.
- Filter uses range, regex, `$in`, or other conditions likely to match multiple documents.
- Update or delete filter lacks `_id` but has some other equality condition.
- Schema cache has partial field coverage.

#### ALLOW

- Insert writes non-blacklisted fields.
- Update/delete has `_id` equality filter.
- Permission is sufficient.
- No blacklist rule is violated.
- Schema coverage is sufficient or no high-risk field condition is present.

MVP update operator allowlist:

- Direct replacement-like object without `$` keys may be treated as `$set`-like for planning if current execution path does so.
- `$set` and `$unset` are allowed for field extraction.
- Other operators should return `BLOCK` until explicitly designed.

### Redis

`targetTables` uses the key or key pattern. Redis has no table concept, but the existing result contract should remain stable.

#### BLOCK

- Permission does not allow the requested write/delete operation.
- Key or key pattern is `*` or obviously too broad.
- Delete has no concrete key.
- Key or prefix matches blacklist rules.
- Planner intent maps to a Redis write command outside the MVP-supported set.

#### WARN

- Key contains wildcard characters and looks like a pattern rather than one key.
- Hash update/insert has no field information, preventing field-level blacklist checks.
- TTL or overwrite impact is unknown.
- Schema/key metadata is missing.

#### ALLOW

- Single-key insert/update/delete.
- Permission is sufficient.
- No blacklist rule is violated.

MVP Redis command mapping should mirror current command behavior rather than inventing a new Redis DSL. If the real `insert/update/delete` paths use simplified `SET`/`HSET`/`DEL` semantics, the planner should describe and check those same semantics.

### Elasticsearch

`targetTables` uses the index name.

#### BLOCK

- Permission does not allow the requested write/delete operation.
- Index is blacklisted.
- Update/delete lacks `_id`.
- `_update_by_query`, `_delete_by_query`, and bulk are requested or inferred.
- Insert/update writes a blacklisted field.

#### WARN

- Index is missing from schema cache.
- Document/update includes nested or dynamic fields that schema cache cannot confirm.
- Insert lacks `_id` and would rely on auto-id generation, making later correlation harder.

#### ALLOW

- Insert/update/delete is document-level and by-id where required.
- Permission is sufficient.
- No blacklist rule is violated.
- Schema coverage is sufficient or no high-risk field condition is present.

## Input Parsing Rules

### Shared

- `--plan` and `--dry-run` remain mutually exclusive.
- `--format` is only `text` or `json`.
- Command-specific required arguments remain required.
- Analyzer-produced `BLOCK` exits `0` because analysis succeeded.
- Invalid JSON, invalid format, missing config, or unsupported DSL exits non-zero.

### MongoDB

- `insert --data` must be a JSON object.
- `update --set` must be a JSON object.
- `update/delete --where` should prefer JSON object filters.
- If JSON parsing fails, fall back to existing simple `key=value` parsing for convenience and parity with current MongoDB command behavior.

### Redis

- The positional `<target>` is the primary key/key namespace input.
- `update --set` remains a JSON object when field information is available.
- `delete --where` should not be required to identify a broad pattern if the current command semantics use `<target>` as the key; the planner should follow current execution semantics and flag ambiguous/wildcard keys.

### Elasticsearch

- The positional `<target>` is the index.
- `_id` may be supplied through parsed `--where` (`{"_id":"abc"}` or `_id=abc`).
- Insert may warn when no `_id` is supplied.
- Update/delete should block without `_id` in MVP.

## QueryRiskResult Compatibility

The MVP should preserve the result shape and broad operation values to protect existing agent integrations.

Recommended operation mapping:

| Engine action | `operation` |
| --- | --- |
| MongoDB insert | `INSERT` |
| MongoDB update | `UPDATE` |
| MongoDB delete | `DELETE` |
| Redis insert/set-like write | `INSERT` |
| Redis update/hash-like write | `UPDATE` |
| Redis delete | `DELETE` |
| Elasticsearch index/create document | `INSERT` |
| Elasticsearch update document | `UPDATE` |
| Elasticsearch delete document | `DELETE` |

Recommended new `QueryRiskFactorCode` additions include:

- `nonsql_filter_empty`
- `nonsql_filter_broad`
- `nonsql_missing_id`
- `nonsql_unsupported_operator`
- `nonsql_unsupported_bulk`
- `nonsql_key_pattern_broad`
- `nonsql_dynamic_schema_unknown`
- `nonsql_overwrite_unknown`

Exact names may be refined during implementation, but the plan should keep them stable once introduced.

## UX

Examples:

```bash
dbcli insert users --data '{"name":"Alice"}' --plan --format json
dbcli update users --set '{"status":"inactive"}' --where '{"_id":"123"}' --plan --format json
dbcli delete users --where '{"_id":"123"}' --plan --format json
```

Text output keeps the same format as `dbcli plan`:

```text
Decision: WARN
Operation: UPDATE
Target tables: users

Risk factors:
- MongoDB update filter does not use _id and may match multiple documents.

Recommendations:
- Prefer an _id equality filter before executing this update.
- Use --dry-run on the actual write command.
```

JSON output is the existing `QueryRiskResult` object.

## Error Handling

### `--plan` with `--dry-run`

Fail with non-zero exit:

```text
--plan cannot be used with --dry-run
```

### Missing config

Preserve existing command behavior:

```text
Run "dbcli init" to configure database connection
```

### Invalid non-SQL DSL

Fail non-zero when the planner cannot interpret required input, for example invalid JSON where no fallback applies:

```text
MongoDB --where must be a JSON object or simple key=value expression
```

### Analyzer `BLOCK`

Print the plan result and exit `0`:

```json
{
  "decision": "BLOCK",
  "operation": "DELETE",
  "targetTables": ["users"],
  "riskFactors": [
    {
      "code": "nonsql_missing_id",
      "severity": "block",
      "message": "Elasticsearch delete requires _id in --where for planner-safe document-level deletion."
    }
  ],
  "recommendations": ["Add an _id equality filter before deleting."],
  "suggestedCommands": []
}
```

## Testing Strategy

Use `bun test`.

Create focused unit tests:

```text
tests/unit/core/mongo-dml-plan.test.ts
tests/unit/core/redis-dml-plan.test.ts
tests/unit/core/elasticsearch-dml-plan.test.ts
tests/unit/commands/dml-plan-nonsql.test.ts
```

Required cases:

- SQL `--plan` behavior remains unchanged.
- MongoDB connection no longer receives the generic SQL-only unsupported-engine error.
- MongoDB update/delete with empty filter returns `BLOCK`.
- MongoDB update/delete with `_id` equality returns `ALLOW` or schema-missing `WARN`.
- MongoDB `$where` or unsupported update operator returns `BLOCK`.
- Redis wildcard key delete returns `BLOCK`.
- Redis single-key update/delete returns `ALLOW` or schema-missing/overwrite `WARN`.
- Elasticsearch update/delete without `_id` returns `BLOCK`.
- Elasticsearch by-id update/delete returns `ALLOW` or schema-missing `WARN`.
- Elasticsearch insert without `_id` returns `WARN`, not `BLOCK`, unless another rule blocks it.
- Analyzer `BLOCK` decisions exit `0`.
- Invalid DSL/config errors exit non-zero.
- Adapter factory and adapter `connect()` are not called in any non-SQL `--plan` path.

## Documentation Updates

Because this changes command behavior, implementation must update user documentation in all supported languages and formats:

```text
docs/user/en/index.md
docs/user/en/index.html
docs/user/zh-TW/index.md
docs/user/zh-TW/index.html
```

Documentation must state:

- `--plan` supports SQL, MongoDB, Redis, and Elasticsearch DML preflight.
- The planner is static and planner-only: it does not connect or execute.
- Each engine has conservative MVP restrictions.
- `BLOCK` means the planner found an unsafe intent; it is not a CLI failure.
- Users should still run `--dry-run` before a real write when supported.

## Implementation Order

1. Add non-SQL risk factor codes and pure analyzer tests.
2. Implement MongoDB planner-only DSL and analyzer.
3. Implement Redis planner-only DSL and analyzer.
4. Implement Elasticsearch planner-only DSL and analyzer.
5. Refactor `runDmlPlanAnalysis()` into an engine-aware dispatcher while preserving SQL behavior.
6. Update `insert/update/delete` plan branches to pass generic DML intent.
7. Add command-level tests proving no adapter connection occurs.
8. Update user documentation in English and Traditional Chinese, Markdown and HTML.
9. Run targeted tests, then broader command/core test suites.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Breaking existing SQL `--plan` consumers | Preserve `QueryRiskResult` shape and broad operation enum values. Add regression tests for SQL plan output. |
| False `ALLOW` on broad non-SQL writes | Prefer `WARN` or `BLOCK` when filter/key/id precision is uncertain. |
| Drift from real command semantics | Build planner intent from the same command arguments and parsing utilities used by execution paths. |
| Blacklist/schema model is SQL-shaped | Use target names in `targetTables` for compatibility; add engine-specific messages for collection/key/index semantics. |
| Implementation accidentally connects | Add tests that spy on adapter factory/connect and fail if called during `--plan`. |

## Approval Notes

The approved design direction is option 1 from brainstorming: preserve the shared `QueryRiskResult` contract and add engine-specific analyzers rather than converting MongoDB, Redis, or Elasticsearch DSL into SQL.
