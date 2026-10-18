# Release 12.0.0

Status: Approved and assigned by the human in the current session on 2026-10-18.
Authorization covers local preparation and verification under this Story.
The resulting candidate still requires Human Review.

## Goal

Prepare `@carllee1983/dbcli@12.0.0` for the stable npm `latest` channel from
`main` at `b3c30b5e11906c5ee8237192e759f31fca2a75e7`, containing the complete
merged delta since the published 11.0.0 release at
`54c133609b1d4a3383251866a4ed75d3d8d44b63`.

This is a major release because single-object SQL `schema` now interprets a
name containing a dot as a qualified object. Previously, `schema audit.orders`
looked up the literal local name `audit.orders` in the default namespace; the
new parser interprets it as namespace `audit`, object `orders`. Document the
required quoted-component migration, alongside metadata omission, grant
redaction, and native authorization error-routing changes.

Synchronize the package and five plugin/extension manifests at 12.0.0, finish
the release notes for the entire candidate, and update the supported-major
table under the existing security policy. Produce an isolated, verified local
release candidate for Human Review. Follow the existing
[release process](../../CONTRIBUTING.md#release-process) and repository
ForgePilot/Warrant rules; remote release operations remain a separate task.
If the source scope changes from the pinned base, reassess and obtain approval
for the changed scope before implementation.

## Out of Scope

- Product source, tests, dependencies or lockfile, workflows, repository
  settings, credentials, and changes to security-policy commitments.
- Files other than `package.json`, `.claude-plugin/plugin.json`,
  `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`,
  `gemini-extension.json`, `plugins/dbcli-agent/.codex-plugin/plugin.json`,
  `CHANGELOG.md`, `SECURITY.md`, and this Story.
- Rewriting the 11.0.0 or older changelog sections; adding unmerged work,
  including the unrelated CSV serialization Story or `.scratch/` contents.
- Commit, push, PR creation or merge, tag creation, npm/GitHub publication,
  publishing configuration, and granting Human Review approval.
- Backport branches, data migrations, new RDS procedure support, and changes
  to the existing query-only or credential-isolation boundaries.
- Weakening or bypassing verification. A failure requiring changes outside
  this Story is reported as blocked rather than repaired under this scope.

## Acceptance Criteria

1. The six package/plugin/extension manifests have version `12.0.0`; their only
   changes from the pinned base are version strings. `bun run manifest:check`
   exits 0 after the security table is updated.
2. `CHANGELOG.md` has an empty Unreleased section followed by exactly one
   `## [12.0.0] - YYYY-MM-DD` section, using the actual local preparation date
   in Asia/Taipei. The 11.0.0 and older sections remain byte-identical to the
   pinned base. `bun run scripts/changelog-section.ts 12.0.0` extracts nonempty
   notes; `bun test tests/unit/scripts/changelog-section.test.ts` passes.
3. The release notes label the dotted-name interpretation as breaking and show
   the PostgreSQL migration from `schema audit.orders` to
   `schema 'public."audit.orders"'`, plus the MySQL/MariaDB equivalent using
   a quoted database and local-name component. They state that unqualified
   names without dots retain their exact-name/default-namespace behavior,
   qualified lookup has no fallback, and other commands keep their existing
   name parsing. Qualified names cannot be combined with `--refresh` or
   `--reset`; no connection or schema-cache migration is required.
4. The notes cover the schema output contract: separate namespace and local
   name, accurate table/view classification, no exact `COUNT(*)` for qualified
   inspection, nullable unknown estimates, and blacklist protection on both
   existing unqualified and new qualified SQL inspection. They explain whole
   key/index/foreign-key omission, expression/partial-index omission when
   dependencies cannot be represented safely, `metadataOmitted`, and failure
   on required metadata read errors. Returned metadata is not guaranteed to
   be complete; consumers must not treat omission as proof of absence.
5. The notes cover mandatory SHOW GRANTS authentication redaction across
   normal and native-read-only MySQL/MariaDB execution, `[REDACTED]` versus
   whole-cell `[OMITTED: grant text could not be safely redacted]`, and the
   resulting prohibition on treating that output as replayable grant SQL.
   They retain the documented limits: this protection covers SHOW GRANTS,
   not arbitrary SQL, direct system-table queries, or SHOW CREATE USER.
6. The notes explain `DB_PERMISSION_DENIED` for native authorization failures,
   distinct from authentication and local policy refusal. They identify the
   recovery v1 discriminator `error.details.connectionCode`, outer
   `error.code: "PERMISSION_DENIED"`, empty recovery steps and absent `verify`;
   no envelope migration or automatic privilege repair is introduced.
7. The notes retain the existing assertion receipt fix and RDS CALL evidence
   guidance, and add the previously omitted MongoDB Unix socket URI
   preservation/fallback credential redaction, `blacklist.read` capability,
   agent-mode read-only task planning, corrected safe-backfill flags, and
   migration-review `admin` guidance. They describe the startup bundle
   reduction without presenting the Windows audit-path test correction as a
   product fix or claiming new RDS execution support.
   Every product-facing change in the baseline-to-target diff is accounted
   for by a release-note entry or an explicit rationale in the handoff.
8. `SECURITY.md` identifies 12.x as the sole supported major and 11.x and
   earlier as superseded, preserving the existing current-major-only policy.
   Existing bilingual Markdown/HTML user documentation remains unchanged;
   `bun run docs:check`, `bun run plugin:check`, and `bun run format:check`
   exit 0. Any discovered documentation gap beyond the allowed files is
   reported for a separately approved scope change.
9. After `bun run build`, `bun pm pack --dry-run` lists the built CLI, both
   public entry points and declarations, and the declared shipped assets,
   with no `src/`, `tests/`, `node_modules/`, `.scratch/`, or unrelated local
   files. Create the tarball outside the repository, record its SHA-256, and
   install it into an isolated temporary directory using Bun. Invoking its
   installed `dbcli` from outside the development checkout prints `12.0.0`
   for `--version` and exits 0 for `--help`.
10. `bun run release:check` exits 0 locally against the prepared candidate.
    The assigned ForgePilot work item is verified with
    `forgepilot verify <work_id> --snapshot`, running canonical `make verify`
    with required database services against the exact isolated snapshot.
    Record the candidate revision, tree, evidence ID, command results and
    individual skips. Missing services, a failed gate or missing observation
    yields **partial**; checks on the source base do not prove the new
    candidate. A passing candidate still awaits Human Review.
11. Final diff review confirms only the nine allowed files changed relative
    to the pinned base. The verification/package source contains only that
    candidate, excluding unrelated untracked work while preserving it in the
    user's workspace. The handoff maps each criterion to its actual command
    output or inspected file lines, lists blocked/skipped checks and residual
    risks, and records that no commit or external release operation occurred.
    Rollback guidance notes that reverting to 11.0.0 removes the new metadata
    and grant protections and may break newly adopted qualified-name calls.

## Assessment evidence

The [11.0.0 release](https://github.com/CarlLee1983/dbcli/releases/tag/v11.0.0)
and npm `latest` metadata agreed on the baseline SHA during the assessment.
The [target CI run](https://github.com/CarlLee1983/dbcli/actions/runs/39126225470)
passed all 11 jobs, with canonical `make verify` passing all 22 gates at the
pinned target: 7,454 tests passed, one zsh case skipped, zero failures;
performance tests had 27 passes and two SQL benchmark skips. This is source
assessment evidence, not verification of the future 12.0.0 candidate.

[Pages deployment](https://github.com/CarlLee1983/dbcli/actions/runs/39126225115)
already published the target's documentation while npm remained at 11.0.0.
Record this channel difference in the handoff; release preparation alone does
not publish the package or close that gap.
