# Make the test suite leave nothing behind in the OS temp directory

## Goal

After a full test run, nothing the tests created remains in the OS temp
directory (`TMPDIR`). On `main` at `891a4979`, with a fresh empty directory as
`TMPDIR` and the integration services running,
`SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test`
reported `6954 pass` and `0 fail` and left 134 entries in `TMPDIR`. Apart from
`node-jiti/` (the config cache that tailwind writes through jiti during the
build, produced by a third party), every entry came from test code, for
example `dbcli-vcmd-*` (33), `test-dbcli-<timestamp>-*` (20, files rather than
directories), `dbcli-vreader-*` (11), `dbcli-verif-*`, `dbcli-prune-*`,
`dbcli-home-*` and `dbcli-audit-write-gate-*` (5 each), `inspect-cache-*` (4),
`dbcli-error-wording-*` (4), `dbcli-recovery*`, and `dbcli-snap-*.json`. Neither
`src/` nor the CLI subprocesses produce these.

Most test files that call `mkdtemp` already remove what they create, with
`rm(dir, { recursive: true, force: true })` in `afterEach`/`afterAll` (for
example `tests/unit/core/config-integrity.test.ts:31-37`) or in a `finally`
(for example `tests/unit/commands/verify-receipt.test.ts:88-90`). The leaks
follow a few patterns: a seed helper called by every test whose directory is
never removed (`seedWork` in `tests/integration/verification-command.test.ts:41-42`,
`seed` in `tests/unit/core/verification/reader.test.ts:33-34`); a directory
created in `beforeEach`/`beforeAll` with no matching `rm`; a `finally` that
restores `HOME` but does not remove the directory
(`withTempHome` in `tests/unit/commands/completion-install.test.ts:9-19`); and
files written straight into `tmpdir()` and never deleted
(`createTempConfig` in `tests/unit/commands/blacklist.test.ts:21-40`). These are
examples, not the list: the measured residue shows more leaking files than a
code reading found, so the set of files to change is defined by the result in
the Acceptance Criteria, not by a fixed list.

When this Story is done, each leaking test file removes what it creates, in the
form this repository already uses (`afterEach`/`afterAll` with
`rm(..., { recursive: true, force: true })`, or a `finally`), written in that
file itself. No shared cleanup helper is added. Test cases and assertions are
not changed, removed, or skipped. This Story branches from `main` after the
Story that turns `ui-template.html` into a build artifact has merged, so every
diff below is taken against `main` at the branch point (`main...HEAD`). Line
numbers are locators only; the content anchors decide.

## Out of Scope

- `src/**` and `scripts/**`, including the HTML report files that
  `src/commands/q.ts:249`, `src/commands/q-mongo.ts:105`, and
  `src/commands/query.ts:745` write to the temp directory on purpose.
- `node-jiti/`, written by a third party during the build.
- Temp directories already accumulated on any machine (about 1400 on the
  owner's); the owner removes those by hand.
- A new shared cleanup helper, and any change under `tests/helpers/`
  (including `tests/helpers/ensure-dist.ts`, which does not touch the temp
  directory).
- `bunfig.toml`, test runner configuration, test ordering, and a global
  `TMPDIR` override as a way to meet the criteria.
- CI workflow files, `Makefile`, `package.json`, `bun.lock`, and dependencies.
- New test files, and new, changed, removed, or skipped test cases or
  assertions.
- Releasing: version numbers, tags, `CHANGELOG.md`, push, merge.

## Acceptance Criteria

1. With the integration test services running, in a fresh empty temp
   directory: `T=$(mktemp -d) && TMPDIR="$T/" SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test`
   exits 0, its summary reports `0 fail`, and afterwards
   `ls -A "$T" | grep -vx node-jiti` prints nothing.
2. No test was lost: running the command from criterion 1 (each run with its
   own fresh `T`) once on HEAD and once on a checkout of
   `$(git merge-base main HEAD)` in the same environment, the summary lines
   matching `^ *[0-9]+ (pass|skip|todo|fail)$` and `^Ran [0-9]+ tests across [0-9]+ files` are
   identical between the two runs, and both report `0 fail`.
3. No test name line was removed or changed:
   `git diff -w main...HEAD -- tests | grep -E '^-[^-]' | grep -E '\b(test|it|describe)(\.[A-Za-z]+)?\('`
   prints nothing.
4. No assertion line was removed or changed:
   `git diff -w main...HEAD -- tests | grep -E '^-[^-]' | grep -E 'expect\('`
   prints nothing.
5. No skip, todo, or focus was added:
   `git diff main...HEAD -- tests | grep -E '^\+[^+]' | grep -E '\.(skip|skipIf|todo|todoIf|only|if)\(|\b(xit|xtest|xdescribe)\('`
   prints nothing.
6. Only existing test files changed:
   `git diff --name-status main...HEAD | awk -F'\t' '!($1=="M" && $2 ~ /^tests\//) && $2!="specs/stories/tests-leave-no-temp-residue.md"'`
   prints nothing.
7. No shared helper was added or changed:
   `git diff --name-only main...HEAD -- tests/helpers` prints nothing.
8. With the integration test services running, `make verify` exits 0.
