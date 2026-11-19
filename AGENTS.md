# Repository workflow

Use Bun for development, scripts, builds and tests. Before changing runtime APIs,
frontend entry points, documentation, or operating a database, read the matching
section in [the development guide](docs/development/agent-workflow.md#task-safeguards).

## Development workflow

Start work from the user's explicit task. Ask for clarification when a choice
would materially change its scope. Verify changes with `make verify`, preserve
its gates, and report the changes, results and any unverified items. Complete
any review the user requested.

For releases, follow the [pre-release checklist](CONTRIBUTING.md#pre-release-checklist).
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
