---
status: accepted
date: 2026-08-13
---

# dbcli is a Bun program, and `engines` says so

`package.json` declared `engines.node: ">=18.0.0"` alongside `engines.bun: ">=1.3.3"`
from the first release. Measured on Node v22.17.1 against the `v1.54.1` `dist/`, none of
that was true except for one entry point:

- `node dist/cli.mjs` throws `ERR_MODULE_NOT_FOUND` before running any code.
  `src/cli.ts:19` keeps the runtime path as a non-literal `'./cli-runtime'` so Bun's
  bundler does not inline the heavy runtime into the `--version` launcher
  (`scripts/build.ts:41-43`). Bun's resolver appends `.mjs`; Node's ESM resolver requires
  the extension on a relative specifier and refuses.
- `import('dist/core.mjs')` — the `./core` subpath export — throws `Bun is not defined`.
  The bundle holds 30 Bun global references (`Bun.file` ×22, `Bun.write` ×5, `Bun.env`
  ×2, `Bun.spawn`); `dist/cli-runtime.mjs` holds 143, including `Bun.Glob`, `Bun.stdin`,
  `Bun.listen` and `Bun.connect`.
- `scripts/build.ts:46` writes `#!/usr/bin/env bun` into the `bin` target, so even a
  fixed bundle would need Bun on `PATH` after `npm install -g`.
- `dist/cli.mjs`'s `--version` fast path branches on `import.meta.main`, which is
  `undefined` before Node 24.

`dist/agent-core.mjs` was and remains clean: zero Bun globals, imports fine under Node.

## Decision

`engines` declares `bun` only. dbcli is a Bun program; `./agent-core` is the one
published entry point Node can import, and the docs say exactly that.

The alternative — making the bundles Node-resolvable — was rejected on cost. It means
switching to `--target node`, replacing 173 Bun API call sites with `node:` equivalents
and a glob dependency, resolving the launcher's runtime path through
`new URL('./cli-runtime.mjs', import.meta.url)`, replacing `import.meta.main`, and adding
a Node runtime e2e suite to CI. That buys a second runtime to maintain forever, for a
path no user has been verified to want; `AGENTS.md` makes Bun the first-class runtime
throughout, down to `bun:sqlite` and `Bun.serve()`.

npm and npx stay supported as *distribution* channels, and the docs are explicit that the
installed executable still runs under Bun.

## Why record this

Removing a declared engine looks like a regression to anyone who reads it as a capability
being taken away. It was not a capability; it was a claim nobody had run. A later reader
tempted to put `node` back to widen the audience should know the cost of making it true
before doing so — and that the honest way in, if the demand ever appears, is to grow a
Node-safe subset outward from `./agent-core`, which already is one, rather than dragging
the whole CLI across.

`tests/integration/runtime-contract.test.ts` enforces the decision in both directions. If
`engines.node` comes back, the test imports `dist/cli.mjs` and `dist/core.mjs` in a bare
Node process and fails unless they actually load — the declaration is allowed to stand
only when the bundles back it up. And `dist/agent-core.mjs` must stay Node-importable
regardless, since that is the one promise the docs still make.

**Falsified if:** `package.json` declares `engines.node`, or
`tests/integration/runtime-contract.test.ts` stops importing the built bundles in a bare
Node process, or `scripts/build.ts` stops targeting Bun.
