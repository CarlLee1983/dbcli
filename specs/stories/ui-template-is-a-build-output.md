# Make assets/ui-template.html a build output, not a tracked file

## Goal

`assets/ui-template.html` is tracked, but every `bun run build` regenerates and
overwrites it: `scripts/build.ts` bundles `src/ui-template/src/main.tsx` with
`Bun.build({ minify: true })`, inlines the Tailwind CSS, and writes the result
(lines 82-106), lists it among the build's artifacts (lines 22-31), and records
its hash in `dist/.build-stamp` (lines 113-120). What npm users receive is not
the committed copy either: `package.json` runs `"prepublishOnly": "bun run build"`
(line 69) and ships `assets/` (line 50), and the release steps in
`CONTRIBUTING.md` (lines 362-368) build before `npm publish`. Tracking the file
therefore only lets the commit drift from what the build produces; locally,
with Bun 1.4.2, every `make verify` rewrites it (about 24 lines of differing
minified identifiers) with no source change, which leaves the worktree dirty.
The likely cause is that Bun is not pinned (`"engines": { "bun": ">=1.3.3" }`,
no `packageManager`); that is an inference and is not addressed here. When this
Story is done:

* `assets/ui-template.html` is removed from git and listed in `.gitignore`.
  `.prettierignore` (line 4) and `tests/helpers/ensure-dist.ts` (the comment at
  lines 16-18 that calls it tracked, and the `BUILD_OUTPUTS` entry at line 68)
  are adjusted to match; whether and how each changes is the implementer's
  choice, within the file list of criterion 9. In `scripts/build.ts`, only
  the comment at lines 19-21 that calls the template tracked is updated.
* Tests that read the template pass on a clean checkout with no `dist/` and no
  `assets/ui-template.html`, building what they need themselves. They are
  `tests/unit/formatters/html-formatter.test.ts`,
  `tests/unit/commands/query.test.ts`, `tests/unit/commands/q.test.ts`,
  `tests/unit/commands/export-truncation.test.ts`, and
  `tests/integration/sqlite-cli-scenarios.test.ts` (the last renders HTML
  through `export --format html`); on `main`, with the template and `dist/`
  moved aside, the four that do not build today fail with
  `UI template not found` (7 and 2 failures), passing only when an earlier
  test file in the same run happens to have built. Each builds (for example
  through `ensureDistBuilt` with `BUILD_HOOK_TIMEOUT_MS`, as
  `tests/helpers/ensure-dist.ts` offers; the exact form is the implementer's
  choice). Today `tests/unit/formatters/html-formatter.test.ts` (lines 9-16)
  builds only when the template is missing, inside a `beforeAll` with no
  explicit timeout.
* `ARTIFACTS` in `scripts/check-build-determinism.ts` (lines 28-33, currently
  only the four `dist/*.mjs` bundles) includes `assets/ui-template.html`, so
  `bun run build:determinism` proves two builds of identical source produce the
  same template.
* `docs/adr/ADR-0041-<slug>.md` records the decision: the template is a build
  output, `prepublishOnly` always rebuilds it before publishing, and tracking
  it only lets the commit drift from the build. It uses the format of
  `docs/adr/ADR-0040-replace-forgeflow-with-warrant.md` (`# Title`,
  `* Status: accepted`, `* Date:`, `## Decision`, `## Consequences`, and a
  closing `**Falsified if:**` paragraph). The falsification condition is that
  the release flow no longer builds before `npm publish`; backticks in that
  paragraph hold only real repository paths (for example `package.json`).

Line numbers locate text on `main` at the time of writing; the content anchors
decide.

## Out of Scope

* `src/ui-template/` and every other UI source file.
* `src/formatters/html-formatter.ts`: its behaviour and its
  `UI template not found ... Please run 'bun run build' first.` error stay as
  they are. That `bun run dev` needs one build before its first HTML output is
  accepted.
* Pinning the Bun version (`engines`, `packageManager`, `.bun-version`, or CI).
* The release flow: the `prepublishOnly` script and the publishing steps in
  `CONTRIBUTING.md`.
* CI workflow files under `.github/workflows/`.
* `scripts/build.ts` other than the comment at lines 19-21 that calls the
  template tracked, and every file under `assets/` other than
  `assets/ui-template.html`.
* `assets/reference.md` and its managed copies (`skills/`,
  `plugins/dbcli-agent/skills/`, `.github/skills/`, `.cursor/`, `.windsurf/`):
  they only say the template is installed alongside the binary, which stays
  true.
* `CHANGELOG.md`, dependencies, `bun.lock`, releases, version bumps, tags,
  pushes, and merges.

## Acceptance Criteria

1. `git ls-files assets/ui-template.html` prints nothing, and
   `git check-ignore assets/ui-template.html` prints `assets/ui-template.html`.
2. With neither `dist/` nor `assets/ui-template.html` present (both moved aside,
   e.g. `mv dist /tmp/dbcli-dist-aside; mv assets/ui-template.html /tmp/`, or a
   fresh checkout after `bun install`),
   `bun test tests/unit/formatters/html-formatter.test.ts tests/unit/ensure-dist.test.ts tests/unit/commands/query.test.ts tests/unit/commands/q.test.ts tests/unit/commands/export-truncation.test.ts tests/integration/sqlite-cli-scenarios.test.ts`
   exits 0 and reports `0 fail`.
3. `grep -n -F "'assets/ui-template.html'" scripts/check-build-determinism.ts`
   prints a line inside the `ARTIFACTS` array, and
   `bun run build:determinism` exits 0 and its output contains
   `✓ assets/ui-template.html`.
4. After `bun run build`, `npm pack --dry-run 2>&1 | grep -F 'assets/ui-template.html'`
   prints a line.
5. Starting from a clean worktree (`git status --porcelain` prints nothing),
   after `make verify` has run, `git status --porcelain` still prints nothing.
6. `ls docs/adr/ADR-0041-*.md` lists exactly one file. Its first line starts
   with `# `, followed by a `* Status: accepted` bullet and a `* Date:` bullet;
   it contains a `## Decision` heading and a `## Consequences` heading; and
   `grep -c -F '**Falsified if:**' docs/adr/ADR-0041-*.md` prints `1`.
7. The ADR states that `assets/ui-template.html` is a build output, that
   `prepublishOnly` rebuilds it before every publish, and that tracking it only
   lets the commit drift from what the build produces. Its `**Falsified if:**`
   paragraph states that the decision no longer holds once the release flow
   stops building before `npm publish`, and names `` `package.json` ``; every
   backticked token in that paragraph is an existing path:
   `` sed -n '/^\*\*Falsified if:\*\*/,/^$/p' docs/adr/ADR-0041-*.md | grep -oE '`[^`]+`' | tr -d '`' | while read -r p; do test -e "$p" || echo "missing $p"; done ``
   prints nothing.
8. With the integration test services running, `make verify` exits 0.
9. `git diff --name-status main...HEAD` lists `D assets/ui-template.html`,
   `M .gitignore`, `M scripts/check-build-determinism.ts`, and
   `A docs/adr/ADR-0041-<slug>.md`; and every other line it lists is one of
   `M .prettierignore`, `M scripts/build.ts`, `M tests/helpers/ensure-dist.ts`,
   `M tests/unit/ensure-dist.test.ts`,
   `M tests/unit/formatters/html-formatter.test.ts`,
   `M tests/unit/commands/query.test.ts`, `M tests/unit/commands/q.test.ts`,
   `M tests/unit/commands/export-truncation.test.ts`,
   `M tests/integration/sqlite-cli-scenarios.test.ts`, or
   `A specs/stories/ui-template-is-a-build-output.md` (this Story, if it is not
   already on `main`).
