# Future Development Roadmap — Agent Database Workbench Design

**Date:** 2026-05-08
**Milestone range:** v1.12.0 → v1.15.0
**Status:** Draft → awaiting user review
**Current baseline:** v1.11.0, release gates clean, saved-query discovery shipped

## Goal

Turn `dbcli` from a safe multi-engine database CLI into a practical **database workbench for AI agents**. The next development arc should make the tool better at answering three recurring agent questions:

1. **Where am I connected and what am I allowed to do?**
2. **What is available in this database and which safe command should I run next?**
3. **How do I collect useful diagnostic evidence without guessing table names, snippet names, or dangerous queries?**

This roadmap keeps the implementation deterministic and dependency-light. It does not add an embedded LLM. Instead, it improves the structured context, diagnostics, and recovery surfaces that external agents can consume.

## Strategic Recommendation

Prioritize **Route A: Agent Database Workbench** first, then layer in **Route B: DBA Diagnostics** and **Route C: Production Hardening** as supporting tracks.

Recommended sequence:

| Version | Theme | Primary outcome |
| --- | --- | --- |
| v1.12.0 | Inspect | Agent-friendly database context snapshot |
| v1.13.0 | Report | Markdown/JSON diagnostic report built from reusable collectors |
| v1.14.0 | Guide | Deterministic next-command planner for common database goals |
| v1.15.0 | Recovery | Machine-readable errors with suggested recovery commands |

## Route A — Agent Database Workbench

### Intent

Create a first-class entry point that gives an AI agent enough context to work safely without ad-hoc probing.

### v1.12.0 Candidate: `dbcli inspect`

Add a read-only command:

```bash
dbcli inspect --format json
dbcli inspect --format markdown
dbcli inspect --brief
dbcli inspect --for-agent
```

The command should gather a bounded snapshot:

- connection summary: system, selected connection name, configured database, version if cheaply available
- permission summary: current permission level and write/destructive capability flags
- blacklist summary: protected tables/columns counts, no sensitive values
- object summary: tables/collections/keys/indices count plus small top-N preview
- schema cache summary: whether schema cache exists, freshness metadata when available
- saved-query summary: snippet count, engines represented, top built-in diagnostic intents
- suggested next commands: deterministic commands such as `list`, `schema`, `queries search`, `queries suggest`, `doctor`

### Output contract

JSON should be stable enough for agents and tests:

```json
{
  "system": "postgresql",
  "connection": { "name": "default", "database": "app" },
  "permission": { "level": "query-only", "canWrite": false, "canDestruct": false },
  "blacklist": { "tables": 1, "columnRules": 3 },
  "objects": { "kind": "tables", "count": 42, "sample": ["users", "orders"] },
  "schemaCache": { "available": true, "stale": false },
  "snippets": { "count": 27, "intents": ["perf.slow-query", "capacity.size"] },
  "suggestedCommands": [
    "dbcli list --format json",
    "dbcli queries suggest perf --format json"
  ]
}
```

Exact fields can evolve during implementation, but the design principle is: **safe summary, bounded size, no secrets, actionable next commands**.

### Architecture

Prefer a reusable collector layer instead of hardcoding all logic in the command file:

```text
src/core/inspect/
  collector.ts        # orchestrates safe bounded collectors
  types.ts            # InspectSnapshot and section types
  render-json.ts      # stable JSON shaping if needed
  render-markdown.ts  # human-readable report
src/commands/inspect.ts
```

Collectors should reuse existing modules where possible:

- config loading from `src/core/config*`
- blacklist manager from `src/core/blacklist-manager.ts`
- adapter factory from `src/adapters/factory.ts`
- saved-query loader/fold/search metadata from `src/core/saved-queries/*`
- schema cache metadata from schema cache/index modules

### Boundaries

- `inspect` is read-only.
- It must not run expensive full schema scans by default.
- It must not expose passwords, tokens, URIs with credentials, raw env values, or blacklisted data.
- It should degrade gracefully when disconnected or when optional collectors fail.

## Route B — DBA Diagnostics Pack

### Intent

Build on the v1.11 snippet taxonomy to produce practical diagnostic evidence for humans and agents.

### v1.13.0 Candidate: `dbcli report`

Add:

```bash
dbcli report --format markdown
dbcli report --format json
dbcli report --section health,capacity,perf
```

The report should reuse `inspect` collectors and add diagnostic snippets where available:

- SQL: connections, long-running queries, locks, table sizes, index usage, database size, cache hit
- Redis: keyspace, memory, slowlog, clients, cluster info when available
- Elasticsearch: cluster health, index stats, hot threads, pending tasks, unassigned shards

### Report shape

Markdown is for humans and issue attachments. JSON is for agents and automation. Both should include:

- environment/config status without secrets
- database object summary
- warning list with severity
- evidence sections grouped by taxonomy
- recommended next commands

### Shared collector principle

Avoid separate duplicated logic between `inspect` and `report`. The distinction should be:

- `inspect`: fast context snapshot
- `report`: deeper diagnostic artifact

## Route C — Production Hardening

### Intent

Make release and support work boring and repeatable.

### Candidate: `release:check`

Add a single local script:

```bash
bun run release:check
```

It should run the current release gate in order:

1. `bun audit`
2. `bunx prettier --check "src/**/*.ts" "tests/**/*.ts"`
3. `bun run typecheck`
4. `bun run lint`
5. `bun test`
6. `bun run build`
7. dist smoke tests or targeted packaged-binary checks

This can land in any milestone because it is orthogonal and reduces risk.

### Candidate: `doctor --fix`

Extend `doctor` with safe auto-fixes only:

- create missing local directories
- explain config migration path
- repair known non-secret config shape issues after dry-run preview
- never rewrite credentials without explicit user action

## Route D — Later Multi-Source Consistency

This is valuable but should follow the workbench/report foundation.

Potential goals:

- normalize `query`, `schema`, `export`, and saved-query semantics across SQL, Redis, Elasticsearch, and MongoDB
- define a common `QueryableAdapter` result contract
- add MongoDB saved-query support only after a Mongo command safety model is designed
- document engine-specific limitations in `docs/feature-matrix.md`

This route has higher architectural risk because engines are fundamentally different. Treat it as a later design, not the first v1.12 target.

## Non-Goals for the Immediate Roadmap

- Embedded LLM calls inside `dbcli`.
- Natural language to SQL generation.
- Automatic destructive remediation.
- Full schema scan as part of fast inspect.
- Breaking saved-query frontmatter compatibility.
- Replacing `pg` / `mysql2` / `mongodb` adapters as part of v1.12. Bun-native adapter migration can be evaluated separately.

## Success Criteria

### Product success

- A new agent can run one command and understand the safe next steps.
- Common diagnostic tasks use built-in snippets and structured reports instead of improvised queries.
- Error handling increasingly points agents to deterministic recovery commands.

### Engineering success

- New functionality is additive and backwards compatible.
- JSON outputs have tests that lock important fields.
- All new commands support `--format json` where agent use is expected.
- Release gates remain clean: audit, format, typecheck, lint, tests, build.

## Testing Strategy

For each milestone:

- Unit-test pure collector functions with mocked config/adapter data.
- Integration-test CLI JSON output for shape and secret redaction.
- Add smoke tests for markdown rendering when applicable.
- Keep live DB tests skippable unless explicit live config exists.
- Add regression tests for failure/degraded states, such as missing config, connection failure, missing schema cache, and empty snippet directories.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `inspect` output grows too large | Bad agent ergonomics | Default to bounded summaries; add `--brief`; require explicit deeper report |
| Collectors duplicate command logic | Maintenance drag | Introduce `src/core/inspect` collector layer and reuse existing modules |
| Engine differences leak into common schema | Confusing JSON | Use explicit `kind` and engine-specific optional sections |
| Reports become slow | Poor UX | Keep `inspect` fast; make `report` explicitly deeper |
| Error recovery hints become stale | Bad guidance | Test suggested commands and keep them deterministic |

## Proposed First Milestone Scope: v1.12.0 `dbcli inspect`

### In scope

- Add `inspect` command.
- Add `src/core/inspect` types and collector orchestration.
- Support JSON and Markdown output.
- Include safe summaries for config, permission, blacklist, objects, schema cache, saved queries, and suggested commands.
- Add unit and integration tests.
- Update README and generated skill documentation if the command becomes part of the agent workflow.

### Out of scope

- Deep diagnostic execution.
- Natural language goal planning.
- New built-in snippets.
- MongoDB saved queries.
- Adapter replacement or dependency migration.

## Open Decisions for User Review

1. Should the first milestone command be named `inspect`, `context`, or `overview`? Recommendation: `inspect`.
2. Should Markdown output be included in v1.12.0 or deferred to `report`? Recommendation: include lightweight Markdown for humans.
3. Should `inspect` attempt a cheap connection/version check by default? Recommendation: yes, with timeout and graceful degradation.
4. Should `release:check` be bundled into v1.12.0? Recommendation: yes if it stays script-only and does not distract from `inspect`.

## Recommended Next Step

After this roadmap is approved, write a focused implementation plan for **v1.12.0 `dbcli inspect`**. The plan should define exact files, JSON schema, collector behavior, tests, and documentation updates before implementation starts.
