# Release 10.0.0

## Goal

Prepare `@carllee1983/dbcli@10.0.0` from `main` at
`3bd041d5e223da4d3df1c956f0f024b808b5e01c`, containing all merged changes since
the published 9.1.2 release. The owner explicitly assigned this release scope
in the current session. The prepared 9.2.0 version was not published; its notes
and the current Unreleased entries belong together in 10.0.0.

This is a major release because initializing a new connection now requires an
explicit connection name and removing a default connection no longer silently
selects another one. Explain the required upgrade steps without implying that
existing v1 readers or named imports were removed. Preserve the PostgreSQL
fixes, time-limited audit exemptions, recorded demo and dependency notes.

Synchronize the package and five plugin/extension manifests at 10.0.0, update
the security-policy table to the current major under its existing policy, and
make pre-release version examples consistently use `--no-git-tag-version`.
The parent release task owns remote review, merge, tagging and publication.

## Out of Scope

- Product source, tests, dependency versions or lockfile, workflows, repository
  settings, secrets, and any change to security-policy commitments.
- Files other than `package.json`, `.claude-plugin/plugin.json`,
  `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`,
  `gemini-extension.json`, `plugins/dbcli-agent/.codex-plugin/plugin.json`,
  `CHANGELOG.md`, `README.dev.md`, `CONTRIBUTING.md`, `SECURITY.md`, and this Story.
- Rewriting the 9.1.2 or older changelog sections, or claiming that all
  advisories have patched versions.
- Pushing, opening or merging a PR, tagging, publishing to npm or GitHub,
  configuring persistent publishing access, or granting human review approval
  from this local preparation task.
- Weakening, replacing or skipping a required verification gate to claim a
  full pass. Missing database services are a blocker, not a passing result.

## Acceptance Criteria

1. The six package/plugin/extension manifests have version `10.0.0`; their only
   changes are the version strings, and `bun run manifest:check` passes.
2. `CHANGELOG.md` has an empty Unreleased section followed by exactly one
   `## [10.0.0] - 2026-10-13` section, with no separate 9.2.0 heading, and
   explicitly says that 9.2.0 was prepared but not published.
3. The 10.0.0 notes explain `--conn-name` for noninteractive init, `--name` as
   the database name, Bun >= 1.4.0, retained v1 readers and named imports,
   first named connection default selection, preservation of existing
   default/no-default on additions, `dbcli use --unset`, no automatic
   replacement when removing the default, and the home-storage migration
   prerequisite for direct-project v2 configurations with a custom `envFile`.
4. The 10.0.0 notes retain the PostgreSQL key-column and enum fixes, update
   permission ordering, audit exemptions and their expiry, demo video,
   dependency advisory details, and merged tag-driven release workflow;
   the 9.1.2 and older changelog bytes match the base commit exactly.
5. Every pre-release `npm version` command in `README.dev.md` and
   `CONTRIBUTING.md` uses `--no-git-tag-version`; `SECURITY.md` identifies 10.x
   as the sole supported major without changing its existing support policy.
6. `bun run format:check`, `bun run docs:check`, `bun run plugin:check`, and
   `bun test tests/unit/scripts/changelog-section.test.ts` pass, and
   `bun run scripts/changelog-section.ts 10.0.0` extracts nonempty release
   notes containing the breaking and upgrade guidance.
7. `bun run release:check` exits 0, with any unavailable-service test skips
   reported explicitly rather than described as full integration coverage.
8. A package dry-run contains the expected built CLI and public entry points,
   with no `src/`, `tests/`, or `node_modules/`; an isolated installation of
   the produced tarball prints `10.0.0` for `--version` and succeeds for
   `--help` without resolving the development checkout.
9. On the clean, committed release revision, `forgepilot verify` runs the
   canonical `make verify` and records its exact result; completion requires
   a passing canonical gate with database services and subsequent human
   review. A service-blocked local run is reported as partial.
10. The committed diff is limited to the eleven files above, the worktree is
    clean, and the handoff reports the exact commit, tree, validation evidence,
    blocked checks and residual risks.
