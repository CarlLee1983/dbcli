# Make the Skill Author Integration Kit test build dist/ itself

## Goal

`tests/integration/skill-author-integration-kit.test.ts` statically imports `../../assets/integration-kit/skill-author-consumer` (lines 6-10), which imports `@carllee1983/dbcli/core` (`assets/integration-kit/skill-author-consumer.ts:8`). That is the package importing itself, and `package.json` resolves `./core` to `./dist/core.mjs` (`package.json:13-16`). `dist/` is not tracked, so on a clean checkout the test file only loads if some earlier test file has already built `dist/` through `ensureDistBuilt` from `tests/helpers/ensure-dist.ts` (as `tests/integration/core-dist-import.test.ts:11-13` does). When `bun test` happens to run this file first, it fails at module load with `error: Cannot find module '@carllee1983/dbcli/core'`, reported as `# Unhandled error between tests`; this is what fails the integration job on PR #203. When this Story is done, the test file makes sure `dist/` is built before it loads `skill-author-consumer` (for example `ensureDistBuilt` in a `beforeAll` with `BUILD_HOOK_TIMEOUT_MS`, then a dynamic import; the exact form is the implementer's choice), so it passes regardless of test file order, with its test cases and assertions unchanged. This Story ships on `fix/brace-expansion-advisory` on top of `5f2ff937` and merges in the same PR, so every diff below is taken against `5f2ff937`, not `main`. Line numbers are locators only.

## Out of Scope

- `assets/integration-kit/**`. It is the example for external consumers and imports the package by name on purpose.
- `tests/helpers/ensure-dist.ts`, and every other test file.
- `package.json`, `bun.lock`, dependencies, `Makefile`, `bunfig.toml`, and CI workflow files.
- Test ordering or test runner configuration as a way to fix this.
- ForgeFlow files: `specs/handoff.md`, `specs/stories/DBCLI-*`, `AGENTS.md`. This Story is a Warrant single-file Story and its commit carries no `Story:` trailer.
- Releasing: version numbers, tags, `CHANGELOG.md`, push, merge.

## Acceptance Criteria

1. With `dist/` absent (moved aside, e.g. `mv dist /tmp/dbcli-dist-aside`, or never built), `bun test tests/integration/skill-author-integration-kit.test.ts` exits 0, reports `6 pass` and `0 fail`, and its output does not contain `Cannot find module`.
2. Immediately after the run in criterion 1, `dist/core.mjs` and `dist/.build-stamp` exist, showing the test file built `dist/` itself.
3. The test case names and their count are unchanged from `5f2ff937`: `diff <(git show 5f2ff937:tests/integration/skill-author-integration-kit.test.ts | grep -oE "test\('[^']*'") <(grep -oE "test\('[^']*'" tests/integration/skill-author-integration-kit.test.ts)` prints nothing, and each side lists 6 names.
4. No assertion line changed: `git diff 5f2ff937...HEAD -- tests/integration/skill-author-integration-kit.test.ts | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | grep -E 'expect\('` prints nothing.
5. `git diff --name-status 5f2ff937...HEAD` lists exactly `M tests/integration/skill-author-integration-kit.test.ts` and this Story file, `A specs/stories/integration-kit-test-builds-dist.md`, and nothing else.
6. With the integration test services running, `make verify` exits 0.
