# Open Issues #4–#10 Implementation and Acceptance Plan

**Date:** 2026-08-01

**Status:** Ready for implementation

**Baseline:** dbcli v1.42.0 (`2c45177`)

**Source:** GitHub issues
[#4](https://github.com/CarlLee1983/dbcli/issues/4) through
[#10](https://github.com/CarlLee1983/dbcli/issues/10)

## Goal

Resolve the seven open issues as independently reviewable vertical slices while
preserving dbcli's permission, blacklist, audit, recovery, and machine-readable
output contracts. This document is the implementation and acceptance source of
truth for those issues.

## Delivery Order

Implement one issue per pull request in this order:

1. #4 — truthful auto-limit metadata
2. #10 — bounded CLI error presentation
3. #7 — stateless single-connection selection
4. #9 — query input from files and stdin
5. #5 — query field projection
6. #6 — bounded table cell output
7. #8 — read-only multi-connection fan-out

The ordering is intentional:

- #4 and #10 fix correctness and error-boundary defects before new behavior.
- #7 defines the connection-selection contract required by #8.
- #10 provides the partial-failure error boundary required by #8.
- #5 and #6 solve different output-volume problems and remain separate changes.

## Cross-Cutting Delivery Rules

- Keep each issue in a separate branch and pull request.
- Do not add production dependencies.
- Use Bun commands from `AGENTS.md`; do not introduce Node-only entrypoints.
- A behavior-changing PR must update all four user-document variants:
  `docs/user/en/index.md`, `docs/user/en/index.html`,
  `docs/user/zh-TW/index.md`, and `docs/user/zh-TW/index.html`.
- Preserve blacklist filtering before user-visible output. Projection and
  truncation must never reintroduce protected values.
- Preserve audit and recovery behavior unless the issue explicitly changes its
  output contract.
- Do not claim completion from unit tests alone. Each PR must run its focused
  tests plus the repository-wide completion gate in this document.
- Review the final diff for generated files, unrelated formatting, and output
  contract changes before marking a task complete.

## Shared Output Vocabulary

Use the following names consistently:

```ts
interface AppliedLimitMetadata {
  truncated: boolean
  limitApplied: number
}
```

The internal TypeScript field is `limitApplied`. The public JSON query contract
uses the issue-requested spelling:

```json
{
  "metadata": {
    "truncated": true,
    "limit_applied": 1000
  }
}
```

`truncated` means that dbcli fetched evidence of at least one additional row and
removed it from the returned result. It must not mean merely that a limit was
configured.

---

## Milestone 1 — Issue #4: Truthful Auto-Limit Metadata

### Outcome

When dbcli applies its own row cap, stdout tells callers whether additional
rows actually existed. A result containing exactly N rows is not falsely
reported as truncated.

### Scope

- `dbcli query` on SQL, MongoDB, and Elasticsearch connections.
- Default query-only limit and explicit CLI `--limit N` when dbcli injects the
  limit.
- Table and JSON output.

### Non-Goals

- Do not run a separate `COUNT(*)` or equivalent total-count query.
- Do not change user-authored SQL `LIMIT`, MongoDB `$limit`, or Elasticsearch
  body `size` semantics in this milestone.
- Do not change `dbcli q` or `dbcli export`; create follow-up issues for their
  format-specific truncation contracts.
- Do not report a total row count.

### Design

For a dbcli-applied limit N, request N+1 rows from the adapter. If N+1 rows are
returned, drop the final row and set `truncated: true`. Otherwise preserve all
rows and set `truncated: false`. Expose the user-facing limit as
`limitApplied: N`, never N+1.

Engine behavior:

- SQL: append or otherwise apply `LIMIT N+1` only when dbcli owns the limit.
- MongoDB find: call `.limit(N+1)`.
- MongoDB aggregation: append `$limit: N+1` only when dbcli owns the limit.
- Elasticsearch: request `size: N+1` through the existing adapter option.
- User-authored limits remain untouched and do not receive a dbcli truncation
  claim unless future work can prove it accurately.

Table output when truncated:

```text
Rows: 1000 (truncated; limit 1000) | Execution time: 42ms
```

Table output below or exactly at the limit remains:

```text
Rows: 1000 | Execution time: 42ms
```

JSON includes both metadata fields whenever dbcli applied a limit, including
`truncated: false`.

### Expected File Boundary

- Modify: `src/types/query.ts`
- Modify: `src/core/query-executor.ts`
- Modify: `src/commands/query.ts`
- Modify as required: `src/adapters/mongodb-adapter.ts`
- Modify as required: `src/adapters/elasticsearch-adapter.ts`
- Modify: `src/formatters/query-result-formatter.ts`
- Add or modify focused tests under:
  - `tests/unit/commands/query-executor-autolimit.test.ts`
  - `tests/unit/commands/query-mongodb.test.ts`
  - Elasticsearch query tests
  - `tests/unit/formatters/query-result-formatter.test.ts`

### Implementation Tasks

- [ ] Introduce internal applied-limit metadata without changing unrelated
      `QueryMetadata` fields.
- [ ] Centralize N+1 trimming in a pure helper so all engines share the exact
      definition of `truncated`.
- [ ] Apply N+1 fetching to SQL only for dbcli-owned limits.
- [ ] Apply N+1 fetching to MongoDB find and aggregation paths.
- [ ] Apply N+1 fetching to Elasticsearch search.
- [ ] Render the table truncation footer.
- [ ] Map `limitApplied` to public JSON `metadata.limit_applied`.
- [ ] Update all four user-document variants.

### Acceptance Matrix

| Case | Returned rows | `truncated` | Visible rows |
| --- | ---: | --- | ---: |
| Source has N-1 rows | N-1 | `false` | N-1 |
| Source has exactly N rows | N | `false` | N |
| Source has N+1 rows | N+1 fetched | `true` | N |
| Source has more than N+1 rows | N+1 fetched | `true` | N |
| `--no-limit` | unchanged | metadata omitted | all rows |
| User-authored limit | unchanged | no dbcli claim | user limit |

The matrix must pass for SQL, MongoDB find, MongoDB aggregation, and
Elasticsearch.

### Verification

```sh
bun test tests/unit/commands/query-executor-autolimit.test.ts
bun test tests/unit/commands/query-mongodb.test.ts
bun test tests/unit/formatters/query-result-formatter.test.ts
bun run typecheck
bun run lint
bun run docs:check
```

---

## Milestone 2 — Issue #10: Bounded CLI Error Presentation

### Outcome

No first-party command can let an adapter or command rejection fall through to
Bun's default uncaught-error printer. Normal stderr starts with a readable error
message, never a bundled source-code frame. Stack traces are opt-in via verbose
mode.

### Confirmed Defect

`src/commands/list.ts` returns asynchronous engine branches from inside a
`try` without awaiting them. A later rejection therefore bypasses its `catch`.
The CLI entrypoint also calls synchronous `program.parse(process.argv)` instead
of awaiting a guarded async parse.

### Decisions

- Use `program.parseAsync()` behind one top-level `try/catch`.
- Set `process.exitCode = 1`; do not call `process.exit()` from the top-level
  presenter.
- Normal mode prints message, stable error code when present, and actionable
  hints.
- `-v` and `-vv` may add diagnostic detail; at least one verbose mode must print
  the stack.
- A failure is presented exactly once.
- Recovery envelopes keep their existing stdout contract and suppress the
  duplicate human stderr message where they already do so.

### Expected File Boundary

- Add: `src/utils/cli-error.ts` or an equivalently narrow shared presenter
- Modify: `src/cli.ts`
- Modify: `src/commands/list.ts`
- Modify as required: `src/commands/schema.ts`
- Modify as required: `src/commands/query.ts`
- Modify as required: `src/commands/export.ts`
- Modify as required: `src/commands/check.ts`
- Add CLI-boundary and bundled-entrypoint regression tests

### Implementation Tasks

- [ ] Add a pure error-to-presentation mapper for message, code, hints, and
      optional stack.
- [ ] Add one stderr presenter that respects the active logger level.
- [ ] Change `list` engine branch returns to `return await ...` or await then
      return, proving rejections stay inside the intended boundary.
- [ ] Replace the entrypoint parse call with an awaited, guarded `parseAsync`.
- [ ] Remove duplicate rendering from affected connection-bearing commands;
      preserve their audit and recovery work before rethrowing.
- [ ] Ensure disconnect failures are also caught and presented once.
- [ ] Add a production-bundle regression test using a rejected MongoDB adapter
      connection.
- [ ] Update troubleshooting and verbose-mode documentation in all four user
      documents.

### Acceptance

- [ ] `dbcli list` with MongoDB connection failure: stderr line 1 is readable
      text, not a source frame.
- [ ] `dbcli schema` with MongoDB connection failure behaves identically.
- [ ] `dbcli query` connection failure is presented once.
- [ ] Normal stderr contains no bundled source line, JavaScript source excerpt,
      or escaped Unicode error text.
- [ ] Verbose mode contains the stack; normal mode does not.
- [ ] Exit code is 1 for the failure cases.
- [ ] `--recovery` still emits one valid envelope without duplicate stderr.

### Verification

```sh
bun test tests/unit/commands/list-mongodb.test.ts
bun test tests/unit/commands/query-mongodb.test.ts
bun run build
# Run the new bundled CLI error regression test against dist/cli.mjs.
bun run typecheck
bun run lint
bun run docs:check
```

---

## Milestone 3 — Issue #7: Stateless Single-Connection Selection

### Outcome

Agents can select one connection for one invocation without changing the
persistent default, regardless of whether `--use` appears before or after the
subcommand.

### Selection Contract

```text
explicit --use > DBCLI_CONNECTION > configured default
```

Additional rules:

- Trim surrounding whitespace from `DBCLI_CONNECTION`.
- Treat an empty environment value as unset.
- If root-level and subcommand-level `--use` are both present with different
  values, fail with a clear conflict error instead of silently choosing one.
- If both carry the same value, accept it.
- A missing connection name uses the existing config error path.
- Do not mutate the persistent default connection.

### Supported Subcommand Position

The following must accept `--use` after the subcommand:

- `query`
- `schema`
- `list`
- `export`
- `check`

Root-level `dbcli --use staging query ...` remains supported.

### Expected File Boundary

- Add a pure selector resolver under `src/core/` or `src/utils/`
- Modify: `src/program.ts`
- Modify: `src/cli.ts`
- Modify command definitions for list, schema, and check as required
- Modify connection-selection tests under `tests/unit/core/`
- Add CLI parser integration tests

### Implementation Tasks

- [ ] Add a reusable Commander option helper so `--use` help text and parsing
      are not duplicated inconsistently.
- [ ] Resolve root option, leaf option, and environment input in a pure helper.
- [ ] Set the invocation-scoped connection selection once in `preAction`.
- [ ] Prove config fallback remains unchanged when neither option nor env is
      present.
- [ ] Add conflict and invalid-connection tests.
- [ ] Correct existing documentation that currently claims post-subcommand
      `--use` works, and document `DBCLI_CONNECTION` in all four variants.

### Acceptance

These forms resolve to the same `staging` connection without persistent writes:

```sh
bun run src/cli.ts --use staging query "SELECT 1"
bun run src/cli.ts query --use staging "SELECT 1"
DBCLI_CONNECTION=staging bun run src/cli.ts query "SELECT 1"
```

Precedence cases:

```sh
DBCLI_CONNECTION=dev bun run src/cli.ts query --use staging "SELECT 1"
# effective connection: staging
```

- [ ] All five named subcommands accept post-subcommand `--use`.
- [ ] No invocation calls the persistent `dbcli use` mutation path.
- [ ] Parallel processes with different environment selectors cannot affect one
      another.

### Verification

```sh
bun test tests/unit/core/global-connection-name.test.ts
bun test tests/integration/multi-connection.test.ts
bun run typecheck
bun run lint
bun run docs:check
```

---

## Milestone 4 — Issue #9: Query Input from Files and Stdin

### Outcome

SQL and MongoDB queries can be supplied without shell-escaping their entire
contents.

### CLI Contract

```text
dbcli query [sql] [-f, --query-file <path>]
```

Exactly one source is required:

- positional query text, or
- `--query-file <path>`, or
- `--query-file -` for stdin.

Providing zero sources or more than one source is an error. An input that is
empty after trimming and optional UTF-8 BOM removal is also an error.

### Decisions

- Use `Bun.file(path).text()` for files.
- Use `Bun.stdin.text()` for `-`.
- Treat input as UTF-8 text.
- Remove one leading UTF-8 BOM.
- Reuse the existing query validation, permission, audit, blacklist, and engine
  routing after input resolution.
- Audit the resolved query under the existing redaction rules; do not log file
  contents through a new side channel.

### Expected File Boundary

- Add a pure/testable query-input resolver, with injectable file/stdin readers
- Modify: `src/program.ts`
- Modify as required: `src/commands/query.ts`
- Add parser and resolver tests

### Implementation Tasks

- [ ] Change the Commander argument from required `<sql>` to optional `[sql]`.
- [ ] Add `-f, --query-file <path>`.
- [ ] Resolve and validate exactly one input source before connecting.
- [ ] Add file-not-found, unreadable-file, empty-file, BOM, stdin, and conflict
      tests.
- [ ] Test both multiline SQL and a MongoDB aggregation containing shell-hostile
      quotes.
- [ ] Update all four user-document variants.

### Acceptance

```sh
bun run src/cli.ts query -f ./pipeline.json --collection raw_logs

bun run src/cli.ts query --collection raw_logs -f - <<'EOF'
[{"$match":{"message":{"$regex":"user's event"}}}]
EOF
```

- [ ] Both examples reach the same execution path as positional input.
- [ ] `query "SELECT 1" -f query.sql` fails before config or database access.
- [ ] `query -f missing.sql` reports the path and exits 1 without a Bun code
      frame.
- [ ] Stdin is read once and does not hang after EOF.

### Verification

```sh
bun test tests/unit/commands/query.test.ts
bun test tests/unit/commands/query-mongodb.test.ts
bun run typecheck
bun run lint
bun run docs:check
```

---

## Milestone 5 — Issue #5: Query Field Projection

### Outcome

Callers can request or exclude fields without rewriting a MongoDB filter as a
full aggregation pipeline, while SQL and MongoDB expose one CLI vocabulary.

### CLI Contract

```text
--fields id,name,created_at
--fields=-raw_response,-request_payload
```

Rules:

- Inclusion tokens are unprefixed.
- Exclusion tokens start with `-`.
- Inclusion and exclusion tokens cannot be mixed in one invocation.
- Empty tokens, duplicate tokens, and an empty final set are errors.
- Because exclusion values start with `-`, document the portable
  `--fields=-field_a,-field_b` form.
- Dotted paths are supported. User-visible projected rows use the requested
  dotted path as the column name.
- In inclusion mode, MongoDB `_id` is excluded unless explicitly requested.

### Engine Behavior

- SQL: execute the original validated query, apply blacklist filtering, then
  project returned rows. Do not rewrite arbitrary SQL into a subquery.
- MongoDB find: pass a native projection to the driver to avoid transferring
  unused fields, then run blacklist masking and normalize requested dotted
  paths for output.
- MongoDB aggregation: append a `$project` stage after the user pipeline, then
  run blacklist masking and output normalization.
- Other engines are out of scope for this issue and must return a clear
  unsupported-option error rather than silently ignoring `--fields`.

Blacklist filtering has final authority. Requesting a protected field either
omits/redacts it according to the existing policy and emits the existing
security notification; it never bypasses the blacklist.

### Expected File Boundary

- Add a projection parser and row projector under `src/core/`
- Modify: `src/program.ts`
- Modify: `src/commands/query.ts`
- Modify: `src/adapters/mongodb-adapter.ts`
- Modify Mongo adapter execution option types
- Add parser, SQL result, Mongo find, Mongo aggregate, dotted-path, and
  blacklist interaction tests

### Implementation Tasks

- [ ] Implement pure parsing and validation for include/exclude modes.
- [ ] Implement dotted-path projection without mutating adapter-owned rows.
- [ ] Apply SQL projection after blacklist filtering.
- [ ] Push MongoDB projection into find and aggregation execution.
- [ ] Normalize MongoDB output to the requested column contract.
- [ ] Reject unsupported engines explicitly.
- [ ] Update all four user-document variants.

### Acceptance

- [ ] SQL inclusion output contains exactly the requested visible columns in
      requested order.
- [ ] SQL exclusion output omits the named columns.
- [ ] MongoDB find receives a native projection and returns bounded fields.
- [ ] MongoDB aggregation receives a final `$project` stage.
- [ ] `--fields a,-b` fails before connecting.
- [ ] A blacklisted field cannot be recovered through inclusion, exclusion, or
      dotted parent selection.
- [ ] JSON `columnNames` matches projected row keys.

### Verification

```sh
bun test tests/unit/commands/query.test.ts
bun test tests/unit/commands/query-mongodb.test.ts
# Run new projection parser and blacklist interaction tests.
bun run typecheck
bun run lint
bun run docs:check
```

---

## Milestone 6 — Issue #6: Bounded Table Cell Output

### Outcome

Human-readable tables cannot be overwhelmed by one very large field, while
machine-readable formats remain lossless by default and by contract.

### CLI Contract

- Table output defaults to a 120-character serialized-cell limit.
- `--truncate N` sets a positive integer limit.
- `--no-truncate` disables the table default.
- `--truncate` and `--no-truncate` together are an error.
- JSON and CSV remain lossless. Passing `--truncate` with JSON or CSV is an
  error; do not silently ignore it and do not change value types.

### Truncation Contract

- Convert table cells with the existing semantics first: nullish values become
  empty text, objects use `JSON.stringify`, and primitives use `String`.
- Count Unicode code points, not UTF-16 code units.
- If the serialized value exceeds N code points, keep the first N and append:

```text
…(+3412 chars)
```

- The marker is outside the N-character retained-value budget.
- The count reports omitted code points from the serialized value.
- Do not mutate `QueryResult.rows`; truncation is a formatting concern only.

### Expected File Boundary

- Modify: `src/program.ts`
- Modify: `src/commands/query.ts`
- Modify: `src/formatters/query-result-formatter.ts`
- Add formatter and command-option tests

### Implementation Tasks

- [ ] Add a pure Unicode-aware serialized-cell truncation helper.
- [ ] Extend formatter options without changing JSON or CSV serialization.
- [ ] Wire table default, explicit override, and disable flag into `query`.
- [ ] Validate positive integers and format conflicts before connecting.
- [ ] Test strings, nested objects, emoji, exact-boundary values, null, and
      malformed numeric options.
- [ ] Update all four user-document variants.

### Acceptance

- [ ] A 120-character value is unchanged under the default.
- [ ] A 121-character value is shortened and includes `…(+1 chars)`.
- [ ] `--no-truncate` preserves the full table cell.
- [ ] JSON and CSV outputs are byte-for-byte equivalent to pre-feature output
      for the same `QueryResult`.
- [ ] `--format json --truncate 120` fails clearly before database access.
- [ ] Nested object truncation does not mutate the original object or affect a
      subsequent JSON formatting call.

### Verification

```sh
bun test tests/unit/formatters/query-result-formatter.test.ts
bun test tests/unit/commands/query.test.ts
bun run typecheck
bun run lint
bun run docs:check
```

---

## Milestone 7 — Issue #8: Read-Only Multi-Connection Fan-Out

### Outcome

One read-only query can run against multiple named connections, preserving
per-connection results and errors without allowing one failure to cancel the
others.

### Dependencies

- #7 is complete: connection selection is explicit and invocation-scoped.
- #10 is complete: errors can be represented without terminating inside a
  command branch.
- The query path has an execution function that returns data/errors instead of
  printing and exiting internally.

### Selection Contract

```sh
dbcli --use hub-demo,temp-demo2 query "SELECT ..."
dbcli query --use hub-demo,temp-demo2 "SELECT ..."
```

- Split on commas, trim each name, and preserve input order.
- Reject empty names and duplicates.
- A single name uses the existing single-connection path.
- `DBCLI_CONNECTION` remains single-connection only in this milestone.
- Never implement fan-out by repeatedly mutating the process-global connection
  selector. Pass each connection name explicitly to config resolution.

### Safety Contract

Multi-connection mode is read-only:

- SQL permits existing read-only classifications such as SELECT, SHOW,
  DESCRIBE, and EXPLAIN; mutation and DDL classifications are rejected before
  any connection executes.
- MongoDB permits filters and read-only aggregation pipelines. Pipelines
  containing `$out` or `$merge` are rejected before any connection executes.
- Elasticsearch permits search only.
- Redis fan-out is out of scope for the initial issue unless a separate design
  proves read-only command classification and output parity.

Validation must occur before starting any connection, preventing partial writes
from an invalid multi-connection request.

### Execution Contract

- Execute independent connections with `Promise.allSettled` or equivalent.
- Preserve input order in output regardless of completion order.
- One connection failure does not cancel or hide other results.
- Each connection gets independent config, adapter, audit entry, disconnect,
  limit metadata, blacklist filtering, and execution timing.
- `--recovery` is unsupported in multi-connection mode for the first version;
  reject the combination before connecting. Per-connection structured errors
  replace the single recovery envelope in this mode.

### Output Contract

JSON:

```json
{
  "results": [
    {
      "connection": "hub-demo",
      "status": "ok",
      "rows": [],
      "rowCount": 0,
      "columnNames": [],
      "metadata": {
        "truncated": false,
        "limit_applied": 1000
      }
    },
    {
      "connection": "temp-demo2",
      "status": "error",
      "error": {
        "code": "ETIMEDOUT",
        "message": "Connection timed out",
        "hints": []
      }
    }
  ]
}
```

Table output uses independent sections because schemas may differ:

```text
Connection: hub-demo [ok]
<table>

Connection: temp-demo2 [error]
ETIMEDOUT: Connection timed out
```

Do not merge heterogeneous fields into one table.

### Exit Codes

| Result | Exit code |
| --- | ---: |
| All connections succeeded | 0 |
| At least one succeeded and at least one failed | 2 |
| All connections failed | 1 |
| Request rejected before execution | 1 |

### Expected Architecture Boundary

Introduce or extract concepts equivalent to:

```ts
interface QueryExecutionContext {
  connectionName: string
  configPath: string
}

type ConnectionQueryOutcome =
  | { connection: string; status: 'ok'; result: QueryResult<Record<string, unknown>> }
  | { connection: string; status: 'error'; error: SerializedCliError }
```

The exact file names may follow existing architecture, but execution must be
separate from presentation. The single-connection command should consume the
same execution function to avoid parallel implementations.

### Implementation Tasks

- [ ] Extract query execution from console output and `process.exit` behavior.
- [ ] Parse and validate the connection list before execution.
- [ ] Classify the query as read-only for every applicable engine before
      starting any connection.
- [ ] Execute with isolated explicit connection contexts.
- [ ] Serialize ordered per-connection successes and errors.
- [ ] Add JSON and table multi-result formatters.
- [ ] Implement exit-code aggregation.
- [ ] Preserve single-connection output byte-for-byte where unrelated to prior
      milestones.
- [ ] Add audit and disconnect assertions for success, partial failure, and
      total failure.
- [ ] Update all four user-document variants.

### Acceptance

- [ ] Two successful connections produce two labeled results in input order.
- [ ] Different schemas render as separate table sections.
- [ ] One unreachable connection and one successful connection produce both
      outcomes and exit code 2.
- [ ] All unreachable connections produce all errors and exit code 1.
- [ ] A fast second connection cannot reorder output ahead of a slow first
      connection.
- [ ] SQL mutation, MongoDB `$out`/`$merge`, `--recovery`, empty names, and
      duplicate names fail before any adapter connects.
- [ ] Blacklist filtering and #4 truncation metadata remain per connection.
- [ ] No persistent default connection is modified.

### Verification

```sh
bun test tests/integration/multi-connection.test.ts
bun test tests/unit/commands/query.test.ts
bun test tests/unit/commands/query-mongodb.test.ts
# Run new fan-out formatter, safety, ordering, audit, and partial-failure tests.
bun run typecheck
bun run lint
bun run docs:check
```

---

## Repository-Wide Completion Gate

For every milestone:

```sh
bun test <focused-test-paths>
bun run typecheck
bun run lint
bun run docs:check
```

Before merging each behavior-changing pull request:

```sh
bun test
bun run build
bun run typecheck
bun run lint
bun run docs:check
```

Run `bun run skill:check` and `bun run platform:check` only when the PR changes
skill or platform-distributed assets. Run the repository's release check before
a release, not as a substitute for the per-PR checks above.

## Final Traceability Matrix

| Issue | Required artifact | Primary evidence | Depends on |
| --- | --- | --- | --- |
| #4 | Accurate truncation metadata | N-1/N/N+1 engine matrix | — |
| #10 | No default Bun code frame | Bundled CLI failure regression | — |
| #7 | Stateless selector precedence | CLI parser + parallel-process tests | — |
| #9 | File/stdin query source | Resolver + CLI integration tests | #10 error boundary |
| #5 | Include/exclude projection | SQL/Mongo/blacklist tests | — |
| #6 | Bounded table cells | Formatter immutability/lossless tests | — |
| #8 | Ordered partial-failure fan-out | Multi-connection integration tests | #7, #10, #4 |

## Definition of Done

An issue is complete only when all of the following are true:

- Every checkbox and acceptance item in its milestone is satisfied.
- Focused and repository-wide checks have actually passed.
- The implementation uses one source of truth and adds no silent fallback.
- User documentation is synchronized across language and format variants.
- The final diff contains no unrelated changes.
- Compatibility, security, rollout, and remaining risks are recorded in the PR.
- The GitHub issue is linked from the PR and closed only after the acceptance
  evidence is available.
