Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`, not Vite. When implementing or changing a
frontend server, HTML entry point, or React/CSS imports, read
[the Bun frontend reference](docs/development/bun-frontend.md) for the full examples
and local API documentation pointer.

## dbcli Development Mode

During development, `dbcli` is not yet installed in the PATH. Use `bun run src/cli.ts` as a replacement for `dbcli`:

```bash
bun run src/cli.ts list
bun run src/cli.ts schema users --format json
bun run src/cli.ts query "SELECT * FROM users LIMIT 10" --format json
```

## Development Lifecycle

- **Documentation Mandate**: After developing a new feature, fixing a significant bug, or modifying command behavior, you MUST update the user documentation in `docs/user/`.
- **Multi-language Parity**: Ensure updates are applied to all supported language directories (e.g., `docs/user/en/` and `docs/user/zh-TW/`).
- **Format Parity**: Both `index.md` (Markdown) and `index.html` (Polished UI) must be kept in sync.

## ForgePilot Work Control Plane

ForgePilot decides what is actionable next and holds the evidence; Warrant
defines how work is specified and reviewed; this repository's `make verify` is
the canonical verification. ForgePilot is an operator tool — dbcli neither
imports nor requires it, and `.forgepilot/` is local state, not source.

For engineering work, use the existing `$forgepilot` skill and
`forgepilot --help` for work selection, Story lookup, and verification details.
Implement only the approved Story. When commit is not explicitly authorized,
verify the working tree with ForgePilot's `--snapshot` mode; a WIP commit is
not required. Commit only with explicit user authorization. Verification must
run the canonical `make verify` against the exact candidate; a passing candidate
still awaits Human Review before completion is claimed.

## Warrant

This repository follows Warrant. Work is bounded by human-approved intent and
proven by this repository's own verification.

**Verification command:** `make verify`

1. **Intent is approved by a human.** Work starts from a Story at
   `specs/stories/<slug>.md` with Goal, Out of Scope, and Acceptance Criteria.
   A Story is approved only when a human has committed it to the default
   branch, or has explicitly assigned it in the current session. When it is
   not committed and the human only asks you to implement it, ask once whether
   they approve it as written; only a yes counts. A Story you
   drafted or committed yourself is not approved: stop and wait. Approval is
   not a work queue; the human chooses which Story to do.
2. **Completion is proven by evidence.** Run the verification command above and
   repair failures until it passes; if the repair lies outside the Story, stop
   and report it. Map every acceptance criterion to a reproducible observation:
   the command you ran and its output, or the `file:line` you inspected. If no
   verification command is declared, report that and stop; do not choose
   checks yourself.
3. **The standard is not yours to change.** Do not change requirements, weaken
   or reinterpret acceptance criteria, delete or skip failing tests, edit the
   Story to fit the work, or widen scope. When work outside the Story is
   needed, or a criterion conflicts with Out of Scope, stop and report it.

Finish with a completion report of three sections: (1) each acceptance
criterion → command run → observed result; (2) skipped or blocked checks;
(3) residual risks. An inference or substitute check is not an observation.
If the verification command did not pass, or any criterion lacks a passing
observation, the report says **partial**, never done.

Directories under `specs/stories/` are legacy records, not pending work.

## dbcli Usage Guidelines

Before operating on the database, you must perform the following steps in order:

0. (If snippets are needed) `bun run src/cli.ts queries list` — Find available snippets, then execute with `q @<name>`.
1. `bun run src/cli.ts blacklist list` — Verify that sensitive data is protected.
2. `bun run src/cli.ts schema <table> --format json` — Confirm the actual column names of the target table.
3. Then proceed with operations such as `query` / `insert` / `update` / `export`.
4. **In Case of Errors**:
   - When a command with the `--recovery` flag fails, `.dbcli/last-recovery.json` is automatically updated.
   - Use `bun run src/cli.ts recover` to view the recovery plan.
   - Use `bun run src/cli.ts recover --apply` to automatically execute safe remediation steps.

**Guessing column names is strictly prohibited.** Always use `schema` to confirm first.

Notes:
- Prioritize using `--format json`.
- Use `--dry-run` to preview SQL before writing.
- Query-only mode automatically adds `LIMIT 1000`. Use `--no-limit` when querying `information_schema`.
- Skill sources: `assets/SKILL.md` (compact workflow and tabular overview) and `assets/reference.md` (complete subcommands, flags, and examples). `dbcli skill --install <platform>` will write both to the corresponding directory.

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
