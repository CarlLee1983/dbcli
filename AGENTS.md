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

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

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

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->

## Graft usage

For repository orientation, feature discovery, cross-file changes,
dependency analysis, and refactoring:

- Use `graft_repo_map` before exploring an unfamiliar area.
- Use `graft_find_code` before broad manual file searches.
- Use `graft_file_api` before reading an entire large file.
- Use `graft_trace_calls` before changing public symbols or contracts.
- Use `graft_find_all` when exhaustive matching is required.
- Run `graft_check_freshness` after code changes.
- Fall back to native file search when Graft results are incomplete.
