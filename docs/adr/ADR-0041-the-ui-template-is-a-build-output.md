# The UI template is a build output

* Status: accepted
* Date: 2026-10-01

`assets/ui-template.html` was tracked, yet `scripts/build.ts` regenerates and
overwrites it on every `bun run build`: it bundles `src/ui-template/src/main.tsx`
minified, inlines the Tailwind CSS, writes the result and records its hash in
`dist/.build-stamp`. The committed copy was not what npm users received either:
`package.json` runs `"prepublishOnly": "bun run build"` and ships `assets/`, so
every publish rebuilt the template before packing it. With Bun 1.4.2 locally,
each `make verify` rewrote the file (about 24 lines of differing minified
identifiers) with no source change and left the worktree dirty.

## Decision

**`assets/ui-template.html` is a build output, not a tracked file.** It is
removed from git and listed in `.gitignore`, like `dist/`. `prepublishOnly`
rebuilds it before every publish, so what ships is always what the build of
the published source produces; tracking it only let the commit drift from what
the build produces.

**Two builds of identical source must produce the same template.**
`scripts/check-build-determinism.ts` includes it in `ARTIFACTS`, so
`bun run build:determinism` checks it alongside the `dist/*.mjs` bundles.

**Tests that read the template build it themselves.**
`tests/unit/formatters/html-formatter.test.ts`,
`tests/unit/commands/query.test.ts`, `tests/unit/commands/q.test.ts`,
`tests/unit/commands/export-truncation.test.ts` and
`tests/integration/sqlite-cli-scenarios.test.ts` each call `ensureDistBuilt` in
a `beforeAll`, so each passes on a clean checkout with neither `dist/` nor the
template present, without relying on an earlier test file in the same run
having built.

## Consequences

A fresh clone has no template until `bun run build` runs; `bun run dev` needs
one build before its first HTML output, and the formatter's existing
`Please run 'bun run build' first.` error says so. A source change to the UI no
longer shows a template diff in review; the determinism check, not the diff,
is what guards the built bytes. Why Bun 1.4.2 produced different identifiers
than the committed copy (likely the unpinned Bun version) is not addressed
here.

**Falsified if:** the release flow stops building before npm publish — the
prepublishOnly script in `package.json` no longer runs the build, and the
publishing steps in `CONTRIBUTING.md` no longer build first. The published
template would then be whatever happens to sit in the worktree, and tracking
it would again be the only way to know what ships.
