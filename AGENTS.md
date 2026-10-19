# Repository workflow

Use Bun for development, scripts, builds and tests. Before changing runtime APIs,
frontend entry points, documentation, or operating a database, read the matching
section in [the development guide](docs/development/agent-workflow.md#task-safeguards).

## Intent, verification and review

Warrant bounds work to a human-approved Story with Goal, Out of Scope and
Acceptance Criteria. Implement only the Story selected by the human. A Story is
approved when a human committed it to the default branch or explicitly assigned
it in this session; an uncommitted implementation request alone needs one
explicit approval as written. Agent-authored or agent-committed intent is not
human approval. `specs/stories/` contains legacy records, not a pending queue.

**Canonical verification: `make verify`.** Preserve its gates and the Story's
criteria. Stop and report when a repair requires work outside approved scope.
Completion requires evidence for every criterion and human review of the exact
candidate; a passing command alone is not completion.

Before selecting evidence, read [the workflow paths](docs/development/agent-workflow.md#choose-one-evidence-record):
ForgePilot is required for uncommitted snapshot verification, dependency
scheduling, or candidate-bound local handoff. A single committed PR may use
exact-checkout-revision CI and review evidence. A dirty workspace is ineligible
for that PR-only path. ForgePilot is an operator tool, not a dbcli dependency;
`.forgepilot/` remains local state. Use the existing `$forgepilot` skill and
`forgepilot --help` when that path applies.

For release preparation, follow [the release checklist](CONTRIBUTING.md#pre-release-checklist).
For completion reports and distinct intent/review/publication decisions, follow
[the evidence handoff](docs/development/agent-workflow.md#completion-and-handoff).
Commit, push, merge, tag and publication each require user authorization.

<!-- graft:start -->
## Graft — repo context graph

For any repository task, consult `graft/` before source searches. Use the CLI or
its matching MCP tool from this single navigation table:

| Need | CLI | MCP tool |
| --- | --- | --- |
| Unfamiliar area / orientation | `graft map` | `graft_repo_map` |
| Locate or understand code before broad search | `graft ask "<question or literal identifier>" --source` | `graft_find_code` |
| File API before reading a large file | `graft skeleton <file>` | `graft_file_api` |
| Callers before changing public symbols/contracts | `graft callers <symbol>` | `graft_trace_calls` |
| Exhaustive occurrences / callers of a pattern | `graft grep "<pattern>"` | `graft_find_all` |
| Freshness after code changes | `graft check` | `graft_check_freshness` |

Ranked lookup is not exhaustive. Reuse known identifiers; narrow multi-project
queries with `--in <scope>/`. Trace outgoing or transitive calls with
`--direction out` or `--depth N`. Follow `covers:` file:line spans from the top
relevant node; open exact ranges when truncated or missing needed detail rather
than rereading whole files. Browse `graft/INDEX.md` when useful. Fall back to native
file search for unindexed or incomplete results. After big code changes, refresh
with `graft build` (deterministic, no API key).
<!-- graft:end -->
