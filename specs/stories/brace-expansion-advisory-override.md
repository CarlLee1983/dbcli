# Raise the brace-expansion override past its open advisories

## Goal

`bun run audit` (step 3 of `make verify`, `scripts/audit.ts`) fails on unmodified `main` with `3 vulnerabilities (2 high, 1 moderate)`, all in `brace-expansion@5.0.9`, which reaches the tree through `eslint > @eslint/config-array > minimatch` and `typescript-eslint > … > minimatch`: GHSA-qhr7-859c-m2p7 (`>=4.0.0 <5.0.11`), GHSA-6j4f-fj2g-mc7p (`<5.0.10`) and GHSA-q2hr-2g5m-vwhr (`<5.0.12`). The root `overrides` in `package.json` already pins `brace-expansion` (currently `^5.0.9`, `package.json:137`), following the precedent of commit `37179d0b` ("chore: [deps] pin brace-expansion ^5.0.6 (GHSA-jxxr-4gwj-5jf2)"). When this Story is done, that override reads `^5.0.12`, `bun.lock` is regenerated to match (currently `bun.lock:48` and `bun.lock:252`), and `make verify` passes again. Line numbers are locators only.

## Out of Scope

- Any other dependency, and any other entry in `overrides`.
- Upgrading `eslint`, `typescript-eslint`, `minimatch` or any other package to escape the advisory instead of overriding it.
- `scripts/audit.ts` and every other script or gate definition, including `Makefile`.
- `CHANGELOG.md`; the entry is written at release time.
- ForgeFlow files: `specs/handoff.md`, `specs/stories/DBCLI-*`, `AGENTS.md`. This Story is a Warrant single-file Story and its commit carries no `Story:` trailer.
- Releasing: version numbers, tags, push, merge.

## Acceptance Criteria

1. The `overrides` entry for `brace-expansion` in `package.json` is `"^5.0.12"`, and `git diff main...HEAD -- package.json` shows exactly one removed line, `"brace-expansion": "^5.0.9",`, and one added line, `"brace-expansion": "^5.0.12",`, with no other `+`/`-` content lines.
2. Every resolved `brace-expansion` version in `bun.lock` is 5.0.12 or higher: `grep -o 'brace-expansion@[0-9][0-9.]*' bun.lock` prints only versions `>= 5.0.12`.
3. Every changed content line in `bun.lock` is a `brace-expansion` entry: `git diff main...HEAD -- bun.lock | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | grep -vE '^[+-][[:space:]]*"brace-expansion": '` prints nothing.
4. `bun install --frozen-lockfile` exits 0 on a clean checkout of the change.
5. `bun run audit` prints `No vulnerabilities found` and exits 0.
6. With the integration test services running, `make verify` exits 0.
7. `git diff --name-status main...HEAD` lists exactly `package.json` and `bun.lock` (both `M`), plus this Story file, `specs/stories/brace-expansion-advisory-override.md` (`A`), and nothing else.
