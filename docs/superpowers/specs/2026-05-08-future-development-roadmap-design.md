# Future Development Roadmap — Agent Database Workbench Design

**Date:** 2026-05-08
**Last updated:** 2026-05-09
**Milestone range:** v1.12.0 → v1.16.0
**Status:** v1.12.0 ✅ shipped · v1.13.0 ✅ shipped · v1.14.0 ✅ shipped · v1.15.0 ✅ shipped · v1.16.0 ✅ shipped
**Current baseline:** v1.16.0, release gates clean, `dbcli inspect`, `dbcli report`, `dbcli guide`, and `dbcli recovery` (broadened to insert/update/delete/export/schema/inspect) shipped on top of v1.11 saved-query discovery

## Goal

Turn `dbcli` from a safe multi-engine database CLI into a practical **database workbench for AI agents**. The next development arc should make the tool better at answering three recurring agent questions:

1. **Where am I connected and what am I allowed to do?**
2. **What is available in this database and which safe command should I run next?**
3. **How do I collect useful diagnostic evidence without guessing table names, snippet names, or dangerous queries?**

This roadmap keeps the implementation deterministic and dependency-light. It does not add an embedded LLM. Instead, it improves the structured context, diagnostics, and recovery surfaces that external agents can consume.

## Strategic Recommendation

Prioritize **Route A: Agent Database Workbench** first, then layer in **Route B: DBA Diagnostics** and **Route C: Production Hardening** as supporting tracks.

Recommended sequence:

| Version | Theme | Primary outcome | Status |
| --- | --- | --- | --- |
| v1.12.0 | Inspect | Agent-friendly database context snapshot | ✅ shipped (2026-05-08) |
| v1.13.0 | Report | Markdown/JSON diagnostic report built from reusable collectors | ✅ shipped (2026-05-09) |
| v1.14.0 | Guide | Deterministic next-command planner for common database goals | ✅ shipped (2026-05-09) |
| v1.15.0 | Recovery | Machine-readable errors with suggested recovery commands | ✅ shipped (2026-05-09) |
| v1.16.0 | Recovery (broadened) | `--recovery` extended to insert/update/delete/export/schema/inspect; SCHEMA_CACHE_MISSING throw site; dry-run step coverage for writes | ✅ shipped (2026-05-09) |

## Route A — Agent Database Workbench

### Intent

Create a first-class entry point that gives an AI agent enough context to work safely without ad-hoc probing.

### v1.12.0: `dbcli inspect` — ✅ shipped 2026-05-08

> **Status:** Released. Implemented at `src/core/inspect/` + `src/commands/inspect.ts`. Output schema is locked at `schemaVersion: 1`. The remainder of this section is preserved as the original design contract for reference.

Read-only command:

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

### v1.13.0: `dbcli report` — ✅ shipped 2026-05-09

> **Status:** Released. Implemented at `src/core/report/` + `src/commands/report.ts`. Reuses `collectInspect()` for context and runs curated `@diag/*` snippets grouped into `health` / `capacity` / `perf`. Output schema locked at `schemaVersion: 1`. The remainder of this section is preserved as the original design contract for reference.

Command:

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

> **Status:** ✅ delivered in v1.12.0; retained here as the original production-hardening candidate for historical context. The script is the live release gate used by every milestone since.

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

## Shipped Milestones — Retrospective

### v1.12.0 `dbcli inspect` — shipped 2026-05-08

Delivered:
- `inspect` command with `--format json|markdown`, `--brief`, `--for-agent`, `--no-connect`, `--probe-timeout`.
- `src/core/inspect/` collector layer (connection, permission, blacklist, objects, schema cache, snippets, version, suggested commands).
- `release:check` script (audit / format / typecheck / lint / test / build / dist smoke).
- Skill docs and README updated; `schemaVersion: 1` locked.

Resolved open decisions:
- Command name: `inspect` ✓
- Markdown output included ✓
- Cheap version probe with timeout + graceful degradation ✓
- `release:check` bundled into v1.12.0 ✓

### v1.13.0 `dbcli report` — shipped 2026-05-09

Delivered:
- `report` command with `--format json|markdown`, `--section health,capacity,perf`, `--brief`, `--for-agent`, `--no-connect`, `--per-snippet-timeout`, `--max-rows-per-evidence`, `--probe-timeout`.
- `src/core/report/` module (`section-map`, `select-snippets`, `run-diagnostic`, `collector`, JSON + Markdown renderers) reusing `collectInspect()` so context is gathered once.
- Curated read-only `@diag/*` snippet selection (skips snippets with required-without-default params); per-snippet timeout (default 3000 ms) and per-evidence row cap (default 50).
- 6 CLI integration tests covering shape, redaction, `--for-agent`, `--section` validation, Markdown headings, and degraded no-config workspace.
- MongoDB and no-config workspaces emit context-only snapshots with warnings (no built-in mongo snippets in this release).

### v1.14.0 `dbcli guide` — shipped 2026-05-09

Delivered:
- `guide` command with `<goal>` argument plus `--format json|markdown`, `--brief`, `--for-agent`, `--list`, `--probe`, `--probe-timeout`.
- `src/core/guide/` module (`types`, `goal-map`, `build-plan`, `collector`, JSON + Markdown renderers) reusing `collectInspect()` for context and `loadSnippets()` for the inventory.
- Six goals locked at `schemaVersion: 1`: `slow-query`, `capacity`, `health`, `index-usage`, `permissions`, `schema-overview`.
- 9 CLI integration tests covering plan shape, redaction, `--for-agent` brief mode, `--list`, missing/unknown goal exits, Markdown headings, and degraded no-config workspace.
- Risk vocabulary aligned with `dbcli skill tasks plan` (`readonly | dry-run | write | unknown`); v1.14.0 always emits `readonly`. Here `readonly` means "does not mutate the **remote database**" — local cache writes (e.g. `dbcli schema --refresh` updating `.dbcli/schemas/index.json`) are still classified as `readonly`.

Resolved open decisions:
- Goal vocabulary: fixed enumerated list ✓
- Cache-first with optional `--probe` ✓
- Per-step risk tag ✓
- Single-shot output (no `guide run` yet) ✓

### v1.15.0 `dbcli recovery` — shipped 2026-05-09

Delivered:
- `recovery` standalone lookup command with `--code <CODE>`, `--list`, `--format json|markdown`, `--brief`, `--for-agent`, plus placeholder bindings (`--hint`, `--snippet`, `--table`).
- `src/core/recovery/` module (`types`, `recovery-steps`, `classify`, `emit`, JSON + Markdown renderers).
- 14 recovery codes locked at `schemaVersion: 1`: `CONFIG_MISSING`, `CONN_REFUSED`, `CONN_AUTH_FAILED`, `CONN_TIMEOUT`, `CONN_HOST_NOT_FOUND`, `CONN_UNKNOWN`, `PERMISSION_DENIED`, `BLACKLIST_TABLE`, `BLACKLIST_COLUMN_WRITE`, `SNIPPET_NOT_FOUND`, `SNIPPET_AMBIGUOUS`, `SNIPPET_PARAM_MISSING`, `SCHEMA_CACHE_MISSING`, `UNKNOWN`.
- `--recovery` flag wired into `dbcli query` and `dbcli q`. On failure, the envelope is emitted to stdout as JSON, the human stderr message is suppressed, and the process exits non-zero. Other commands preserve their existing error behavior; broader integration is planned for v1.16+.
- 46 tests covering recovery-steps, classifier, JSON + Markdown renderers, the standalone command, and `--recovery` integration on both `query` and `q` (including the empty-workspace + unknown-snippet paths).
- First surface to emit non-`readonly` `GuideStep` risks (`dry-run` / `write`); the `GuideStep` contract from v1.14.0 is reused unchanged.

Resolved open decisions:
- Opt-in via `--recovery` flag (not always-on) ✓
- Envelope to stdout, suppress stderr message ✓
- v1.15.0 wires only `query` + `q` ✓
- Standalone `dbcli recovery` lookup with `--list` ✓

### v1.16.0 broaden `--recovery` integration — shipped 2026-05-09

Delivered:
- `--recovery` flag wired into `insert`, `update`, `delete`, `export`, `schema`, `inspect`. Output channel + exit-code semantics identical to v1.15.0's `query` / `q`: envelope to stdout, human stderr suppressed, non-zero exit.
- `dbcli inspect --require-schema-cache` — first real CLI surface that throws `SchemaCacheMissingError`, giving `SCHEMA_CACHE_MISSING` classifier coverage end-to-end without touching the size-guard or DataExecutor schema-fetch behavior.
- `RecoveryContext.writeOperation` (additive, optional) plus new `risk: 'dry-run'` step branches in `BLACKLIST_COLUMN_WRITE` and `PERMISSION_DENIED`. When the failing operation was an INSERT / UPDATE / DELETE, the envelope leads with a `dbcli <verb> <table> --dry-run` suggestion before the readonly inventory steps. Step count stays under `MAX_RECOVERY_STEPS` (6).
- New `requireSchemaCacheOrThrow` helper in `src/core/inspect/`, with 6 unit tests.
- 10 new unit tests for the dry-run step branches; ~12 new integration tests in `tests/integration/recovery.test.ts` covering all six newly-wired commands plus the `--require-schema-cache` throw site.
- `RecoveryEnvelope` shape unchanged; `RECOVERY_SCHEMA_VERSION` unchanged at 1; the 14 recovery codes unchanged.

Resolved open decisions:
- Throw site for `SchemaCacheMissingError`: `inspect --require-schema-cache` (not size-guard, not DataExecutor) ✓
- Dry-run step granularity: keyed on `RecoveryContext.writeOperation` (`INSERT|UPDATE|DELETE`) ✓
- No envelope on success runs (`ok: false` only) ✓
- No new i18n strings; `--recovery` and `--require-schema-cache` help text are constants in `src/cli.ts` and `src/commands/{schema,inspect}.ts` ✓

## Next Milestone Focus: v1.17.0

Two candidate tracks; pick during the next planning cycle:

### Candidate A: Route D — multi-source consistency

- Normalize `query` / `schema` / `export` semantics across SQL, Redis, Elasticsearch, MongoDB.
- Define a common `QueryableAdapter` result contract.
- Add MongoDB saved-query support after a Mongo command safety model lands.

### Candidate B: Recovery v2 — automated remediation prompt-pack

- Generate `dbcli skill tasks` plans directly from `RecoveryEnvelope` recovery steps so an agent can promote a failure into a guided fix loop.
- Introduce a `dbcli recovery run --code <CODE>` mode that walks readonly steps locally and surfaces dry-run / write steps as confirmation prompts.
- Decide whether to introduce success-shape envelopes (`ok: true` symmetry).

## Recommended Next Step

Pick a v1.17.0 candidate (A vs B) and write a focused implementation plan, mirroring the structure of the v1.12.0–v1.16.0 plans (file layout, exact JSON schema, collector reuse, per-task TDD steps, release gates).
