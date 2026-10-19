# Agent development workflow

## Choose one evidence record

Select the path before implementation. Warrant's approved intent, scope,
acceptance criteria, exact-candidate verification and human review apply to all
paths; selecting a tool does not authorize external writes.

| Candidate or task | Required path | Authoritative completion/evidence record |
| --- | --- | --- |
| Single committed PR, clean checkout | Exact-revision CI and PR review may be used | PR: approved Story, actual CI checkout revision, passing canonical evidence and human review for that candidate |
| Uncommitted candidate | ForgePilot snapshot verification | Selected ForgePilot work item: snapshot/tree, canonical verification, criterion observations and candidate-bound human review |
| Multiple work items with dependencies, or candidate-bound local handoff | ForgePilot scheduling/handoff | ForgePilot goal/work items: dependency order and each candidate's evidence/review |

A dirty or uncommitted workspace cannot use the PR-only path. CI must identify
its actual checkout revision: equal branch-head metadata does not prove equal
PR merge/check-out content. A changed source candidate needs new verification
and review; retain a PASS only while its candidate and environment remain valid.

For ForgePilot, use the existing `$forgepilot` skill and `forgepilot --help` for
selection, Story lookup, start/verify/review commands and dependency scheduling.
Use `--snapshot` when commits are not authorized; a WIP commit is not required.
Record the canonical `make verify` result for the exact snapshot. ForgePilot
and `.forgepilot/` are operator infrastructure, not product dependencies or
tracked source. A one-item plan still provides snapshot and review binding;
it adds no dependency scheduling benefit.

## Completion and handoff

Keep observations in the selected record rather than maintaining competing
completion ledgers. A release index links that record to subsequent publication
observations; it does not grant a new approval. One human decision can be
registered in several tools using the same decision identity/reference without
asking again. Intent approval, acceptance review and publication authorization
are distinct decisions: record each separately and apply only its stated scope.

Finish with three sections:

1. Each acceptance criterion → command run or inspected `file:line` → observed
   result. Include changed files and the exact candidate identity.
2. Skipped or blocked checks, including why they were not observed.
3. Residual risks.

If canonical verification fails or a criterion lacks a passing observation,
report **partial**. An inference or substitute check is not an observation.
A passing candidate still awaits human review before completion is claimed.
Stop and report out-of-scope repairs; keep the approved requirements and gates.

For releases, follow [CONTRIBUTING](../../CONTRIBUTING.md#pre-release-checklist).
Save the durable, sanitized handoff in
[`release-evidence/<version>.json`](release-evidence/README.md), linking candidate,
review, exact-commit CI and publication observations. Label historical local
observations and retain useful failure evidence. Temporary paths may help an
operator during execution but must not be indispensable to the tracked index.

## Task safeguards

### Runtime APIs, scripts and tests

Use Bun rather than Node.js for development: `bun <file>` rather than
`node <file>`/`ts-node`; `bun test` rather than Jest/Vitest; `bun build` rather
than webpack/esbuild; `bun install`, `bun run <script>` and `bunx` rather than
npm/yarn/pnpm/npx equivalents. Bun loads `.env`; do not add dotenv.

Prefer `Bun.file` for file reads/writes and `Bun.$` for shell execution rather
than execa. Use `Bun.serve()` for HTTP, WebSockets, HTTPS and routes rather than
Express; `bun:sqlite` rather than better-sqlite3; `Bun.redis` rather than ioredis;
`Bun.sql` rather than pg/postgres.js; built-in `WebSocket` rather than ws.

Before changing a frontend server, HTML entry point or React/CSS imports, read
[the Bun frontend reference](bun-frontend.md). Use HTML imports with
`Bun.serve()`, rather than Vite. Development CLI examples use
`bun run src/cli.ts` because `dbcli` is not installed in PATH.

### User documentation

After a new feature, significant bug fix or command behavior change, update
`docs/user/`. Keep all supported languages (including `en` and `zh-TW`) and both
`index.md` and `index.html` in sync. Tooling-only workflow changes belong in the
development documentation.

### Database operations

Before operating a database, perform these steps in order using the development
CLI (`bun run src/cli.ts`):

0. If snippets are needed, run `queries list` and execute a known snippet with
   `q @<name>`.
1. Run `blacklist list` to confirm sensitive data protections.
2. Run `schema <table> --format json` to confirm actual column names.
3. Then run the authorized query, insert, update or export. Always confirm
   columns through schema; guessing column names is prohibited.

Prefer `--format json`; preview writes with supported `--dry-run` commands.
Query-only mode adds `LIMIT 1000`; use `--no-limit` for `information_schema`.
When a command with `--recovery` fails, `.dbcli/last-recovery.json` is updated:
`recover` displays the plan and `recover --apply` executes safe remediation.
Apply only within the user's authorization.

For detailed subcommands, flags and examples, read
[assets/SKILL.md](../../assets/SKILL.md) (compact workflow/tabular overview) and
[assets/reference.md](../../assets/reference.md) (complete reference).
`dbcli skill --install <platform>` installs both.
