# Semantic Context MVP Design

**Date:** 2026-08-06
**Status:** Implemented — retained as a design record
**Source of inspiration:** WrenAI's version-controlled semantic context; see
[`docs/research/wrenai-feature-analysis.md`](../research/wrenai-feature-analysis.md).

## Outcome

Add a small, local semantic context that lets an agent understand the
project's business vocabulary without granting a new query-execution path.

The MVP exposes two commands:

```text
dbcli semantic validate [--file <path>] [--format json]
dbcli semantic context [--file <path>] [--format json|markdown]
```

`dbcli skill context` also includes the validated semantic context when the
default file exists. No command connects to a database, sends data to an LLM,
or runs a saved query.

## Configuration contract

The default, project-committable file is `dbcli.semantic.json`. It is outside
`.dbcli/`, whose contents are intentionally ignored because they may contain a
project binding or other local state.

```json
{
  "version": 1,
  "models": [
    {
      "name": "orders",
      "table": "orders",
      "description": "Completed customer purchases.",
      "aliases": ["purchases"],
      "fields": [
        {
          "column": "created_at",
          "description": "Time at which the order was created.",
          "aliases": ["order date"]
        }
      ]
    }
  ],
  "metrics": [
    {
      "name": "daily-revenue",
      "description": "Revenue per day from completed orders.",
      "query": "@analytics/revenue"
    }
  ]
}
```

The format deliberately contains no SQL, connection settings, credentials,
embedding data, or relationship declarations. Cached schema foreign keys remain
the source of truth for relationships; saved-query files remain the source of
truth for executable metrics.

## Module and seam

`src/core/semantic` is the deep module and its interface is
`loadSemanticContext(input)`. Its input is the local file, filtered schema, and
available saved-query keys; its output is either a compact, validated context or
a list of deterministic validation errors. The command layer and `skill
context` only consume that result, so parsing, schema checks, blacklist safety,
sorting, and output shaping remain local to one implementation.

Validation rules:

1. The root must have `version: 1`, only the documented keys, and arrays of
   uniquely named models and metrics.
2. A model's `table` must be present in the already filtered schema. A
   blacklisted or unknown table cannot be described.
3. A field's `column` must be present in its model's filtered table schema.
4. A metric's `query` must be one of the currently available saved-query keys.
   The validator locally parses the existing query file to establish that key,
   but never executes or emits its SQL.
5. Names, aliases, and descriptions are bounded plain strings. The validator
   never reads database rows or credentials.

Absence of `dbcli.semantic.json` is valid for `skill context` and produces no
`semantic` key. An explicitly requested file, or a default file that exists but
is invalid, causes the command to fail rather than silently dropping context.

## Non-goals

- No natural-language-to-SQL generation, LLM provider, vector store, MCP
  server, dashboard hosting, or WrenAI runtime dependency.
- No automatic changes to schema, saved queries, permissions, or blacklist.
- No direct Wren MDL import in this first format; WrenAI is beta and a future
  importer can be a separately versioned adapter.

## Acceptance criteria

1. Both semantic commands are offline and read-only.
2. Invalid, unknown, and blacklisted table/column references are rejected.
3. Metric references cannot name an unknown saved query.
4. `skill context --format json` exposes only validated semantic data and
   continues to work when no semantic file exists.
5. Unit tests cover valid input, malformed input, blacklist filtering, unknown
   references, and command output; user documentation is updated in English
   and Traditional Chinese, in both Markdown and HTML.
