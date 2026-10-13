# Release 9.2.0

## Goal

Prepare the 9.2.0 release commit, in the shape of the 9.1.2 release commit
`dc31c556`: bump the version from `9.1.2` to `9.2.0` and give the changes since
9.1.2 a `## [9.2.0]` section in `CHANGELOG.md`. The owner tags and publishes.

The release is a minor one because the supported runtime floor moves: users on
Bun 1.3.x must upgrade to 1.4.0 (see `specs/stories/bun-floor-for-current-bson.md`).
No command or flag is added or removed.

Since 9.1.2 (`d4ac1e0f`), `main` gained these non-merge commits:

* `c054760c` lets the audit gate carry dated, explained advisory exemptions in
  `scripts/audit-exemptions.json` (ADR-0042); the first entry exempts
  GHSA-vfj7-8cjw-p6xm (`braces`) until 2026-11-30.
* `6325e63a` makes the PostgreSQL schema report primary key, index and foreign
  key columns again (the write gate refused every structured write without
  them), and makes `update` on SQL engines check the permission level before
  connecting and before the blacklist check.
* `f915c592` makes the PostgreSQL schema report enum values again.
* `b7e5e0a2` adds a recorded agent session video to both intro pages and
  READMEs, with re-recording scripts under `scripts/demo/`.
* `217c0a52` raises the Bun floor to 1.4.0 for bson 7.3+.
* `677e99f4` clears the `source-map-js` advisory and exempts the
  `postcss-selector-parser` advisory.

The last two already have entries under `## [Unreleased]`. The new
`## [9.2.0] - <date>` heading goes directly below `## [Unreleased]`, so those
entries become part of 9.2.0 and `## [Unreleased]` is left empty. Under it
comes a short Traditional Chinese summary paragraph stating the version and that
the Bun floor is the one change users must act on, then the existing
subsections extended with entries for the first four commits (`### Fixed` for
the PostgreSQL fixes, the audit gate and video under `### Changed` or
`### Added` as fits), in the language and style of the 9.1.2 section.

## Out of Scope

* Any file other than `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`,
  `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`,
  `gemini-extension.json`, `plugins/dbcli-agent/.codex-plugin/plugin.json`, and
  this Story.
* Rewording existing `CHANGELOG.md` entries, including the two already under
  `## [Unreleased]`.
* Tagging, `npm publish`, GitHub releases, and the Pages check; the owner does
  these.

## Acceptance Criteria

1. In each of the six manifests listed in Out of Scope, the `"version"` field
   reads `"9.2.0"`, and
   `git grep -n -F '"version": "9.1.2"' -- package.json .claude-plugin .codex-plugin .cursor-plugin gemini-extension.json plugins/dbcli-agent/.codex-plugin`
   prints nothing.
2. `git diff main...HEAD -- package.json .claude-plugin .codex-plugin .cursor-plugin gemini-extension.json plugins/dbcli-agent/.codex-plugin | grep -E '^[+-][^+-]'`
   prints exactly six `-` lines containing `"version": "9.1.2"` and six `+`
   lines containing `"version": "9.2.0"`, and nothing else.
3. `CHANGELOG.md` has exactly one `## [9.2.0] - <date>` heading, the first
   `## [` heading after `## [Unreleased]` with no entry between them, and
   `git diff main...HEAD -- CHANGELOG.md | grep -E '^-[^-]'` prints nothing.
4. The `## [9.2.0]` section covers the audit exemptions with
   GHSA-vfj7-8cjw-p6xm, the PostgreSQL key column, enum value and `update`
   permission-order fixes, the demo video, the Bun 1.4.0 floor, and the
   `source-map-js` / `postcss-selector-parser` advisories.
5. `bun run release:check` exits 0.
6. With the integration test services running, `make verify` exits 0.
7. `git diff --name-status main...HEAD` lists only `M` for `CHANGELOG.md` and
   the six manifests, plus `A specs/stories/release-9-2-0.md`.
