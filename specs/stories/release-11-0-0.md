# Release 11.0.0

## Goal

Prepare `@carllee1983/dbcli@11.0.0` from `main` at
`c9d02fecca48a9299951ea0a7425b382a1ede50b`, containing all merged changes since
the published 10.0.0 release (PR #219, Story DBCLI-041).

This is a major release because `dbcli init --uri` now writes a MongoDB
connection string as field config instead of storing it verbatim in `uri`, and
`--uri` combined with field flags or `--use-env-refs` is now an error. Explain
the upgrade impact without implying that existing configs holding `uri` stop
working: they are not migrated and keep connecting as before.

Complete the release notes: the Unreleased section currently records only the
changed behaviour, so add the new capabilities — the `options` field for MongoDB
field config (rejected when it duplicates a dedicated field), the
`--replica-set`, `--srv`, `--tls` / `--no-tls` init flags, and the doctor
warning when `uri` and `options` are both set. Synchronize the package and five
plugin/extension manifests at 11.0.0 and update the security-policy table to the
current major under its existing policy. The parent release task owns remote
review, merge, tagging and publication.

## Out of Scope

- Product source, tests, dependency versions or lockfile, workflows, repository
  settings, secrets, and any change to security-policy commitments.
- Files other than `package.json`, `.claude-plugin/plugin.json`,
  `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`,
  `gemini-extension.json`, `plugins/dbcli-agent/.codex-plugin/plugin.json`,
  `CHANGELOG.md`, `SECURITY.md`, and this Story.
- Rewriting the 10.0.0 or older changelog sections.
- Pushing, opening or merging a PR, tagging, publishing to npm or GitHub,
  configuring persistent publishing access, or granting human review approval
  from this local preparation task.
- Weakening, replacing or skipping a required verification gate to claim a
  full pass. Missing database services are a blocker, not a passing result.

## Acceptance Criteria

1. The six package/plugin/extension manifests have version `11.0.0`; their only
   changes are the version strings, and `bun run manifest:check` passes.
2. `CHANGELOG.md` has an empty Unreleased section followed by exactly one
   `## [11.0.0] - 2026-10-14` section.
3. The 11.0.0 notes mark the `--uri` config-shape change as breaking, state that
   existing configs holding `uri` are not migrated and keep working, list the
   conditions under which a connection string is still stored as `uri`, and
   state that `--uri` with field flags or `--use-env-refs` is now an error.
4. The 11.0.0 notes add an `Added` entry covering the `options` field, the
   `--replica-set`, `--srv`, `--tls` / `--no-tls` flags, and the doctor
   `uri`/`options` warning, and retain the SRV `authSource` TXT-first change;
   the 10.0.0 and older changelog bytes match the base commit exactly.
5. `SECURITY.md` identifies 11.x as the sole supported major without changing its
   existing support policy.
6. `bun run format:check`, `bun run docs:check`, `bun run plugin:check`, and
   `bun test tests/unit/scripts/changelog-section.test.ts` pass, and
   `bun run scripts/changelog-section.ts 11.0.0` extracts nonempty release
   notes containing the breaking-change guidance.
7. `bun run release:check` exits 0, with any unavailable-service test skips
   reported explicitly rather than described as full integration coverage.
8. A package dry-run contains the expected built CLI and public entry points,
   with no `src/`, `tests/`, or `node_modules/`; an isolated installation of
   the produced tarball prints `11.0.0` for `--version` and succeeds for
   `--help` without resolving the development checkout.
9. On the clean, committed release revision, the canonical `make verify` passes
   with database services; a service-blocked local run is reported as partial.
10. The committed diff is limited to the nine files above, the worktree is
    clean, and the handoff reports the exact commit, tree, validation evidence,
    blocked checks and residual risks.
