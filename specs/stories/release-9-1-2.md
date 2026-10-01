# Release 9.1.2

## Goal

Prepare the 9.1.2 release commit, in the shape of the 9.1.1 release commit
`03ee4e51`: bump the version from `9.1.1` to `9.1.2` and add a `## [9.1.2]`
section to `CHANGELOG.md`. The owner tags and publishes.

Since 9.1.1 (`03ee4e51`), `main` gained five non-merge commits, none of which
changes CLI behaviour, commands, flags, engines, or output:

* `fdcf4659` replaces the ForgeFlow protocol with Warrant (ADR-0040); the
  published package no longer ships `.agents/skills/story-development/SKILL.md`.
* `5f2ff937` raises the `brace-expansion` override to `^5.0.12`, clearing
  GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p and GHSA-q2hr-2g5m-vwhr in a
  development dependency.
* `35a1a0ea` makes the Skill Author Integration Kit test build `dist/` itself.
* `566ff938` makes `assets/ui-template.html` a build output (ADR-0041); the
  published template is still built by `prepublishOnly`.
* `92771a1c` makes the test suite leave nothing in the OS temp directory.

The `## [9.1.2]` section follows the language and structure of the 9.1.1
section (a short Traditional Chinese summary paragraph stating the version and
that nothing user-facing changed, then `### Changed` / `### Fixed` / `### Security`
subsections as fit), and covers each of the five commits above.

## Out of Scope

* Any file other than `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`,
  `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`,
  `gemini-extension.json`, `plugins/dbcli-agent/.codex-plugin/plugin.json`, and
  this Story.
* Existing `CHANGELOG.md` sections.
* Tagging, `npm publish`, GitHub releases, and the Pages check; the owner does
  these.

## Acceptance Criteria

1. In each of the six manifests listed in Out of Scope, the `"version"` field
   reads `"9.1.2"`, and
   `git grep -n -F '"version": "9.1.1"' -- package.json .claude-plugin .codex-plugin .cursor-plugin gemini-extension.json plugins/dbcli-agent/.codex-plugin`
   prints nothing.
2. `git diff main...HEAD -- package.json .claude-plugin .codex-plugin .cursor-plugin gemini-extension.json plugins/dbcli-agent/.codex-plugin | grep -E '^[+-][^+-]'`
   prints exactly six `-` lines containing `"version": "9.1.1"` and six `+`
   lines containing `"version": "9.1.2"`, and nothing else.
3. `CHANGELOG.md` has exactly one `## [9.1.2] - <date>` heading, placed
   directly above `## [9.1.1] - 2026-09-15`, and
   `git diff main...HEAD -- CHANGELOG.md | grep -E '^-[^-]'` prints nothing.
4. The `## [9.1.2]` section covers the Warrant migration (including that
   `story-development` is no longer in the package), the
   `brace-expansion` override with the three GHSA ids, the integration kit test
   fix, the `assets/ui-template.html` build-output change, and the temp
   directory cleanup; and it states that no command, flag, engine, or output
   changed.
5. `bun run release:check` exits 0.
6. With the integration test services running, `make verify` exits 0.
7. `git diff --name-status main...HEAD` lists only `M` for `CHANGELOG.md` and
   the six manifests, plus `A specs/stories/release-9-1-2.md`.
