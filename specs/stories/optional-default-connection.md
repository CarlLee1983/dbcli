# Allow v2 configurations without a default connection

## Goal

Resolve [issue #212](https://github.com/CarlLee1983/dbcli/issues/212): a project
with multiple named connections can deliberately have no persisted default, so
database operations require an explicit connection selection instead of silently
choosing a target. Deleting the current default must not choose another
connection based on JSON key order.

The baseline is `main` at `3ac368d8`. Its v2 schema requires `default`,
`resolveConnection` falls back to that field, and both the public
`removeConnection` helper and `dbcli init --remove` replace a deleted default
with the first remaining connection.

## Out of Scope

- Changing configuration version 2, the v1 format, or the default created by
  existing initialization and v1-to-v2 migration flows.
- Changing selector precedence, production-selection and production-default
  confirmation rules, configuration mutation approval, integrity records,
  permissions, credential storage, or blacklist protection.
- Allowing a configuration with no connections or deletion of its last
  connection.
- Adding a new graphical control, a new MCP tool, or new connection management
  API endpoints solely to unset the default.
- Dependency upgrades, version bumps, releases, merges, deployments, and access
  to a user's real databases.

## Acceptance Criteria

1. `DbcliConfigV2Schema` accepts a v2 configuration that omits `default`. When
   supplied, `default` remains a nonempty string naming an existing connection;
   `null`, `""`, and nonexistent names are rejected. Existing valid v2
   configurations retain their default and still validate.
2. Resolving a target in a no-default v2 configuration without an explicit
   selector fails before database access, with an actionable error naming
   `--use` and `DBCLI_CONNECTION` and listing available connection names, without
   exposing connection endpoints or credentials. CLI and existing shared-core
   consumers use the same no-default rule rather than selecting the first
   connection or producing an `undefined` target.
3. Explicit selection continues to work without a default. Explicit CLI
   `--use` takes precedence over `DBCLI_CONNECTION`, which takes precedence
   over the persisted default. Conflicting root-level and command-level
   `--use` values remain an error. Blank CLI selectors remain invalid, a
   blank environment selector remains absent, and unknown names and production
   connections retain their existing validation and explicit-selection
   safeguards.
4. `dbcli use --unset` removes the persisted v2 `default` field through the
   existing approved, integrity-protected write path, reports that the default
   was cleared, and succeeds without changing connections when it is already
   absent. It rejects combination with a connection name, `--list`,
   `--confirm-production`, or `--format json` without writing. It does not
   convert or overwrite a v1 configuration.
5. Both the public `removeConnection` helper and `dbcli init --remove` clear
   `default` when deleting its connection, preserve any other default when
   deleting a non-default connection, and preserve the no-default state when
   it already exists. The CLI reports when the default was cleared. Deleting
   the last connection remains an error without modifying the configuration.
6. Connection inventory remains usable without a default: `dbcli use` describes
   that state, text output marks no connection as default, JSON inventory has
   `isDefault: false` for every connection, and `doctor` does not report an
   omitted default as an invalid v2 configuration. Existing initialization,
   v1 migration, explicit switching, and connection renaming preserve their
   established behavior or the existing no-default state as applicable.
7. Automated regression coverage proves the acceptance cases above, including
   negative cases and no unintended database or configuration mutation. Existing
   unrelated tests are not deleted, skipped, or weakened. User documentation
   under both `docs/user/en/` and `docs/user/zh-TW/`, in Markdown and HTML, and
   the shipped CLI/skill reference surfaces describe the optional default,
   explicit-selection error, deletion behavior, and `use --unset` consistently;
   `CHANGELOG.md` records the change under `Unreleased`.
8. `make verify` passes against the final committed revision. The completion
   report maps each criterion to observed test output or inspected file lines,
   lists blocked or skipped checks and residual risks, and leaves human review
   and merging to the user.
