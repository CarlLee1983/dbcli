# Database Design Assistant v1

**Date:** 2026-08-07
**Status:** Implemented and verified
**Baseline:** dbcli v1.51.2 schema cache, ORM drift, DDL, verification, semantic context, and task packs

## Outcome

Add a local, deterministic Design Assistant for SQL projects. It turns a
reviewable project design artifact into design findings, documentation, an ERD,
and safe migration proposals. It is intended both for reviewing an existing
database and for grounding an external coding agent when bootstrapping a new
project.

The command group is:

```text
dbcli design init --output <path>
dbcli design validate [--file <path>] [--format json|markdown]
dbcli design render [--file <path>] --format json|markdown|mermaid
dbcli design diff [--file <path>] (--against-cache | --against-orm <path>) [--format json|table|markdown]
dbcli design propose [--file <path>] (--against-cache | --against-orm <path>) [--format json|markdown]
```

`init` is the sole file-writing command and requires an explicit output path.
Every other command is read-only. `propose` only emits dry-run commands and
manual-review escalations; it never calls `migrate --execute` or applies DDL.

## Scope and non-goals

v1 supports PostgreSQL, MySQL, and MariaDB design artifacts. `validate` and
`render` remain offline; cache comparison requires only the existing local
schema cache, and ORM comparison reuses the existing local parser path.

No command calls an LLM/provider, stores credentials, sends a prompt, reads
database rows, infers an unreviewed schema from natural language, or changes
the artifact except for explicit `init`. MongoDB, Redis, Elasticsearch,
multi-schema lossless DDL generation, data backfills, destructive migrations,
and automatic repair are out of scope.

An external AI may create a proposed artifact, but that file is untrusted until
`design validate` succeeds and a human reviews the result. dbcli owns the
deterministic evidence and safety gates, not the agent's provider workflow.

## Artifact contract

The default committable artifact is `dbcli.design.json` at the workspace root.
It has one source of truth for the target relational design:

```json
{
  "version": 1,
  "dialect": "postgresql",
  "models": [
    {
      "name": "orders",
      "table": "orders",
      "description": "A customer purchase.",
      "fields": [
        { "name": "id", "type": "uuid", "nullable": false, "primaryKey": true },
        { "name": "customer_id", "type": "uuid", "nullable": false },
        { "name": "created_at", "type": "timestamp", "nullable": false }
      ],
      "indexes": [{ "columns": ["customer_id", "created_at"] }]
    }
  ],
  "relationships": [
    {
      "name": "order-customer",
      "from": { "model": "orders", "field": "customer_id" },
      "to": { "model": "customers", "field": "id" },
      "cardinality": "many-to-one"
    }
  ],
  "accessPatterns": [
    {
      "model": "orders",
      "filters": ["customer_id"],
      "sort": ["created_at"]
    }
  ],
  "decisions": []
}
```

The exact JSON schema is implemented by the core parser. It must bound file
size and collection sizes, reject unknown keys, and reject SQL snippets,
connection fields, secrets, row data, and identifiers that cannot safely be
represented by the v1 command path.

## Core module and seams

`src/core/design` is the deep module. Its interface accepts an explicit local
artifact and returns normalized, sorted value objects; it does not know about
Commander, file output, a database connection, or a provider.

- The parser loads and normalizes `DesignSpec`.
- The reviewer returns a `DesignReviewReport` containing safe `error`, `warn`,
  and `info` findings.
- The renderer turns a validated spec/report into JSON, Markdown, or Mermaid.
- The compiler produces the existing `NormalizedSchema` shape for comparison.
- The proposal planner consumes existing drift entries and produces either a
  known-safe dry-run migration command or a `migration-review` escalation.

The command layer owns explicit file I/O, config/cache loading, Commander
options, output selection, and process exit codes. Existing ORM drift remains
the comparison authority; existing DDL generators remain the SQL authority;
existing verification remains the after-write evidence authority.

## Review rules

The initial deterministic rule set verifies, at minimum:

1. unique model/table/field/index/relationship names and valid identifiers;
2. one primary key per model, valid fields/types, and index fields that exist;
3. relationship endpoint existence, compatible key types, and duplicate/reverse
   relationship ambiguity;
4. `one-to-one` relationships require a unique foreign-key field;
5. `many-to-many` relationships require an explicit bridge model; v1 never
   silently creates one;
6. duplicate, prefix-redundant, or primary-key-redundant indexes;
7. declared access patterns that have no compatible declared index (advisory);
8. destructive or lossy differences that must be manually reviewed.

`error` makes `validate` exit 1. Warnings and informational findings leave it
successful. Results are deterministic and do not expose credentials, SQL, or
database rows.

## Comparison, proposal, and verification

`design diff` compiles the target artifact to `NormalizedSchema`, then delegates
to the existing `compareNormalized` logic against either the local cache or a
supported ORM input. It must preserve the existing exact/case-sensitive schema
identity semantics.

`design propose` is deliberately narrower than a migration generator:

- a losslessly representable missing column or index may use the existing
  shell-safe dry-run proposal;
- all table creation, constraints, enum changes, drops, type/nullability
  changes, qualified targets, data movement, and unsupported constructs must
  emit a deterministic escalation to `dbcli skill tasks plan migration-review`;
- every result includes blacklist/schema preflight, a rollback reminder, and an
  after-write read-only verification plan. It never claims a change is applied.

## Ticket backlog

```text
DGN-00 contract/specification
  -> DGN-01 artifact parser + normalized model
  -> DGN-02 deterministic review rules
  -> DGN-03 validate/init CLI
  -> DGN-04 render/ERD CLI
  -> DGN-05 compiler + cache/ORM diff
  -> DGN-06 safe proposal planner
  -> DGN-07 verification/task/agent integration
  -> DGN-08 tests and release verification
  -> DGN-09 four-way user documentation and generated-skill parity
```

Each ticket must have focused tests. No later ticket may weaken the safety
contract established here. DGN-09 updates `docs/user/en/index.md`,
`docs/user/en/index.html`, `docs/user/zh-TW/index.md`, and
`docs/user/zh-TW/index.html` together.

## Implementation status

- Completed: DGN-00 through DGN-07. The shipped slice includes artifact review,
  rendering, cache and ORM comparison, review-only proposal plans, and the
  `design-review` task pack.
- Completed: DGN-08/DGN-09. Focused and full test suites, typecheck, lint,
  user-document parity, skill parity, and CLI help contracts have passed.

## Acceptance criteria

1. A versioned artifact can be validated and rendered offline with stable JSON,
   Markdown, and Mermaid output.
2. The validator fails closed on malformed designs and physical relationship
   violations; findings are suitable for CI and agent consumption.
3. A valid design can be compared to the cached DB or supported ORM sources
   without connection, schema refresh, or execution.
4. Proposals never execute DDL and escalate any destructive or lossy change.
5. A new-project example and an existing-database evolution example are
   documented in English and Traditional Chinese, in Markdown and HTML.
6. Focused tests plus `bun run typecheck`, `bun run lint`, `bun test`,
   `bun run docs:check`, and relevant skill/platform/CLI contract checks pass.
