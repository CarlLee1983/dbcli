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
