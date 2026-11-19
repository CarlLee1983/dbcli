# Agent development workflow

For everyday changes, follow the [repository workflow](../../AGENTS.md#development-workflow).

## Release candidate evidence

For a release, identify the task or PR and the source used for verification,
review and build. For a clean committed PR, record the actual CI checkout
revision, passing canonical verification and review for that revision.

For an uncommitted candidate, keep one local handoff record with:

1. The task or PR and base revision, a complete diff against that base
   (including staged, unstaged, binary and deleted files), and an inventory of
   added files with their reconstructable contents. Hash the candidate's source
   contents, including added files; record file modes and symlink targets where
   they affect reconstruction. A hash alone cannot reconstruct a candidate.
2. The `make verify` command, working directory, relevant environment, actual
   exit status, complete log, attestation when produced, and observations for
   every acceptance criterion. Exclude credentials and private environment
   values from the handoff. The attestation's revision and `dirty_worktree`
   flag alone do not identify an uncommitted candidate.
3. A comparison of the recorded source before and after verification. If source
   changed, refresh the candidate record and rerun verification. Generated
   outputs are not source evidence; build assets must come from the verified
   candidate. Keep unrelated local changes out of the candidate, using an
   isolated checkout when needed, and preserve the original worktree.
4. Human review referencing the same candidate content identity and criterion
   observations. Recheck that identity before handoff; changed content requires
   new verification and review. A pending review stays explicitly pending.

Keep the patch, added-file contents and observations with the local record so
another reviewer can reconstruct the candidate from the base. No WIP commit or
replacement snapshot tool is required. Local records may remain outside the
repository; committing or publishing them needs separate authorization.

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
