# dbcli lint final-fixes report

Date: 2026-07-19

Implementation commit: `a9e7aa4` (`fix: harden dbcli lint safety boundaries`)

## Required findings resolved

1. **Fail-closed `EXPLAIN ANALYZE` safety**
   - Root cause: lint generated `--analyze` commands unconditionally, and the
     explain command created/connected its adapter before validating SQL.
   - Fix: added a dialect-aware structural read-only proof, guarded every
     generated verification/related command, rejected DML/DDL/data-modifying
     CTEs and unrecognized SQL, and enforced the boundary both before adapter
     creation and in the explain runner.

2. **Central structural redaction**
   - Root cause: audit and recovery used separate positional assumptions and
     did not understand global options, multiple lint inputs, or bulk inputs.
   - Fix: centralized argv parsing/redaction for audit and recovery, covered
     global `--config`/`--use`, all lint positionals, and `--bulk`, and scrubbed
     argv-derived values from failure text.

3. **Nullable `NOT IN` projection filtering**
   - Root cause: the rule classified a nullable projected expression without
     considering a subquery `WHERE` clause that null-rejected that expression.
   - Fix: suppress the diagnostic only when the exact resolved projection is
     guarded by `IS NOT NULL` directly or under `AND`; remain conservative for
     `OR`, ambiguous resolution, and partially guarded compound expressions.

4. **Schema case-collision safety**
   - Root cause: lowercased map keys overwrote case-distinct tables/columns.
   - Fix: preserve exact and folded indexes, but accept a lookup only when its
     folded bucket is unique. The parser does not retain reliable quote
     provenance, so an exact-looking AST identifier cannot resolve a collision.

5. **SQL statement splitting**
   - Root cause: regex comment stripping followed by `split(';')` broke
     semicolons inside strings, identifiers, comments, and dollar-quoted text.
   - Fix: added a deterministic scanner for quote, comment, escape, nested
     block-comment, and PostgreSQL dollar-quote states; file and glob lint
     inputs share it.

6. **Literal-left implicit casts**
   - Root cause: the rule only handled column-left/literal-right comparisons.
   - Fix: normalize both operand orders for PostgreSQL, MySQL, and MariaDB,
     preserve the original operator, and withhold rewrites when targeting is
     ambiguous.

## Plan and documentation

- Preserved `.dbcli/schemas/` plus `SchemaLayeredLoader` as the schema source.
- Preserved the existing global `--use <conn>` option.
- Recorded the approved three-file test grouping with independently named rule
  test cases.
- Recorded the right-hand-side `NOT IN` NULL semantics and conservative
  remediation policy.
- Updated English and Traditional Chinese Markdown/HTML user docs.
- Updated canonical skill/reference assets and synchronized all plugin,
  Cursor, GitHub, and Windsurf copies.

## TDD evidence

- RED checkpoint: `124 pass`, `27 fail`, with one expected missing-module error
  before the read-only proof module existed.
- Focused GREEN checkpoint: `161 pass`, `0 fail`, `453 expect()` calls across
  the final 12 focused files.

## Final verification

- `bun run lint`: exit 0.
- `bun run typecheck`: exit 0.
- `bun run docs:check`: 22 Markdown/HTML topics aligned in each locale.
- `bun run skill:check`: 23 sections aligned.
- `bun run plugin:check`: all generated plugin/skill copies current.
- `bun run platform:check`: all 5 platform surfaces aligned.
- `bun run build`: exit 0; CLI, core declarations, and UI template built.
- `bun test`: `3655 pass`, `26 skip`, `0 fail`, 6 snapshots,
  `9033 expect()` calls across 383 files.
- `git diff --check`: exit 0.

The 26 skips are the repository's existing environment-dependent live
MariaDB/PostgreSQL explain/classification suites; Redis and Elasticsearch
absence is handled by their smoke tests without failures.

## Unresolved concerns

None within the requested Critical/Important scope. Structural SQL proofs,
schema resolution, and rewrite targeting intentionally fail closed when
ambiguous.

## Follow-up final-review blockers

A subsequent review found two remaining fail-open cases and both were addressed:

1. **Function-bearing `SELECT` statements**
   - Root cause: the structural walker rejected write statement nodes but
     treated `function`, `aggr_func`, and `window_func` AST nodes as harmless.
     `EXPLAIN ANALYZE` evaluates those expressions, so built-ins such as
     `nextval`, `setval`, `pg_advisory_lock`, and `set_config`, as well as
     unknown UDFs and table functions, could have side effects.
   - Fix: every explicit scalar, aggregate, window, or table-function node now
     makes the statement unproven. Lint emits plain `dbcli explain`, and
     `explain --analyze` rejects it before adapter creation. Function-free
     `SELECT` and SELECT-only CTE statements remain eligible.

2. **Exact-looking identifiers inside folded collisions**
   - Root cause: `node-sql-parser` emits identical AST identifiers for
     unquoted `Foo` and quoted `"Foo"`, while context resolution preferred an
     exact spelling before checking the folded collision.
   - Fix: table and column lookup now checks folded-bucket uniqueness first.
     Every spelling is unresolved when multiple schema objects share that
     bucket; unique case-insensitive lookups still resolve normally.

### Follow-up TDD and verification

- RED: `74 pass`, `13 fail`; an independently corrected mixed-case column
  regression then also failed against the old exact-first behavior.
- Focused GREEN: `117 pass`, `0 fail`, `388 expect()` calls across 8 files.
- Real subprocess coverage proves representative side-effecting functions,
  arbitrary UDFs, and table functions fall back or reject before connection.
- `bun run lint`: exit 0.
- `bun run typecheck`: exit 0.
- `bun run docs:check`, `skill:check`, `plugin:check`, and `platform:check`:
  exit 0.
- `git diff --check`: exit 0.
